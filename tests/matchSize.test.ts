import { beforeEach, describe, expect, it } from 'vitest';
import { defaultToolStyle, makeShape, makeText, newDocument } from '../src/model/defaults';
import { matchSize, matchSizes } from '../src/store/commands';
import { wrapInContainer } from '../src/store/containers';
import { useDoc } from '../src/store/docStore';
import { useUI } from '../src/store/uiStore';
import type { FlowDocument } from '../src/model/types';

const box = (x: number, y: number, w: number, h: number) => makeShape('rectangle', x, y, w, h, defaultToolStyle('shape:rectangle'));
const get = (d: FlowDocument, id: string) => d.elements.find((e) => e.id === id)!;

function setup() {
  const ref = box(0, 0, 200, 100), small = box(400, 0, 50, 40), tall = box(600, 0, 40, 160);
  return { doc: { ...newDocument(), elements: [ref, small, tall] } as FlowDocument, ref, small, tall };
}

describe('match size', () => {
  it('width: matches the width and keeps each shape\'s proportions, around its centre', () => {
    const { doc, ref, small, tall } = setup();
    const d = matchSizes(doc, ref.id, [small.id, tall.id], 'width');
    expect(get(d, small.id)).toMatchObject({ w: 200, h: 160, x: 425 - 100, y: 20 - 80 });
    expect(get(d, tall.id)).toMatchObject({ w: 200, h: 800 });
    expect(get(d, ref.id)).toEqual(ref);
  });

  it('height: matches the height and keeps proportions', () => {
    const { doc, ref, small } = setup();
    const s = get(matchSizes(doc, ref.id, [small.id], 'height'), small.id);
    expect(s.h).toBe(100);
    expect(s.w).toBeCloseTo(125);
  });

  it('both: matches width and height exactly, stretching', () => {
    const { doc, ref, small, tall } = setup();
    const d = matchSizes(doc, ref.id, [small.id, tall.id], 'both');
    for (const id of [small.id, tall.id]) expect(get(d, id)).toMatchObject({ w: 200, h: 100 });
    expect(get(d, small.id).x + 100).toBe(425); // centre kept
  });

  it('leaves text, locked shapes and containers alone; containers grow to fit', () => {
    const { doc, ref, small } = setup();
    const t = makeText(0, 300, 'hi', defaultToolStyle('text'));
    const locked = { ...box(800, 0, 30, 30), locked: true };
    const w = wrapInContainer({ ...doc, elements: [...doc.elements, t, locked] }, [small.id], defaultToolStyle('container'))!;
    const before = get(w.doc, w.id);
    const d = matchSizes(w.doc, ref.id, [small.id, t.id, locked.id, w.id], 'both');
    expect(get(d, t.id)).toEqual(t);
    expect(get(d, locked.id)).toEqual(locked);
    expect(get(d, small.id)).toMatchObject({ w: 200, h: 100 });
    expect(get(d, w.id).w).toBeGreaterThan(before.w);
  });

  describe('command', () => {
    beforeEach(() => useDoc.getState().load(newDocument()));
    it('uses the first selected shape as the reference, in one undo step', () => {
      const { ref, small, tall } = setup();
      useDoc.getState().commit((d) => ({ ...d, elements: [ref, small, tall] }));
      useUI.getState().select([small.id, ref.id, tall.id]); // small was selected first
      matchSize('both');
      const d = useDoc.getState().doc;
      expect(get(d, ref.id)).toMatchObject({ w: 50, h: 40 });
      expect(get(d, tall.id)).toMatchObject({ w: 50, h: 40 });
      useDoc.getState().undo();
      expect(get(useDoc.getState().doc, tall.id)).toMatchObject({ w: 40, h: 160 });
    });
  });
});
