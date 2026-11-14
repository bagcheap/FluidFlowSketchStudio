import { describe, expect, it } from 'vitest';
import { connectorPath } from '../src/engine/connectors';
import { crossings, hop, jumpRadius } from '../src/engine/jumps';
import { lineJumps, makeLookup, renderDocumentAtTime } from '../src/engine/render';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { parseDocument, serializeDocument } from '../src/model/schema';
import type { ConnectorElement, FlowDocument, Point } from '../src/model/types';

const free = (a: Point, b: Point) => makeConnector({ ...a, elementId: null }, { ...b, elementId: null }, { ...defaultToolStyle('arrow'), routing: 'straight' as const });
const docWith = (els: ConnectorElement[], jumps = true): FlowDocument => {
  const d = newDocument();
  return { ...d, canvas: { ...d.canvas, lineJumps: jumps }, animation: { ...d.animation, enabled: false }, elements: els };
};
/** The points of an arrow's main line in a still frame. */
const linePts = (doc: FlowDocument, id: string): Point[] => {
  const part = renderDocumentAtTime(doc, 0).items.find((i) => i.id === id)!.parts.find((p) => p.k === 'line') as { pts: number[] };
  const out: Point[] = [];
  for (let i = 0; i < part.pts.length; i += 2) out.push({ x: part.pts[i], y: part.pts[i + 1] });
  return out;
};

describe('line jumps', () => {
  it('the arrow on top hops over the one below where they cross; the one below stays straight', () => {
    const below = free({ x: 0, y: 100 }, { x: 0, y: -100 }); // vertical
    const above = free({ x: -150, y: 0 }, { x: 150, y: 0 }); // horizontal, later = on top
    const doc = { ...docWith([below, above]), elements: [below, above].map((c) => ({ ...c, style: { ...c.style, roughness: 0 } })) } as FlowDocument;
    const r = jumpRadius(above.style.strokeWidth);
    const top = linePts(doc, above.id);
    const peak = Math.min(...top.filter((p) => Math.abs(p.x) < 2).map((p) => p.y));
    expect(peak).toBeLessThan(-r * 0.9); // up and over at x = 0
    expect(Math.min(...top.filter((p) => Math.abs(p.x) > r + 2).map((p) => p.y))).toBeGreaterThan(-0.5); // flat elsewhere
    expect(Math.max(...linePts(doc, below.id).map((p) => Math.abs(p.x)))).toBeLessThan(0.5); // the lower one doesn't hop
    // switched off: no hop
    expect(Math.min(...linePts({ ...doc, canvas: { ...doc.canvas, lineJumps: false } }, above.id).map((p) => p.y))).toBeGreaterThan(-0.5);
  });

  it('hops bulge up (or left on a vertical line) whichever way the arrow points', () => {
    const v = free({ x: 0, y: -100 }, { x: 0, y: 100 });
    for (const [a, b] of [[{ x: -150, y: 0 }, { x: 150, y: 0 }], [{ x: 150, y: 0 }, { x: -150, y: 0 }]] as [Point, Point][]) {
      const doc = docWith([v, free(a, b)]);
      const j = lineJumps(doc, makeLookup(doc, null)).get(doc.elements[1].id)!;
      expect(Math.min(...j.pts.map((p) => p.y))).toBeLessThan(-5);
      expect(Math.max(...j.pts.map((p) => p.y))).toBeLessThan(0.01);
    }
    for (const [a, b] of [[{ x: 0, y: -100 }, { x: 0, y: 100 }], [{ x: 0, y: 100 }, { x: 0, y: -100 }]] as [Point, Point][]) {
      const h = free({ x: -150, y: 0 }, { x: 150, y: 0 });
      const doc = docWith([h, free(a, b)]);
      const j = lineJumps(doc, makeLookup(doc, null)).get(doc.elements[1].id)!;
      expect(Math.min(...j.pts.map((p) => p.x))).toBeLessThan(-5);
      expect(Math.max(...j.pts.map((p) => p.x))).toBeLessThan(0.01);
    }
  });

  it('crossings close together make one wider hop; none near the ends (the arrowhead) or where lines only touch', () => {
    const a = free({ x: -200, y: 0 }, { x: 200, y: 0 });
    const look = makeLookup(docWith([a]), null);
    const pa = connectorPath(a, look);
    const v1 = connectorPath(free({ x: -4, y: -50 }, { x: -4, y: 50 }), look), v2 = connectorPath(free({ x: 6, y: -50 }, { x: 6, y: 50 }), look);
    const ss = [...crossings(pa, v1), ...crossings(pa, v2)].sort((x, y) => x - y);
    expect(ss.length).toBe(2);
    const h = hop(pa, ss, 10, 20);
    const off = h.pts.filter((p) => p.y < -0.5); // the raised part: one arc from before the first to after the second
    expect(Math.min(...off.map((p) => p.x))).toBeLessThan(-12);
    expect(Math.max(...off.map((p) => p.x))).toBeGreaterThan(14);
    expect(off.every((p, i) => i === 0 || p.x > off[i - 1].x)).toBe(true); // one continuous arc, not two
    expect(Math.min(...off.map((p) => p.y))).toBeGreaterThan(-10.01); // no taller than one hop
    // a crossing 15 px from the end is too near the arrowhead
    expect(hop(pa, [pa.length - 15], 10, 30)).toBe(pa);
    // touching at an end isn't crossing
    expect(crossings(pa, connectorPath(free({ x: 200, y: 0 }, { x: 200, y: 80 }), look))).toEqual([]);
  });

  it("lifelines, activation bars and loops to the same shape don't take part", () => {
    const box = makeShape('rectangle', -60, -200, 120, 50, defaultToolStyle('shape:rectangle'));
    const lifeline = makeConnector({ x: 0, y: 0, elementId: box.id, anchor: { x: 0.5, y: 1 } }, { x: 0, y: 0, elementId: box.id, anchor: { x: 0.5, y: 8 } }, defaultToolStyle('line'));
    const msg = free({ x: -150, y: 0 }, { x: 150, y: 0 });
    const doc = { ...docWith([]), elements: [box, lifeline, msg] } as FlowDocument;
    expect(lineJumps(doc, makeLookup(doc, null)).size).toBe(0);
  });

  it('new diagrams have them on; older files keep their look (off); the switch is saved', () => {
    expect(newDocument().canvas.lineJumps).toBe(true);
    const old = JSON.parse(serializeDocument(newDocument()));
    old.schemaVersion = 14; delete old.canvas.lineJumps;
    expect(parseDocument(JSON.stringify(old)).doc.canvas.lineJumps).toBe(false);
    old.canvas.lineJumps = 'yes';
    expect(parseDocument(JSON.stringify(old)).doc.canvas.lineJumps).toBe(false);
    expect(parseDocument(serializeDocument(newDocument())).doc.canvas.lineJumps).toBe(true);
  });
});
