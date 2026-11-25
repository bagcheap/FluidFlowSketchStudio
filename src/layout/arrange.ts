// Arranging boxes (pure): move, align, distribute and match sizes. Used by the editor's Arrange commands and by the
// AI tool kit, so a change Claude makes behaves exactly like the same command in the menus. Locked items, arrows and
// text-only items are left where they are; a container brings its contents; container membership is re-checked.
import type { BoxElement, DiagramElement, FlowDocument } from '../model/types';
import { moveElements, updateMembership, withMembers } from '../store/containers';

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type MatchSizeMode = 'width' | 'height' | 'both';

/** Move boxes by their own offsets; a container brings its contents. Then re-check container membership. */
export function moveBoxes(doc: FlowDocument, moves: (readonly [string, number, number])[]): FlowDocument {
  let out = doc;
  for (const [id, dx, dy] of moves) if (dx || dy) out = moveElements(out, new Set(withMembers(out, [id])), dx, dy);
  return updateMembership(out, moves.map((m) => m[0]));
}

/** The movable boxes among `ids` (not arrows, not locked). */
export function movableBoxes(doc: FlowDocument, ids: Iterable<string>): BoxElement[] {
  const want = new Set(ids);
  return doc.elements.filter((e): e is BoxElement => want.has(e.id) && e.type !== 'connector' && !e.locked);
}

/** Line boxes up by an edge or their centres, within the group's own bounds. Needs two or more. */
export function alignBoxes(doc: FlowDocument, ids: Iterable<string>, kind: AlignKind): FlowDocument {
  const els = movableBoxes(doc, ids);
  if (els.length < 2) return doc;
  const x0 = Math.min(...els.map((e) => e.x)), x1 = Math.max(...els.map((e) => e.x + e.w));
  const y0 = Math.min(...els.map((e) => e.y)), y1 = Math.max(...els.map((e) => e.y + e.h));
  const target = (b: BoxElement) => {
    switch (kind) {
      case 'left': return { x: x0, y: b.y };
      case 'right': return { x: x1 - b.w, y: b.y };
      case 'hcenter': return { x: (x0 + x1) / 2 - b.w / 2, y: b.y };
      case 'top': return { x: b.x, y: y0 };
      case 'bottom': return { x: b.x, y: y1 - b.h };
      case 'vcenter': return { x: b.x, y: (y0 + y1) / 2 - b.h / 2 };
    }
  };
  return moveBoxes(doc, els.map((b) => { const t = target(b); return [b.id, t.x - b.x, t.y - b.y] as const; }));
}

/** Even gaps between boxes across (h) or down (v), keeping the first and last where they are. Needs three or more. */
export function distributeBoxes(doc: FlowDocument, ids: Iterable<string>, axis: 'h' | 'v'): FlowDocument {
  const els = movableBoxes(doc, ids).sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y));
  if (els.length < 3) return doc;
  const total = els.reduce((s, e) => s + (axis === 'h' ? e.w : e.h), 0);
  const first = els[0], last = els[els.length - 1];
  const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
  const gap = (span - total) / (els.length - 1);
  let cur = axis === 'h' ? first.x : first.y;
  const pos = new Map<string, number>();
  for (const e of els) { pos.set(e.id, cur); cur += (axis === 'h' ? e.w : e.h) + gap; }
  return moveBoxes(doc, els.map((e) => [e.id, axis === 'h' ? pos.get(e.id)! - e.x : 0, axis === 'v' ? pos.get(e.id)! - e.y : 0] as const));
}

/** Elements Match size resizes: shapes, icons, pictures and pen drawings (not text, arrows, containers or locked items). */
export const canMatchSize = (e: DiagramElement): e is BoxElement =>
  !e.locked && (e.type === 'shape' || e.type === 'icon' || e.type === 'image' || e.type === 'freehand');

/**
 * Resize `ids` to the size of `refId`, each keeping its centre. Width or height changes only that side, unless
 * `keepProportions` (the other side then scales with it); both sets width and height exactly.
 */
export function matchSizes(doc: FlowDocument, refId: string, ids: string[], mode: MatchSizeMode, keepProportions = false): FlowDocument {
  const ref = doc.elements.find((e) => e.id === refId);
  if (!ref || ref.type === 'connector') return doc;
  const targets = new Set(ids.filter((id) => id !== refId));
  const out = { ...doc, elements: doc.elements.map((e) => {
    if (!targets.has(e.id) || !canMatchSize(e) || e.w <= 0 || e.h <= 0) return e;
    const k = mode === 'width' ? ref.w / e.w : ref.h / e.h;
    const w = mode === 'both' || mode === 'width' ? ref.w : keepProportions ? e.w * k : e.w;
    const h = mode === 'both' || mode === 'height' ? ref.h : keepProportions ? e.h * k : e.h;
    return { ...e, x: e.x + e.w / 2 - w / 2, y: e.y + e.h / 2 - h / 2, w, h };
  }) };
  return updateMembership(out, [...targets]); // containers grow to fit bigger members
}
