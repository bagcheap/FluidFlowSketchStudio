import { describe, expect, it } from 'vitest';
import { connectorPath, isHorizontal, moveElbowSegment, tidyElbow } from '../src/engine/connectors';
import { makeLookup } from '../src/engine/render';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import type { ConnectorElement, FlowDocument, Point } from '../src/model/types';

const t = defaultToolStyle('shape:rectangle');
function setup(a: { x: number; y: number }, b: { x: number; y: number }, sa: Point | null, sb: Point | null) {
  const A = makeShape('rectangle', a.x, a.y, 120, 60, t), B = makeShape('rectangle', b.x, b.y, 120, 60, t);
  const c: ConnectorElement = { ...makeConnector({ x: 0, y: 0, elementId: A.id, anchor: sa }, { x: 0, y: 0, elementId: B.id, anchor: sb }, defaultToolStyle('arrow')), routing: 'elbow' };
  const doc: FlowDocument = { ...newDocument(), elements: [A, B, c] };
  const route = (bends: Point[]) => connectorPath({ ...c, bends }, makeLookup(doc, null)).control;
  return { route };
}
const axisAligned = (pts: Point[]) => pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) < 0.01 || Math.abs(p.y - pts[i - 1].y) < 0.01);
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 0.01;

describe('elbow waypoints: dragging a segment', () => {
  it('the middle segment of a Z route slides sideways; the arrow keeps its right angles and ends', () => {
    const { route } = setup({ x: 0, y: 0 }, { x: 400, y: 200 }, { x: 1, y: 0.5 }, { x: 0, y: 0.5 });
    const before = route([]);
    expect(before).toHaveLength(4); // out, down, in
    const k = 1; // the vertical middle segment
    expect(isHorizontal(before[1], before[2])).toBe(false);
    const after = route(moveElbowSegment(before, k, 300));
    expect(axisAligned(after)).toBe(true);
    expect(near(after[0], before[0]) && near(after[after.length - 1], before[before.length - 1])).toBe(true);
    expect(after[1].x).toBeCloseTo(300); expect(after[2].x).toBeCloseTo(300);
  });

  it('an end segment gets a short jog next to its shape, so an L route can be steered too', () => {
    const { route } = setup({ x: 0, y: 0 }, { x: 400, y: 200 }, { x: 1, y: 0.5 }, { x: 0.5, y: 0 });
    const before = route([]);
    expect(before).toHaveLength(3); // right, then down into the top
    const after = route(moveElbowSegment(before, 0, 120)); // the first (horizontal) segment moves down to y = 120
    expect(axisAligned(after)).toBe(true);
    expect(near(after[0], before[0]) && near(after[after.length - 1], before[before.length - 1])).toBe(true);
    expect(after.some((p) => Math.abs(p.y - 120) < 0.01)).toBe(true);
    expect(after[1].y).toBeCloseTo(before[0].y); // leaves the shape the same way before the jog
  });

  it('every segment of several routes can be dragged without breaking the route', () => {
    const cases: [{ x: number; y: number }, Point | null, Point | null][] = [
      [{ x: 400, y: 200 }, { x: 1, y: 0.5 }, { x: 0, y: 0.5 }],
      [{ x: 400, y: 200 }, { x: 0.5, y: 1 }, { x: 0.5, y: 0 }],
      [{ x: 400, y: 0 }, { x: 1, y: 0.5 }, { x: 0, y: 0.5 }],
      [{ x: 300, y: 250 }, { x: 1, y: 0.5 }, { x: 0.5, y: 0 }],
      [{ x: 300, y: 250 }, null, null],
    ];
    for (const [b, sa, sb] of cases) {
      const { route } = setup({ x: 0, y: 0 }, b, sa, sb);
      const before = route([]);
      for (let k = 0; k < before.length - 1; k++) {
        const horiz = isHorizontal(before[k], before[k + 1]);
        const c = (horiz ? before[k].y : before[k].x) + 37;
        const after = route(moveElbowSegment(before, k, c));
        expect(axisAligned(after), JSON.stringify({ b, sa, sb, k })).toBe(true);
        expect(near(after[0], before[0]) && near(after[after.length - 1], before[before.length - 1]), JSON.stringify({ b, k })).toBe(true);
        // the moved segment is at its new place, and dragging again from the new route still works
        expect(after.some((p, i) => i > 0 && (horiz ? Math.abs(p.y - c) < 0.01 && Math.abs(after[i - 1].y - c) < 0.01 : Math.abs(p.x - c) < 0.01 && Math.abs(after[i - 1].x - c) < 0.01))).toBe(true);
        const again = route(moveElbowSegment(after, 1, (isHorizontal(after[1], after[2]) ? after[1].y : after[1].x) - 15));
        expect(axisAligned(again)).toBe(true);
      }
    }
  });

  it('tidying drops repeated points and points in the middle of a straight run, keeping the route', () => {
    const s = { x: 0, y: 0 }, e = { x: 100, y: 100 };
    expect(tidyElbow(s, [{ x: 50, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 50, y: 100 }], e)).toEqual([{ x: 50, y: 0 }, { x: 50, y: 100 }]);
    const { route } = setup({ x: 0, y: 0 }, { x: 400, y: 200 }, { x: 1, y: 0.5 }, { x: 0, y: 0.5 });
    const before = route([]);
    const moved = moveElbowSegment(before, 1, 300);
    const tidy = tidyElbow(before[0], moved, before[before.length - 1]);
    expect(route(tidy)).toEqual(route(moved));
  });
});
