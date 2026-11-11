import { describe, expect, it } from 'vitest';
import { connectorPath, labelPlacement, pointAt } from '../src/engine/connectors';
import { connectorLabelSize, makeLookup, renderDocumentAtTime } from '../src/engine/render';
import { parseDocument, serializeDocument } from '../src/model/schema';
import { connectorLabelBox } from '../src/editor/hitTest';
import { defaultToolStyle, makeConnector, newDocument } from '../src/model/defaults';
import type { FlowDocument, Point } from '../src/model/types';

const free = (p: Point) => ({ x: p.x, y: p.y, elementId: null, anchor: null });
function arrow(a: Point, b: Point, bends: Point[] = []) {
  const c = { ...makeConnector(free(a), free(b), defaultToolStyle('arrow')), text: 'label', bends };
  const doc: FlowDocument = { ...newDocument(), elements: [c] };
  return { c, doc, path: connectorPath(c, makeLookup(doc, null)) };
}
const centre = (doc: FlowDocument, c: Parameters<typeof connectorLabelBox>[1]) => { const b = connectorLabelBox(doc, c)!; return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; };

describe('dragging arrow labels', () => {
  it('a point beside a straight arrow gives the fraction along it and the sideways distance', () => {
    const { path } = arrow({ x: 0, y: 0 }, { x: 200, y: 0 });
    const r = labelPlacement(path, { x: 50, y: 30 });
    expect(r.labelPos).toBeCloseTo(0.25);
    expect(Math.abs(r.labelOffset)).toBeCloseTo(30);
  });

  it('the label is drawn exactly where it was dropped (both sides, bent arrows)', () => {
    for (const bends of [[], [{ x: 100, y: 120 }]]) {
      const { c, doc, path } = arrow({ x: 0, y: 0 }, { x: 200, y: 40 }, bends);
      for (const want of [{ x: 60, y: -25 }, { x: 140, y: 90 }]) {
        const placed = { ...c, ...labelPlacement(path, want) };
        const got = centre({ ...doc, elements: [placed] }, placed);
        expect(got.x).toBeCloseTo(want.x, 4);
        expect(got.y).toBeCloseTo(want.y, 4);
      }
    }
  });

  it('a point on the line gives offset 0; the offset stays within the file limits', () => {
    const { path } = arrow({ x: 0, y: 0 }, { x: 100, y: 100 });
    const on = pointAt(path, path.length * 0.6).pt;
    expect(labelPlacement(path, on).labelOffset).toBeCloseTo(0);
    expect(labelPlacement(path, on).labelPos).toBeCloseTo(0.6);
    expect(Math.abs(labelPlacement(path, { x: 5000, y: -5000 }).labelOffset)).toBeLessThanOrEqual(500);
  });

  it('a label width wraps the text: the width stays, the height follows the text', () => {
    const { c } = arrow({ x: 0, y: 0 }, { x: 400, y: 0 });
    const long = { ...c, text: 'POST /chat with the prompt and the session id in the body' };
    const auto = connectorLabelSize(long);
    const sized = connectorLabelSize({ ...long, labelWidth: 120 });
    expect(sized.w).toBe(120);
    expect(sized.h).toBeGreaterThan(auto.h * 2);
    expect(connectorLabelSize({ ...long, labelWidth: 5 }).w).toBe(40); // never narrower than the minimum
    // drawn as several lines, inside the box
    const doc: FlowDocument = { ...newDocument(), elements: [{ ...long, labelWidth: 120 }] };
    const text = renderDocumentAtTime(doc, 0).items.find((i) => i.id === c.id + ':label')!.parts.find((p) => p.k === 'text') as { lines: unknown[] };
    expect(text.lines.length).toBeGreaterThan(2);
    expect(connectorLabelBox(doc, doc.elements[0] as typeof c)!.w).toBe(120);
  });

  it('label width is saved, checked on load, and absent in older files', () => {
    const { c } = arrow({ x: 0, y: 0 }, { x: 400, y: 0 });
    const doc: FlowDocument = { ...newDocument(), elements: [{ ...c, labelWidth: 150 }] };
    const again = parseDocument(serializeDocument(doc)).doc.elements[0] as typeof c;
    expect(again.labelWidth).toBe(150);
    const raw = JSON.parse(serializeDocument(doc));
    raw.pages[0].elements[0].labelWidth = 1e9;
    expect((parseDocument(JSON.stringify(raw)).doc.elements[0] as typeof c).labelWidth).toBe(2000);
    raw.pages[0].elements[0].labelWidth = 'wide';
    expect((parseDocument(JSON.stringify(raw)).doc.elements[0] as typeof c).labelWidth).toBeUndefined();
    raw.schemaVersion = 9; delete raw.pages[0].elements[0].labelWidth;
    expect((parseDocument(JSON.stringify(raw)).doc.elements[0] as typeof c).labelWidth).toBeUndefined();
  });
});
