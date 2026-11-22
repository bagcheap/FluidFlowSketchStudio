// AI edits to the current page (pure). The page is described to Claude as a compact JSON list with short ids (s1, a1,
// c1 …); Claude answers with a list of edit operations in a fixed JSON format (EDIT_SCHEMA, enforced by structured
// outputs). The answer is UNTRUSTED: `parseEdits` re-checks every operation (known op, ids that exist or were added
// earlier in the list, shape kinds from a fixed list, hex colours, plain capped text, limits) and drops anything else;
// `applyEdits` turns the survivors into an ordinary document change (one undo step, done by cmd.applyAiEdits).
// Nothing in the answer is ever executed or rendered as HTML.
import type { BoxElement, ConnectorElement, ContainerElement, DiagramElement, FlowDocument, Point, ShapeKind, ToolStyle } from '../model/types';
import { makeConnector, makeShape, SHAPE_DEFAULT_SIZE } from '../model/defaults';
import { SHAPE_KINDS } from '../model/schema';
import { SHAPE_LABELS } from '../engine/shapes';
import { deleteElements } from '../store/docStore';
import { updateMembership, wrapInContainer } from '../store/containers';
import { nextSlot, type Side } from '../store/quickConnect';
import { routeArrowsAround, spreadEnds } from '../layout/routeArrows';
import { isLifeline } from '../editor/hitTest';

export const MAX_OPS = 200;
const MAX_ADDS = 100;
const MAX_TEXT = 500;

// ---- the page as Claude sees it ------------------------------------------------------------------------------------

export interface PageView { json: string; ids: Map<string, string> } // ids: short id → element id

const shortColor = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : c === 'transparent' ? 'none' : c);

/**
 * The current page as a compact JSON description for the prompt, and the short ids it uses. With `prev` (an earlier
 * view of the same page, as in a tool session), items keep the short ids they had and new items get the next free
 * number, so an id never changes meaning during a conversation.
 */
export function describePage(doc: FlowDocument, prev?: PageView): PageView {
  const ids = new Map<string, string>(), back = new Map<string, string>();
  const next: Record<string, number> = { a: 0, c: 0, t: 0, s: 0 };
  const prefix = (e: DiagramElement) => (e.type === 'connector' ? 'a' : e.type === 'container' ? 'c' : e.type === 'text' ? 't' : 's');
  if (prev) for (const [k, id] of prev.ids) { const m = /^([a-z])(\d+)$/.exec(k); if (m) next[m[1]] = Math.max(next[m[1]] ?? 0, Number(m[2])); if (doc.elements.some((e) => e.id === id)) { ids.set(k, id); back.set(id, k); } }
  for (const e of doc.elements) {
    if (back.has(e.id)) continue;
    const p = prefix(e), k = `${p}${++next[p]}`;
    ids.set(k, e.id); back.set(e.id, k);
  }
  const parent = new Map<string, string>();
  for (const e of doc.elements) if (e.type === 'container') for (const m of e.members) parent.set(m, back.get(e.id)!);
  const r = (v: number) => Math.round(v);
  const items: Record<string, unknown>[] = [];
  for (const e of doc.elements) {
    const id = back.get(e.id)!;
    const base: Record<string, unknown> = { id, ...(e.locked ? { locked: true } : {}), ...(parent.has(e.id) ? { in: parent.get(e.id) } : {}) };
    if (e.type === 'connector') {
      if (e.bar || isLifeline(e as DiagramElement)) continue; // sequence-diagram plumbing: not for editing here
      items.push({ ...base, arrow: true, from: e.start.elementId ? back.get(e.start.elementId) ?? null : null, to: e.end.elementId ? back.get(e.end.elementId) ?? null : null,
        label: e.text.slice(0, 200), dashed: e.style.strokeStyle !== 'solid', heads: e.startHead !== 'none' && e.endHead !== 'none' ? 'both' : e.endHead !== 'none' ? 'end' : e.startHead !== 'none' ? 'start' : 'none', color: shortColor(e.style.stroke) });
    } else if (e.type === 'container') {
      items.push({ ...base, container: true, title: e.text.slice(0, 200), x: r(e.x), y: r(e.y), w: r(e.w), h: r(e.h) });
    } else if (e.type === 'freehand') {
      items.push({ ...base, kind: 'drawing', x: r(e.x), y: r(e.y), w: r(e.w), h: r(e.h) });
    } else {
      items.push({ ...base, kind: e.type === 'shape' ? e.shape : e.type, label: e.type === 'image' ? '' : e.text.slice(0, 200), x: r(e.x), y: r(e.y), w: r(e.w), h: r(e.h),
        ...(e.type === 'shape' ? { fill: e.style.fillStyle === 'none' ? 'none' : shortColor(e.style.fill), line: shortColor(e.style.stroke) } : {}) });
    }
  }
  return { json: JSON.stringify(items), ids };
}

