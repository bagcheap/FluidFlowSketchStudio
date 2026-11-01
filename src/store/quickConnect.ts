// Quick-connect (draw.io style): from a shape, add a connected copy of it in one direction, or connect it to
// another shape. Pure document functions; the canvas handles and Cmd+Arrow shortcuts call these.
import type { BoxElement, DiagramElement, Endpoint, FlowDocument, Point, ShapeKind, ToolStyle } from '../model/types';
import { makeConnector, makeShape, newSeed, SHAPE_DEFAULT_SIZE, uid } from '../model/defaults';
import { growContainers, parentOf } from './containers';

export type Side = 'n' | 'e' | 's' | 'w';
export const SIDES: Side[] = ['n', 'e', 's', 'w'];
const DIR: Record<Side, Point> = { n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 } };

/** Space between a shape and the copy placed next to it. */
export const QUICK_GAP = 80;

/** Elements that get quick-connect handles: shapes, icons and pictures (not text, pen strokes or containers). */
export const canQuickConnect = (e: DiagramElement | undefined | null): e is BoxElement =>
  !!e && !e.locked && (e.type === 'shape' || e.type === 'icon' || e.type === 'image');

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, m: number) =>
  a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;

/** Shapes offered in the quick-connect picker (after "same shape" and your recent picks). */
export const QUICK_SHAPES: ShapeKind[] = ['rectangle', 'roundRect', 'ellipse', 'diamond', 'parallelogram', 'hexagon', 'pill', 'triangle', 'cylinder', 'document', 'cloud', 'sticky'];

/**
 * Where a new w×h shape goes on side `side` of `src`: one gap away, centred on src's axis, moved sideways
 * (alternating) past anything in the way. Containers don't count as in the way (it may sit inside one).
 */
export function nextSlot(doc: FlowDocument, src: BoxElement, side: Side, size?: { w: number; h: number }): Point {
  const d = DIR[side];
  const w = size?.w ?? src.w, h = size?.h ?? src.h;
  const cx = src.x + src.w / 2 + d.x * (src.w / 2 + QUICK_GAP + w / 2), cy = src.y + src.h / 2 + d.y * (src.h / 2 + QUICK_GAP + h / 2);
  const x = cx - w / 2, y = cy - h / 2;
  const step = d.x ? { x: 0, y: h + QUICK_GAP / 2 } : { x: w + QUICK_GAP / 2, y: 0 };
  const blockers = doc.elements.filter((e) => e.type !== 'connector' && e.type !== 'container' && e.id !== src.id);
  for (let i = 0; i < 12; i++) {
    const k = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2); // 0, +1, -1, +2, -2, …
    const box = { x: x + step.x * k, y: y + step.y * k, w, h };
    if (!blockers.some((b) => overlaps(box, b, 8))) return { x: box.x, y: box.y };
  }
  return { x, y };
}

/** A copy of `src` (same kind, size, style and animation; no text, no group, unlocked) with its top-left at `at`. */
export function copyShape(src: BoxElement, at: Point): BoxElement {
  const n = structuredClone(src) as BoxElement;
  return { ...n, id: uid(), seed: newSeed(), x: at.x, y: at.y, text: '', groupIds: [], locked: false };
}

const attached = (id: string): Endpoint => ({ x: 0, y: 0, elementId: id, anchor: null });

/** Put `id` into the container `src` is in (if any) and grow containers to fit. */
function joinSourceContainer(doc: FlowDocument, srcId: string, id: string): FlowDocument {
  const parent = parentOf(doc, srcId);
  if (!parent) return doc;
  return growContainers({ ...doc, elements: doc.elements.map((e) => (e.id === parent.id && e.type === 'container' ? { ...e, members: [...e.members, id] } : e)) });
}

/** What to add: a copy of the source shape, or a new shape of `kind` in that tool's default style. */
export type QuickNew = { kind: ShapeKind; tool: ToolStyle } | null;

/**
 * Add a copy of `srcId` (or, with `make`, a new shape of that kind) on `side` (or with its centre at `center`),
 * connected to it by an arrow. Returns the new document and the new shape's id, or null if the source can't be
 * quick-connected.
 */
export function addConnectedCopy(doc: FlowDocument, srcId: string, arrow: ToolStyle, opts: { side?: Side; center?: Point; connectorId?: string; make?: QuickNew }): { doc: FlowDocument; id: string; connectorId: string } | null {
  const src = doc.elements.find((e) => e.id === srcId);
  if (!canQuickConnect(src)) return null;
  const size = opts.make ? (() => { const [w, h] = SHAPE_DEFAULT_SIZE[opts.make.kind] ?? [160, 80]; return { w, h }; })() : { w: src.w, h: src.h };
  const at = opts.center ? { x: opts.center.x - size.w / 2, y: opts.center.y - size.h / 2 } : nextSlot(doc, src, opts.side ?? 'e', size);
  const shape: BoxElement = opts.make ? makeShape(opts.make.kind, at.x, at.y, size.w, size.h, opts.make.tool) : copyShape(src, at);
  let out: FlowDocument;
  let connectorId = opts.connectorId;
  if (connectorId && doc.elements.some((e) => e.id === connectorId)) {
    // a connector already being dragged from the source: attach its end to the new shape
    out = {
      ...doc,
      elements: [...doc.elements.map((e) => (e.id === connectorId && e.type === 'connector' ? { ...e, end: attached(shape.id) } : e)), shape],
    };
  } else {
    const c = makeConnector(attached(src.id), attached(shape.id), arrow);
    connectorId = c.id;
    out = { ...doc, elements: [...doc.elements, shape, c] };
  }
  out = joinSourceContainer(out, src.id, shape.id);
  return { doc: out, id: shape.id, connectorId: connectorId! };
}

/** Where the quick-connect handle for `side` sits, in the element's own (unrotated) coordinates. */
export function handleLocal(el: BoxElement, side: Side, offset: number): Point {
  const d = DIR[side];
  return { x: el.w / 2 + d.x * (el.w / 2 + offset), y: el.h / 2 + d.y * (el.h / 2 + offset) };
}
