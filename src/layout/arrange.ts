// Arranging boxes (pure): move, align, distribute and match sizes. Used by the editor's Arrange commands and by the
// AI tool kit, so a change Claude makes behaves exactly like the same command in the menus. Locked items, arrows and
// text-only items are left where they are; a container brings its contents; container membership is re-checked.
import type { BoxElement, ContainerElement, DiagramElement, FlowDocument } from '../model/types';
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

/** How far Spread out may push things apart in one go (1 = unchanged). */
export const SPREAD_MIN = 1, SPREAD_MAX = 3;

/**
 * Spread out (pure): push everything on the page apart by `factor` around the middle of the page, to give crowded
 * diagrams room. Sizes stay; only places change. Items in a group move together; locked items stay put. Each
 * container then fits round its contents again with the padding it had (so it grows with them, keeping its look);
 * an empty one moves like a shape. Arrows follow their shapes; waypoints of straight/curved arrows are spread too,
 * elbow arrows lose theirs (their automatic route is redrawn; route them again for a tidy result).
 */
export function spreadOut(doc: FlowDocument, factor: number): FlowDocument {
  const f = Math.min(SPREAD_MAX, Math.max(SPREAD_MIN, Number.isFinite(factor) ? factor : 1));
  if (f === 1) return doc;
  const leaves = doc.elements.filter((e): e is BoxElement => e.type !== 'connector' && e.type !== 'container');
  const containers = doc.elements.filter((e): e is ContainerElement => e.type === 'container');
  if (!leaves.length && !containers.length) return doc;
  const all = [...leaves, ...containers];
  const x0 = Math.min(...all.map((e) => e.x)), y0 = Math.min(...all.map((e) => e.y));
  const x1 = Math.max(...all.map((e) => e.x + e.w)), y1 = Math.max(...all.map((e) => e.y + e.h));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const sp = (p: { x: number; y: number }) => ({ x: cx + (p.x - cx) * f, y: cy + (p.y - cy) * f });
  // units that move as one: a group (by its first group id), else each item alone
  const units = new Map<string, BoxElement[]>();
  for (const e of leaves) { const k = e.groupIds[0] ?? e.id; units.set(k, [...(units.get(k) ?? []), e]); }
  const delta = new Map<string, { dx: number; dy: number }>();
  for (const list of units.values()) {
    if (list.some((e) => e.locked)) continue;
    const ux0 = Math.min(...list.map((e) => e.x)), uy0 = Math.min(...list.map((e) => e.y));
    const ux1 = Math.max(...list.map((e) => e.x + e.w)), uy1 = Math.max(...list.map((e) => e.y + e.h));
    const c = { x: (ux0 + ux1) / 2, y: (uy0 + uy1) / 2 }, n = sp(c);
    for (const e of list) delta.set(e.id, { dx: n.x - c.x, dy: n.y - c.y });
  }
  const byId = new Map(doc.elements.map((e) => [e.id, e]));
  let els = doc.elements.map((e) => {
    const d = delta.get(e.id);
    return d ? { ...e, x: Math.round(e.x + d.dx), y: Math.round(e.y + d.dy) } : e;
  });
  // containers, innermost first: fit round their (moved) contents with the padding they had
  const depth = (c: ContainerElement): number => { let n = 0, cur: ContainerElement | undefined = c; const seen = new Set<string>(); while (cur && !seen.has(cur.id)) { seen.add(cur.id); cur = containers.find((k) => k.members.includes(cur!.id)); if (cur) n++; } return n; };
  const order = [...containers].sort((a, b) => depth(b) - depth(a));
  const now = () => new Map(els.map((e) => [e.id, e]));
  for (const k of order) {
    if (k.locked) continue;
    const cur = now();
    const old = (ids: string[], map: Map<string, DiagramElement>) => ids.map((id) => map.get(id)).filter((e): e is DiagramElement => !!e && e.type !== 'connector');
    const before = old(k.members, byId), after = old(k.members, cur);
    if (!before.length) { const n = sp({ x: k.x + k.w / 2, y: k.y + k.h / 2 }); els = els.map((e) => (e.id === k.id ? { ...e, x: Math.round(n.x - k.w / 2), y: Math.round(n.y - k.h / 2) } : e)); continue; }
    const bb = (list: DiagramElement[]) => ({ x0: Math.min(...list.map((e) => e.x)), y0: Math.min(...list.map((e) => e.y)), x1: Math.max(...list.map((e) => e.x + e.w)), y1: Math.max(...list.map((e) => e.y + e.h)) });
    const b0 = bb(before), b1 = bb(after);
    const pad = { l: Math.max(0, b0.x0 - k.x), t: Math.max(0, b0.y0 - k.y), r: Math.max(0, k.x + k.w - b0.x1), b: Math.max(0, k.y + k.h - b0.y1) };
    const box = { x: Math.round(b1.x0 - pad.l), y: Math.round(b1.y0 - pad.t), w: Math.round(b1.x1 - b1.x0 + pad.l + pad.r), h: Math.round(b1.y1 - b1.y0 + pad.t + pad.b) };
    els = els.map((e) => (e.id === k.id ? { ...e, ...box } : e));
  }
  // arrows: free ends and straight/curved waypoints spread; elbow waypoints dropped (their route is redrawn)
  els = els.map((e) => {
    if (e.type !== 'connector' || e.locked) return e;
    const end = (p: typeof e.start) => (p.elementId ? p : { ...p, ...sp(p) });
    return { ...e, start: end(e.start), end: end(e.end), bends: e.routing === 'elbow' ? [] : e.bends.map(sp) };
  });
  return { ...doc, elements: els };
}
