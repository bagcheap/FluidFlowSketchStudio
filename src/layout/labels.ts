// Arrow label placement (pure): move each chosen arrow's label along its arrow and to one side of it, to the spot
// where it covers the least: other shapes, other labels and other arrows' lines first, then its own line. Labels sit
// beside the line (not on top of it) when there is room, like a well-drawn diagram. Static geometry. The result is
// ordinary labelPos / labelOffset, so a label can still be dragged by hand afterwards.
import type { BoxElement, ConnectorElement, FlowDocument, Point, TextStyle } from '../model/types';
import { defaultToolStyle, makeText } from '../model/defaults';
import { updateMembership } from '../store/containers';
import { connectorPath, pointAt, type ConnectorPath } from '../engine/connectors';
import { connectorLabelSize, elementBounds, makeLookup } from '../engine/render';
import { isLifeline } from '../editor/hitTest';
import { segmentHitsRect } from '../lint/lint';

type Rect = { x: number; y: number; w: number; h: number };

/** Where along the arrow a label may go (middle first) and the clear space kept between label and line (px). */
const ALONG = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.2, 0.8];
const CLEAR = 6;
/** Costs: covering a shape or another label (per px²), crossing another arrow's line, sitting on its own line, leaving the middle. */
const W_BOX = 4, W_LABEL = 3, W_LINE = 2500, W_OWN = 900, W_MOVE = 220;
const MAX_ARROWS = 400;

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const grow = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
const lineHits = (pts: Point[], r: Rect) => { for (let i = 0; i + 1 < pts.length; i++) if (segmentHitsRect(pts[i], pts[i + 1], r)) return true; return false; };

/** The label's box for a position along the path and an offset across it (as the renderer places it). */
function boxAt(path: ConnectorPath, size: { w: number; h: number }, t: number, off: number): Rect {
  const { pt, tan } = pointAt(path, t * path.length);
  const cx = pt.x - tan.y * off, cy = pt.y + tan.x * off;
  return { x: cx - size.w / 2, y: cy - size.h / 2, w: size.w, h: size.h };
}

/** Is this arrow one whose label may be moved? */
const lifeline = (c: ConnectorElement): boolean => isLifeline(c);
const placeable = (c: ConnectorElement) => !!c.text.trim() && !c.locked && !c.bar && !lifeline(c);

/**
 * Re-place the labels of the given arrows (all labelled arrows when `ids` is empty). A label only moves when the
 * new spot is clearly better than where it is. Returns the new document and how many labels moved.
 */
export function placeLabels(doc: FlowDocument, ids: string[] = []): { doc: FlowDocument; moved: number } {
  const want = new Set(ids);
  const lookup = makeLookup(doc, null);
  const arrows = doc.elements.filter((e): e is ConnectorElement => e.type === 'connector' && !e.bar).slice(0, MAX_ARROWS);
  const paths = new Map(arrows.map((c) => [c.id, connectorPath(c, lookup)]));
  // shapes, icons, pictures and text boxes (callouts, titles): a label shouldn't cover any of them
  const boxes = doc.elements.filter((e): e is BoxElement => e.type === 'shape' || e.type === 'icon' || e.type === 'image' || e.type === 'text').map((b) => ({ id: b.id, r: elementBounds(doc, b) }));
  const todo = arrows.filter((c) => placeable(c) && (!want.size || want.has(c.id)));
  if (!todo.length) return { doc, moved: 0 };
  // labels that stay put count as obstacles; the ones being placed are added as they are placed
  const labels = new Map<string, Rect>();
  for (const c of arrows) if (c.text.trim() && !todo.includes(c)) labels.set(c.id, boxAt(paths.get(c.id)!, connectorLabelSize(c), c.labelPos, c.labelOffset));
  const cost = (c: ConnectorElement, r: Rect, t: number, off: number) => {
    const g = grow(r, 3);
    let k = 0;
    for (const b of boxes) k += overlap(g, b.r) * W_BOX; // the arrow's own end shapes too: a label shouldn't hide them
    for (const [id, l] of labels) if (id !== c.id) k += overlap(g, l) * W_LABEL;
    for (const o of arrows) if (o.id !== c.id && !lifeline(o) && lineHits(paths.get(o.id)!.pts, g)) k += W_LINE;
    if (lineHits(paths.get(c.id)!.pts, grow(r, 1))) k += W_OWN * (off === 0 ? 1 : 0.5);
    return k + Math.abs(t - 0.5) * W_MOVE;
  };
  const changes = new Map<string, { labelPos: number; labelOffset: number }>();
  for (const c of todo) {
    const path = paths.get(c.id)!, size = connectorLabelSize(c);
    const here = boxAt(path, size, c.labelPos, c.labelOffset);
    let best = { t: c.labelPos, off: c.labelOffset, r: here, k: cost(c, here, c.labelPos, c.labelOffset) };
    for (const t of ALONG) {
      const { tan } = pointAt(path, t * path.length);
      // far enough across the line for the box to clear it: half its extent across the line, plus a gap
      const d = Math.ceil(Math.abs(tan.y) * size.w / 2 + Math.abs(tan.x) * size.h / 2 + CLEAR + c.style.strokeWidth / 2);
      for (const off of [-d, d, 0]) {
        const r = boxAt(path, size, t, off), k = cost(c, r, t, off);
        if (k < best.k - 1) best = { t, off, r, k };
      }
    }
    labels.set(c.id, best.r);
    if (best.t !== c.labelPos || best.off !== c.labelOffset) changes.set(c.id, { labelPos: best.t, labelOffset: best.off });
  }
  if (!changes.size) return { doc, moved: 0 };
  return { doc: { ...doc, elements: doc.elements.map((e) => (e.type === 'connector' && changes.has(e.id) ? { ...e, ...changes.get(e.id)! } : e)) }, moved: changes.size };
}

