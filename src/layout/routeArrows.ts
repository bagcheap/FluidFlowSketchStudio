// Route arrows around shapes (on request): each chosen arrow gets port anchors on the best pair of sides and bend
// points along an obstacle-free right-angled route (orthoRoute). Arrows sharing a side of a shape are spread along it.
// The result is ordinary elbow routing with waypoints: editable with the segment bars, undone by Reset route.
import type { BoxElement, ConnectorElement, FlowDocument, HeadKind, Point } from '../model/types';
import { connectorPath, GAP, LEAD, localOutline, toWorld } from '../engine/connectors';
import { makeLookup } from '../engine/render';
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

/** The route end at a saved anchor on the shape's outline (a snap point the user chose). */
function anchorPoint(el: BoxElement, anchor: Point): { anchor: Point; end: RouteEnd; side: Side } {
  const side = sideOfAnchor(anchor), dir = OUT[side];
  const w = toWorld(el, STILL, { x: anchor.x * el.w, y: anchor.y * el.h });
  return { anchor, side, end: { p: { x: w.x + dir.x * GAP, y: w.y + dir.y * GAP }, dir } };
}

interface Plan { c: ConnectorElement; a: BoxElement; b: BoxElement; sa: Side; sb: Side; pts: Point[] }

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
  const plans: Plan[] = [];
  const used = new Map<string, number>();
  // pass 1: the best pair of sides for each arrow, from the middle of each side
  for (const c of conns) {
    const a = c.start.elementId ? byId.get(c.start.elementId) : undefined, b = c.end.elementId ? byId.get(c.end.elementId) : undefined;
    if (!a || !b || a === b || !isObstacle(a) || !isObstacle(b) || a.rotation % 360 || b.rotation % 360) continue;
    let best: Plan | null = null, bestCost = Infinity;
    const ka = kept(c, 'start'), kb = kept(c, 'end');
    const sidesA: Side[] = ka ? [anchorPoint(a, ka).side] : [0, 1, 2, 3], sidesB: Side[] = kb ? [anchorPoint(b, kb).side] : [0, 1, 2, 3];
    for (const sa of sidesA) for (const sb of sidesB) {
      const r = routeOrtho(withStub(ka ? anchorPoint(a, ka).end : sidePoint(a, sa, 0.5).end, stubOf(c, c.startHead)), withStub(kb ? anchorPoint(b, kb).end : sidePoint(b, sb, 0.5).end, stubOf(c, c.endHead)), obstacles, used, borders);
      if (r && r.cost < bestCost) { bestCost = r.cost; best = { c, a, b, sa, sb, pts: r.pts }; }
    }
    if (best) { plans.push(best); markUsed(used, best.pts, obstacles); }
  }
  // spread arrows that share a side of a shape along it, in the order of where their other ends are
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
  for (const list of slots.values()) {
    list.sort((p, q) => p.along - q.along);
    list.forEach((s, i) => tOf.set(`${s.plan.c.id}:${s.end}`, (i + 1) / (list.length + 1)));
  }
  // pass 2: route again from the spread points
  const used2 = new Map<string, number>();
  const done = new Map<string, Partial<ConnectorElement>>();
  for (const plan of plans) {
    const ka = kept(plan.c, 'start'), kb = kept(plan.c, 'end');
    const A = ka ? anchorPoint(plan.a, ka) : sidePoint(plan.a, plan.sa, tOf.get(`${plan.c.id}:a`) ?? 0.5);
    const B = kb ? anchorPoint(plan.b, kb) : sidePoint(plan.b, plan.sb, tOf.get(`${plan.c.id}:b`) ?? 0.5);
    const r = routeOrtho(withStub(A.end, stubOf(plan.c, plan.c.startHead)), withStub(B.end, stubOf(plan.c, plan.c.endHead)), obstacles, used2, borders);
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
