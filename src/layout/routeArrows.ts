// Route arrows around shapes (on request): each chosen arrow gets port anchors on the best pair of sides and bend
// points along an obstacle-free right-angled route (orthoRoute). Arrows sharing a side of a shape are spread along it.
// The result is ordinary elbow routing with waypoints: editable with the segment bars, undone by Reset route.
import type { BoxElement, ConnectorElement, FlowDocument, HeadKind, Point } from '../model/types';
import { connectorPath, GAP, LEAD, localOutline, toWorld } from '../engine/connectors';
import { makeLookup } from '../engine/render';
import { STILL } from '../engine/animation';
import { rayPolygon } from '../engine/shapes';
import { countCrossings, markUsed, routeOrtho, segsOf, type Rect, type RouteEnd, type Seg } from './orthoRoute';
import { isLifeline } from '../editor/hitTest';

type Side = 0 | 1 | 2 | 3; // top, right, bottom, left
const OUT: Point[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];

/** Shapes, icons and pictures are obstacles; containers (arrows run inside them), text and pen strokes aren't. */
const isObstacle = (e: FlowDocument['elements'][number]): e is BoxElement => e.type === 'shape' || e.type === 'icon' || e.type === 'image';

function bounds(el: BoxElement): Rect {
  const cs = [{ x: 0, y: 0 }, { x: el.w, y: 0 }, { x: el.w, y: el.h }, { x: 0, y: el.h }].map((q) => toWorld(el, STILL, q));
  return { x0: Math.min(...cs.map((q) => q.x)), y0: Math.min(...cs.map((q) => q.y)), x1: Math.max(...cs.map((q) => q.x)), y1: Math.max(...cs.map((q) => q.y)) };
}

/** The side the elbow router reads from an anchor (resolveEnd's rule), so a saved route comes back exactly. */
const sideOfAnchor = (a: Point): Side => {
  const ax = a.x - 0.5, ay = a.y - 0.5;
  return Math.abs(ax) >= Math.abs(ay) ? (ax >= 0 ? 1 : 3) : (ay >= 0 ? 2 : 0);
};

/**
 * A point on `side` of the shape's outline, `t` (0..1) along that side, straight out from the middle line (as the
 * snap points are). On a slanted outline (a diamond's) a point near a corner would read as the next side, so it moves
 * towards the middle until it reads right. Returns the anchor and the route end just outside the shape.
 */
function sidePoint(el: BoxElement, side: Side, t: number): { anchor: Point; end: RouteEnd } {
  const poly = localOutline(el);
  for (let k = 0; k < 6; k++, t = 0.5 + (t - 0.5) / 2) {
    const vertical = side === 0 || side === 2;
    const from = vertical ? { x: t * el.w, y: el.h / 2 } : { x: el.w / 2, y: t * el.h };
    const dir = OUT[side];
    const d = rayPolygon(from, dir, poly);
    const lp = d === null ? { x: from.x + dir.x * (vertical ? el.h / 2 : el.w / 2), y: from.y + dir.y * (vertical ? el.h / 2 : el.w / 2) } : { x: from.x + dir.x * d, y: from.y + dir.y * d };
    const anchor = { x: lp.x / Math.max(1, el.w), y: lp.y / Math.max(1, el.h) };
    if (sideOfAnchor(anchor) !== side && k < 5) continue;
    const w = toWorld(el, STILL, lp);
    return { anchor, end: { p: { x: w.x + dir.x * GAP, y: w.y + dir.y * GAP }, dir } };
  }
  throw new Error('unreachable');
}

/** The route end at a saved anchor on the shape's outline (a snap point the user chose). */
function anchorPoint(el: BoxElement, anchor: Point): { anchor: Point; end: RouteEnd; side: Side } {
  const side = sideOfAnchor(anchor), dir = OUT[side];
  const w = toWorld(el, STILL, { x: anchor.x * el.w, y: anchor.y * el.h });
  return { anchor, side, end: { p: { x: w.x + dir.x * GAP, y: w.y + dir.y * GAP }, dir } };
}

interface Plan { c: ConnectorElement; a: BoxElement; b: BoxElement; sa: Side; sb: Side; pts: Point[] }

