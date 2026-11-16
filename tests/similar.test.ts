import { describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeShape, makeText } from '../src/model/defaults';
import { kindOf, selectSimilar } from '../src/store/similar';
import type { DiagramElement } from '../src/model/types';

const rect = (fill: string, stroke = '#1e1e1e') => {
  const s = makeShape('rectangle', 0, 0, 100, 60, defaultToolStyle('shape:rectangle'));
  s.style = { ...s.style, fill, fillStyle: 'solid', stroke };
  return s;
};
const ell = (fill: string) => { const s = makeShape('ellipse', 0, 0, 80, 80, defaultToolStyle('shape:ellipse')); s.style = { ...s.style, fill, fillStyle: 'solid' }; return s; };
const arrow = (a: string, b: string) => makeConnector({ x: 0, y: 0, elementId: a, anchor: null }, { x: 0, y: 0, elementId: b, anchor: null }, defaultToolStyle('arrow'));

describe('Select similar', () => {
  const r1 = rect('#ffc9c9'), r2 = rect('#a5d8ff'), r3 = rect('#ffc9c9', '#c92a2a'), e1 = ell('#ffc9c9');
  const a1 = arrow(r1.id, r2.id), a2 = arrow(r2.id, r3.id);
  const line = arrow(r1.id, e1.id); line.endHead = 'none'; line.startHead = 'none';
  const t = makeText(0, 0, 'note', defaultToolStyle('text'));
  const els: DiagramElement[] = [r1, r2, r3, e1, a1, a2, line, t];

  it('same kind: shapes by their shape, arrows apart from plain lines', () => {
    expect(selectSimilar(els, [r1.id], 'kind')).toEqual([r1.id, r2.id, r3.id]);
    expect(selectSimilar(els, [a1.id], 'kind')).toEqual([a1.id, a2.id]);
    expect(kindOf(line)).toBe('connector:line');
    expect(selectSimilar(els, [r1.id, a1.id], 'kind')).toEqual([r1.id, r2.id, r3.id, a1.id, a2.id]); // matches any selected item
  });

  it('same fill or line colour works across kinds; same kind and look needs both', () => {
    expect(selectSimilar(els, [r1.id], 'fill')).toEqual([r1.id, r3.id, e1.id]);
    expect(selectSimilar(els, [r3.id], 'stroke')).toEqual([r3.id]);
    expect(selectSimilar(els, [r1.id], 'look')).toEqual([r1.id]); // r3 has another outline, e1 another kind
    expect(selectSimilar(els, [a1.id], 'look')).toEqual([a1.id, a2.id]);
  });

  it('same animation; locked items are left out unless selected; nothing selected → nothing', () => {
    const f = { ...r2, id: 'float', anim: { mode: 'float' as const } };
    const locked = { ...rect('#ffc9c9'), id: 'locked', locked: true };
    const all = [...els, f, locked];
    expect(selectSimilar(all, [f.id], 'anim')).toEqual([f.id]);
    expect(selectSimilar(all, [r1.id], 'anim')).not.toContain(f.id);
    expect(selectSimilar(all, [r1.id], 'fill')).not.toContain('locked');
    expect(selectSimilar(all, ['locked'], 'fill')).toContain('locked');
    expect(selectSimilar(all, [], 'kind')).toEqual([]);
  });
});
