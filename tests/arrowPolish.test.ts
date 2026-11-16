import { describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { connectorPath, LEAD } from '../src/engine/connectors';
import { makeLookup } from '../src/engine/render';
import { routeOrtho } from '../src/layout/orthoRoute';
import { routeArrowsAround, spreadEnds } from '../src/layout/routeArrows';
import { SAMPLES } from '../src/templates/samples';
import type { ConnectorElement, FlowDocument, Point, ShapeElement } from '../src/model/types';

const box = (x: number, y: number, w = 120, h = 60) => makeShape('rectangle', x, y, w, h, defaultToolStyle('shape:rectangle'));
const arrow = (a: ShapeElement, b: ShapeElement, anchors: [Point | null, Point | null] = [null, null]) => {
  const c = makeConnector({ x: 0, y: 0, elementId: a.id, anchor: anchors[0] }, { x: 0, y: 0, elementId: b.id, anchor: anchors[1] }, { ...defaultToolStyle('arrow'), routing: 'elbow' });
  c.elbowRadius = 12;
  return c;
};
const docOf = (...els: FlowDocument['elements']) => { const d = newDocument(); d.elements = els; return d; };
const segLen = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const ends = (d: FlowDocument, id: string) => {
  const c = d.elements.find((e) => e.id === id) as ConnectorElement;
  const ctl = connectorPath(c, makeLookup(d, null)).control;
  return { first: segLen(ctl[0], ctl[1]), last: segLen(ctl[ctl.length - 2], ctl[ctl.length - 1]), ctl };
};
const headRoom = LEAD + (9 + 3 * 2); // the lead before an arrowhead with the default 2 px line

describe('New diagrams', () => {
  it('start with still shapes; arrows still animate; the samples keep their motion', () => {
    const d = newDocument();
    expect(d.animation.shape.mode).toBe('off');
    expect(d.animation.animateConnectors).toBe(true);
    expect(SAMPLES.every((x) => x.build().animation.shape.mode !== 'off')).toBe(true);
  });
});

describe('Elbow arrows run straight into a shape before turning', () => {
  it('an L-shaped arrow that would turn right at its head goes over and comes straight down instead', () => {
    // start's right side at y = 130; target's top at y = 120: the old route turned 10 px before the head
    const a = box(0, 100), b = box(300, 120);
    const c = arrow(a, b, [{ x: 1, y: 0.5 }, { x: 0.5, y: 0 }]);
    const d = docOf(a, b, c);
    const { first, last } = ends(d, c.id);
    expect(last).toBeGreaterThanOrEqual(headRoom - 0.5);
    expect(first).toBeGreaterThanOrEqual(LEAD - 0.5);
  });

  it('shapes facing each other stay a straight line, even close together', () => {
    const a = box(0, 100), b = box(150, 100); // 30 px apart
    const c = arrow(a, b, [{ x: 1, y: 0.5 }, { x: 0, y: 0.5 }]);
    expect(ends(docOf(a, b, c), c.id).ctl.length).toBe(2);
  });

  it('far apart, offset shapes keep the usual Z route through the middle', () => {
    const a = box(0, 0), b = box(400, 200);
    const c = arrow(a, b, [{ x: 1, y: 0.5 }, { x: 0, y: 0.5 }]);
    const { ctl } = ends(docOf(a, b, c), c.id);
    expect(ctl.length).toBe(4);
    expect(ctl[1].x).toBeCloseTo((ctl[0].x + ctl[3].x) / 2, 0);
  });

  it('rounding never eats into the straight part before the head', () => {
    const a = box(0, 100), b = box(300, 120);
    const c = arrow(a, b, [{ x: 1, y: 0.5 }, { x: 0.5, y: 0 }]);
    c.elbowRadius = 60;
    const d = docOf(a, b, c);
    const p = connectorPath(c, makeLookup(d, null)).pts;
    const end = p[p.length - 1];
    // the last (9 + 3·2) + 4 px before the end are a straight vertical run
    const straight = p.filter((q) => Math.hypot(q.x - end.x, q.y - end.y) < 19);
    expect(straight.every((q) => Math.abs(q.x - end.x) < 0.01)).toBe(true);
  });
});

describe('Routing around shapes', () => {
  it('routed arrows run straight out of and into their shapes for the lead', () => {
    const a = box(0, 0), b = box(400, 160);
    const c = arrow(a, b);
    const r = routeArrowsAround(docOf(a, b, c), [c.id]).doc;
    const { first, last } = ends(r, c.id);
    expect(first).toBeGreaterThanOrEqual(LEAD - 0.5);
    expect(last).toBeGreaterThanOrEqual(headRoom - 0.5);
  });

  it('keeps off a container border when there is room either side', () => {
    // the route's crossing runs at y = 120 or y = 280 (just out of either end); a container's borders lie along both
    const border = { x0: 0, y0: 118, x1: 600, y1: 282 };
    const s = { p: { x: 50, y: 100 }, dir: { x: 0, y: 1 } }, e = { p: { x: 550, y: 300 }, dir: { x: 0, y: -1 } };
    const plain = routeOrtho(s, e, [])!.pts, avoid = routeOrtho(s, e, [], undefined, [border])!.pts;
    const onBorder = (pts: Point[]) => pts.some((p, i) => i > 0 && Math.abs(p.y - pts[i - 1].y) < 0.01 && Math.abs(p.x - pts[i - 1].x) > 20 && (Math.abs(p.y - 118) <= 8 || Math.abs(p.y - 282) <= 8));
    expect(onBorder(plain)).toBe(true);
    expect(onBorder(avoid)).toBe(false);
  });

  it('re-routing after a move keeps the points the arrows were attached to', () => {
    const a = box(0, 0), b = box(400, 160);
    const c = arrow(a, b, [{ x: 0.75, y: 1 }, { x: 0, y: 0.25 }]);
    c.bends = [{ x: 90, y: 200 }];
    const moved = { ...b, x: 500, y: 300 };
    const r = routeArrowsAround(docOf(a, moved, c), [c.id], { keepAnchors: true }).doc;
    const rc = r.elements.find((e) => e.id === c.id) as ConnectorElement;
    expect(rc.start.anchor).toEqual({ x: 0.75, y: 1 });
    expect(rc.end.anchor).toEqual({ x: 0, y: 0.25 });
  });
});

describe('Several arrows into one shape', () => {
  it('are spread along the side they share, in the order of their other ends; own snap points stay', () => {
    const t = box(300, 300, 240, 60);
    const s1 = box(100, 0), s2 = box(300, 0), s3 = box(500, 0);
    const c1 = arrow(s1, t), c2 = arrow(s2, t), c3 = arrow(s3, t);
    const d = spreadEnds(docOf(t, s1, s2, s3, c1, c2, c3), [t.id]);
    const xs = [c1, c2, c3].map((c) => (d.elements.find((e) => e.id === c.id) as ConnectorElement).end.anchor!);
    expect(xs.every((a) => Math.abs(a.y) < 0.01)).toBe(true); // all on the top side
    expect(xs[0].x).toBeLessThan(xs[1].x); expect(xs[1].x).toBeLessThan(xs[2].x);
    expect(new Set(xs.map((a) => a.x.toFixed(2))).size).toBe(3);
    // one arrow alone on a side is left as it is
    const solo = arrow(s1, t), alone = docOf(t, s1, solo);
    expect(spreadEnds(alone, [t.id])).toBe(alone);
  });
});