// ---- the edit format ----------------------------------------------------------------------------------------------

export type Placement = 'right' | 'left' | 'above' | 'below';
export type ArrowStyle = 'solid' | 'dashed' | 'thick';
export type Heads = 'end' | 'both' | 'none';
export type EditOp =
  | { op: 'add_shape'; ref: string; label: string; shape: ShapeKind; near: string | null; place: Placement | null; container: string | null }
  | { op: 'connect'; from: string; to: string; label: string; style: ArrowStyle; heads: Heads }
  | { op: 'remove'; id: string }
  | { op: 'set_label'; id: string; label: string }
  | { op: 'set_shape'; id: string; shape: ShapeKind }
  | { op: 'set_color'; ids: string[]; fill: string | null; line: string | null }
  | { op: 'set_arrow'; id: string; style: ArrowStyle | null; heads: Heads | null; reverse: boolean }
  | { op: 'add_container'; ref: string; title: string; members: string[] }
  | { op: 'move_into'; ids: string[]; container: string | null };

const str = { type: 'string' } as const;
const nstr = { type: ['string', 'null'] } as const;
const obj = (op: string, props: Record<string, unknown>) => ({
  type: 'object', additionalProperties: false, required: ['op', ...Object.keys(props)],
  properties: { op: { type: 'string', enum: [op] }, ...props },
});
const SHAPE_ENUM = { type: 'string', enum: [...SHAPE_KINDS] };
const PLACE = { type: ['string', 'null'], enum: ['right', 'left', 'above', 'below', null] };
const STYLE = { type: 'string', enum: ['solid', 'dashed', 'thick'] };
const HEADS = { type: 'string', enum: ['end', 'both', 'none'] };

/** The JSON schema the reply must follow (structured outputs). */
export const EDIT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'ops'],
  properties: {
    summary: str,
    ops: {
      type: 'array',
      items: {
        anyOf: [
          obj('add_shape', { ref: str, label: str, shape: SHAPE_ENUM, near: nstr, place: PLACE, container: nstr }),
          obj('connect', { from: str, to: str, label: str, style: STYLE, heads: HEADS }),
          obj('remove', { id: str }),
          obj('set_label', { id: str, label: str }),
          obj('set_shape', { id: str, shape: SHAPE_ENUM }),
          obj('set_color', { ids: { type: 'array', items: str }, fill: nstr, line: nstr }),
          obj('set_arrow', { id: str, style: { type: ['string', 'null'], enum: ['solid', 'dashed', 'thick', null] }, heads: { type: ['string', 'null'], enum: ['end', 'both', 'none', null] }, reverse: { type: 'boolean' } }),
          obj('add_container', { ref: str, title: str, members: { type: 'array', items: str } }),
          obj('move_into', { ids: { type: 'array', items: str }, container: nstr }),
        ],
      },
    },
  },
} as const;

