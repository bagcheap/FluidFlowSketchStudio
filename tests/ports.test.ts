import { describe, expect, it } from 'vitest';
import { nearestPort, portAnchors, portPositions, PORTS } from '../src/editor/hitTest';
import { connectorPath } from '../src/engine/connectors';
import { makeLookup } from '../src/engine/render';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import type { FlowDocument } from '../src/model/types';

const shape = (kind: Parameters<typeof makeShape>[0]) => makeShape(kind, 100, 50, 200, 80, defaultToolStyle(`shape:${kind}`));

describe('snap points (ports)', () => {
  it('three on each side of a rectangle: a quarter, half and three quarters along', () => {
    const r = shape('rectangle');
    const ps = portPositions(r);
    expect(ps).toHaveLength(12);
    const top = ps.filter((p) => Math.abs(p.y - 50) < 0.01).map((p) => p.x).sort((a, b) => a - b);
    const right = ps.filter((p) => Math.abs(p.x - 300) < 0.01).map((p) => p.y).sort((a, b) => a - b);
    const bottom = ps.filter((p) => Math.abs(p.y - 130) < 0.01).map((p) => p.x).sort((a, b) => a - b);
    const left = ps.filter((p) => Math.abs(p.x - 100) < 0.01).map((p) => p.y).sort((a, b) => a - b);
    expect(top).toEqual([150, 200, 250]);
    expect(bottom).toEqual([150, 200, 250]);
    expect(right).toEqual([70, 90, 110]);
    expect(left).toEqual([70, 90, 110]);
    expect(portAnchors(r)).toEqual(PORTS.map((p) => ({ x: p.x, y: p.y })));
  });

  it('on a curved shape the ports sit on its outline, at the same quarter positions', () => {
    const e = shape('ellipse');
    for (const p of portPositions(e)) {
      const nx = (p.x - 200) / 100, ny = (p.y - 90) / 40; // centre (200, 90), radii 100 × 40
      expect(Math.abs(Math.hypot(nx, ny) - 1)).toBeLessThan(0.03);
    }
    const tops = portAnchors(e).slice(0, 3).map((a) => a.x); // the top side's three, in order
    expect(tops.map((x) => Math.round(x * 100) / 100)).toEqual([0.25, 0.5, 0.75]);
  });

  it('snapping picks the nearest port, not the first one in reach', () => {
    const ps = portPositions(shape('rectangle'));
    const i = nearestPort(ps, { x: 243, y: 52 }, 60);
    expect(ps[i!]).toEqual({ x: 250, y: 50 });
    expect(nearestPort(ps, { x: 0, y: 0 }, 14)).toBeNull();
  });

  it('an arrow attached to a quarter port starts there and leaves straight out of that side', () => {
    const a = shape('rectangle'), b = makeShape('rectangle', 100, 400, 200, 80, defaultToolStyle('shape:rectangle'));
    for (const routing of ['straight', 'elbow'] as const) {
      const c = { ...makeConnector({ x: 0, y: 0, elementId: a.id, anchor: { x: 0.25, y: 1 } }, { x: 0, y: 0, elementId: b.id, anchor: { x: 0.75, y: 0 } }, defaultToolStyle('arrow')), routing };
      const doc: FlowDocument = { ...newDocument(), elements: [a, b, c] };
      const path = connectorPath(c, makeLookup(doc, null));
      expect(path.control[0].x).toBeCloseTo(150); expect(path.control[0].y).toBeGreaterThan(130);
      const end = path.control[path.control.length - 1];
      expect(end.x).toBeCloseTo(250); expect(end.y).toBeLessThan(400);
      if (routing === 'elbow') expect(path.control[1].x).toBeCloseTo(150); // straight down first
    }
  });
});
