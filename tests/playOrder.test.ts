import { describe, expect, it } from 'vitest';
import { renderDocumentAtTime } from '../src/engine/render';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { parseDocument, serializeDocument } from '../src/model/schema';
import { clearAllPlayOrder, playOrderClick } from '../src/store/commands';
import { useDoc } from '../src/store/docStore';
import { applyPlaySteps, readPlaySteps, togglePlayStep } from '../src/store/sequence';
import type { ConnectorElement, FlowDocument } from '../src/model/types';

const HL = '#3b82f6';
function fourArrows() {
  const t = defaultToolStyle('shape:rectangle');
  const shapes = [0, 1, 2, 3, 4].map((i) => makeShape('rectangle', i * 200, 0, 100, 60, t));
  const arrows = [0, 1, 2, 3].map((i) => makeConnector({ x: 0, y: 0, elementId: shapes[i].id }, { x: 0, y: 0, elementId: shapes[i + 1].id }, defaultToolStyle('arrow')));
  const doc: FlowDocument = { ...newDocument(), elements: [...shapes, ...arrows] };
  return { doc, ids: arrows.map((a) => a.id) };
}
const lit = (doc: FlowDocument, id: string, t: number) =>
  renderDocumentAtTime(doc, t).items.find((i) => i.id === id)!.parts.some((p) => p.k === 'line' && (p as { color: string }).color === HL);

describe('set play order', () => {
  it('clicks build steps; Shift adds to the last step; clicking again takes an arrow out', () => {
    let s: string[][] = [];
    s = togglePlayStep(s, 'a', false);
    s = togglePlayStep(s, 'b', false);
    s = togglePlayStep(s, 'c', true);
    expect(s).toEqual([['a'], ['b', 'c']]);
    s = togglePlayStep(s, 'd', false);
    expect(s).toEqual([['a'], ['b', 'c'], ['d']]);
    s = togglePlayStep(s, 'a', false); // out: later steps move up
    expect(s).toEqual([['b', 'c'], ['d']]);
    s = togglePlayStep(s, 'b', false);
    s = togglePlayStep(s, 'c', false); // a step that empties disappears
    expect(s).toEqual([['d']]);
    expect(togglePlayStep([], 'x', true)).toEqual([['x']]); // Shift on the first click just starts the order
  });

  it('the order is stored in the arrows and read back exactly (also from a saved file)', () => {
    const { doc, ids } = fourArrows();
    const steps = [[ids[2]], [ids[0], ids[3]], [ids[1]]];
    const d = applyPlaySteps(doc, steps);
    expect(readPlaySteps(d)).toEqual(steps);
    expect(readPlaySteps(parseDocument(serializeDocument(d)).doc)).toEqual(steps);
  });

  it('plays in that order; arrows in one step light up together', () => {
    const { doc, ids } = fourArrows();
    const d = { ...applyPlaySteps(doc, [[ids[2]], [ids[0], ids[3]], [ids[1]]]), animation: { ...doc.animation, duration: 6, loop: true, seamless: true } };
    const at = (f: number) => ids.map((id) => lit(d, id, 6 * f));
    expect(at(0.15)).toEqual([false, false, true, false]); // step 1
    expect(at(0.48)).toEqual([true, false, false, true]); // step 2: two together
    expect(at(0.8)).toEqual([false, true, false, false]); // step 3
  });

  it('arrows left out of the order animate as usual; Clear takes every arrow out', () => {
    const { doc, ids } = fourArrows();
    const d = applyPlaySteps(doc, [[ids[0]], [ids[1]]]);
    const anim = (x: FlowDocument, id: string) => (x.elements.find((e) => e.id === id) as ConnectorElement).anim;
    expect(anim(d, ids[2])?.window).toBeUndefined();
    const cleared = applyPlaySteps(d, []);
    expect(ids.every((id) => !anim(cleared, id)?.window)).toBe(true);
  });

  it('clicking arrows in the editor builds the order, one undo step each, and lengthens a short loop', () => {
    const { doc, ids } = fourArrows();
    useDoc.getState().replace(() => ({ ...doc, animation: { ...doc.animation, duration: 2 } }));
    playOrderClick(ids[3], false);
    playOrderClick(ids[1], false);
    playOrderClick(ids[0], true);
    expect(readPlaySteps(useDoc.getState().doc)).toEqual([[ids[3]], [ids[0], ids[1]]]); // within a step: document order (they play together)
    expect(useDoc.getState().doc.animation.duration).toBeGreaterThanOrEqual(2);
    useDoc.getState().undo();
    expect(readPlaySteps(useDoc.getState().doc)).toEqual([[ids[3]], [ids[1]]]);
    clearAllPlayOrder();
    expect(readPlaySteps(useDoc.getState().doc)).toEqual([]);
  });
});
