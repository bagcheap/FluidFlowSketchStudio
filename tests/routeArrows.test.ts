import { describe, expect, it } from 'vitest';
import { connectorPath } from '../src/engine/connectors';
import { geometryFor, pointInPolygon } from '../src/engine/shapes';
import { makeLookup } from '../src/engine/render';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { routeArrowsAround } from '../src/layout/routeArrows';
import { routeOrtho, simplifyRoute } from '../src/layout/orthoRoute';
import type { ConnectorElement, FlowDocument, ShapeElement } from '../src/model/types';

const box = (x: number, y: number, w = 120, h = 60, kind: ShapeElement['shape'] = 'rectangle') => makeShape(kind, x, y, w, h, defaultToolStyle(`shape:${kind}`));
const arrow = (a: ShapeElement, b: ShapeElement) => makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 0, y: 0, elementId: b.id }, { ...defaultToolStyle('arrow'), routing: 'elbow' });
const inside = (p: { x: number; y: number }, s: ShapeElement) => p.x > s.x + 0.5 && p.x < s.x + s.w - 0.5 && p.y > s.y + 0.5 && p.y < s.y + s.h - 0.5;

function check(doc: FlowDocument, shapes: ShapeElement[], ids: string[]) {
  const r = routeArrowsAround(doc, ids);
  expect(r.routed).toBe(ids.length); // every arrow found a way round
  const lookup = makeLookup(r.doc, null);
  for (const id of ids) {
    const c = r.doc.elements.find((e) => e.id === id) as ConnectorElement;
    const path = connectorPath(c, lookup);
    // the saved waypoints come back exactly: the elbow route is the routed one, corner for corner (the elbow router
    // may add a point in the middle of a straight run, which draws the same)
    expect(simplifyRoute(path.control).slice(1, -1)).toEqual(c.bends);
    for (const p of path.pts) for (const s of shapes) {
      // its own two shapes: never inside the real outline; any other shape: never inside its box
      const own = s.id === c.start.elementId || s.id === c.end.elementId;
      const hit = own ? pointInPolygon({ x: p.x - s.x, y: p.y - s.y }, geometryFor(s).poly) && inside(p, s) : inside(p, s);
      expect(hit, JSON.stringify({ id, p, s: [s.x, s.y], own })).toBe(false);
    }
    for (let i = 1; i < path.control.length; i++) { const a = path.control[i - 1], b = path.control[i]; expect(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01).toBe(true); }
  }
  return r;
}

