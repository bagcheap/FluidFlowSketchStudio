// Connector geometry: endpoint resolution against (animated) targets, routing, and
// arc-length parametrised polylines used by flow/draw-on animation and hit testing.
import type { BoxElement, ConnectorElement, DiagramElement, Point } from '../model/types';
import { geometryFor, pointInPolygon, rayPolygon } from './shapes';
import type { Motion } from './animation';
import { STILL } from './animation';

export interface Placed { el: BoxElement; m: Motion }
export type Lookup = (id: string) => Placed | null;

const rad = (d: number) => (d * Math.PI) / 180;

export function localOutline(el: BoxElement): Point[] {
  if (el.type === 'shape') return geometryFor(el).poly;
  return [{ x: 0, y: 0 }, { x: el.w, y: 0 }, { x: el.w, y: el.h }, { x: 0, y: el.h }];
}

/** local -> world for a box element with an animated rigid motion */
export function toWorld(el: BoxElement, m: Motion, p: Point): Point {
  const cx = el.w / 2, cy = el.h / 2;
  const a = rad(el.rotation + m.rot);
  const dx = p.x - cx, dy = p.y - cy;
  return { x: el.x + m.tx + cx + dx * Math.cos(a) - dy * Math.sin(a), y: el.y + m.ty + cy + dx * Math.sin(a) + dy * Math.cos(a) };
}

export function toLocal(el: BoxElement, m: Motion, p: Point): Point {
  const cx = el.w / 2, cy = el.h / 2;
  const a = -rad(el.rotation + m.rot);
  const dx = p.x - (el.x + m.tx + cx), dy = p.y - (el.y + m.ty + cy);
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
}

export const centerOf = (el: BoxElement, m: Motion = STILL): Point => ({ x: el.x + m.tx + el.w / 2, y: el.y + m.ty + el.h / 2 });

export const GAP = 5;

interface End { p: Point; dir: Point } // dir = outward direction from the attached shape (for elbow/arrow logic)

function norm(v: Point): Point { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; }

function resolveEnd(end: ConnectorElement['start'], aim: Point, lookup: Lookup, elbow: boolean): End {
  const pl = end.elementId ? lookup(end.elementId) : null;
  if (!pl) return { p: { x: end.x, y: end.y }, dir: norm({ x: aim.x - end.x, y: aim.y - end.y }) };
  const { el, m } = pl;
  const c = centerOf(el, m);
  if (end.anchor) {
    const lp = { x: end.anchor.x * el.w, y: end.anchor.y * el.h };
    const wp = toWorld(el, m, lp);
    const d = norm({ x: wp.x - c.x, y: wp.y - c.y });
    // snap port direction to its nearest side for nicer elbows
    const ax = end.anchor.x - 0.5, ay = end.anchor.y - 0.5;
    const sideDir = Math.abs(ax) >= Math.abs(ay) ? { x: Math.sign(ax) || 1, y: 0 } : { x: 0, y: Math.sign(ay) || 1 };
    const dir = elbow ? sideDir : d;
    return { p: { x: wp.x + dir.x * GAP, y: wp.y + dir.y * GAP }, dir };
  }
  const al = toLocal(el, m, aim);
  const lc = { x: el.w / 2, y: el.h / 2 };
  let ld: Point;
  if (elbow) {
    const dx = (al.x - lc.x) / Math.max(1, el.w), dy = (al.y - lc.y) / Math.max(1, el.h);
    ld = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) || 1 };
  } else ld = norm({ x: al.x - lc.x, y: al.y - lc.y });
  const t = rayPolygon(lc, ld, localOutline(el)) ?? Math.max(el.w, el.h) / 2;
  const lp = { x: lc.x + ld.x * (t + GAP), y: lc.y + ld.y * (t + GAP) };
  const wp = toWorld(el, m, lp);
  const a = rad(el.rotation + m.rot);
  const wd = { x: ld.x * Math.cos(a) - ld.y * Math.sin(a), y: ld.x * Math.sin(a) + ld.y * Math.cos(a) };
  return { p: wp, dir: wd };
}

function refPoint(end: ConnectorElement['start'], lookup: Lookup): Point {
  const pl = end.elementId ? lookup(end.elementId) : null;
  if (!pl) return { x: end.x, y: end.y };
  if (end.anchor) return toWorld(pl.el, pl.m, { x: end.anchor.x * pl.el.w, y: end.anchor.y * pl.el.h });
  return centerOf(pl.el, pl.m);
}

