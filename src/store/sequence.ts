// Drawing sequence diagrams by hand (toolbar ▸ Sequence): the same pieces the Mermaid importer makes.
// A participant is a box with a lifeline: a dashed line attached to the box at its bottom edge and at a point below
// it. Messages are arrows attached to two participants at one height, so they stay on the lifelines when the
// participants move. Pure document functions; the canvas gestures call them.
import type { BoxElement, ConnectorElement, ContainerElement, DiagramElement, Endpoint, FlowDocument, Point, ToolStyle } from '../model/types';
import { baseFields, makeConnector, makeShape } from '../model/defaults';
import { isLifeline } from '../editor/hitTest';
import { BAR_W, makeLookup } from '../engine/render';
import { connectorPath } from '../engine/connectors';

export { BAR_W };

export const SEQ_BOX = { w: 130, h: 50 };
export const SELF_H = 56; // height of a message to itself (a loop out to the right)
const NEW_LIFELINE = 360; // length of the first participant's lifeline
const BELOW_LAST = 40; // lifelines reach this far below the lowest message

/** A participant's lifeline, from the bottom of its box down to `bottom` (canvas y). */
export function lifelineFor(box: BoxElement, bottom: number, line: ToolStyle): ConnectorElement {
  const c = makeConnector({ x: 0, y: 0, elementId: box.id, anchor: { x: 0.5, y: 1 } }, onLifeline(box, bottom), line);
  c.routing = 'straight'; c.startHead = 'none'; c.endHead = 'none';
  c.style = { ...c.style, strokeStyle: 'dashed', strokeWidth: 1.5, stroke: '#868e96' };
  c.anim = { mode: 'none' };
  return c;
}

/** The point on a participant's lifeline at canvas height `y`. */
export function onLifeline(box: BoxElement, y: number): Endpoint {
  return { x: box.x + box.w / 2, y, elementId: box.id, anchor: { x: 0.5, y: (y - box.y) / Math.max(1, box.h) } };
}

export interface Participant { box: BoxElement; lifeline: ConnectorElement }

/** The participants on the page: boxes with a lifeline. */
export function participantsOf(doc: FlowDocument): Participant[] {
  const byId = new Map(doc.elements.map((e) => [e.id, e]));
  const out: Participant[] = [];
  for (const e of doc.elements) {
    if (!isLifeline(e)) continue;
    const box = byId.get(e.start.elementId!);
    if (box && box.type !== 'connector') out.push({ box, lifeline: e });
  }
  return out;
}

/** The participant whose lifeline column (anywhere below its box, even past the lifeline's end) is under `p`. */
export function columnAt(doc: FlowDocument, p: Point, zoom: number, exclude?: string): Participant | null {
  const tol = 12 / zoom;
  let best: Participant | null = null, bd = Infinity;
  for (const pt of participantsOf(doc)) {
    const { box } = pt;
    if (box.id === exclude || box.rotation) continue;
    const d = Math.abs(p.x - (box.x + box.w / 2));
    if (d <= tol && p.y > box.y + box.h && d < bd) { best = pt; bd = d; }
  }
  return best;
}

/** Make the given participants' lifelines reach at least `y` (plus a little room below). */
export function extendLifelines(doc: FlowDocument, boxIds: string[], y: number): FlowDocument {
  const want = new Set(boxIds);
  return {
    ...doc,
    elements: doc.elements.map((e) => {
      if (!isLifeline(e) || !want.has(e.start.elementId!)) return e;
      const box = doc.elements.find((b) => b.id === e.start.elementId) as BoxElement | undefined;
      if (!box) return e;
      const end = box.y + (e.end.anchor?.y ?? 1) * box.h;
      return end >= y + BELOW_LAST ? e : { ...e, end: onLifeline(box, y + BELOW_LAST) };
    }),
  };
}

/**
 * Add a participant (box, or a pill for an actor) with its lifeline, centred on `at`. With others on the page it
 * lines up with them: same top, a lifeline as long as theirs, and never on top of another participant.
 */
