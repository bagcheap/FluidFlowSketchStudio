import { describe, expect, it } from 'vitest';
import { layered } from '../src/layout/layered';
import { autoLayout } from '../src/layout/autoLayout';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { wrapInContainer } from '../src/store/containers';
import type { FlowDocument } from '../src/model/types';

const B = (id: string, w = 100, h = 50) => ({ id, w, h });
const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('layered layout', () => {
  it('puts each step of a chain in its own rank, in the flow direction', () => {
    const p = layered([B('a'), B('b'), B('c')], [['a', 'b'], ['b', 'c']], 'LR');
    expect(p.get('a')!.x).toBeLessThan(p.get('b')!.x);
    expect(p.get('b')!.x).toBeLessThan(p.get('c')!.x);
    expect(new Set([...p.values()].map((q) => q.y)).size).toBe(1);
    const t = layered([B('a'), B('b')], [['a', 'b']], 'TB');
    expect(t.get('a')!.y).toBeLessThan(t.get('b')!.y);
    const bt = layered([B('a'), B('b')], [['a', 'b']], 'BT');
    expect(bt.get('a')!.y).toBeGreaterThan(bt.get('b')!.y);
  });

  it('spreads siblings without overlap and centres the parent over them', () => {
    const boxes = [B('p'), B('a'), B('b'), B('c')];
    const p = layered(boxes, [['p', 'a'], ['p', 'b'], ['p', 'c']], 'TB');
    const r = (id: string) => ({ ...p.get(id)!, w: 100, h: 50 });
    for (const x of ['a', 'b', 'c']) for (const y of ['a', 'b', 'c']) if (x < y) expect(overlap(r(x), r(y))).toBe(false);
    const mid = (r('a').x + r('c').x) / 2;
    expect(Math.abs(r('p').x - mid)).toBeLessThan(1);
  });

  it('copes with cycles, self-loops and unconnected boxes', () => {
    const p = layered([B('a'), B('b'), B('c'), B('lone')], [['a', 'b'], ['b', 'a'], ['c', 'c']], 'LR');
    expect(p.size).toBe(4);
    for (const q of p.values()) expect(Number.isFinite(q.x) && Number.isFinite(q.y)).toBe(true);
    expect(Math.min(...[...p.values()].map((q) => q.x))).toBe(0);
  });
});

describe('auto-layout of a diagram', () => {
  function messy() {
    const t = defaultToolStyle('shape:rectangle');
    const a = makeShape('rectangle', 300, 300, 120, 60, t), b = makeShape('rectangle', 0, 0, 120, 60, t), c = makeShape('rectangle', 310, 290, 120, 60, t);
    const arrow = (x: string, y: string) => makeConnector({ x: 0, y: 0, elementId: x }, { x: 0, y: 0, elementId: y }, defaultToolStyle('arrow'));
    const doc: FlowDocument = { ...newDocument(), elements: [a, b, c, arrow(a.id, b.id), arrow(b.id, c.id)] };
    return { doc, a, b, c };
  }
  const get = (d: FlowDocument, id: string) => d.elements.find((e) => e.id === id)!;

  it('arranges shapes along the arrows, keeping the group\'s top-left corner', () => {
    const { doc, a, b, c } = messy();
    const d = autoLayout(doc, 'LR');
    expect(get(d, a.id).x).toBeLessThan(get(d, b.id).x);
    expect(get(d, b.id).x).toBeLessThan(get(d, c.id).x);
    expect(overlap(get(d, a.id), get(d, c.id))).toBe(false);
    expect(Math.min(...[a, b, c].map((s) => get(d, s.id).x))).toBeCloseTo(0, 5); // b started at x = 0
  });

  it('lays out a container\'s contents inside it, then moves the container as one block', () => {
    const { doc, a, b, c } = messy();
    const w = wrapInContainer(doc, [b.id, c.id], defaultToolStyle('container'))!;
    const d = autoLayout(w.doc, 'TB');
    const box = get(d, w.id);
    for (const id of [b.id, c.id]) {
      const s = get(d, id);
      expect(s.x >= box.x && s.x + s.w <= box.x + box.w && s.y >= box.y && s.y + s.h <= box.y + box.h).toBe(true);
    }
    expect(get(d, b.id).y).toBeLessThan(get(d, c.id).y);
    expect(overlap(get(d, a.id), box)).toBe(false);
    expect(get(d, a.id).y).toBeLessThan(box.y); // a → (something in the box): the box comes after a
  });

  it('leaves locked shapes, text and arrows alone; nothing to do returns the same document', () => {
    const { doc, a } = messy();
    const locked = { ...doc, elements: doc.elements.map((e) => (e.id === a.id ? { ...e, locked: true } : e)) };
    expect(get(autoLayout(locked, 'LR'), a.id)).toEqual(get(locked, a.id));
    const empty = newDocument();
    expect(autoLayout(empty, 'LR')).toBe(empty);
  });
});