/** The two shapes an arrow joins, in a fixed order (arrows between the same pair sort together). */
const pairKey = (p: Plan) => [p.a.id, p.b.id].sort().join('|');
/**
 * Two shapes facing each other across a gap, with overlapping edges and nothing in between: a straight arrow across
 * the middle of the overlap reads best (the router's straight runs out of each shape wouldn't fit a short gap and
 * would give it a step). Returns the anchors and the straight route, or null.
 */
function straightShot(plan: Plan, obstacles: Rect[], segs: Seg[], fixA?: number, fixB?: number): { A: { anchor: Point }; B: { anchor: Point }; pts: Point[] } | null {
  const { a, b, sa, sb } = plan;
  if ((sa + 2) % 4 !== sb || a.type !== 'shape' || b.type !== 'shape') return null; // outlines other than shapes' vary
  const ra = bounds(a), rb = bounds(b), horiz = sa === 1 || sa === 3;
  const lo = horiz ? Math.max(ra.y0, rb.y0) : Math.max(ra.x0, rb.x0), hi = horiz ? Math.min(ra.y1, rb.y1) : Math.min(ra.x1, rb.x1);
  if (hi - lo < 16) return null; // not enough of the edges face each other
  // where along the edges: the middle of the overlap, or where a shared end already sits (both fixed: they must agree)
  const at = (r: Rect, t: number) => (horiz ? r.y0 + t * (r.y1 - r.y0) : r.x0 + t * (r.x1 - r.x0));
  const want = [fixA !== undefined ? at(ra, fixA) : null, fixB !== undefined ? at(rb, fixB) : null].filter((v): v is number => v !== null);
  if (want.length === 2 && Math.abs(want[0] - want[1]) > 0.5) return null;
  const c = want.length ? want[0] : (lo + hi) / 2;
  if (c < lo + 8 || c > hi - 8) return null; // too near a corner of one of them
  const ta = horiz ? (c - ra.y0) / (ra.y1 - ra.y0) : (c - ra.x0) / (ra.x1 - ra.x0), tb = horiz ? (c - rb.y0) / (rb.y1 - rb.y0) : (c - rb.x0) / (rb.x1 - rb.x0);
  const A = sidePoint(a, sa, ta), B = sidePoint(b, sb, tb);
  if (Math.abs(horiz ? A.end.p.y - B.end.p.y : A.end.p.x - B.end.p.x) > 0.5) return null; // a slanted outline moved a point
  const d = horiz ? (B.end.p.x - A.end.p.x) * A.end.dir.x : (B.end.p.y - A.end.p.y) * A.end.dir.y;
  if (d <= 0) return null; // they don't face each other
  const pts = [A.end.p, B.end.p];
  const between = (r: Rect) => r !== null && !(r.x1 < Math.min(pts[0].x, pts[1].x) || r.x0 > Math.max(pts[0].x, pts[1].x) || r.y1 < Math.min(pts[0].y, pts[1].y) || r.y0 > Math.max(pts[0].y, pts[1].y));
  if (obstacles.some((r) => r !== ra && r !== rb && !sameRect(r, ra) && !sameRect(r, rb) && between(r))) return null;
  if (countCrossings(segsOf(pts), segs) > 0) return null;
  return { A, B, pts };
}
const sameRect = (p: Rect, q: Rect) => Math.abs(p.x0 - q.x0) < 0.01 && Math.abs(p.y0 - q.y0) < 0.01 && Math.abs(p.x1 - q.x1) < 0.01 && Math.abs(p.y1 - q.y1) < 0.01;

/** Most side-order swaps tried to remove crossings (each re-routes the arrows). */
const MAX_SWAPS = 30;
const lifeline = (e: ConnectorElement): boolean => isLifeline(e);

/**
 * Route the given arrows (ids) around every shape on the page. Only arrows attached at both ends to two different,
 * unrotated shapes/icons/pictures are routed; locked ones and activation bars are left alone. They become elbow
 * arrows. Returns the new document and how many arrows were routed.
 */