export function addParticipant(doc: FlowDocument, at: Point, actor: boolean, tool: ToolStyle, line: ToolStyle): { doc: FlowDocument; id: string } {
  const others = participantsOf(doc);
  const { w, h } = SEQ_BOX;
  const y = others.length ? Math.min(...others.map((o) => o.box.y)) : at.y - h / 2;
  let x = at.x - w / 2;
  // step right past any participant this would overlap
  for (let guard = 0; guard < others.length + 1; guard++) {
    const hit = others.find((o) => x < o.box.x + o.box.w + 20 && x + w + 20 > o.box.x);
    if (!hit) break;
    x = hit.box.x + hit.box.w + 70;
  }
  const box = { ...makeShape(actor ? 'pill' : 'rectangle', x, y, w, h, tool), anim: { mode: 'off' as const } };
  const bottom = others.length ? Math.max(...others.map((o) => o.box.y + (o.lifeline.end.anchor?.y ?? 1) * o.box.h)) : y + h + NEW_LIFELINE;
  const lifeline = lifelineFor(box, bottom, line);
  return { doc: { ...doc, elements: [...doc.elements, lifeline, box] }, id: box.id };
}

/** A message's highlight travels the way its arrow points: a remembered round trip becomes one-way. */
export function oneWay(anim: ConnectorElement['anim']): ConnectorElement['anim'] {
  return anim?.direction === 'roundTrip' ? { ...anim, direction: 'forward' } : anim;
}

/** Style a message arrow between two participants: straight and level, label above; or a loop for a self-message. */
export function asMessage(c: ConnectorElement, from: BoxElement, to: BoxElement): ConnectorElement {
  const self = from.id === to.id;
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  return {
    ...c,
    routing: self ? 'curved' : 'straight',
    curvature: self ? -1 : 0, // a loop out to the right
    labelPos: 0.5,
    anim: oneWay(c.anim), // a message flows from sender to receiver, even if the arrow tool is set to a round trip
    labelOffset: self ? -(c.text.length * c.textStyle.fontSize * 0.275 + 40) : dx >= 0 ? -14 : 14, // above the arrow; beside a loop
  };
}

/** A message from one participant to another at height `y` (lifelines grow to reach it). */
export function addMessage(doc: FlowDocument, from: BoxElement, to: BoxElement, y: number, tool: ToolStyle): { doc: FlowDocument; id: string } {
  const fx = from.x + from.w / 2, tx = to.x + to.w / 2;
  const start = messageEnd(from, y, activeLevel(doc, from, y), tx), end = messageEnd(to, y, activeLevel(doc, to, y), fx);
  const c = asMessage(makeConnector(start, end, tool), from, to);
  return { doc: extendLifelines({ ...doc, elements: [...doc.elements, c] }, [from.id, to.id], y), id: c.id };
}

/** A message from a participant to itself, starting at height `y`. */
export function addSelfMessage(doc: FlowDocument, box: BoxElement, y: number, tool: ToolStyle): { doc: FlowDocument; id: string } {
  const right = (yy: number) => messageEnd(box, yy, activeLevel(doc, box, yy), Infinity); // the right edge of an active bar
  const c = asMessage(makeConnector(right(y), right(y + SELF_H), tool), box, box);
  return { doc: extendLifelines({ ...doc, elements: [...doc.elements, c] }, [box.id], y + SELF_H), id: c.id };
}

/** A block frame (loop, alt, opt…): a see-through titled container. Sits behind everything, so it never hides arrows. */
export function makeFrame(x: number, y: number, w: number, h: number, tool: ToolStyle, title = 'loop'): ContainerElement {
  return {
    ...baseFields(tool), type: 'container', x, y, w, h, text: title, members: [], anim: { mode: 'off' },
    style: { ...tool.style }, textStyle: { ...tool.textStyle },
  };
}

/** Put a frame at the back of the page. */
export function addFrameBehind(doc: FlowDocument, frame: DiagramElement): FlowDocument {
  return { ...doc, elements: [frame, ...doc.elements.filter((e) => e.id !== frame.id)] };
}

// ---- activation bars -------------------------------------------------------------------------------------------

/** How far each nested activation bar shifts right (UML style); the bar width is BAR_W from the renderer. */
const NEST_SHIFT = 6;
export const MIN_BAR = 20;

const barX = (box: BoxElement, level: number) => 0.5 + (level * NEST_SHIFT) / Math.max(1, box.w);

