import { beforeEach, describe, expect, it } from 'vitest';
import { defaultToolStyle, makeShape, makeText, newDocument } from '../src/model/defaults';
import { addConnectedCopy, canQuickConnect, nextSlot, QUICK_GAP } from '../src/store/quickConnect';
import { wrapInContainer } from '../src/store/containers';
import { useDoc } from '../src/store/docStore';
import { useUI } from '../src/store/uiStore';
import { quickConnect } from '../src/store/commands';
import type { ConnectorElement, FlowDocument, ShapeElement } from '../src/model/types';

const arrow = defaultToolStyle('arrow');
const get = (d: FlowDocument, id: string) => d.elements.find((e) => e.id === id)!;

function setup() {
  const a = makeShape('diamond', 100, 100, 120, 80, defaultToolStyle('shape:diamond'));
  a.text = 'Approve?';
  a.style = { ...a.style, fill: '#fff3bf', fillStyle: 'solid' };
  return { doc: { ...newDocument(), elements: [a] } as FlowDocument, a };
}

describe('quick-connect', () => {
  it('adds a copy of the shape (same kind, size and style, no text) one gap away, joined by an arrow', () => {
    const { doc, a } = setup();
    const r = addConnectedCopy(doc, a.id, arrow, { side: 'e' })!;
    const n = get(r.doc, r.id) as ShapeElement;
    expect(n).toMatchObject({ type: 'shape', shape: 'diamond', w: 120, h: 80, text: '', x: 100 + 120 + QUICK_GAP, y: 100 });
    expect(n.style).toEqual(a.style);
    expect(n.id).not.toBe(a.id);
    const c = get(r.doc, r.connectorId) as ConnectorElement;
    expect(c.start.elementId).toBe(a.id);
    expect(c.end.elementId).toBe(n.id);
    expect(c.endHead).toBe('arrow');
    // the source is unchanged
    expect(get(r.doc, a.id)).toEqual(a);
  });

  it('goes in each direction, and steps aside when the spot is taken', () => {
    const { doc, a } = setup();
    expect(nextSlot(doc, a, 's')).toEqual({ x: 100, y: 100 + 80 + QUICK_GAP });
    expect(nextSlot(doc, a, 'w')).toEqual({ x: 100 - 120 - QUICK_GAP, y: 100 });
    expect(nextSlot(doc, a, 'n')).toEqual({ x: 100, y: 100 - 80 - QUICK_GAP });
    // add two to the right: the second one doesn't land on the first
    const r1 = addConnectedCopy(doc, a.id, arrow, { side: 'e' })!;
    const r2 = addConnectedCopy(r1.doc, a.id, arrow, { side: 'e' })!;
    const n1 = get(r2.doc, r1.id), n2 = get(r2.doc, r2.id);
    expect(n2.x).toBe(n1.x);
    expect(Math.abs(n2.y - n1.y)).toBeGreaterThanOrEqual(80);
  });

  it('places the copy where it was dropped, attaching the arrow being dragged', () => {
    const { doc, a } = setup();
    const r1 = addConnectedCopy(doc, a.id, arrow, { side: 'e' })!;
    const r = addConnectedCopy(r1.doc, a.id, arrow, { center: { x: 600, y: 500 }, connectorId: r1.connectorId })!;
    const n = get(r.doc, r.id);
    expect(n.x + n.w / 2).toBe(600);
    expect(n.y + n.h / 2).toBe(500);
    expect(r.connectorId).toBe(r1.connectorId);
    expect((get(r.doc, r1.connectorId) as ConnectorElement).end.elementId).toBe(r.id);
  });

  it('a copy of a shape in a container joins that container, which grows to fit', () => {
    const { doc, a } = setup();
    const w = wrapInContainer(doc, [a.id], defaultToolStyle('container'))!;
    const before = get(w.doc, w.id);
    const r = addConnectedCopy(w.doc, a.id, arrow, { side: 'e' })!;
    const c = get(r.doc, w.id);
    expect(c.type === 'container' && c.members).toContain(r.id);
    expect(c.w).toBeGreaterThan(before.w);
  });

  it('only shapes, icons and pictures that are not locked get handles', () => {
    const { a } = setup();
    expect(canQuickConnect(a)).toBe(true);
    expect(canQuickConnect({ ...a, locked: true })).toBe(false);
    expect(canQuickConnect(makeText(0, 0, 'hi', defaultToolStyle('text')))).toBe(false);
    expect(canQuickConnect(null)).toBe(false);
  });

  describe('command', () => {
    beforeEach(() => { useDoc.getState().load(newDocument()); useUI.getState().select([]); });
    it('Cmd+Arrow adds a connected copy of the selected shape and selects it, as one undo step', () => {
      const { a } = setup();
      useDoc.getState().commit((d) => ({ ...d, elements: [a] }));
      useUI.getState().select([a.id]);
      quickConnect('s');
      const d = useDoc.getState().doc;
      expect(d.elements).toHaveLength(3);
      const sel = useUI.getState().selection;
      expect(sel).toHaveLength(1);
      expect(get(d, sel[0]).y).toBe(100 + 80 + QUICK_GAP);
      useDoc.getState().undo();
      expect(useDoc.getState().doc.elements).toHaveLength(1);
    });
  });
});
