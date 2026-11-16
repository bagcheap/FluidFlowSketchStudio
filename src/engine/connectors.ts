// Connector geometry: endpoint resolution against (animated) targets, routing, and
// arc-length parametrised polylines used by flow/draw-on animation and hit testing.
import type { BoxElement, ConnectorElement, DiagramElement, HeadKind, Point } from '../model/types';
import { geometryFor, rayPolygon } from './shapes';
import type { Motion } from './animation';
import { STILL } from './animation';

export interface Placed { el: BoxElement; m: Motion }
export type Lookup = (id: string) => Placed | null;

const rad = (d: number) => (d * Math.PI) / 180;

export function localOutline(el: BoxElement): Point[] {
  if (el.type === 'shape') return geometryFor(el).poly;
  if (el.type === 'icon' && el.frame === 'circle') {
    // arrows end on the round background
    return Array.from({ length: 48 }, (_, i) => { const a = (i / 48) * Math.PI * 2; return { x: el.w / 2 + Math.cos(a) * el.w / 2, y: el.h / 2 + Math.sin(a) * el.h / 2 }; });
  }
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
/** Elbow arrows run straight out of (and into) a shape at least this far, plus the arrowhead's length. */
export const LEAD = 26;

/** dir = outward direction from the attached shape (for elbow/arrow logic); box = that shape's world bounds. */
interface End { p: Point; dir: Point; box?: { x0: number; y0: number; x1: number; y1: number } }

function worldBox(el: Parameters<typeof toWorld>[0], m: Parameters<typeof toWorld>[1]) {
  const cs = [{ x: 0, y: 0 }, { x: el.w, y: 0 }, { x: el.w, y: el.h }, { x: 0, y: el.h }].map((q) => toWorld(el, m, q));
  return { x0: Math.min(...cs.map((q) => q.x)), y0: Math.min(...cs.map((q) => q.y)), x1: Math.max(...cs.map((q) => q.x)), y1: Math.max(...cs.map((q) => q.y)) };
}

function norm(v: Point): Point { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; }

function resolveEnd(end: ConnectorElement['start'], aim: Point, lookup: Lookup, elbow: boolean): End {
  const pl = end.elementId ? lookup(end.elementId) : null;
  if (!pl) return { p: { x: end.x, y: end.y }, dir: norm({ x: aim.x - end.x, y: aim.y - end.y }) };
  const { el, m } = pl;
  if (end.anchor) {
    const lp = { x: end.anchor.x * el.w, y: end.anchor.y * el.h };
    const wp = toWorld(el, m, lp);
    // a point outside the box (a sequence-diagram lifeline below a participant): exactly there, no gap
    if (end.anchor.x < -0.001 || end.anchor.x > 1.001 || end.anchor.y < -0.001 || end.anchor.y > 1.001) {
      return { p: wp, dir: norm({ x: aim.x - wp.x, y: aim.y - wp.y }) };
    }
    // snap port direction to its nearest side for nicer elbows
    const ax = end.anchor.x - 0.5, ay = end.anchor.y - 0.5;
    const sideDir = Math.abs(ax) >= Math.abs(ay) ? { x: Math.sign(ax) || 1, y: 0 } : { x: 0, y: Math.sign(ay) || 1 };
    // the gap runs straight out of the port's side (the same as from the centre for a side's middle port)
    const a = rad(el.rotation + m.rot);
    const out = { x: sideDir.x * Math.cos(a) - sideDir.y * Math.sin(a), y: sideDir.x * Math.sin(a) + sideDir.y * Math.cos(a) };
    const dir = elbow ? sideDir : out;
    return { p: { x: wp.x + out.x * GAP, y: wp.y + out.y * GAP }, dir, box: worldBox(el, m) };
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
  return { p: wp, dir: wd, box: worldBox(el, m) };
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

/** Waypoints this close to lining up with an arrow's end are lined up with it (see elbowRoute). */
const END_SNAP = 16;

/**
 * Line the first and last waypoints up with the arrow's ends when they're nearly in line. Waypoints stay put while
 * shapes float a few px (animation) or are nudged; without this the corner next to the end would split into two with
 * a tiny step between them, and rounding (limited by segment length) would make it look sharp. Moving a waypoint
 * along its own segment keeps the route right-angled, because only the coordinate across that segment changes.
 */
function alignToEnds(s: End, e: End, bends: Point[]): Point[] {
  const b = bends.map((p) => ({ ...p }));
  const n = b.length;
  const firstHoriz = Math.abs(s.dir.x) >= Math.abs(s.dir.y), lastHoriz = Math.abs(e.dir.x) >= Math.abs(e.dir.y);
  if (firstHoriz ? Math.abs(b[0].y - s.p.y) <= END_SNAP : Math.abs(b[0].x - s.p.x) <= END_SNAP) {
    if (firstHoriz) b[0].y = s.p.y; else b[0].x = s.p.x;
  }
  // with a single waypoint, the end can only be lined up when it runs the other way (an L)
  if (n > 1 || firstHoriz !== lastHoriz) {
    const L = b[n - 1];
    if (lastHoriz ? Math.abs(L.y - e.p.y) <= END_SNAP : Math.abs(L.x - e.p.x) <= END_SNAP) {
      if (lastHoriz) L.y = e.p.y; else L.x = e.p.x;
    }
  }
  return b;
}

/**
 * An elbow route without waypoints that runs straight out of each attached end for `leadS` / `leadE` px before its
 * first turn (so no corner sits right at an arrowhead), then takes the cheapest of the simple right-angled ways
 * between those points (length + a cost per turn) that never doubles back and never cuts through either shape.
 * Null when none works (the plain route is used then).
 */
function leadRoute(s: End, e: End, leadS: number, leadE: number): { pts: Point[]; cost: number } | null {
  const ax = (d: Point): Point => (Math.abs(d.x) >= Math.abs(d.y) ? { x: Math.sign(d.x) || 1, y: 0 } : { x: 0, y: Math.sign(d.y) || 1 });
  const sd = ax(s.dir), ed = ax(e.dir);
  const S = { x: s.p.x + sd.x * leadS, y: s.p.y + sd.y * leadS }, E = { x: e.p.x + ed.x * leadE, y: e.p.y + ed.y * leadE };
  // the turn halfway between the shapes (as before), as long as that is past both straight runs
  const mid = (a: number, b: number, A: number, B: number) => Math.min(Math.max((a + b) / 2, Math.min(A, B)), Math.max(A, B));
  const mx = mid(s.p.x, e.p.x, S.x, E.x), my = mid(s.p.y, e.p.y, S.y, E.y);
  // in order of preference when costs tie: straight, the turn halfway, then the corner at an end
  const cands: Point[][] = [
    [],
    [{ x: mx, y: S.y }, { x: mx, y: E.y }], [{ x: S.x, y: my }, { x: E.x, y: my }],
    [{ x: E.x, y: S.y }], [{ x: S.x, y: E.y }],
  ];
  // also round the far side of a shape that is in the way
  const boxes = [s.box, e.box].filter(Boolean) as NonNullable<End['box']>[];
  for (const b of boxes) {
    for (const x of [b.x0 - leadS, b.x1 + leadS]) cands.push([{ x, y: S.y }, { x, y: E.y }], [{ x: S.x, y: my }, { x, y: my }, { x, y: E.y }]);
    for (const y of [b.y0 - leadS, b.y1 + leadS]) cands.push([{ x: S.x, y }, { x: E.x, y }], [{ x: mx, y: S.y }, { x: mx, y }, { x: E.x, y }]);
  }
  const cuts = (a: Point, b: Point, r: NonNullable<End['box']>) => {
    // does segment a–b (horizontal or vertical) pass through the inside of r?
    if (Math.abs(a.y - b.y) < 0.01) return a.y > r.y0 + 0.5 && a.y < r.y1 - 0.5 && Math.max(a.x, b.x) > r.x0 + 0.5 && Math.min(a.x, b.x) < r.x1 - 0.5;
    return a.x > r.x0 + 0.5 && a.x < r.x1 - 0.5 && Math.max(a.y, b.y) > r.y0 + 0.5 && Math.min(a.y, b.y) < r.y1 - 0.5;
  };
  let best: Point[] | null = null, bestCost = Infinity;
  for (const mid of cands) {
    const pts = simplifyRight([s.p, S, ...mid, E, e.p]);
    if (!pts) continue;
    let cost = 0, ok = true;
    for (let i = 1; i < pts.length && ok; i++) {
      const a = pts[i - 1], b = pts[i];
      cost += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      if (i > 1 && i < pts.length - 1) ok = !boxes.some((r) => cuts(a, b, r)); // the leads themselves leave the shapes
    }
    // the first and last stretches must still run along the leads (at least as long as them)
    const first = pts[1], last = pts[pts.length - 2];
    if (Math.abs(first.x - s.p.x) + Math.abs(first.y - s.p.y) < leadS - 0.5 && pts.length > 2) ok = false;
    if (Math.abs(last.x - e.p.x) + Math.abs(last.y - e.p.y) < leadE - 0.5 && pts.length > 2) ok = false;
    if (!ok) continue;
    cost += (pts.length - 2) * 40;
    if (cost < bestCost - 1e-6) { bestCost = cost; best = pts; }
  }
  return best ? { pts: best, cost: bestCost } : null;
}

/**
 * A right-angled polyline without repeated points or points in the middle of a straight run; null if it has a
 * slanted segment or doubles straight back on itself.
 */
function simplifyRight(raw: Point[]): Point[] | null {
  const pts: Point[] = [];
  for (const q of raw) {
    const l = pts[pts.length - 1];
    if (l && Math.abs(q.x - l.x) < 0.01 && Math.abs(q.y - l.y) < 0.01) continue;
    pts.push(q);
  }
  for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].x - pts[i - 1].x) > 0.01 && Math.abs(pts[i].y - pts[i - 1].y) > 0.01) return null;
  const out: Point[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i];
    if (out.length >= 2) {
      const a = out[out.length - 2], m = out[out.length - 1];
      const d1 = { x: Math.sign(m.x - a.x), y: Math.sign(m.y - a.y) }, d2 = { x: Math.sign(b.x - m.x), y: Math.sign(b.y - m.y) };
      if (d1.x === -d2.x && d1.y === -d2.y) return null; // doubles back
      if (d1.x === d2.x && d1.y === d2.y) out.pop(); // straight on
    }
    out.push(b);
  }
  return out;
}