// ---- callouts -------------------------------------------------------------------------------------------------------

/** Callouts are at most this wide (px) and placed at most this far from their arrow's label. */
const CALLOUT_W = 240, CALLOUT_REACH = 520;

/**
 * Where to put a box of size w×h near `near`: the free spot closest to it, clear of shapes, labels, text, other
 * arrows' lines and container borders (inside a container is fine).
 */
export function placeNote(doc: FlowDocument, w: number, h: number, near: Point, skip: Set<string> = new Set()): Rect {
  const lookup = makeLookup(doc, null);
  const solid = doc.elements.filter((e) => !skip.has(e.id) && (e.type === 'shape' || e.type === 'icon' || e.type === 'image' || e.type === 'text')).map((e) => elementBounds(doc, e));
  const frames = doc.elements.filter((e) => !skip.has(e.id) && e.type === 'container').map((e) => elementBounds(doc, e));
  const arrows = doc.elements.filter((e): e is ConnectorElement => e.type === 'connector' && !e.bar).slice(0, MAX_ARROWS);
  const lines = arrows.filter((c) => !lifeline(c)).map((c) => connectorPath(c, lookup).pts);
  const labels = arrows.filter((c) => !skip.has(c.id) && c.text.trim()).map((c) => boxAt(connectorPath(c, lookup), connectorLabelSize(c), c.labelPos, c.labelOffset));
  const cost = (r: Rect) => {
    const g = grow(r, 8);
    let k = 0;
    for (const s of solid) k += overlap(g, s) * W_BOX;
    for (const l of labels) k += overlap(g, l) * W_LABEL;
    for (const f of frames) { const o = overlap(g, f); if (o > 0 && o < g.w * g.h - 1) k += 1500; } // across a container border
    for (const pts of lines) if (lineHits(pts, g)) k += W_LINE;
    return k + Math.hypot(r.x + r.w / 2 - near.x, r.y + r.h / 2 - near.y) * 3;
  };
  let best: Rect = { x: near.x - w / 2, y: near.y - h / 2, w, h }, bestK = cost(best);
  for (let rad = 40; rad <= CALLOUT_REACH; rad += 40) {
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      const r = { x: near.x + Math.cos(t) * rad - w / 2, y: near.y + Math.sin(t) * rad - h / 2, w, h };
      const k = cost(r);
      if (k < bestK) { best = r; bestK = k; }
    }
  }
  return { x: Math.round(best.x), y: Math.round(best.y), w, h };
}

/** The leading step number of a label ("17", "4a", "8a.1"), or ''. */
export function stepPrefix(label: string): string {
  const m = /^\s*(\d{1,3}[a-z]?(?:\.\d{1,3}[a-z]?){0,5})(?=$|[\s.):\-])/i.exec(label);
  return m ? m[1] : '';
}

/**
 * Move most of a long arrow label into a callout text box near the arrow: the arrow keeps `short` (always starting
 * with its step number, so the play order and step numbering are unchanged) and the whole label goes into the
 * callout, which starts with the same number so the two are easy to match. The full label is also kept as the
 * arrow's hover note (unless it already has one). Returns null for an arrow without a label or a locked one.
 */
export function labelToCallout(doc: FlowDocument, arrowId: string, short: string, text: TextStyle, measure: (s: string, w: number) => { w: number; h: number }): { doc: FlowDocument; calloutId: string } | null {
  const c = doc.elements.find((e): e is ConnectorElement => e.id === arrowId && e.type === 'connector');
  if (!c || c.locked || !c.text.trim()) return null;
  const full = c.text.trim(), num = stepPrefix(full);
  let s = short.replace(/\s+/g, ' ').trim();
  if (num && stepPrefix(s) !== num) s = `${num}. ${s.replace(/^[\s.):\-]+/, '')}`.trim();
  if (!s || s === `${num}.`) s = num ? `${num}. ${full.slice(full.indexOf(num) + num.length).replace(/^[\s.):\-]+/, '').split(' ').slice(0, 3).join(' ')}` : full.split(' ').slice(0, 4).join(' ');
  const shortened: ConnectorElement = { ...c, text: s, ...(c.note ? {} : { note: full.slice(0, 1000) }) };
  let d: FlowDocument = { ...doc, elements: doc.elements.map((e) => (e.id === c.id ? shortened : e)) };
  d = placeLabels(d, [c.id]).doc;
  const size = measure(full, CALLOUT_W);
  const lb = (() => { const cc = d.elements.find((e) => e.id === c.id) as ConnectorElement; return boxAt(connectorPath(cc, makeLookup(d, null)), connectorLabelSize(cc), cc.labelPos, cc.labelOffset); })();
  const at = placeNote(d, size.w, size.h, { x: lb.x + lb.w / 2, y: lb.y + lb.h / 2 });
  const callout = { ...makeText(at.x, at.y, full, { ...defaultToolStyle('text'), textStyle: text }), w: size.w, h: size.h, textStyle: { ...text } };
  d = { ...d, elements: [...d.elements, callout] };
  return { doc: updateMembership(d, [callout.id]), calloutId: callout.id };
}