export const EDIT_SYSTEM_PROMPT = `You edit diagrams in FlowSketch, a hand-drawn diagram editor that animates arrows.

You get the current page as JSON: shapes and icons (id s1, s2 …; kind, label, position x/y/w/h, fill and line colours), text (t1 …), containers (c1 …; title; "in" on an item names the container it is in) and arrows (a1 …; from, to, label, heads, dashed). Then a request for a change.

Reply with a short summary of what you change and a list of operations, in the required JSON format. Only change what the request asks for; leave everything else alone. Use the ids from the page. A shape or container you add gets a "ref" of your choosing (n1, n2 …), which later operations can use in place of an id.

Operations:
- add_shape: a new shape with a label; "near" an existing or new id and "place" right/left/above/below of it (or null for a free spot); "container" to put it in (or null).
- connect: an arrow from → to, with a short label (or ""), style solid/dashed/thick, heads end/both/none.
- remove: delete a shape, arrow, text or container (removing a shape also removes its arrows; removing a container removes what is in it, so to keep the contents move them out first).
- set_label: new text for a shape, arrow, text or container title.
- set_shape: change a shape's kind.
- set_color: fill and/or line colour of items as #rrggbb (null = leave as is; fill "none" is not allowed, use a light colour). Prefer soft fills (for example #d0ebff blue, #d3f9d8 green, #fff3bf yellow, #ffe3e3 red, #e5dbff violet, #f1f3f5 grey) and dark lines.
- set_arrow: an arrow's style, heads (null = leave as is) and reverse = true to swap its direction.
- add_container: a container titled "title" around the given members.
- move_into: move items into a container, or out of any (container null).

Keep labels short (a few words). To show the order things happen in, start arrow labels with step numbers like "1. ", "2. " when the request asks for steps. Never invent ids that are not on the page or added by you. If the request can't be done, reply with no operations and say why in the summary.`;

// ---- checking the reply -------------------------------------------------------------------------------------------

export interface ParsedEdits { summary: string; ops: EditOp[]; dropped: number }

/** Plain text: no control, zero-width or bidi-override characters; capped. */
export function cleanText(v: unknown, max = MAX_TEXT): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, '').slice(0, max).trim();
}
const hex = (v: unknown): string | null => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : null);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null);
const ref = (v: unknown): string | null => (typeof v === 'string' && /^[a-z]{1,3}\d{1,5}$/i.test(v.trim()) ? v.trim() : null);

/**
 * Check a reply against the page: every operation must be well formed and name ids that exist on the page (`known`)
 * or were added by an earlier operation. Anything else is dropped (and counted).
 */
export function parseEdits(raw: unknown, known: Set<string>): ParsedEdits {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(o.ops) ? o.ops.slice(0, MAX_OPS) : [];
  const ids = new Set(known);
  const ops: EditOp[] = [];
  let dropped = Array.isArray(o.ops) ? Math.max(0, o.ops.length - MAX_OPS) : 0, adds = 0;
  const has = (v: unknown) => { const r = ref(v); return r && ids.has(r) ? r : null; };
  const many = (v: unknown) => (Array.isArray(v) ? v.slice(0, 500).map(has).filter((x): x is string => !!x) : []);
  for (const item of list) {
    const p = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    let op: EditOp | null = null;
    switch (p.op) {
      case 'add_shape': {
        const r = ref(p.ref), shape = oneOf(p.shape, SHAPE_KINDS) ?? 'roundRect';
        if (r && !ids.has(r) && adds < MAX_ADDS) {
          op = { op: 'add_shape', ref: r, label: cleanText(p.label), shape, near: has(p.near), place: oneOf(p.place, ['right', 'left', 'above', 'below'] as const), container: has(p.container) };
          ids.add(r); adds++;
        }
        break;
      }
      case 'connect': {
        const from = has(p.from), to = has(p.to);
        if (from && to && adds < MAX_ADDS) { op = { op: 'connect', from, to, label: cleanText(p.label), style: oneOf(p.style, ['solid', 'dashed', 'thick'] as const) ?? 'solid', heads: oneOf(p.heads, ['end', 'both', 'none'] as const) ?? 'end' }; adds++; }
        break;
      }
      case 'remove': { const id = has(p.id); if (id) op = { op: 'remove', id }; break; }
      case 'set_label': { const id = has(p.id); if (id && typeof p.label === 'string') op = { op: 'set_label', id, label: cleanText(p.label) }; break; }
      case 'set_shape': { const id = has(p.id), shape = oneOf(p.shape, SHAPE_KINDS); if (id && shape) op = { op: 'set_shape', id, shape }; break; }
      case 'set_color': {
        const list2 = many(p.ids), fill = hex(p.fill), line = hex(p.line);
        if (list2.length && (fill || line)) op = { op: 'set_color', ids: list2, fill, line };
        break;
      }
      case 'set_arrow': {
        const id = has(p.id), style = oneOf(p.style, ['solid', 'dashed', 'thick'] as const), heads = oneOf(p.heads, ['end', 'both', 'none'] as const);
        if (id && (style || heads || p.reverse === true)) op = { op: 'set_arrow', id, style, heads, reverse: p.reverse === true };
        break;
      }
      case 'add_container': {
        const r = ref(p.ref), members = many(p.members);
        if (r && !ids.has(r) && members.length && adds < MAX_ADDS) { op = { op: 'add_container', ref: r, title: cleanText(p.title, 200) || 'Group', members }; ids.add(r); adds++; }
        break;
      }
      case 'move_into': {
        const list2 = many(p.ids), container = p.container === null ? null : has(p.container);
        if (list2.length && (p.container === null || container)) op = { op: 'move_into', ids: list2, container };
        break;
      }
    }
    if (op) ops.push(op); else dropped++;
  }
  return { summary: cleanText(o.summary, 1000), ops, dropped };
}