export function routeArrowsAround(doc: FlowDocument, ids: string[], opts: { keepAnchors?: boolean } = {}): { doc: FlowDocument; routed: number } {
  // keepAnchors: an end already on a snap point stays exactly there (an end the user just dropped); others are chosen
  const kept = (c: ConnectorElement, end: 'start' | 'end') => {
    const a = c[end].anchor;
    return opts.keepAnchors && a && a.x >= -0.001 && a.x <= 1.001 && a.y >= -0.001 && a.y <= 1.001 ? a : null;
  };
  const byId = new Map(doc.elements.map((e) => [e.id, e]));
  const boxes = doc.elements.filter(isObstacle);
  const obstacles = boxes.map(bounds);
  // routes keep off container borders (an arrow along a dashed border is hard to see)
  const borders = doc.elements.filter((e) => e.type === 'container').map((e) => ({ x0: e.x, y0: e.y, x1: e.x + e.w, y1: e.y + e.h }));
  // straight room out of each shape before a turn: as the elbow router gives it (more where there is an arrowhead)
  const stubOf = (c: ConnectorElement, h: HeadKind) => LEAD + (h === 'none' ? 0 : Math.min(34, 9 + 3 * c.style.strokeWidth) * (c.headSize ?? 1));
  const withStub = (r: RouteEnd, stub: number): RouteEnd => ({ ...r, stub });
  const want = new Set(ids);
  const conns = doc.elements.filter((e): e is ConnectorElement => e.type === 'connector' && want.has(e.id) && !e.locked && !e.bar);
  // arrows that aren't being routed stay where they are: new routes try not to cross them (lifelines don't count)
  const lookup = makeLookup(doc, null);
  const fixed: Seg[] = doc.elements.filter((e): e is ConnectorElement => e.type === 'connector' && !e.bar && !lifeline(e) && !conns.some((c) => c.id === e.id))
    .slice(0, 400).flatMap((c) => segsOf(connectorPath(c, lookup).control));
  const plans: Plan[] = [];
  const used = new Map<string, number>();
  const placed: Seg[] = [...fixed];
  // pass 1: the best pair of sides for each arrow, from the middle of each side (crossing other arrows costs a lot,
  // so an arrow picks the sides that keep it clear of the ones already placed)
  for (const c of conns) {
    const a = c.start.elementId ? byId.get(c.start.elementId) : undefined, b = c.end.elementId ? byId.get(c.end.elementId) : undefined;
    if (!a || !b || a === b || !isObstacle(a) || !isObstacle(b) || a.rotation % 360 || b.rotation % 360) continue;
    let best: Plan | null = null, bestCost = Infinity;
    const ka = kept(c, 'start'), kb = kept(c, 'end');
    const sidesA: Side[] = ka ? [anchorPoint(a, ka).side] : [0, 1, 2, 3], sidesB: Side[] = kb ? [anchorPoint(b, kb).side] : [0, 1, 2, 3];
    for (const sa of sidesA) for (const sb of sidesB) {
      const r = routeOrtho(withStub(ka ? anchorPoint(a, ka).end : sidePoint(a, sa, 0.5).end, stubOf(c, c.startHead)), withStub(kb ? anchorPoint(b, kb).end : sidePoint(b, sb, 0.5).end, stubOf(c, c.endHead)), obstacles, used, borders, placed);
      if (r && r.cost < bestCost) { bestCost = r.cost; best = { c, a, b, sa, sb, pts: r.pts }; }
    }
    if (best) { plans.push(best); markUsed(used, best.pts, obstacles); placed.push(...segsOf(best.pts)); }
  }
  // spread arrows that share a side of a shape along it, in the order of where their other ends are; arrows between
  // the same two shapes keep the same order at both ends (by id), so they run side by side instead of crossing
  const slots = new Map<string, { plan: Plan; end: 'a' | 'b'; along: number }[]>();
  for (const plan of plans) {
    for (const end of ['a', 'b'] as const) {
      if (kept(plan.c, end === 'a' ? 'start' : 'end')) continue; // stays where it was put
      const el = plan[end], side = end === 'a' ? plan.sa : plan.sb, other = end === 'a' ? plan.b : plan.a;
      const ob = bounds(other), along = side === 0 || side === 2 ? (ob.x0 + ob.x1) / 2 : (ob.y0 + ob.y1) / 2;
      const k = `${el.id}:${side}`;
      slots.set(k, [...(slots.get(k) ?? []), { plan, end, along }]);
    }
  }
  const tOf = new Map<string, number>(); // `${connector}:${end}` → position along the side
  const groups = [...slots.values()].filter((l) => l.length > 1);
  const shared = new Set(groups.flatMap((l) => l.map((s) => `${s.plan.c.id}:${s.end}`))); // ends sharing a side
  for (const list of slots.values()) {
    list.sort((p, q) => p.along - q.along || pairKey(p.plan).localeCompare(pairKey(q.plan)) || (p.plan.c.id < q.plan.c.id ? -1 : 1));
    list.forEach((s, i) => tOf.set(`${s.plan.c.id}:${s.end}`, (i + 1) / (list.length + 1)));
  }
  // pass 2: route again from the spread points, each route keeping clear of the ones before it
  const routeAll = () => {
    const used2 = new Map<string, number>();
    const segs: Seg[] = [...fixed];
    const out = new Map<string, { A: { anchor: Point }; B: { anchor: Point }; pts: Point[] }>();
    for (const plan of plans) {
      const ka = kept(plan.c, 'start'), kb = kept(plan.c, 'end');
      // a short straight arrow between facing shapes; an end that shares its side keeps its spread place
      const fixA = shared.has(`${plan.c.id}:a`) ? tOf.get(`${plan.c.id}:a`) : undefined, fixB = shared.has(`${plan.c.id}:b`) ? tOf.get(`${plan.c.id}:b`) : undefined;
      const direct = !ka && !kb ? straightShot(plan, obstacles, segs, fixA, fixB) : null;
      if (direct) { segs.push(...segsOf(direct.pts)); out.set(plan.c.id, direct); continue; }
      const A = ka ? anchorPoint(plan.a, ka) : sidePoint(plan.a, plan.sa, tOf.get(`${plan.c.id}:a`) ?? 0.5);
      const B = kb ? anchorPoint(plan.b, kb) : sidePoint(plan.b, plan.sb, tOf.get(`${plan.c.id}:b`) ?? 0.5);
      const r = routeOrtho(withStub(A.end, stubOf(plan.c, plan.c.startHead)), withStub(B.end, stubOf(plan.c, plan.c.endHead)), obstacles, used2, borders, segs);
      if (!r) continue;
      markUsed(used2, r.pts, obstacles);
      segs.push(...segsOf(r.pts));
      out.set(plan.c.id, { A, B, pts: r.pts });
    }
    return out;
  };
  const crossTotal = (rs: ReturnType<typeof routeAll>) => {
    const list = [...rs.values()].map((r) => segsOf(r.pts));
    let n = 0;
    for (let i = 0; i < list.length; i++) { n += countCrossings(list[i], fixed); for (let j = i + 1; j < list.length; j++) n += countCrossings(list[i], list[j]); }
    return n;
  };
  let routes = routeAll(), crossed = crossTotal(routes);
  // still crossing: try swapping neighbours on a shared side (the order there decides whether they cross); keep a
  // swap only when it leaves fewer crossings and no fewer routes
  for (let sweep = 0, tries = 0; sweep < 2 && crossed > 0 && tries < MAX_SWAPS; sweep++) {
    for (const list of groups) for (let i = 0; i + 1 < list.length && crossed > 0 && tries < MAX_SWAPS; i++, tries++) {
      const p = `${list[i].plan.c.id}:${list[i].end}`, q = `${list[i + 1].plan.c.id}:${list[i + 1].end}`;
      const tp = tOf.get(p)!, tq = tOf.get(q)!;
      tOf.set(p, tq); tOf.set(q, tp);
      const r2 = routeAll(), c2 = crossTotal(r2);
      if (c2 < crossed && r2.size >= routes.size) { routes = r2; crossed = c2; [list[i], list[i + 1]] = [list[i + 1], list[i]]; }
      else { tOf.set(p, tp); tOf.set(q, tq); }
    }
  }
  const done = new Map<string, Partial<ConnectorElement>>();
  for (const plan of plans) {
    const r = routes.get(plan.c.id);
    if (!r) continue;
    done.set(plan.c.id, {
      routing: 'elbow',
      start: { ...plan.c.start, anchor: r.A.anchor },
      end: { ...plan.c.end, anchor: r.B.anchor },
      bends: r.pts.slice(1, -1),
    });
  }
  return {
    doc: { ...doc, elements: doc.elements.map((e) => (e.type === 'connector' && done.has(e.id) ? { ...e, ...done.get(e.id) } as ConnectorElement : e)) },
    routed: done.size,
  };
}