/** An activation bar on a participant's lifeline from y0 to y1 (canvas y); `level` 0 = on the lifeline, 1+ nested. */
export function makeBar(box: BoxElement, y0: number, y1: number, level: number, tool: ToolStyle): ConnectorElement {
  const top = Math.min(y0, y1), bottom = Math.max(y0, y1, top + MIN_BAR);
  const ax = barX(box, level);
  const c = makeConnector(
    { x: 0, y: 0, elementId: box.id, anchor: { x: ax, y: (top - box.y) / Math.max(1, box.h) } },
    { x: 0, y: 0, elementId: box.id, anchor: { x: ax, y: (bottom - box.y) / Math.max(1, box.h) } },
    tool,
  );
  return { ...c, bar: true, routing: 'straight', startHead: 'none', endHead: 'none', anim: { mode: 'none' }, text: '' };
}

/** The activation bars on a participant: their top and bottom (canvas y) and nesting level. */
export function barsOn(doc: FlowDocument, box: BoxElement): { c: ConnectorElement; y0: number; y1: number; level: number }[] {
  return doc.elements.flatMap((e) => {
    if (e.type !== 'connector' || !e.bar || e.start.elementId !== box.id || !e.start.anchor || !e.end.anchor) return [];
    const ya = box.y + e.start.anchor.y * box.h, yb = box.y + e.end.anchor.y * box.h;
    return [{ c: e, y0: Math.min(ya, yb), y1: Math.max(ya, yb), level: Math.round(((e.start.anchor.x - 0.5) * box.w) / NEST_SHIFT) }];
  });
}

/** How many activation bars cover height `y` on this participant (0 = none). */
export function activeLevel(doc: FlowDocument, box: BoxElement, y: number): number {
  return barsOn(doc, box).filter((b) => y >= b.y0 - 0.5 && y <= b.y1 + 0.5).length;
}

/**
 * Where a message touches a participant at height `y`: on the lifeline, or, while an activation bar is active
 * there, on the edge of the (innermost) bar facing the other end of the message.
 */
export function messageEnd(box: BoxElement, y: number, level: number, towardX: number): Endpoint {
  const p = onLifeline(box, y);
  if (level <= 0) return p;
  const cx = box.x + box.w / 2 + (level - 1) * NEST_SHIFT; // the innermost bar's centre
  const x = towardX >= cx ? cx + BAR_W / 2 : cx - BAR_W / 2;
  return { ...p, x, anchor: { x: (x - box.x) / Math.max(1, box.w), y: p.anchor!.y } };
}

/** Next free nesting level for a new bar on this participant from y0 to y1 (overlapping bars stack to the right). */
export function nextBarLevel(doc: FlowDocument, box: BoxElement, y0: number, y1: number): number {
  const top = Math.min(y0, y1), bottom = Math.max(y0, y1);
  const used = new Set(barsOn(doc, box).filter((b) => b.y0 < bottom && b.y1 > top).map((b) => b.level));
  let l = 0;
  while (used.has(l)) l++;
  return l;
}

/** Add an activation bar on a participant (nesting next to overlapping ones); lifelines grow to reach it. */
export function addBar(doc: FlowDocument, box: BoxElement, y0: number, y1: number, tool: ToolStyle): { doc: FlowDocument; id: string } {
  const c = makeBar(box, y0, y1, nextBarLevel(doc, box, y0, y1), tool);
  // just above the lifeline: bars sit on top of it, under the messages
  const life = doc.elements.findIndex((e) => isLifeline(e) && e.start.elementId === box.id);
  const els = [...doc.elements];
  els.splice(life >= 0 ? life + 1 : els.length, 0, c);
  return { doc: extendLifelines({ ...doc, elements: els }, [box.id], Math.max(y0, y1, Math.min(y0, y1) + MIN_BAR)), id: c.id };
}

// ---- message-by-message playback -------------------------------------------------------------------------------

/** The messages of the sequence diagram(s) on the page: arrows with both ends on participants (not lifelines or bars). */
export function messagesOf(doc: FlowDocument): ConnectorElement[] {
  const parts = new Set(participantsOf(doc).map((p) => p.box.id));
  const notLifeline = (e: DiagramElement): boolean => !isLifeline(e); // a plain boolean, not a type guard
  return doc.elements.filter((e): e is ConnectorElement =>
    e.type === 'connector' && !e.bar && notLifeline(e) && !!e.start.elementId && !!e.end.elementId
    && parts.has(e.start.elementId) && parts.has(e.end.elementId));
}

