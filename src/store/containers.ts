// Containers (Visio/draw.io style), as pure document functions: membership, moving with members,
// growing to fit, wrapping a selection and removing a container. Members are the ids in
// ContainerElement.members; an element belongs to at most one container (its innermost one).
import type { ContainerElement, DiagramElement, FlowDocument, ToolStyle } from '../model/types';
import { baseFields } from '../model/defaults';
import { containerHeader, elementBounds } from '../engine/render';

/** Space between a container's edge and its members. */
export const CONTAINER_PAD = 24;

export const isContainer = (e: DiagramElement | undefined): e is ContainerElement => e?.type === 'container';

const byId = (doc: FlowDocument) => new Map(doc.elements.map((e) => [e.id, e]));

/** The container an element sits in directly, if any. */
export function parentOf(doc: FlowDocument, id: string): ContainerElement | undefined {
  return doc.elements.find((e): e is ContainerElement => e.type === 'container' && e.members.includes(id));
}

/** The ids plus everything inside them (members of containers, recursively). */
export function withMembers(doc: FlowDocument, ids: Iterable<string>): string[] {
  const map = byId(doc);
  const out = new Set<string>();
  const add = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    const e = map.get(id);
    if (isContainer(e)) e.members.forEach(add);
  };
  for (const id of ids) add(id);
  return [...out];
}

/** Move elements by (dx, dy): boxes, bends and free connector ends (ends attached to shapes follow those shapes). */
export function moveElements(doc: FlowDocument, ids: Set<string>, dx: number, dy: number): FlowDocument {
  if (!dx && !dy) return doc;
  return {
    ...doc,
    elements: doc.elements.map((e) => {
      if (!ids.has(e.id) || e.locked) return e;
      if (e.type === 'connector') {
        const mv = (p: typeof e.start) => (p.elementId ? p : { ...p, x: p.x + dx, y: p.y + dy });
        return { ...e, start: mv(e.start), end: mv(e.end), bends: e.bends.map((b) => ({ x: b.x + dx, y: b.y + dy })) };
      }
      return { ...e, x: e.x + dx, y: e.y + dy };
    }),
  };
}

/** Container depth (0 = not inside any container), for processing inner containers before outer ones. */
function depthOf(doc: FlowDocument, id: string): number {
  let d = 0;
  for (let p = parentOf(doc, id); p && d < 100; p = parentOf(doc, p.id)) d++;
  return d;
}

const center = (doc: FlowDocument, e: DiagramElement) => {
  const b = elementBounds(doc, e);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
};

/**
 * Re-check which container each of `ids` belongs to: the innermost container whose box contains the element's
 * centre (never itself or one of its own members). A container only joins another when it fits entirely inside
 * it, so a duplicated container placed over the original doesn't end up nested in it. Then keep containers
 * behind their members and grow them to fit. Call after elements are moved, created, resized or pasted.
 */
export function updateMembership(doc: FlowDocument, ids: Iterable<string>): FlowDocument {
  let out = doc;
  for (const id of ids) {
    const e = out.elements.find((x) => x.id === id);
    if (!e || e.type === 'connector') continue; // connectors follow the shapes they attach to
    const own = new Set(withMembers(out, [id]));
    const c = center(out, e);
    const eb = elementBounds(out, e);
    const inside = (k: ContainerElement) => (e.type === 'container'
      ? eb.x >= k.x && eb.y >= k.y && eb.x + eb.w <= k.x + k.w && eb.y + eb.h <= k.y + k.h
      : c.x >= k.x && c.x <= k.x + k.w && c.y >= k.y && c.y <= k.y + k.h);
    let best: ContainerElement | undefined;
    for (const k of out.elements) {
      if (k.type !== 'container' || own.has(k.id)) continue;
      if (inside(k) && (!best || k.w * k.h < best.w * best.h)) best = k;
    }
    const cur = parentOf(out, id);
    if (cur?.id === best?.id) continue;
    out = {
      ...out,
      elements: out.elements.map((k) => {
        if (k.type !== 'container') return k;
        if (k.id === cur?.id) return { ...k, members: k.members.filter((m) => m !== id) };
        if (k.id === best?.id) return { ...k, members: [...k.members, id] };
        return k;
      }),
    };
  }
  return growContainers(keepBehindMembers(out));
}