// ---- describing operations to the user ----------------------------------------------------------------------------

const WHERE = { right: 'right of', left: 'left of', above: 'above', below: 'below', next: 'next to' } as const;

/** One line per operation, in plain words, using the items' labels. */
export function describeOps(doc: FlowDocument, view: PageView, ops: EditOp[]): string[] {
  const added = new Map<string, string>();
  const name = (id: string) => {
    if (added.has(id)) return `“${added.get(id)}”`;
    const e = doc.elements.find((x) => x.id === view.ids.get(id));
    const label = e ? (e.text || '').split('\n')[0].trim() : '';
    if (e?.type === 'connector') return label ? `arrow “${label}”` : 'an arrow';
    return label ? `“${label}”` : e?.type === 'shape' ? `a ${SHAPE_LABELS[e.shape].toLowerCase()}` : e ? `a ${e.type}` : id;
  };
  return ops.map((o) => {
    switch (o.op) {
      case 'add_shape': { added.set(o.ref, o.label || SHAPE_LABELS[o.shape]); return `Add ${SHAPE_LABELS[o.shape].toLowerCase()} “${o.label}”${o.near ? ` ${WHERE[o.place ?? 'next']} ${name(o.near)}` : ''}${o.container ? ` in ${name(o.container)}` : ''}`; }
      case 'connect': return `Connect ${name(o.from)} → ${name(o.to)}${o.label ? ` (“${o.label}”)` : ''}${o.style !== 'solid' ? `, ${o.style}` : ''}${o.heads !== 'end' ? `, heads: ${o.heads}` : ''}`;
      case 'remove': return `Remove ${name(o.id)}`;
      case 'set_label': return `Rename ${name(o.id)} to “${o.label}”`;
      case 'set_shape': return `Make ${name(o.id)} a ${SHAPE_LABELS[o.shape].toLowerCase()}`;
      case 'set_color': return `Colour ${o.ids.map(name).join(', ')}:${o.fill ? ` fill ${o.fill}` : ''}${o.line ? ` line ${o.line}` : ''}`;
      case 'set_arrow': return `Change ${name(o.id)}:${o.style ? ` ${o.style}` : ''}${o.heads ? ` heads ${o.heads}` : ''}${o.reverse ? ' reversed' : ''}`;
      case 'add_container': { added.set(o.ref, o.title); return `Put ${o.members.map(name).join(', ')} in a container “${o.title}”`; }
      case 'move_into': return o.container ? `Move ${o.ids.map(name).join(', ')} into ${name(o.container)}` : `Move ${o.ids.map(name).join(', ')} out of their container`;
    }
  });
}

// ---- applying them ------------------------------------------------------------------------------------------------

export interface EditTools {
  shape: (k: ShapeKind) => ToolStyle;
  arrow: ToolStyle;
  container: ToolStyle;
  fit: (e: DiagramElement) => DiagramElement;
}

const SIDE: Record<Placement, Side> = { right: 'e', left: 'w', above: 'n', below: 's' };

/**
 * Apply checked operations to the document, in order. Locked items are left alone. Returns the new document, the
 * ids of what was added or changed (to select), and how many operations could not be applied.
 */