function elbowRoute(s: End, e: End, bends: Point[], leadS = 0, leadE = 0): Point[] {
  // attached ends without waypoints: straight out of (and into) the shapes first, so no turn sits at an arrowhead
  if (!bends.length && (s.box || e.box)) {
    // full straight runs if they fit; shorter ones (at a price) when shapes are too close for them, rather than a
    // long way round
    let best: Point[] | null = null, bestCost = Infinity;
    for (const [f, price] of [[1, 0], [0.5, 90], [0, 180]] as const) {
      const r = leadRoute(s, e, s.box ? leadS * f : 0, e.box ? leadE * f : 0);
      if (r && r.cost + price < bestCost) { bestCost = r.cost + price; best = r.pts; }
    }
    if (best) return best;
  }
  if (bends.length) bends = alignToEnds(s, e, bends);
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

export const ELBOW_JOG = 20; // dragging an end segment of an elbow arrow adds a jog this far from its shape

/** Does the elbow segment a→b run horizontally (so it slides up and down)? */
export const isHorizontal = (a: Point, b: Point) => Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);

/**
 * Slide segment k of an elbow route (its control points, start to end) sideways to coordinate c: y for a horizontal
 * segment, x for a vertical one. The ends stay where they are: moving the first or last segment adds a short jog next
 * to its shape. Returns the route's new corners, which become the arrow's bend points (an elbow route passes through
 * its bend points in turn, so the arrow keeps exactly this shape).
 */
