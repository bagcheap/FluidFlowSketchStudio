import { beforeEach, describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { GAP, connectorPath, pairGap, pairPaths } from '../src/engine/connectors';
import { makeLookup, renderDocumentAtTime } from '../src/engine/render';
import { parseDocument, serializeDocument } from '../src/model/schema';
import { useDoc } from '../src/store/docStore';
import { useUI } from '../src/store/uiStore';
import { setConnectorPair, swapDirection } from '../src/store/commands';
import type { ConnectorElement, FlowDocument } from '../src/model/types';

// Browser (0..160 × 0..80) → API (400..560 × 0..80), request ⇄ response, straight
function pairDoc(): { doc: FlowDocument; c: ConnectorElement } {
  const doc = newDocument('pair');
  const a = makeShape('rectangle', 0, 0, 160, 80, defaultToolStyle('shape:rectangle'));
  const b = makeShape('rectangle', 400, 0, 160, 80, defaultToolStyle('shape:rectangle'));
  const c = makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 0, y: 0, elementId: b.id }, defaultToolStyle('pair'));
  c.text = 'GET /orders'; c.pair!.text = '200 OK';
  doc.elements = [a, b, c];
  doc.animation = { ...doc.animation, animateShapes: false };
  return { doc, c };
}

describe('request ⇄ response geometry', () => {
  it('draws two parallel arrows that start and end on the shape outlines', () => {
    const { doc, c } = pairDoc();
    const { req, res } = pairPaths(c, makeLookup(doc, null));
    const half = pairGap(c) / 2;
    // request runs left→right above the centre line (left of travel), response right→left below it
    expect(req.pts[0].x).toBeCloseTo(160 + GAP, 3);
    expect(req.pts[req.pts.length - 1].x).toBeCloseTo(400 - GAP, 3);
    expect(res.pts[0].x).toBeCloseTo(400 - GAP, 3);
    expect(res.pts[res.pts.length - 1].x).toBeCloseTo(160 + GAP, 3);
    for (const p of req.pts) expect(p.y).toBeCloseTo(40 - half, 3);
    for (const p of res.pts) expect(p.y).toBeCloseTo(40 + half, 3);
  });

  it('stays parallel along an elbow route', () => {
    const { doc, c } = pairDoc();
    const b = doc.elements[1];
    doc.elements[1] = { ...b, x: 400, y: 300 };
    const elbow = { ...c, routing: 'elbow' as const };
    const center = connectorPath(elbow, makeLookup(doc, null)).control;
    const { req } = pairPaths(elbow, makeLookup(doc, null));
    expect(req.control.length).toBe(center.length);
    // every segment stays horizontal or vertical
    for (let i = 1; i < req.control.length; i++) {
      const dx = Math.abs(req.control[i].x - req.control[i - 1].x), dy = Math.abs(req.control[i].y - req.control[i - 1].y);
      expect(Math.min(dx, dy)).toBeLessThan(1e-6);
    }
  });
});

describe('request ⇄ response animation', () => {
  const highlightYs = (doc: FlowDocument, id: string, t: number) => {
    const item = renderDocumentAtTime(doc, t).items.find((i) => i.id === id)!;
    return item.parts.filter((p) => p.k === 'line' && p.color === doc.animation.connector.highlightColor).map((p) => (p as { pts: number[] }).pts[1]);
  };

  it('ping-pongs: the request highlight travels first, then the response', () => {
    const { doc, c } = pairDoc();
    // speed 0.5 trips/s → one round trip every 4 s in the default 4 s loop
    expect(highlightYs(doc, c.id, 1).every((y) => y < 40)).toBe(true);
    expect(highlightYs(doc, c.id, 1).length).toBeGreaterThan(0);
    expect(highlightYs(doc, c.id, 3).every((y) => y > 40)).toBe(true);
    expect(highlightYs(doc, c.id, 3).length).toBeGreaterThan(0);
  });

  it('loops seamlessly and renders deterministically', () => {
    const { doc } = pairDoc();
    const L = doc.animation.duration;
    expect(JSON.stringify(renderDocumentAtTime(doc, 0).items)).toEqual(JSON.stringify(renderDocumentAtTime(doc, L).items));
    expect(JSON.stringify(renderDocumentAtTime(doc, 1.3))).toEqual(JSON.stringify(renderDocumentAtTime(structuredClone(doc), 1.3)));
  });

  it('renders both labels, outside their arrows', () => {
    const { doc, c } = pairDoc();
    const items = renderDocumentAtTime(doc, 0).items;
    const y = (id: string) => (items.find((i) => i.id === id)!.parts.find((p) => p.k === 'text') as { lines: { y: number }[] }).lines[0].y;
    expect(y(c.id + ':label')).toBeLessThan(40 - pairGap(c) / 2);
    expect(y(c.id + ':label2')).toBeGreaterThan(40 + pairGap(c) / 2);
  });
});

describe('request ⇄ response files', () => {
  it('round-trips through save and open, and sanitises the response settings', () => {
    const { doc, c } = pairDoc();
    const back = parseDocument(serializeDocument(doc)).doc.elements.find((e) => e.id === c.id) as ConnectorElement;
    expect(back.pair).toEqual({ text: '200 OK', strokeStyle: 'dashed' });
    const raw = JSON.parse(serializeDocument(doc));
    raw.elements[2].pair = { text: 42, strokeStyle: 'zigzag' };
    const bad = parseDocument(raw).doc.elements[2] as ConnectorElement;
    expect(bad.pair).toEqual({ text: '', strokeStyle: 'dashed' });
  });

  it('opens version 1 files (no pairs) unchanged', () => {
    const { doc } = pairDoc();
    const raw = JSON.parse(serializeDocument(doc));
    raw.schemaVersion = 1;
    delete raw.elements[2].pair;
    const parsed = parseDocument(raw).doc;
    expect((parsed.elements[2] as ConnectorElement).pair).toBeUndefined();
  });
});

describe('arrow commands', () => {
  const D = () => useDoc.getState();
  beforeEach(() => { const { doc } = pairDoc(); D().load(doc); });

  it('swap direction reverses the arrow and keeps the labels with their arrows', () => {
    const c = D().doc.elements[2] as ConnectorElement;
    swapDirection([c.id]);
    const s = D().doc.elements[2] as ConnectorElement;
    expect(s.start.elementId).toBe(c.end.elementId);
    expect(s.end.elementId).toBe(c.start.elementId);
    expect(s.text).toBe('GET /orders');
    expect(s.pair!.text).toBe('200 OK');
    expect(D().past.length).toBe(1);
  });

  it('switches between single and pair', () => {
    const c = D().doc.elements[2] as ConnectorElement;
    setConnectorPair([c.id], false);
    expect((D().doc.elements[2] as ConnectorElement).pair).toBeUndefined();
    useUI.getState().setToolStyle('pair', { ...defaultToolStyle('pair'), pair: { text: '', strokeStyle: 'dotted' } });
    setConnectorPair([c.id], true);
    expect((D().doc.elements[2] as ConnectorElement).pair).toEqual({ text: '', strokeStyle: 'dotted' });
  });
});
