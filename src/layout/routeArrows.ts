// Route arrows around shapes (on request): each chosen arrow gets port anchors on the best pair of sides and bend
// points along an obstacle-free right-angled route (orthoRoute). Arrows sharing a side of a shape are spread along it.
// The result is ordinary elbow routing with waypoints: editable with the segment bars, undone by Reset route.
import type { BoxElement, ConnectorElement, FlowDocument, Point } from '../model/types';
import { GAP, localOutline, toWorld } from '../engine/connectors';
import { STILL } from '../engine/animation';
import { rayPolygon } from '../engine/shapes';
import { markUsed, routeOrtho, type Rect, type RouteEnd } from './orthoRoute';

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

interface Plan { c: ConnectorElement; a: BoxElement; b: BoxElement; sa: Side; sb: Side; pts: Point[] }

/**
 * Route the given arrows (ids) around every shape on the page. Only arrows attached at both ends to two different,
 * unrotated shapes/icons/pictures are routed; locked ones and activation bars are left alone. They become elbow
 * arrows. Returns the new document and how many arrows were routed.
 */
export function routeArrowsAround(doc: FlowDocument, ids: string[]): { doc: FlowDocument; routed: number } {
  const byId = new Map(doc.elements.map((e) => [e.id, e]));
  const boxes = doc.elements.filter(isObstacle);
  const obstacles = boxes.map(bounds);
  const want = new Set(ids);
  const conns = doc.elements.filter((e): e is ConnectorElement => e.type === 'connector' && want.has(e.id) && !e.locked && !e.bar);
  const plans: Plan[] = [];
  const used = new Map<string, number>();
  // pass 1: the best pair of sides for each arrow, from the middle of each side
  for (const c of conns) {
    const a = c.start.elementId ? byId.get(c.start.elementId) : undefined, b = c.end.elementId ? byId.get(c.end.elementId) : undefined;
    if (!a || !b || a === b || !isObstacle(a) || !isObstacle(b) || a.rotation % 360 || b.rotation % 360) continue;
    let best: Plan | null = null, bestCost = Infinity;
    for (const sa of [0, 1, 2, 3] as Side[]) for (const sb of [0, 1, 2, 3] as Side[]) {
      const r = routeOrtho(sidePoint(a, sa, 0.5).end, sidePoint(b, sb, 0.5).end, obstacles, used);
      if (r && r.cost < bestCost) { bestCost = r.cost; best = { c, a, b, sa, sb, pts: r.pts }; }
    }
    if (best) { plans.push(best); markUsed(used, best.pts, obstacles); }
  }
  // spread arrows that share a side of a shape along it, in the order of where their other ends are
  const slots = new Map<string, { plan: Plan; end: 'a' | 'b'; along: number }[]>();
  for (const plan of plans) {
    for (const end of ['a', 'b'] as const) {
      const el = plan[end], side = end === 'a' ? plan.sa : plan.sb, other = end === 'a' ? plan.b : plan.a;
      const ob = bounds(other), along = side === 0 || side === 2 ? (ob.x0 + ob.x1) / 2 : (ob.y0 + ob.y1) / 2;
      const k = `${el.id}:${side}`;
      slots.set(k, [...(slots.get(k) ?? []), { plan, end, along }]);
    }
  }
  const tOf = new Map<string, number>(); // `${connector}:${end}` → position along the side
  for (const list of slots.values()) {
    list.sort((p, q) => p.along - q.along);
    list.forEach((s, i) => tOf.set(`${s.plan.c.id}:${s.end}`, (i + 1) / (list.length + 1)));
  }
  // pass 2: route again from the spread points
  const used2 = new Map<string, number>();
  const done = new Map<string, Partial<ConnectorElement>>();
  for (const plan of plans) {
    const A = sidePoint(plan.a, plan.sa, tOf.get(`${plan.c.id}:a`) ?? 0.5), B = sidePoint(plan.b, plan.sb, tOf.get(`${plan.c.id}:b`) ?? 0.5);
    const r = routeOrtho(A.end, B.end, obstacles, used2);
    if (!r) continue;
    markUsed(used2, r.pts, obstacles);
    done.set(plan.c.id, {
      routing: 'elbow',
      start: { ...plan.c.start, anchor: A.anchor },
      end: { ...plan.c.end, anchor: B.anchor },
      bends: r.pts.slice(1, -1),
    });
  }
  return {
    doc: { ...doc, elements: doc.elements.map((e) => (e.type === 'connector' && done.has(e.id) ? { ...e, ...done.get(e.id) } as ConnectorElement : e)) },
    routed: done.size,
  };
}