export function moveElbowSegment(control: Point[], k: number, c: number): Point[] {
  const n = control.length;
  if (n < 2 || k < 0 || k > n - 2) return control.slice(1, -1);
  const a = control[k], b = control[k + 1];
  const horiz = isHorizontal(a, b);
  const to = (q: Point): Point => (horiz ? { x: q.x, y: c } : { x: c, y: q.y });
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const jog = Math.min(ELBOW_JOG, len / 3);
  const step = (from: Point, toward: Point): Point => ({ x: from.x + ((toward.x - from.x) / len) * jog, y: from.y + ((toward.y - from.y) / len) * jog });
  let head: Point[], tail: Point[];
  if (k === 0) { const A = step(a, b); head = [a, A, to(A)]; } else head = [...control.slice(0, k), to(a)];
  if (k + 1 === n - 1) { const B = step(b, a); tail = [to(B), B, b]; } else tail = [to(b), ...control.slice(k + 2)];
  return [...head, ...tail].slice(1, -1);
}

/** Bend points of an elbow route without repeated points or points in the middle of a straight run. */
export function tidyElbow(start: Point, bends: Point[], end: Point): Point[] {
  const out: Point[] = [start];
  for (const q of [...bends, end]) {
    const last = out[out.length - 1];
    if (Math.hypot(q.x - last.x, q.y - last.y) < 0.5) continue;
    if (out.length >= 2) {
      const pre = out[out.length - 2];
      const straight = (Math.abs(pre.x - last.x) < 0.5 && Math.abs(last.x - q.x) < 0.5) || (Math.abs(pre.y - last.y) < 0.5 && Math.abs(last.y - q.y) < 0.5);
      if (straight && out.length > 1 && out[out.length - 1] !== start) out.pop();
    }
    out.push(q);
  }
  return out.slice(1, -1);
}

/**
 * Round the corners of an elbow route: each corner becomes a smooth turn of radius up to `r`, never more than
 * half a segment shared with another corner (or the whole end segment), so short segments still look right.
 */
