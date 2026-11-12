import { describe, expect, it } from 'vitest';
import { connectorPath, roundCorners } from '../src/engine/connectors';
import { makeLookup } from '../src/engine/render';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { applySelectionStyleToDefaults, styleOf } from '../src/store/commands';
import { useDoc } from '../src/store/docStore';
import { useUI } from '../src/store/uiStore';
import { parseDocument, serializeDocument } from '../src/model/schema';
import type { ConnectorElement, FlowDocument } from '../src/model/types';

function twoBoxes(patch: Partial<ConnectorElement>) {
  const t = defaultToolStyle('shape:rectangle');
  const a = makeShape('rectangle', 0, 0, 100, 60, t), b = makeShape('rectangle', 300, 200, 100, 60, t);
  const c = { ...makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 0, y: 0, elementId: b.id }, defaultToolStyle('arrow')), ...patch };
  const doc: FlowDocument = { ...newDocument(), elements: [a, b, c] };
  return connectorPath(c, makeLookup(doc, null));
}
// furthest distance of the path from the straight line between its ends
const bulge = (pts: { x: number; y: number }[]) => {
  const a = pts[0], b = pts[pts.length - 1], L = Math.hypot(b.x - a.x, b.y - a.y);
  return Math.max(...pts.map((p) => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L));
};

