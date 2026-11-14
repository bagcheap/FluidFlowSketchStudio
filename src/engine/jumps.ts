// Line jumps (hop-overs), pure: where two arrows cross, the one higher in the stacking order hops over the other with
// a small arc (Visio/draw.io style). Works on the frame's resolved paths, so hops follow shapes as they move.
import type { Point } from '../model/types';
import type { ConnectorPath } from './connectors';

/** Half the width of a hop (px), for a line of this stroke width. */
export const jumpRadius = (strokeWidth: number) => 6 + strokeWidth * 1.5;

interface Box { x0: number; y0: number; x1: number; y1: number }
const boxOf = (pts: Point[]): Box => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x0, y0, x1, y1 };
};
const overlap = (a: Box, b: Box) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** Arc lengths along `a` where it properly crosses `b` (touching or overlapping lines don't count). */
export function crossings(a: ConnectorPath, b: ConnectorPath): number[] {
  const out: number[] = [];
  const bb = boxOf(b.pts);
  for (let i = 0; i + 1 < a.pts.length; i++) {
    const p = a.pts[i], q = a.pts[i + 1];
    if (Math.max(p.x, q.x) < bb.x0 || Math.min(p.x, q.x) > bb.x1 || Math.max(p.y, q.y) < bb.y0 || Math.min(p.y, q.y) > bb.y1) continue;
    const rx = q.x - p.x, ry = q.y - p.y;
    for (let j = 0; j + 1 < b.pts.length; j++) {
      const u = b.pts[j], v = b.pts[j + 1];
      const sx = v.x - u.x, sy = v.y - u.y;
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-9) continue; // parallel
      const t = ((u.x - p.x) * sy - (u.y - p.y) * sx) / den;
      const w = ((u.x - p.x) * ry - (u.y - p.y) * rx) / den;
      // each segment includes its start point (so a crossing exactly at a sample point counts once), but neither
      // line's very first or last point does: lines that only touch at an end don't cross
      const inA = t >= (i === 0 ? 1e-6 : -1e-9) && t < 1 - (i + 2 === a.pts.length ? 1e-6 : 1e-9);
      const inB = w >= (j === 0 ? 1e-6 : -1e-9) && w < 1 - (j + 2 === b.pts.length ? 1e-6 : 1e-9);
      if (inA && inB) out.push(a.cum[i] + t * (a.cum[i + 1] - a.cum[i]));
    }
  }
  return out.sort((x, y) => x - y);
}

function at(p: ConnectorPath, s: number): Point {
  let lo = 0, hi = p.cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p.cum[mid] <= s) lo = mid; else hi = mid; }
  const seg = p.cum[hi] - p.cum[lo] || 1, f = Math.min(1, Math.max(0, (s - p.cum[lo]) / seg));
  return { x: p.pts[lo].x + (p.pts[hi].x - p.pts[lo].x) * f, y: p.pts[lo].y + (p.pts[hi].y - p.pts[lo].y) * f };
}

/**
 * The path with a hop at each crossing (arc lengths `ss`): the stretch [s − r, s + r] becomes a half-ellipse bulging
 * up (or left, on a vertical line), the same way whichever way the arrow points. Hops that would overlap merge into one
 * wider hop; hops too near an end (the arrowhead) or round a corner are left out. The route's corners are unchanged.
 */
export function hop(path: ConnectorPath, ss: number[], r: number, endGap: number): ConnectorPath {
  // spans, merged where they overlap
  const spans: [number, number][] = [];
  for (const s of ss) {
    if (s - r < endGap || s + r > path.length - endGap) continue;
    const last = spans[spans.length - 1];
    if (last && s - r <= last[1] + 2) last[1] = s + r; else spans.push([s - r, s + r]);
  }
  const keep = spans.filter(([a, b]) => {
    const p = at(path, a), q = at(path, b);
    return Math.hypot(q.x - p.x, q.y - p.y) > (b - a) * 0.995; // straight there (not round a corner or a curve)
  });
  if (!keep.length) return path;
  const pts: Point[] = [];
  let k = 0;
  for (const [a, b] of keep) {
    while (k < path.pts.length && path.cum[k] < a) pts.push(path.pts[k++]);
    const p = at(path, a), q = at(path, b);
    const L = Math.hypot(q.x - p.x, q.y - p.y), ux = (q.x - p.x) / L, uy = (q.y - p.y) / L;
    let nx = uy, ny = -ux; // one side of the line…
    if (ny > 1e-6 || (Math.abs(ny) <= 1e-6 && nx > 0)) { nx = -nx; ny = -ny; } // …always up, or left on a vertical line
    const cx = (p.x + q.x) / 2, cy = (p.y + q.y) / 2, n = Math.max(8, Math.ceil(L / 2.5));
    for (let i = 0; i <= n; i++) {
      const th = (Math.PI * i) / n, c = Math.cos(th), sn = Math.sin(th);
      pts.push({ x: cx - ux * (L / 2) * c + nx * r * sn, y: cy - uy * (L / 2) * c + ny * r * sn });
    }
    while (k < path.pts.length && path.cum[k] <= b) k++;
  }
  while (k < path.pts.length) pts.push(path.pts[k++]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { pts, cum, length: cum[cum.length - 1], control: path.control };
}

/**
 * Hops for a set of arrows in stacking order (first = bottom): each arrow hops over every arrow below it that it
 * crosses. `r` and `endGap` per arrow. Returns only the paths that changed.
 */
export function withJumps(list: { id: string; path: ConnectorPath; r: number; endGap: number }[]): Map<string, ConnectorPath> {
  const out = new Map<string, ConnectorPath>();
  const boxes = list.map((e) => boxOf(e.path.pts));
  for (let j = 1; j < list.length; j++) {
    const ss: number[] = [];
    for (let i = 0; i < j; i++) if (overlap(boxes[i], boxes[j])) ss.push(...crossings(list[j].path, list[i].path));
    if (!ss.length) continue;
    const h = hop(list[j].path, ss.sort((x, y) => x - y), list[j].r, list[j].endGap);
    if (h !== list[j].path) out.set(list[j].id, h);
  }
  return out;
}