/** A container is drawn behind its members: move it just below its lowest member when needed. */
function keepBehindMembers(doc: FlowDocument): FlowDocument {
  let els = doc.elements;
  for (const c of doc.elements.filter((e): e is ContainerElement => e.type === 'container')) {
    const idx = els.findIndex((e) => e.id === c.id);
    const lowest = Math.min(...c.members.map((m) => els.findIndex((e) => e.id === m)).filter((i) => i >= 0));
    if (!Number.isFinite(lowest) || idx < lowest) continue;
    const rest = els.filter((e) => e.id !== c.id);
    const at = rest.findIndex((e) => e.id === els[lowest].id);
    els = [...rest.slice(0, at), els[idx], ...rest.slice(at)];
  }
  return els === doc.elements ? doc : { ...doc, elements: els };
}

/**
 * The box a container needs around its members (with padding and its title bar), or null if empty.
 * Arrows don't count: they often connect to things outside the container and would stretch it.
 */
export function fitBox(doc: FlowDocument, c: ContainerElement) {
  const map = byId(doc);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const m of c.members) {
    const e = map.get(m);
    if (!e || e.type === 'connector') continue;
    const b = elementBounds(doc, e);
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  if (!Number.isFinite(x0)) return null;
  const head = containerHeader(c);
  return { x: x0 - CONTAINER_PAD, y: y0 - CONTAINER_PAD - head, w: x1 - x0 + CONTAINER_PAD * 2, h: y1 - y0 + CONTAINER_PAD * 2 + head };
}

/** Grow containers (never shrink) so their members fit, innermost first. */
export function growContainers(doc: FlowDocument): FlowDocument {
  const cs = doc.elements.filter((e): e is ContainerElement => e.type === 'container').sort((a, b) => depthOf(doc, b.id) - depthOf(doc, a.id));
  let out = doc;
  for (const { id } of cs) {
    const c = out.elements.find((e) => e.id === id) as ContainerElement;
    const need = fitBox(out, c);
    if (!need) continue;
    const x0 = Math.min(c.x, need.x), y0 = Math.min(c.y, need.y);
    const x1 = Math.max(c.x + c.w, need.x + need.w), y1 = Math.max(c.y + c.h, need.y + need.h);
    if (x0 === c.x && y0 === c.y && x1 === c.x + c.w && y1 === c.y + c.h) continue;
    out = { ...out, elements: out.elements.map((e) => (e.id === id ? { ...c, x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : e)) };
  }
  return out;
}

/** Resize a container to exactly fit its members (grow or shrink). Its parents grow if needed. */
export function fitToContents(doc: FlowDocument, id: string): FlowDocument {
  const c = doc.elements.find((e) => e.id === id);
  if (!isContainer(c)) return doc;
  const box = fitBox(doc, c);
  if (!box) return doc;
  return growContainers({ ...doc, elements: doc.elements.map((e) => (e.id === id ? { ...c, ...box } : e)) });
}

/** Wrap elements in a new container (inside their current container, if they share one). Returns the new id. */
export function wrapInContainer(doc: FlowDocument, ids: string[], tool: ToolStyle, title = 'Container'): { doc: FlowDocument; id: string } | null {
  const members = ids.filter((id) => doc.elements.some((e) => e.id === id));
  if (!members.length) return null;
  const c: ContainerElement = {
    ...baseFields(tool), type: 'container', x: 0, y: 0, w: 0, h: 0, text: title,
    style: { ...tool.style }, textStyle: { ...tool.textStyle }, members, anim: { mode: 'off' },
  };
  const box = fitBox({ ...doc, elements: [...doc.elements, c] }, c)!;
  // the members leave their old containers; the new container joins the one they were in, if any
  const placed: ContainerElement = { ...c, ...box };
  // if the elements shared a container, the new one goes inside it (which then grows to make room)
  const parents = new Set(members.map((m) => parentOf(doc, m)?.id));
  const parent = parents.size === 1 ? [...parents][0] : undefined;
  const els = doc.elements.map((e) => {
    if (e.type !== 'container') return e;
    const kept = e.members.filter((m) => !members.includes(m));
    return e.id === parent ? { ...e, members: [...kept, placed.id] } : kept.length === e.members.length ? e : { ...e, members: kept };
  });
  const at = Math.min(...members.map((m) => els.findIndex((e) => e.id === m))); // just below its lowest member
  const out = growContainers(keepBehindMembers({ ...doc, elements: [...els.slice(0, at), placed, ...els.slice(at)] }));
  return { doc: out, id: placed.id };
}

/** Remove a container but keep its contents (they move up to the container's own container, if any). */
export function removeContainer(doc: FlowDocument, id: string): FlowDocument {
  const c = doc.elements.find((e) => e.id === id);
  if (!isContainer(c)) return doc;
  const parent = parentOf(doc, id);
  return {
    ...doc,
    elements: doc.elements.filter((e) => e.id !== id).map((e) => (e.id === parent?.id && e.type === 'container' ? { ...e, members: [...e.members.filter((m) => m !== id), ...c.members] } : e)),
  };
}