describe('arrow routing', () => {
  it('new arrows are straight by default; curved arrows really curve', () => {
    expect(makeConnector({ x: 0, y: 0, elementId: null }, { x: 1, y: 0, elementId: null }, defaultToolStyle('arrow')).routing).toBe('straight');
    expect(bulge(twoBoxes({ routing: 'straight' }).pts)).toBeLessThan(0.01);
    expect(bulge(twoBoxes({ routing: 'curved', curvature: 0.3 }).pts)).toBeGreaterThan(20);
  });

  it('the arrow tool passes its remembered curve and corner radius to new arrows', () => {
    const c = makeConnector({ x: 0, y: 0, elementId: null }, { x: 1, y: 0, elementId: null }, { ...defaultToolStyle('arrow'), routing: 'curved', curvature: 0.5, elbowRadius: 12 });
    expect([c.routing, c.curvature, c.elbowRadius]).toEqual(['curved', 0.5, 12]);
  });

  it('elbow corners are sharp at radius 0 and rounded otherwise, within the segments', () => {
    const sharp = twoBoxes({ routing: 'elbow', elbowRadius: 0 });
    const round = twoBoxes({ routing: 'elbow', elbowRadius: 20 });
    // same ends, a slightly shorter route (corners cut), and no point is a right-angle corner any more
    expect(round.pts[0]).toEqual(sharp.pts[0]);
    expect(round.pts[round.pts.length - 1]).toEqual(sharp.pts[sharp.pts.length - 1]);
    expect(round.length).toBeLessThan(sharp.length);
    for (const corner of sharp.control.slice(1, -1)) {
      expect(sharp.pts.some((p) => Math.hypot(p.x - corner.x, p.y - corner.y) < 0.01)).toBe(true);
      expect(round.pts.some((p) => Math.hypot(p.x - corner.x, p.y - corner.y) < 2)).toBe(false);
    }
  });

  it('a big radius is limited by short segments', () => {
    const pts = roundCorners([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 10 }, { x: 200, y: 10 }], 50);
    for (const p of pts) expect(p.y).toBeGreaterThanOrEqual(-0.001);
    for (const p of pts) expect(p.y).toBeLessThanOrEqual(10.001);
    expect(pts.every((p) => p.x >= 0 && p.x <= 200)).toBe(true);
  });

  it('files from 0.1.14 and earlier: curved arrows with no curve become straight, real curves stay', () => {
    const conn = (id: string, extra: object) => ({ id, type: 'connector', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, routing: 'curved', ...extra });
    const { doc } = parseDocument({ format: 'flowsketch', schemaVersion: 5, elements: [conn('flat', { curvature: 0 }), conn('bent', { curvature: 0.4 }), conn('bends', { bends: [{ x: 50, y: 40 }] })] });
    const r = Object.fromEntries(doc.elements.map((e) => [e.id, (e as ConnectorElement).routing]));
    expect(r).toEqual({ flat: 'straight', bent: 'curved', bends: 'curved' });
    expect((doc.elements[0] as ConnectorElement).elbowRadius).toBe(0);
  });

  it('keeps the corner radius through save and load, clamped', () => {
    const c = { ...makeConnector({ x: 0, y: 0, elementId: null }, { x: 100, y: 50, elementId: null }, defaultToolStyle('arrow')), routing: 'elbow' as const, elbowRadius: 16 };
    const again = parseDocument(serializeDocument({ ...newDocument(), elements: [c] })).doc.elements[0] as ConnectorElement;
    expect(again.elbowRadius).toBe(16);
    const big = parseDocument({ format: 'flowsketch', schemaVersion: 6, elements: [{ ...c, elbowRadius: 1e9 }] }).doc.elements[0] as ConnectorElement;
    expect(big.elbowRadius).toBe(500);
  });

  describe('elbow arrows go round the shapes they connect', () => {
    const t = defaultToolStyle('shape:rectangle');
    const inside = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) => p.x > r.x + 1 && p.x < r.x + r.w - 1 && p.y > r.y + 1 && p.y < r.y + r.h - 1;
    function route(a: ReturnType<typeof makeShape>, b: ReturnType<typeof makeShape>, sa: { x: number; y: number } | null, sb: { x: number; y: number } | null) {
      const c = { ...makeConnector({ x: 0, y: 0, elementId: a.id, anchor: sa }, { x: 0, y: 0, elementId: b.id, anchor: sb }, defaultToolStyle('arrow')), routing: 'elbow' as const };
      return connectorPath(c, makeLookup({ ...newDocument(), elements: [a, b, c] }, null));
    }

    it('bottom of one shape to the bottom of another, lower right (the reported case): round underneath, never through', () => {
      const a = makeShape('rectangle', 0, 0, 400, 230, t), b = makeShape('roundRect', 550, 290, 320, 160, t);
      const p = route(a, b, { x: 0.5, y: 1 }, { x: 0.5, y: 1 });
      for (const q of p.pts) { expect(inside(q, a)).toBe(false); expect(inside(q, b)).toBe(false); }
      const n = p.control.length;
      expect(p.control[n - 1].y).toBeLessThan(p.control[n - 2].y); // comes up into the bottom side
    });

    it('any side to any side, shapes in any direction: no route passes through either shape', () => {
      const sides = [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }, null];
      const a = makeShape('rectangle', 0, 0, 160, 100, t);
      for (const [dx, dy] of [[300, 0], [300, 220], [0, 260], [-300, 220], [-300, -40], [40, -260], [220, 160]]) {
        const b = makeShape('rectangle', dx, dy, 140, 90, t);
        for (const sa of sides) for (const sb of sides) {
          const p = route(a, b, sa, sb);
          for (const q of p.pts) {
            expect(inside(q, a), JSON.stringify({ dx, dy, sa, sb })).toBe(false);
            expect(inside(q, b), JSON.stringify({ dx, dy, sa, sb })).toBe(false);
          }
        }
      }
    });

    it('two shapes side by side, facing ports: still the simple halfway route', () => {
      const a = makeShape('rectangle', 0, 0, 100, 60, t), b = makeShape('rectangle', 300, 200, 100, 60, t);
      const p = route(a, b, { x: 1, y: 0.5 }, { x: 0, y: 0.5 });
      expect(p.control).toHaveLength(4); // out, across at halfway, in
      expect(p.control[1].x).toBeCloseTo(200, 0);
    });
  });

  it('Set as default style keeps the arrow\'s routing, curve and corner radius', () => {
    const c = { ...makeConnector({ x: 0, y: 0, elementId: null }, { x: 100, y: 50, elementId: null }, defaultToolStyle('arrow')), routing: 'elbow' as const, elbowRadius: 18, curvature: 0.4 };
    expect(styleOf(c)).toMatchObject({ routing: 'elbow', elbowRadius: 18, curvature: 0.4 });
    useDoc.getState().replace((d) => ({ ...d, elements: [c] }));
    useUI.getState().select([c.id]);
    applySelectionStyleToDefaults();
    const next = makeConnector({ x: 0, y: 0, elementId: null }, { x: 10, y: 10, elementId: null }, useUI.getState().toolStyle('arrow'));
    expect([next.routing, next.elbowRadius, next.curvature]).toEqual(['elbow', 18, 0.4]);
  });
});
