import { describe, expect, it } from 'vitest';
import { compartmentLayout, renderDocumentAtTime } from '../src/engine/render';
import { COMPARTMENTS, LABEL_BELOW, SHAPE_GROUPS, SHAPE_LABELS, shapeGeometry } from '../src/engine/shapes';
import { defaultToolStyle, makeConnector, makeShape, newDocument, SHAPE_DEFAULT_SIZE } from '../src/model/defaults';
import { BASIC_SHAPES, HEAD_KINDS, parseDocument, serializeDocument, SHAPE_KINDS } from '../src/model/schema';
import { fitShapeToText } from '../src/store/commands';
import { toMermaid } from '../src/export/mermaidExport';
import type { ConnectorElement, FlowDocument, ShapeElement, ShapeKind } from '../src/model/types';

const NEW: ShapeKind[] = ['umlClass', 'umlActor', 'umlPackage', 'umlComponent', 'note', 'erEntity', 'bpmnStart', 'bpmnEnd', 'bpmnIntermediate', 'bpmnGateway', 'bpmnParallel', 'bpmnData'];
const shape = (k: ShapeKind, text?: string): ShapeElement => {
  const [w, h] = SHAPE_DEFAULT_SIZE[k] ?? [140, 80];
  const s = makeShape(k, 0, 0, w, h, defaultToolStyle(`shape:${k}`));
  return text === undefined ? s : { ...s, text };
};

describe('notation shapes', () => {
  it('every new shape has an outline, a label place, a name and a group; the basic list is unchanged', () => {
    for (const k of NEW) {
      expect(SHAPE_KINDS).toContain(k);
      const g = shapeGeometry(k, 120, 80, 0);
      expect(g.d.length, k).toBeGreaterThan(10);
      expect(g.poly.length, k).toBeGreaterThanOrEqual(4);
      expect(SHAPE_LABELS[k], k).toBeTruthy();
      expect(SHAPE_GROUPS.some((grp) => grp.kinds.includes(k)), k).toBe(true);
    }
    expect(BASIC_SHAPES).not.toContain('umlClass');
    expect(BASIC_SHAPES.length).toBe(16);
    // an actor can be clicked and joined anywhere in its box; its name sits underneath
    expect(shapeGeometry('umlActor', 48, 90, 0).poly).toEqual([{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 90 }, { x: 0, y: 90 }]);
    for (const k of LABEL_BELOW) expect(shapeGeometry(k, 50, 50, 0).textBox.y, k).toBeGreaterThan(50);
    // the markers: an exclusive gateway's X and an end event's thick ring are drawn as details
    expect(shapeGeometry('bpmnGateway', 60, 60, 0).details.length).toBe(1);
    expect(shapeGeometry('bpmnEnd', 44, 44, 0).details.length).toBe(1);
    expect(shapeGeometry('bpmnStart', 44, 44, 0).details.length).toBe(0);
  });

  it('a UML class or ER entity starts with sections; its text splits at "--" lines into compartments', () => {
    expect(shape('umlClass').text).toBe('ClassName\n--\n+ attribute: Type\n--\n+ operation(): Type');
    expect(shape('erEntity').text.startsWith('Entity\n--\n')).toBe(true);
    const c = { ...shape('umlClass'), h: 400 };
    const cs = compartmentLayout(c);
    expect(cs.map((x) => x.text)).toEqual(['ClassName', '+ attribute: Type', '+ operation(): Type']);
    expect(cs[0].title).toBe(true);
    expect(cs[1].y).toBeCloseTo(cs[0].h); expect(cs[2].y).toBeCloseTo(cs[1].y + cs[1].h);
    expect(cs[2].y + cs[2].h).toBeCloseTo(400); // the last one takes the rest
    // drawn: two dividers, the name bold and centred, the rest left-aligned
    const items = renderDocumentAtTime({ ...newDocument(), elements: [c], animation: { ...newDocument().animation, enabled: false } }, 0).items;
    const label = items.find((i) => i.id === c.id + ':label')!;
    const texts = label.parts.filter((p) => p.k === 'text') as { font: string; align: string; lines: { t: string }[] }[];
    expect(texts.map((t) => t.lines[0].t)).toEqual(['ClassName', '+ attribute: Type', '+ operation(): Type']);
    expect(texts[0].font).toMatch(/bold|700/); expect(texts[0].align).toBe('center'); expect(texts[1].align).toBe('left');
    const body = items.find((i) => i.id === c.id)!;
    expect(body.parts.filter((p) => p.k === 'sets').length).toBe(3); // outline + two dividers
  });

  it('compartment shapes grow to fit their sections; labels underneath never make a shape grow', () => {
    const tall = fitShapeToText({ ...shape('erEntity'), text: 'Order\n--\nPK id\nFK customer\ntotal\ncreated\nstatus\nnotes' }) as ShapeElement;
    expect(tall.h).toBeGreaterThan(120);
    const need = compartmentLayout({ ...tall, h: 0 }).reduce((t, c) => t + c.h, 0);
    expect(tall.h).toBeGreaterThanOrEqual(Math.floor(need));
    const wide = fitShapeToText({ ...shape('umlClass'), text: 'C\n--\n+ aVeryLongAttributeNameIndeed: SomeLongType' }) as ShapeElement;
    expect(wide.w).toBeGreaterThan(200);
    const ev = { ...shape('bpmnStart'), text: 'A start event with a long name that would not fit' };
    expect(fitShapeToText(ev)).toBe(ev);
    expect(COMPARTMENTS.has('umlClass') && COMPARTMENTS.has('erEntity')).toBe(true);
  });
});

