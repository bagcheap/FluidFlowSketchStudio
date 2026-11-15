// Equal-spacing guides (pure, static geometry): while dragging, the moving box snaps to positions that make gaps equal
// to its neighbours in the same row (or column): halfway between its left and right neighbours, or a gap that already
// appears between neighbouring boxes of that row. Returns the correction and the gaps to mark.
export interface Box { x: number; y: number; w: number; h: number }
/** One gap to mark: a measurement from (x1, y1) to (x2, y2), all the same length. */
export interface GapMark { x1: number; y1: number; x2: number; y2: number; gap: number }

interface Axis { lo: number; hi: number; crossLo: number; crossHi: number }
/** Horizontal (x) or vertical (y) view of a box: along the axis, and across it. */
const along = (b: Box, horizontal: boolean): Axis => horizontal
  ? { lo: b.x, hi: b.x + b.w, crossLo: b.y, crossHi: b.y + b.h }
  : { lo: b.y, hi: b.y + b.h, crossLo: b.x, crossHi: b.x + b.w };

/**
 * The best equal-spacing snap along one axis within `tol`: { d, marks } (d = how far to move along the axis), or null.
 * Only boxes in the same row/column (overlapping the moving box across the axis) count.
 */
export function spacingSnap(moving: Box, others: Box[], horizontal: boolean, tol: number): { d: number; marks: GapMark[] } | null {
  const m = along(moving, horizontal), size = m.hi - m.lo;
  const row = others.map((o) => along(o, horizontal)).filter((o) => o.crossHi > m.crossLo && o.crossLo < m.crossHi);
  if (!row.length) return null;
  // nearest neighbours before and after the moving box (not overlapping it along the axis)
  const centre = (m.lo + m.hi) / 2;
  const before = row.filter((o) => o.hi <= centre && (o.lo + o.hi) / 2 < centre).sort((a, b) => b.hi - a.hi)[0];
  const after = row.filter((o) => o.lo >= centre && (o.lo + o.hi) / 2 > centre).sort((a, b) => a.lo - b.lo)[0];
  // gaps that already exist between neighbouring boxes in this row
  const sorted = [...row].sort((a, b) => a.lo - b.lo);
  const pairs: { a: Axis; b: Axis; gap: number }[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i], b = sorted[i + 1], gap = b.lo - a.hi;
    if (gap > 1 && b.crossHi > a.crossLo && b.crossLo < a.crossHi) pairs.push({ a, b, gap });
  }
  const cands: { lo: number; gap: number; kind: 'between' | 'after' | 'before' }[] = [];
  if (before && after && after.lo - before.hi > size) cands.push({ lo: (before.hi + after.lo - size) / 2, gap: (after.lo - before.hi - size) / 2, kind: 'between' });
  for (const p of pairs) {
    if (before) cands.push({ lo: before.hi + p.gap, gap: p.gap, kind: 'after' });
    if (after) cands.push({ lo: after.lo - p.gap - size, gap: p.gap, kind: 'before' });
  }
  let best: (typeof cands)[number] | null = null;
  for (const c of cands) if (c.gap > 1 && Math.abs(c.lo - m.lo) < tol && (!best || Math.abs(c.lo - m.lo) < Math.abs(best.lo - m.lo))) best = c;
  if (!best) return null;
  // the marks: the moving box's equal gap(s), plus every existing pair with that gap
  const lo = best.lo, hi = lo + size, g = best.gap;
  const at = (a: Axis, b: Axis) => (Math.max(a.crossLo, b.crossLo) + Math.min(a.crossHi, b.crossHi)) / 2; // middle of the overlap
  const segs: [number, number, number][] = []; // along from, along to, across
  const mv: Axis = { lo, hi, crossLo: m.crossLo, crossHi: m.crossHi };
  if ((best.kind === 'between' || best.kind === 'after') && before) segs.push([before.hi, lo, at(before, mv)]);
  if ((best.kind === 'between' || best.kind === 'before') && after) segs.push([hi, after.lo, at(mv, after)]);
  for (const p of pairs) if (Math.abs(p.gap - g) < 0.5) segs.push([p.a.hi, p.b.lo, at(p.a, p.b)]);
  const marks = segs.map(([s, e, c]) => (horizontal ? { x1: s, y1: c, x2: e, y2: c, gap: g } : { x1: c, y1: s, x2: c, y2: e, gap: g }));
  return { d: lo - m.lo, marks };
}

/**
 * Same size as a neighbour (PowerPoint/Visio style), while drawing or resizing: a width (or height) within `tol` of
 * another box's snaps to it. Only the sides being changed are snapped (`w` / `h`). Of several matches the closest
 * size wins, then the nearest box. Marks: the matched size measured along the top (width) or right side (height) of
 * both boxes.
 */
export function sizeSnap(box: Box, others: Box[], tol: number, sides: { w: boolean; h: boolean }): { w?: number; h?: number; marks: GapMark[] } {
  const marks: GapMark[] = [];
  const out: { w?: number; h?: number; marks: GapMark[] } = { marks };
  const dist = (o: Box) => Math.hypot(o.x + o.w / 2 - (box.x + box.w / 2), o.y + o.h / 2 - (box.y + box.h / 2));
  const best = (get: (o: Box) => number, cur: number) => {
    let pick: Box | null = null;
    for (const o of others) {
      const d = Math.abs(get(o) - cur);
      if (d >= tol || get(o) < 4) continue;
      if (!pick || d < Math.abs(get(pick) - cur) - 1e-9 || (Math.abs(d - Math.abs(get(pick) - cur)) < 1e-9 && dist(o) < dist(pick))) pick = o;
    }
    return pick;
  };
  const off = 12; // the marks sit this far outside each box
  if (sides.w) {
    const o = best((b) => b.w, box.w);
    if (o) {
      out.w = o.w;
      marks.push({ x1: o.x, y1: o.y - off, x2: o.x + o.w, y2: o.y - off, gap: o.w });
      marks.push({ x1: box.x, y1: box.y - off, x2: box.x + o.w, y2: box.y - off, gap: o.w }); // (x as drawn; the caller may move the left side)
    }
  }
  if (sides.h) {
    const o = best((b) => b.h, box.h);
    if (o) {
      out.h = o.h;
      marks.push({ x1: o.x + o.w + off, y1: o.y, x2: o.x + o.w + off, y2: o.y + o.h, gap: o.h });
      marks.push({ x1: box.x + box.w + off, y1: box.y, x2: box.x + box.w + off, y2: box.y + o.h, gap: o.h });
    }
  }
  return out;
}

/** The marks for a box after its size snap moved it: re-measure the box's own marks at its final place. */
export function placeSizeMarks(marks: GapMark[], box: Box): GapMark[] {
  const off = 12;
  // marks come in pairs (neighbour, then this box) for width, then for height
  return marks.map((m, i) => {
    if (i % 2 === 0) return m;
    return m.y1 === m.y2
      ? { ...m, x1: box.x, x2: box.x + box.w, y1: box.y - off, y2: box.y - off }
      : { ...m, x1: box.x + box.w + off, x2: box.x + box.w + off, y1: box.y, y2: box.y + box.h };
  });
}