export function applyEdits(doc: FlowDocument, view: PageView, ops: EditOp[], tools: EditTools): { doc: FlowDocument; touched: string[]; skipped: number } {
  const real = new Map(view.ids); // short id → element id (added items join as they are created)
  let d = doc;
  let skipped = 0;
  const touched = new Set<string>(), newArrows: string[] = [], spreadOn = new Set<string>();
  const get = (short: string) => { const id = real.get(short); return id ? d.elements.find((e) => e.id === id) : undefined; };
  const put = (id: string, f: (e: DiagramElement) => DiagramElement) => { d = { ...d, elements: d.elements.map((e) => (e.id === id ? f(e) : e)) }; touched.add(id); };
  const free = (): Point => {
    // a free spot: to the right of everything on the page
    const boxes = d.elements.filter((e) => e.type !== 'connector');
    if (!boxes.length) return { x: 0, y: 0 };
    return { x: Math.max(...boxes.map((b) => b.x + (b as BoxElement).w)) + 100, y: Math.min(...boxes.map((b) => b.y)) };
  };
  for (const o of ops) {
    switch (o.op) {
      case 'add_shape': {
        const [w, h] = SHAPE_DEFAULT_SIZE[o.shape] ?? [160, 80];
        const near = o.near ? get(o.near) : undefined;
        const at = near && near.type !== 'connector' ? nextSlot(d, near as BoxElement, SIDE[o.place ?? 'right'], { w, h }) : free();
        let s: DiagramElement = makeShape(o.shape, at.x, at.y, w, h, tools.shape(o.shape));
        if (o.label) s = tools.fit({ ...s, text: o.label });
        d = { ...d, elements: [...d.elements, s] };
        real.set(o.ref, s.id); touched.add(s.id);
        const c = o.container ? get(o.container) : undefined;
        if (c?.type === 'container') d = { ...d, elements: d.elements.map((e) => (e.id === c.id ? { ...c, members: [...c.members, s.id] } : e)) };
        else d = updateMembership(d, [s.id]);
        break;
      }
      case 'connect': {
        const a = get(o.from), b = get(o.to);
        if (!a || !b || a.type === 'connector' || b.type === 'connector') { skipped++; break; }
        const t = tools.arrow;
        const c = makeConnector({ x: 0, y: 0, elementId: a.id, anchor: null }, { x: 0, y: 0, elementId: b.id, anchor: null }, t);
        c.text = o.label;
        styleArrow(c, o.style, o.heads);
        d = { ...d, elements: [...d.elements, c] };
        touched.add(c.id); newArrows.push(c.id); spreadOn.add(a.id); spreadOn.add(b.id);
        break;
      }
      case 'remove': {
        const e = get(o.id);
        if (!e || e.locked) { skipped++; break; }
        const ids = new Set([e.id]);
        if (e.type === 'container') for (const m of collectMembers(d, e)) ids.add(m);
        // arrows attached to anything removed go too
        for (const c of d.elements) if (c.type === 'connector' && ((c.start.elementId && ids.has(c.start.elementId)) || (c.end.elementId && ids.has(c.end.elementId)))) ids.add(c.id);
        d = deleteElements(d, ids);
        for (const id of ids) touched.delete(id);
        break;
      }
      case 'set_label': {
        const e = get(o.id);
        if (!e || e.locked || e.type === 'image' || e.type === 'freehand') { skipped++; break; }
        put(e.id, (x) => (x.type === 'shape' ? tools.fit({ ...x, text: o.label }) : { ...x, text: o.label } as DiagramElement));
        break;
      }
      case 'set_shape': {
        const e = get(o.id);
        if (!e || e.locked || e.type !== 'shape') { skipped++; break; }
        put(e.id, (x) => tools.fit({ ...(x as BoxElement), shape: o.shape } as DiagramElement));
        break;
      }
      case 'set_color': {
        let any = false;
        for (const id of o.ids) {
          const e = get(id);
          if (!e || e.locked) continue;
          any = true;
          put(e.id, (x) => ({ ...x, style: { ...x.style, ...(o.line ? { stroke: o.line } : {}), ...(o.fill && x.type !== 'connector' ? { fill: o.fill, fillStyle: x.style.fillStyle === 'none' ? 'solid' : x.style.fillStyle } : {}) } }));
        }
        if (!any) skipped++;
        break;
      }
      case 'set_arrow': {
        const e = get(o.id);
        if (!e || e.locked || e.type !== 'connector') { skipped++; break; }
        put(e.id, (x) => {
          let c = { ...(x as ConnectorElement), style: { ...x.style } };
          if (o.style || o.heads) styleArrow(c, o.style ?? currentStyle(c), o.heads ?? currentHeads(c));
          if (o.reverse) c = { ...c, start: c.end, end: c.start, startHead: c.endHead, endHead: c.startHead, bends: [...c.bends].reverse() };
          return c;
        });
        break;
      }
      case 'add_container': {
        const members = o.members.map((m) => get(m)).filter((e): e is DiagramElement => !!e && !e.locked).map((e) => e.id);
        const r = members.length ? wrapInContainer(d, members, tools.container, o.title) : null;
        if (!r) { skipped++; break; }
        d = r.doc; real.set(o.ref, r.id); touched.add(r.id);
        break;
      }
      case 'move_into': {
        const items = o.ids.map((m) => get(m)).filter((e): e is DiagramElement => !!e && !e.locked && e.type !== 'connector');
        const target = o.container ? get(o.container) : null;
        if (!items.length || (o.container && target?.type !== 'container')) { skipped++; break; }
        const move = new Set(items.map((e) => e.id));
        d = { ...d, elements: d.elements.map((e) => {
          if (e.type !== 'container') return e;
          let members = e.members.filter((m) => !move.has(m));
          if (target && e.id === target.id) members = [...members, ...items.map((i) => i.id).filter((id) => id !== e.id)];
          return members.length === e.members.length && members.every((m, i) => m === e.members[i]) ? e : { ...e, members } as ContainerElement;
        }) };
        // moved in: place them inside the container (right of what is there), so membership stays put
        if (target?.type === 'container') {
          for (const it of items) {
            const c = d.elements.find((e) => e.id === target.id) as ContainerElement;
            const inside = d.elements.filter((e) => c.members.includes(e.id) && e.id !== it.id && e.type !== 'connector') as BoxElement[];
            const x = inside.length ? Math.max(...inside.map((b) => b.x + b.w)) + 60 : c.x + 30, y = inside.length ? Math.min(...inside.map((b) => b.y)) : c.y + 40;
            put(it.id, (e) => ({ ...e, x, y }));
          }
          d = updateMembership(d, items.map((i) => i.id));
        }
        items.forEach((i) => touched.add(i.id));
        break;
      }
    }
  }
  // new arrows: spread on shared sides, then routed round the shapes like Mermaid imports
  if (spreadOn.size) d = spreadEnds(d, [...spreadOn]);
  const elbows = newArrows.filter((id) => (d.elements.find((e) => e.id === id) as ConnectorElement | undefined)?.routing === 'elbow');
  if (elbows.length) d = routeArrowsAround(d, elbows, { keepAnchors: true }).doc;
  return { doc: d, touched: [...touched].filter((id) => d.elements.some((e) => e.id === id)), skipped };
}