describe("crow's-foot arrowheads", () => {
  const a = shape('erEntity'), b = { ...shape('erEntity'), x: 400 };
  const linesAtEnd = (head: ConnectorElement['endHead']) => {
    const c: ConnectorElement = { ...makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 0, y: 0, elementId: b.id }, { ...defaultToolStyle('line'), routing: 'straight' }), endHead: head, startHead: 'none' };
    const doc: FlowDocument = { ...newDocument(), elements: [a, b, c], animation: { ...newDocument().animation, enabled: false } };
    const parts = renderDocumentAtTime(doc, 0).items.find((i) => i.id === c.id)!.parts.filter((p) => p.k === 'line') as { closed?: boolean; fill?: string }[];
    return parts.slice(1); // after the line itself
  };
  it('draw the right marks: feet, bars and rings (filled with the background)', () => {
    expect(linesAtEnd('erOne').length).toBe(1);
    expect(linesAtEnd('erOnlyOne').length).toBe(2);
    expect(linesAtEnd('erMany').length).toBe(3);
    expect(linesAtEnd('erOneMany').length).toBe(4);
    const zm = linesAtEnd('erZeroMany');
    expect(zm.length).toBe(4);
    expect(zm.some((p) => p.closed && p.fill === newDocument().canvas.background)).toBe(true);
    expect(linesAtEnd('erZeroOne').some((p) => p.closed)).toBe(true);
  });
  it('are saved and read back; an unknown one falls back to the usual head', () => {
    for (const h of HEAD_KINDS) {
      const c = { ...makeConnector({ x: 0, y: 0, elementId: null }, { x: 100, y: 0, elementId: null }, defaultToolStyle('arrow')), endHead: h };
      expect((parseDocument(serializeDocument({ ...newDocument(), elements: [c] })).doc.elements[0] as ConnectorElement).endHead).toBe(h);
    }
    const raw = JSON.parse(serializeDocument({ ...newDocument(), elements: [makeConnector({ x: 0, y: 0, elementId: null }, { x: 100, y: 0, elementId: null }, defaultToolStyle('arrow'))] }));
    raw.pages[0].elements[0].endHead = 'erSomething';
    expect((parseDocument(JSON.stringify(raw)).doc.elements[0] as ConnectorElement).endHead).toBe('arrow');
  });
});

describe('files and export', () => {
  it('new shapes are saved and read back; older files open as before', () => {
    const els = NEW.map((k, i) => ({ ...shape(k), x: i * 200 }));
    const back = parseDocument(serializeDocument({ ...newDocument(), elements: els })).doc.elements as ShapeElement[];
    expect(back.map((e) => e.shape)).toEqual(NEW);
    const old = JSON.parse(serializeDocument({ ...newDocument(), elements: [shape('diamond')] }));
    old.schemaVersion = 15;
    expect((parseDocument(JSON.stringify(old)).doc.elements[0] as ShapeElement).shape).toBe('diamond');
  });
  it('Mermaid export writes BPMN events as circles and gateways as diamonds', () => {
    const s = { ...shape('bpmnStart', 'Begin'), x: 0 }, g = { ...shape('bpmnGateway', 'OK?'), x: 200 };
    const c = makeConnector({ x: 0, y: 0, elementId: s.id }, { x: 0, y: 0, elementId: g.id }, defaultToolStyle('arrow'));
    const text = toMermaid({ ...newDocument(), elements: [s, g, c] });
    expect(text).toContain('n1(("Begin"))'); expect(text).toContain('n2{"OK?"}');
  });
});