/**
 * Arrows that meet the same side of a shape at the same point (several dropped on its middle) are spread along
 * that side, in the order of where their other ends are, so they don't bunch up. Only arrow ends attached to the
 * given shapes are looked at; a side where every arrow already has a point of its own is left alone. Elbow arrows on
 * a spread side are routed from their new points (around shapes, apart from each other).
 */
export function spreadEnds(doc: FlowDocument, shapeIds: (string | null | undefined)[]): FlowDocument {
  const wanted = new Set(shapeIds.filter(Boolean) as string[]);
  if (!wanted.size) return doc;
  const lookup = makeLookup(doc, null);
  const byId = new Map(doc.elements.map((e) => [e.id, e]));
  interface EndRef { c: ConnectorElement; end: 'start' | 'end'; t: number; along: number; explicit: boolean }
  const groups = new Map<string, EndRef[]>();
  for (const c of doc.elements) {
    if (c.type !== 'connector' || c.bar || c.locked || (c.start.elementId && c.start.elementId === c.end.elementId)) continue;
    let path: ReturnType<typeof connectorPath> | null = null;
    for (const end of ['start', 'end'] as const) {
      const ep = c[end], el = ep.elementId ? byId.get(ep.elementId) : undefined;
      if (!el || !wanted.has(el.id) || !isObstacle(el) || el.rotation % 360) continue;
      const a = ep.anchor;
      if (a && (a.x < -0.001 || a.x > 1.001 || a.y < -0.001 || a.y > 1.001)) continue; // a lifeline-style point outside the box
      let local: Point;
      if (a) local = a;
      else {
        path ??= connectorPath(c, lookup);
        const q = end === 'start' ? path.control[0] : path.control[path.control.length - 1];
        local = { x: (q.x - el.x) / Math.max(1, el.w), y: (q.y - el.y) / Math.max(1, el.h) };
      }
      const side = sideOfAnchor(local);
      const horizSide = side === 0 || side === 2;
      const other = c[end === 'start' ? 'end' : 'start'];
      const oel = other.elementId ? byId.get(other.elementId) : undefined;
      const op = oel && oel.type !== 'connector' ? { x: oel.x + oel.w / 2, y: oel.y + oel.h / 2 } : { x: other.x, y: other.y };
      const k = `${el.id}:${side}`;
      groups.set(k, [...(groups.get(k) ?? []), { c, end, t: horizSide ? local.x : local.y, along: horizSide ? op.x : op.y, explicit: !!a }]);
    }
  }
  const changes = new Map<string, Partial<ConnectorElement>>();
  const touched = new Set<string>();
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    const near = (p: number, q: number) => Math.abs(p - q) < 0.08;
    // nothing to do when every end already has a point of its own
    if (list.every((r) => r.explicit && !list.some((o) => o !== r && near(o.t, r.t)))) continue;
    // all of them get evenly spread places, in the order of where their other ends are: the snap points (¼ ½ ¾)
    // for up to three, so a side the user laid out on snap points keeps them
    const n = list.length;
    const slots = n === 2 ? [0.25, 0.75] : n === 3 ? [0.25, 0.5, 0.75] : Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));
    const movable = [...list].sort((p, q) => p.along - q.along);
    const pick = slots;
    const [elId, sideStr] = k.split(':');
    const el = byId.get(elId) as BoxElement;
    movable.forEach((r, i) => {
      const anchor = sidePoint(el, Number(sideStr) as Side, pick[i]).anchor;
      const ch = changes.get(r.c.id) ?? {};
      ch[r.end] = { ...r.c[r.end], anchor };
      changes.set(r.c.id, ch);
      if (r.c.routing === 'elbow') touched.add(r.c.id);
    });
  }
  if (!changes.size) return doc;
  let out: FlowDocument = { ...doc, elements: doc.elements.map((e) => (e.type === 'connector' && changes.has(e.id) ? { ...e, ...changes.get(e.id) } as ConnectorElement : e)) };
  // elbow arrows on a spread side find their way from their new points, keeping apart from each other
  if (touched.size) out = routeArrowsAround(out, [...touched], { keepAnchors: true }).doc;
  return out;
}