export interface ConnectorPath {
  pts: Point[]; // dense polyline
  cum: number[]; // cumulative arc length
  length: number;
  control: Point[]; // route control points (start, corners/bends, end)
}

function catmull(points: Point[], step = 6): Point[] {
  const out: Point[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const n = Math.max(4, Math.ceil(segLen / step));
    for (let j = 1; j <= n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

function densify(points: Point[], step = 6): Point[] {
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let j = 1; j <= n; j++) out.push({ x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n });
  }
  return out;
}

function elbowRoute(s: End, e: End, bends: Point[]): Point[] {
  const way = [s.p, ...bends, e.p];
  const out: Point[] = [s.p];
  let horiz = Math.abs(s.dir.x) >= Math.abs(s.dir.y);
  for (let i = 1; i < way.length; i++) {
    const a = out[out.length - 1], b = way[i];
    const last = i === way.length - 1;
    if (last && bends.length === 0) {
      const eh = Math.abs(e.dir.x) >= Math.abs(e.dir.y);
      if (horiz && eh) { const mx = (a.x + b.x) / 2; out.push({ x: mx, y: a.y }, { x: mx, y: b.y }); }
      else if (!horiz && !eh) { const my = (a.y + b.y) / 2; out.push({ x: a.x, y: my }, { x: b.x, y: my }); }
      else if (horiz) out.push({ x: b.x, y: a.y });
      else out.push({ x: a.x, y: b.y });
    } else {
      out.push(horiz ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
      horiz = !horiz;
    }
    out.push(b);
  }
  // drop zero-length segments
  return out.filter((p, i) => i === 0 || Math.hypot(p.x - out[i - 1].x, p.y - out[i - 1].y) > 0.01);
}

export function connectorPath(c: ConnectorElement, lookup: Lookup): ConnectorPath {
  const elbow = c.routing === 'elbow';
  const sRef = refPoint(c.start, lookup), eRef = refPoint(c.end, lookup);
  const aimS = c.bends.length ? c.bends[0] : eRef;
  const aimE = c.bends.length ? c.bends[c.bends.length - 1] : sRef;
  const s = resolveEnd(c.start, aimS, lookup, elbow);
  const e = resolveEnd(c.end, aimE, lookup, elbow);
  let control: Point[];
  if (elbow) control = elbowRoute(s, e, c.bends);
  else if (isSmooth(c) && !c.bends.length) {
    const mx = (s.p.x + e.p.x) / 2, my = (s.p.y + e.p.y) / 2;
    const dx = e.p.x - s.p.x, dy = e.p.y - s.p.y;
    const k = c.curvature * 0.5;
    control = [s.p, { x: mx - dy * k, y: my + dx * k }, e.p];
  } else control = [s.p, ...c.bends, e.p];
  return buildPath(control, isSmooth(c));
}

const isSmooth = (c: ConnectorElement) => c.routing === 'curved' && (c.bends.length > 0 || Math.abs(c.curvature) > 0.001);

function buildPath(control: Point[], smooth: boolean): ConnectorPath {
  const pts = smooth ? catmull(control) : densify(control);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { pts, cum, length: cum[cum.length - 1], control };
}

// ---- request ⇄ response pairs ---------------------------------------------------

/** Distance between the two arrows of a pair (centre to centre). */
export const pairGap = (c: ConnectorElement) => 12 + c.style.strokeWidth * 3;

/** Offset a polyline sideways by d (positive = left of travel, i.e. (dy, -dx) on screen); corners are mitred. */
function offsetPolyline(pts: Point[], d: number): Point[] {
  const segN: Point[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const v = norm({ x: pts[i + 1].x - pts[i].x, y: pts[i + 1].y - pts[i].y });
    segN.push({ x: v.y, y: -v.x });
  }
  if (!segN.length) return pts.map((p) => ({ ...p }));
  return pts.map((p, i) => {
    const a = segN[Math.max(0, i - 1)], b = segN[Math.min(segN.length - 1, i)];
    let n = norm({ x: a.x + b.x, y: a.y + b.y });
    if (Math.hypot(a.x + b.x, a.y + b.y) < 1e-6) n = b; // reversal: no sensible miter
    const k = Math.min(4, 1 / Math.max(0.25, n.x * b.x + n.y * b.y)); // miter length, clamped for sharp turns
    return { x: p.x + n.x * d * k, y: p.y + n.y * d * k };
  });
}

/**
 * Slide an offset end point along its own line so it sits on the attached shape's outline (+ GAP).
 * `away` points from the shape out along the path. Port-anchored and free ends are left as they are.
 */
function reattach(end: ConnectorElement['start'], q: Point, away: Point, lookup: Lookup): Point {
  const pl = end.elementId && !end.anchor ? lookup(end.elementId) : null;
  if (!pl) return q;
  const { el, m } = pl;
  const c = centerOf(el, m);
  const along = (c.x - q.x) * away.x + (c.y - q.y) * away.y;
  const foot = { x: q.x + away.x * along, y: q.y + away.y * along }; // closest point to the centre on this line
  const lo = toLocal(el, m, foot);
  const poly = localOutline(el);
  if (!pointInPolygon(lo, poly)) return q; // shape too thin for this offset: keep the plain offset
  const a = -rad(el.rotation + m.rot);
  const ld = { x: away.x * Math.cos(a) - away.y * Math.sin(a), y: away.x * Math.sin(a) + away.y * Math.cos(a) };
  const t = rayPolygon(lo, ld, poly);
  if (t === null) return q;
  return toWorld(el, m, { x: lo.x + ld.x * (t + GAP), y: lo.y + ld.y * (t + GAP) });
}

/**
 * The two arrows of a request ⇄ response pair: `req` runs start→end on the left of travel,
 * `res` runs end→start on the other side. Both follow the connector's route and attach to the shapes.
 */
export function pairPaths(c: ConnectorElement, lookup: Lookup): { req: ConnectorPath; res: ConnectorPath } {
  const center = connectorPath(c, lookup);
  const smooth = isSmooth(c);
  const side = (d: number) => {
    const ctrl = offsetPolyline(center.control, d);
    const n = ctrl.length;
    if (n >= 2) {
      const dir0 = norm({ x: ctrl[1].x - ctrl[0].x, y: ctrl[1].y - ctrl[0].y });
      const dirN = norm({ x: ctrl[n - 2].x - ctrl[n - 1].x, y: ctrl[n - 2].y - ctrl[n - 1].y });
      ctrl[0] = reattach(c.start, ctrl[0], dir0, lookup);
      ctrl[n - 1] = reattach(c.end, ctrl[n - 1], dirN, lookup);
    }
    return ctrl;
  };
  const half = pairGap(c) / 2;
  return { req: buildPath(side(half), smooth), res: buildPath(side(-half).reverse(), smooth) };
}

/** Index i such that cum[i] <= s < cum[i+1] */
function seek(cum: number[], s: number): number {
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  return lo;
}

export function pointAt(p: ConnectorPath, s: number): { pt: Point; tan: Point } {
  if (p.pts.length < 2) return { pt: p.pts[0] ?? { x: 0, y: 0 }, tan: { x: 1, y: 0 } };
  s = Math.max(0, Math.min(p.length, s));
  const i = Math.min(seek(p.cum, s), p.pts.length - 2);
  const a = p.pts[i], b = p.pts[i + 1];
  const seg = p.cum[i + 1] - p.cum[i] || 1;
  const t = (s - p.cum[i]) / seg;
  return { pt: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, tan: norm({ x: b.x - a.x, y: b.y - a.y }) };
}

/** Sub-polyline between arc lengths s0 < s1 */
export function slice(p: ConnectorPath, s0: number, s1: number): Point[] {
  s0 = Math.max(0, s0); s1 = Math.min(p.length, s1);
  if (s1 <= s0) return [];
  const out: Point[] = [pointAt(p, s0).pt];
  const i0 = seek(p.cum, s0) + 1, i1 = seek(p.cum, s1);
  for (let i = i0; i <= i1 && i < p.pts.length; i++) if (p.cum[i] > s0 && p.cum[i] < s1) out.push(p.pts[i]);
  out.push(pointAt(p, s1).pt);
  return out;
}

/** Tangent at the end of the path averaged over the final few px (stable arrowheads). */
export function endTangent(p: ConnectorPath, atStart: boolean, span = 12): Point {
  if (p.length < 0.5) return { x: 1, y: 0 };
  const L = p.length;
  const a = atStart ? pointAt(p, Math.min(L, span)).pt : pointAt(p, Math.max(0, L - span)).pt;
  const b = atStart ? p.pts[0] : p.pts[p.pts.length - 1];
  return norm({ x: b.x - a.x, y: b.y - a.y });
}

export function isAttachable(e: DiagramElement): e is BoxElement {
  return e.type !== 'connector';
}