function collectMembers(d: FlowDocument, c: ContainerElement): string[] {
  const out: string[] = [];
  for (const m of c.members) {
    out.push(m);
    const e = d.elements.find((x) => x.id === m);
    if (e?.type === 'container') out.push(...collectMembers(d, e));
  }
  return out;
}

const currentStyle = (c: ConnectorElement): ArrowStyle => (c.style.strokeStyle !== 'solid' ? 'dashed' : c.style.strokeWidth >= 3 ? 'thick' : 'solid');
const currentHeads = (c: ConnectorElement): Heads => (c.startHead !== 'none' && c.endHead !== 'none' ? 'both' : c.endHead === 'none' && c.startHead === 'none' ? 'none' : 'end');

/** Set an arrow's line style and heads (in place, on a fresh copy). */
function styleArrow(c: ConnectorElement, style: ArrowStyle, heads: Heads) {
  const head = c.endHead !== 'none' ? c.endHead : c.startHead !== 'none' ? c.startHead : 'arrow';
  c.style = { ...c.style, strokeStyle: style === 'dashed' ? 'dashed' : 'solid', strokeWidth: style === 'thick' ? Math.max(3.5, c.style.strokeWidth) : style === 'solid' && c.style.strokeWidth >= 3 ? 2 : c.style.strokeWidth };
  c.endHead = heads === 'none' ? 'none' : head;
  c.startHead = heads === 'both' ? head : 'none';
}
