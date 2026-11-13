// Obstacle-avoiding orthogonal routing (pure). Used on request only, never while drawing: Mermaid import with elbow
// arrows and Arrange ▸ Route arrows around shapes. Each route is saved as the arrow's port anchors and bend points
// (the corners), which the normal elbow router passes through unchanged, so the result stays editable with the
// segment bars and Reset route.
import type { Point } from '../model/types';

export interface Rect { x0: number; y0: number; x1: number; y1: number }
/** An end of a route: a point just outside a shape, and the unit axis direction pointing away from that shape. */
export interface RouteEnd { p: Point; dir: Point }

export const ROUTE_MARGIN = 14; // routes keep this far from shapes
const BEND = 40; // a turn costs as much as this many px of length
const SHARE = 0.6; // running along a segment another route already uses costs this much extra per px

// directions: 0 right, 1 down, 2 left, 3 up
const dirIndex = (d: Point) => (Math.abs(d.x) >= Math.abs(d.y) ? (d.x >= 0 ? 0 : 2) : d.y >= 0 ? 1 : 3);
const r2 = (v: number) => Math.round(v * 2) / 2;
/** A grid segment's key (rounded to half a pixel, so routes that share a line find each other). */
const key = (a: Point, b: Point) => { const [p, q] = a.x < b.x || (a.x === b.x && a.y < b.y) ? [a, b] : [b, a]; return `${r2(p.x)},${r2(p.y)}|${r2(q.x)},${r2(q.y)}`; };
const strictlyInside = (p: Point, r: Rect) => p.x > r.x0 + 0.01 && p.x < r.x1 - 0.01 && p.y > r.y0 + 0.01 && p.y < r.y1 - 0.01;

/** Drop repeated points and points in the middle of a straight run. */
export function simplifyRoute(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const q of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(q.x - last.x) < 0.01 && Math.abs(q.y - last.y) < 0.01) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      if ((Math.abs(a.x - last.x) < 0.01 && Math.abs(last.x - q.x) < 0.01) || (Math.abs(a.y - last.y) < 0.01 && Math.abs(last.y - q.y) < 0.01)) out.pop();
    }
    out.push(q);
  }
  return out;
}

/** A small binary heap of [priority, value]. */
class Heap {
  private a: [number, number][] = [];
  get size() { return this.a.length; }
  push(p: number, v: number) {
    const a = this.a; a.push([p, v]);
    for (let i = a.length - 1; i > 0;) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; }
  }
  pop(): [number, number] {
    const a = this.a, top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}

/**
 * The cheapest right-angled route from s to e that doesn't pass through any obstacle (each grown by ROUTE_MARGIN):
 * straight out of s for a short stub, then along the lines of a sparse grid made from the obstacles' edges, then
 * straight into e. Cost = length + BEND per turn + SHARE per px along segments in `used`. Returns the route's points
 * from s.p to e.p (corners only) and its cost, or null when there is no way through.
 */