export function roundCorners(pts: Point[], r: number, keepS = 0, keepE = 0): Point[] {
  if (r <= 0.01 || pts.length < 3) return pts;
  const out: Point[] = [pts[0]];
  const last = pts.length - 2;
  for (let i = 1; i <= last; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const la = Math.hypot(b.x - a.x, b.y - a.y), lc = Math.hypot(c.x - b.x, c.y - b.y);
    // never more than half a shared segment; at the ends, keep `keepS` / `keepE` px straight (the arrowheads' room)
    const rr = Math.min(r, i === 1 ? la - keepS : la / 2, i === last ? lc - keepE : lc / 2);
    if (rr < 0.5 || la < 0.01 || lc < 0.01) { out.push(b); continue; }
    const p1 = { x: b.x + ((a.x - b.x) / la) * rr, y: b.y + ((a.y - b.y) / la) * rr };
    const p2 = { x: b.x + ((c.x - b.x) / lc) * rr, y: b.y + ((c.y - b.y) / lc) * rr };
    out.push(p1);
    const steps = Math.max(4, Math.min(16, Math.round(rr / 3)));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps, u = 1 - t; // quadratic curve with the corner as control point: a near-circular quarter turn
      out.push({ x: u * u * p1.x + 2 * u * t * b.x + t * t * p2.x, y: u * u * p1.y + 2 * u * t * b.y + t * t * p2.y });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function connectorPath(c: ConnectorElement, lookup: Lookup): ConnectorPath {
  const elbow = c.routing === 'elbow';
  const sRef = refPoint(c.start, lookup), eRef = refPoint(c.end, lookup);
  const aimS = c.bends.length ? c.bends[0] : eRef;
  const aimE = c.bends.length ? c.bends[c.bends.length - 1] : sRef;
  const s = resolveEnd(c.start, aimS, lookup, elbow);
  const e = resolveEnd(c.end, aimE, lookup, elbow);
  let control: Point[];
  let pts: Point[];
  if (elbow) {
    // straight room before each end: more where there is an arrowhead
    const sw = c.style.strokeWidth, hs = c.headSize ?? 1;
    const lead = (h: HeadKind) => LEAD + (h === 'none' ? 0 : Math.min(34, 9 + 3 * sw) * hs);
    control = elbowRoute(s, e, c.bends, lead(c.startHead), lead(c.endHead));
    const keep = (h: HeadKind) => (h === 'none' ? 4 : Math.min(34, 9 + 3 * sw) * hs + 4);
    pts = densify(roundCorners(control, c.elbowRadius ?? 0, keep(c.startHead), keep(c.endHead)));
  } else if (c.routing === 'curved' && (c.bends.length || Math.abs(c.curvature) > 0.001)) {
    if (c.bends.length) control = [s.p, ...c.bends, e.p];
    else {
      const mx = (s.p.x + e.p.x) / 2, my = (s.p.y + e.p.y) / 2;
      const dx = e.p.x - s.p.x, dy = e.p.y - s.p.y;
      const k = c.curvature * 0.5;
      control = [s.p, { x: mx - dy * k, y: my + dx * k }, e.p];
    }
    pts = catmull(control);
  } else {
    control = [s.p, ...c.bends, e.p];
    pts = densify(control);
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { pts, cum, length: cum[cum.length - 1], control };
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

/** The point on the path nearest to q: its arc length, position and direction. */
export function nearestOnPath(p: ConnectorPath, q: Point): { s: number; pt: Point; tan: Point } {
  if (p.pts.length < 2) return { s: 0, pt: p.pts[0] ?? { x: 0, y: 0 }, tan: { x: 1, y: 0 } };
  let best = { d: Infinity, s: 0, pt: p.pts[0], tan: { x: 1, y: 0 } };
  for (let i = 0; i < p.pts.length - 1; i++) {
    const a = p.pts[i], b = p.pts[i + 1];
    const ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
    if (l2 < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * ex + (q.y - a.y) * ey) / l2));
    const pt = { x: a.x + ex * t, y: a.y + ey * t };
    const d = Math.hypot(q.x - pt.x, q.y - pt.y);
    if (d < best.d) best = { d, s: p.cum[i] + (p.cum[i + 1] - p.cum[i]) * t, pt, tan: norm({ x: ex, y: ey }) };
  }
  return { s: best.s, pt: best.pt, tan: best.tan };
}

/**
 * Where an arrow's label goes so that its centre is at (or as close as it can get to) `center`: the fraction along the
 * arrow (labelPos) and the sideways distance (labelOffset), the same pair the renderer reads. Stored relative to the
 * arrow, so the label keeps its place when the arrow's shapes move.
 */
export function labelPlacement(p: ConnectorPath, center: Point): { labelPos: number; labelOffset: number } {
  const { s, pt, tan } = nearestOnPath(p, center);
  const off = (center.x - pt.x) * -tan.y + (center.y - pt.y) * tan.x; // along the normal (-tan.y, tan.x)
  return { labelPos: p.length > 0 ? Math.max(0, Math.min(1, s / p.length)) : 0.5, labelOffset: Math.max(-500, Math.min(500, off)) };
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
