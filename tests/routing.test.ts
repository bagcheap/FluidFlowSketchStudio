import { describe, expect, it } from 'vitest';
import { connectorPath, roundCorners } from '../src/engine/connectors';
import { makeLookup, renderDocumentAtTime } from '../src/engine/render';
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
  it('the arrow tool draws elbow arrows by default (lines stay straight); curved arrows really curve', () => {
    expect(makeConnector({ x: 0, y: 0, elementId: null }, { x: 1, y: 0, elementId: null }, defaultToolStyle('arrow')).routing).toBe('elbow');
    expect(makeConnector({ x: 0, y: 0, elementId: null }, { x: 1, y: 0, elementId: null }, defaultToolStyle('line')).routing).toBe('straight');
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

  it('Set as default style keeps the arrow\'s routing, curve and corner radius', () => {
    const c = { ...makeConnector({ x: 0, y: 0, elementId: null }, { x: 100, y: 50, elementId: null }, defaultToolStyle('arrow')), routing: 'elbow' as const, elbowRadius: 18, curvature: 0.4 };
    expect(styleOf(c)).toMatchObject({ routing: 'elbow', elbowRadius: 18, curvature: 0.4 });
    useDoc.getState().replace((d) => ({ ...d, elements: [c] }));
    useUI.getState().select([c.id]);
    applySelectionStyleToDefaults();
    const next = makeConnector({ x: 0, y: 0, elementId: null }, { x: 10, y: 10, elementId: null }, useUI.getState().toolStyle('arrow'));
    expect([next.routing, next.elbowRadius, next.curvature]).toEqual(['elbow', 18, 0.4]);
  });

  describe('arrowhead size', () => {
    const headLen = (doc: FlowDocument, id: string) => {
      // the open arrowhead is the 3-point line ending at the tip: its arm length
      const item = renderDocumentAtTime({ ...doc, animation: { ...doc.animation, enabled: false } }, 0).items.find((i) => i.id === id)!;
      const head = item.parts.find((p) => p.k === 'line' && (p as { pts: number[] }).pts.length === 6) as { pts: number[] };
      return Math.hypot(head.pts[0] - head.pts[2], head.pts[1] - head.pts[3]);
    };
    const arrow = (headSize?: number) => ({ ...makeConnector({ x: 0, y: 0, elementId: null }, { x: 300, y: 0, elementId: null }, defaultToolStyle('arrow')), ...(headSize ? { headSize } : {}) });

    it('scales the arrowhead; unset is the usual size', () => {
      const a = arrow(), b = arrow(2), c = arrow(0.5);
      const doc: FlowDocument = { ...newDocument(), elements: [a, b, c] };
      expect(headLen(doc, b.id) / headLen(doc, a.id)).toBeCloseTo(2, 5);
      expect(headLen(doc, c.id) / headLen(doc, a.id)).toBeCloseTo(0.5, 5);
    });

    it('is saved, clamped on load, absent in older files, and carried by the arrow tool and Set as default style', () => {
      const a = arrow(1.6);
      const again = parseDocument(serializeDocument({ ...newDocument(), elements: [a] })).doc.elements[0] as ConnectorElement;
      expect(again.headSize).toBe(1.6);
      const raw = JSON.parse(serializeDocument({ ...newDocument(), elements: [a] }));
      raw.pages[0].elements[0].headSize = 99;
      expect((parseDocument(JSON.stringify(raw)).doc.elements[0] as ConnectorElement).headSize).toBe(3);
      raw.pages[0].elements[0].headSize = 'big';
      expect((parseDocument(JSON.stringify(raw)).doc.elements[0] as ConnectorElement).headSize).toBeUndefined();
      raw.schemaVersion = 10; delete raw.pages[0].elements[0].headSize;
      expect((parseDocument(JSON.stringify(raw)).doc.elements[0] as ConnectorElement).headSize).toBeUndefined();
      // the tool's remembered size goes on new arrows; Set as default style remembers it
      expect(makeConnector({ x: 0, y: 0, elementId: null }, { x: 1, y: 1, elementId: null }, { ...defaultToolStyle('arrow'), headSize: 2.2 }).headSize).toBe(2.2);
      expect(styleOf(a).headSize).toBe(1.6);
      useDoc.getState().replace((d) => ({ ...d, elements: [a] }));
      useUI.getState().select([a.id]);
      applySelectionStyleToDefaults();
      expect(makeConnector({ x: 0, y: 0, elementId: null }, { x: 1, y: 1, elementId: null }, useUI.getState().toolStyle('arrow')).headSize).toBe(1.6);
    });
  });
});