export function routeOrtho(s: RouteEnd, e: RouteEnd, obstacles: Rect[], used?: Map<string, number>): { pts: Point[]; cost: number } | null {
  const M = ROUTE_MARGIN, stub = M + 6;
  const rs = obstacles.map((r) => ({ x0: r.x0 - M, y0: r.y0 - M, x1: r.x1 + M, y1: r.y1 + M }));
  // straight out of each end until clear of every shape's margin (a point on a diamond's slanted side starts well
  // inside its bounding box); give up if something else is in the way
  const clear = (q: RouteEnd): Point | null => {
    for (let d = stub; d <= stub + 400; d += 4) {
      const p = { x: q.p.x + q.dir.x * d, y: q.p.y + q.dir.y * d };
      if (!rs.some((r) => strictlyInside(p, r))) return p;
    }
    return null;
  };
  const S0 = clear(s), E0 = clear(e);
  if (!S0 || !E0) return null;
  const S = S0, E = E0;
  // exact coordinates (rounding would put a kink between nearly lined-up ends and the route)
  const uniq = (v: number[]) => v.slice().sort((a, b) => a - b).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 1e-6);
  const xs = uniq([S.x, E.x, ...rs.flatMap((r) => [r.x0, r.x1])]);
  const ys = uniq([S.y, E.y, ...rs.flatMap((r) => [r.y0, r.y1])]);
  const nx = xs.length, ny = ys.length;
  const ix = (x: number) => xs.findIndex((v) => Math.abs(v - x) <= 1e-6), iy = (y: number) => ys.findIndex((v) => Math.abs(v - y) <= 1e-6);
  const si = iy(S.y) * nx + ix(S.x), ei = iy(E.y) * nx + ix(E.x);
  const pt = (n: number): Point => ({ x: xs[n % nx], y: ys[Math.floor(n / nx)] });
  const blocked = new Uint8Array(nx * ny);
  for (let n = 0; n < nx * ny; n++) if (n !== si && n !== ei && rs.some((r) => strictlyInside(pt(n), r))) blocked[n] = 1;
  const step = (n: number, d: number): number => {
    const x = n % nx, y = Math.floor(n / nx);
    const x2 = x + (d === 0 ? 1 : d === 2 ? -1 : 0), y2 = y + (d === 1 ? 1 : d === 3 ? -1 : 0);
    if (x2 < 0 || y2 < 0 || x2 >= nx || y2 >= ny) return -1;
    const m = y2 * nx + x2;
    if (blocked[m]) return -1;
    const a = pt(n), b = pt(m), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return rs.some((r) => strictlyInside(mid, r)) ? -1 : m;
  };
  const arrive = (dirIndex({ x: -e.dir.x, y: -e.dir.y })); // the last stretch runs into e
  const h = (n: number) => { const p = pt(n); return Math.abs(p.x - E.x) + Math.abs(p.y - E.y); };
  const best = new Float64Array(nx * ny * 4).fill(Infinity);
  const from = new Int32Array(nx * ny * 4).fill(-1);
  const heap = new Heap();
  const start = si * 4 + dirIndex(s.dir);
  best[start] = 0; heap.push(h(si), start);
  let goal = -1, goalCost = Infinity;
  while (heap.size) {
    const [f, st] = heap.pop();
    if (f >= goalCost) break;
    const n = st >> 2, d = st & 3, g = best[st];
    if (f - h(n) > g + 1e-9) continue; // stale entry
    if (n === ei) {
      if (d === (arrive + 2) % 4) continue; // would have to double back into e
      const total = g + (d === arrive ? 0 : BEND);
      if (total < goalCost) { goalCost = total; goal = st; }
      continue;
    }
    for (let d2 = 0; d2 < 4; d2++) {
      if (d2 === (d + 2) % 4) continue; // no U-turns
      const m = step(n, d2);
      if (m < 0) continue;
      const a = pt(n), b = pt(m), len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      const g2 = g + len + (d2 === d ? 0 : BEND) + (used?.get(key(a, b)) ?? 0) * SHARE * len;
      const s2 = m * 4 + d2;
      if (g2 < best[s2] - 1e-9) { best[s2] = g2; from[s2] = st; heap.push(g2 + h(m), s2); }
    }
  }
  if (goal < 0) return null;
  const nodes: Point[] = [];
  for (let st = goal; st >= 0; st = from[st]) nodes.push(pt(st >> 2));
  nodes.reverse();
  return { pts: simplifyRoute([s.p, ...nodes, e.p]), cost: goalCost + Math.abs(S.x - s.p.x) + Math.abs(S.y - s.p.y) + Math.abs(E.x - e.p.x) + Math.abs(E.y - e.p.y) };
}

/** Note a route's segments as used (later routes pay a little to share them, so parallel arrows spread out). */
export function markUsed(used: Map<string, number>, pts: Point[], obstacles: Rect[]) {
  // record along the same grid lines the router walks: split each segment at every obstacle edge it crosses
  const M = ROUTE_MARGIN;
  const cuts = obstacles.flatMap((r) => [r.x0 - M, r.x1 + M, r.y0 - M, r.y1 + M]);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const horiz = Math.abs(a.y - b.y) < 0.01;
    const lo = horiz ? Math.min(a.x, b.x) : Math.min(a.y, b.y), hi = horiz ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    const stops = [lo, hi, ...cuts.filter((c) => c > lo && c < hi)].sort((p, q) => p - q);
    for (let k = 1; k < stops.length; k++) {
      if (stops[k] - stops[k - 1] < 1e-6) continue;
      const p = horiz ? { x: stops[k - 1], y: a.y } : { x: a.x, y: stops[k - 1] };
      const q = horiz ? { x: stops[k], y: p.y } : { x: p.x, y: stops[k] };
      const kk = key(p, q);
      used.set(kk, (used.get(kk) ?? 0) + 1);
    }
  }
}