describe('route arrows around shapes', () => {
  it('goes round a shape standing in the way instead of through it', () => {
    const a = box(0, 0), mid = box(250, -40, 120, 140), b = box(500, 0);
    const c = arrow(a, b);
    const r = check({ ...newDocument(), elements: [a, mid, b, c] }, [a, mid, b], [c.id]);
    expect(r.routed).toBe(1);
  });

  it('the reported case: bottom of one shape into the bottom of one below and to the right stays clear of both', () => {
    const a = box(0, 0, 400, 230), b = box(550, 290, 320, 160, 'roundRect');
    const c = { ...arrow(a, b), start: { x: 0, y: 0, elementId: a.id, anchor: { x: 0.5, y: 1 } }, end: { x: 0, y: 0, elementId: b.id, anchor: { x: 0.5, y: 1 } } };
    check({ ...newDocument(), elements: [a, b, c] }, [a, b], [c.id]);
  });

  it('a grid of shapes with arrows between many pairs: no route enters any shape; shared sides are spread out', () => {
    const shapes: ShapeElement[] = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) shapes.push(box(i * 260, j * 180, 120 + (i % 2) * 30, 60 + (j % 2) * 30, (['rectangle', 'ellipse', 'diamond', 'cylinder'] as const)[(i + j) % 4]));
    const pairs: [number, number][] = [[0, 11], [1, 10], [2, 9], [3, 8], [0, 5], [5, 7], [4, 6], [0, 1], [0, 2], [0, 9], [11, 3], [6, 0]];
    const cs = pairs.map(([i, j]) => arrow(shapes[i], shapes[j]));
    const r = check({ ...newDocument(), elements: [...shapes, ...cs] }, shapes, cs.map((c) => c.id));
    expect(r.routed).toBe(cs.length);
    // arrows leaving the same side of shape 0 start at different points
    const starts = r.doc.elements.filter((e): e is ConnectorElement => e.type === 'connector' && e.start.elementId === shapes[0].id).map((c) => JSON.stringify(c.start.anchor));
    expect(new Set(starts).size).toBe(starts.length);
  });

  it("leaves alone what it can't route: loose ends, locked arrows, an arrow from a shape to itself", () => {
    const a = box(0, 0), b = box(300, 0);
    const loose = makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 500, y: 300, elementId: null }, defaultToolStyle('arrow'));
    const locked = { ...arrow(a, b), locked: true };
    const self = arrow(a, a);
    const doc: FlowDocument = { ...newDocument(), elements: [a, b, loose, locked, self] };
    const r = routeArrowsAround(doc, [loose.id, locked.id, self.id]);
    expect(r.routed).toBe(0);
    expect(r.doc.elements).toEqual(doc.elements);
  });

  it('the router reports no route when the end is boxed in', () => {
    const wall = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
    const walls = [wall(180, -200, 200, 200), wall(180, -200, 600, -180), wall(180, 180, 600, 200), wall(580, -200, 600, 200)];
    expect(routeOrtho({ p: { x: 0, y: 0 }, dir: { x: 1, y: 0 } }, { p: { x: 400, y: 0 }, dir: { x: -1, y: 0 } }, walls)).toBeNull();
  });

  it('keepAnchors: an end on a snap point stays exactly there; the route goes round from it', () => {
    const a = box(0, 0), mid = box(250, -40, 120, 140), b = box(500, 0);
    const c = { ...arrow(a, b), end: { x: 0, y: 0, elementId: b.id, anchor: { x: 0.25, y: 1 } } }; // bottom-left quarter of b
    const r = routeArrowsAround({ ...newDocument(), elements: [a, mid, b, c] }, [c.id], { keepAnchors: true });
    const out = r.doc.elements.find((e) => e.id === c.id) as ConnectorElement;
    expect(out.end.anchor).toEqual({ x: 0.25, y: 1 });
    const path = connectorPath(out, makeLookup(r.doc, null));
    expect(simplifyRoute(path.control).slice(1, -1)).toEqual(out.bends);
    const last = path.control[path.control.length - 1];
    expect(last.x).toBeCloseTo(530); expect(last.y).toBeGreaterThan(60); // comes up into b's bottom, a quarter along
    for (const p of path.pts) expect(inside(p, mid)).toBe(false);
  });

  it('when a shape drifts a few px (floating animation), corners next to the ends stay single corners and keep their radius', () => {
    const a = box(0, 0, 300, 230), b = box(450, 0, 300, 230), c = box(1000, 40, 300, 230);
    const mk = (p: ShapeElement, q: ShapeElement, sa: { x: number; y: number }, sb: { x: number; y: number }) =>
      ({ ...makeConnector({ x: 0, y: 0, elementId: p.id, anchor: sa }, { x: 0, y: 0, elementId: q.id, anchor: sb }, { ...defaultToolStyle('arrow'), routing: 'elbow' as const, elbowRadius: 16 }) });
    const cs = [mk(a, c, { x: 0.5, y: 0 }, { x: 0.25, y: 0 }), mk(a, b, { x: 1, y: 0.25 }, { x: 0, y: 0.5 }), mk(c, b, { x: 0, y: 0.75 }, { x: 1, y: 0.9 })];
    const routed = routeArrowsAround({ ...newDocument(), elements: [a, b, c, ...cs] }, cs.map((x) => x.id), { keepAnchors: true }).doc;
    for (const [dx, dy] of [[3, 2], [-2, -3], [4, -4]]) {
      // the shapes drift; the arrows' waypoints stay where they were
      const drifted = { ...routed, elements: routed.elements.map((e) => (e.type === 'shape' ? { ...e, x: e.x + dx, y: e.y + dy } : e)) };
      for (const x of cs) {
        const before = connectorPath(routed.elements.find((e) => e.id === x.id) as ConnectorElement, makeLookup(routed, null)).control;
        const after = connectorPath(drifted.elements.find((e) => e.id === x.id) as ConnectorElement, makeLookup(drifted, null)).control;
        expect(after.length, JSON.stringify({ dx, dy, before, after })).toBe(before.length); // no extra little steps
        // every segment keeps (about) its length: the drift moves the end segments, it doesn't add a step
        const len = (p: { x: number; y: number }[], i: number) => Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
        for (let i = 1; i < after.length; i++) expect(Math.abs(len(after, i) - len(before, i)), JSON.stringify({ dx, dy, i, before, after })).toBeLessThanOrEqual(Math.abs(dx) + Math.abs(dy) + 0.01);
      }
    }
  });
});