/** Top-to-bottom order (then left to right) of the given arrows, by where they start. */
export function inReadingOrder(doc: FlowDocument, arrows: ConnectorElement[]): ConnectorElement[] {
  const look = makeLookup(doc, null);
  const at = new Map(arrows.map((c) => [c.id, connectorPath(c, look).pts[0] ?? { x: 0, y: 0 }]));
  return [...arrows].sort((a, b) => at.get(a.id)!.y - at.get(b.id)!.y || at.get(a.id)!.x - at.get(b.id)!.x);
}

/**
 * Message-by-message playback: each arrow gets its own slice of the loop, in reading order, so they light up one
 * after another (the travelling highlight, once per loop). Returns the number of steps.
 */
export function setPlayOrder(doc: FlowDocument, ids: string[]): { doc: FlowDocument; steps: number } {
  const want = new Set(ids);
  const arrows = inReadingOrder(doc, doc.elements.filter((e): e is ConnectorElement => e.type === 'connector' && want.has(e.id) && !e.bar && !isLifeline(e as DiagramElement)));
  const n = arrows.length;
  if (!n) return { doc, steps: 0 };
  const slot = new Map(arrows.map((c, i) => [c.id, i]));
  return {
    doc: {
      ...doc,
      elements: doc.elements.map((e) => {
        const i = slot.get(e.id);
        if (i === undefined || e.type !== 'connector' || e.locked) return e;
        // a small pause after each message before the next one starts
        return { ...e, anim: { ...oneWay(e.anim), mode: 'travel', window: [i / n, (i + 0.85) / n] as [number, number] } };
      }),
    },
    steps: n,
  };
}

/**
 * The play order set on this page, read back from the arrows' play windows: steps in order, each a list of arrow ids
 * (arrows in one step share a window and play together). Arrows with no window aren't in the order.
 */
export function readPlaySteps(doc: FlowDocument): string[][] {
  const byStart = new Map<number, string[]>();
  for (const e of doc.elements) {
    if (e.type !== 'connector' || e.bar || !e.anim?.window) continue;
    const k = Math.round(e.anim.window[0] * 1e4);
    byStart.set(k, [...(byStart.get(k) ?? []), e.id]);
  }
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids);
}

/**
 * Give the arrows in `steps` play windows in that order (one window per step, a short pause after each), and take
 * the window off any other arrow, so they go back to animating all the time. Locked arrows are left as they are.
 */
export function applyPlaySteps(doc: FlowDocument, steps: string[][]): FlowDocument {
  const n = steps.length;
  const slot = new Map<string, number>();
  steps.forEach((g, k) => g.forEach((id) => slot.set(id, k)));
  return {
    ...doc,
    elements: doc.elements.map((e) => {
      if (e.type !== 'connector' || e.locked) return e;
      const k = slot.get(e.id);
      if (k !== undefined) return { ...e, anim: { ...oneWay(e.anim), mode: 'travel', window: [k / n, (k + 0.85) / n] as [number, number] } };
      if (!e.anim?.window) return e;
      const { window: _w, ...rest } = e.anim;
      void _w;
      return { ...e, anim: rest };
    }),
  };
}

/**
 * One click in "Set play order": an arrow already in the order comes out (later steps move up); otherwise it becomes
 * the next step, or joins the last step when `together` (Shift-click) so they play at the same time.
 */
export function togglePlayStep(steps: string[][], id: string, together: boolean): string[][] {
  if (steps.some((g) => g.includes(id))) return steps.map((g) => g.filter((x) => x !== id)).filter((g) => g.length);
  if (together && steps.length) return [...steps.slice(0, -1), [...steps[steps.length - 1], id]];
  return [...steps, [id]];
}

/** Back to all arrows animating together: remove play windows. */
export function clearPlayOrder(doc: FlowDocument, ids: string[]): FlowDocument {
  const want = new Set(ids);
  return {
    ...doc,
    elements: doc.elements.map((e) => {
      if (!want.has(e.id) || e.type !== 'connector' || !e.anim?.window) return e;
      const { window: _w, ...rest } = e.anim;
      void _w;
      return { ...e, anim: rest };
    }),
  };
}
