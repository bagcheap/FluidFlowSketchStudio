import { beforeEach, describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { afterLabelEdit, playInLabelOrderAllPages, renumberStepLabels } from '../src/store/commands';
import { useDoc } from '../src/store/docStore';
import { useUI } from '../src/store/uiStore';
import { applyPlaySteps, labelSteps, makeRoomForStep, orderFollowsLabels, readPlaySteps, renumberSteps } from '../src/store/sequence';
import type { ConnectorElement, FlowDocument } from '../src/model/types';

/** A chain of arrows with these labels, in that order along the chain. */
function chain(labels: string[]) {
  const t = defaultToolStyle('shape:rectangle');
  const shapes = labels.concat('').map((_, i) => makeShape('rectangle', i * 200, 0, 100, 60, t));
  const arrows = labels.map((text, i) => ({ ...makeConnector({ x: 0, y: 0, elementId: shapes[i].id }, { x: 0, y: 0, elementId: shapes[i + 1].id }, defaultToolStyle('arrow')), text }));
  return { doc: { ...newDocument(), elements: [...shapes, ...arrows] } as FlowDocument, ids: arrows.map((a) => a.id) };
}
const texts = (d: FlowDocument, ids: string[]) => ids.map((id) => (d.elements.find((e) => e.id === id) as ConnectorElement).text);
const relabel = (d: FlowDocument, id: string, text: string): FlowDocument => ({ ...d, elements: d.elements.map((e) => (e.id === id ? { ...e, text } : e)) });

describe('making room for a step number', () => {
  it('7a, 7b → 7, 8: later steps move up, like a numbered list', () => {
    const { doc, ids } = chain(['6. Ask', '7a. Look up', '7b. Fetch', '8. Reply', '8a.1 Log', '9) Done']);
    let d = relabel(doc, ids[1], '7. Look up');
    let r = makeRoomForStep(d, ids[1], '7a. Look up', '7. Look up');
    expect(r.shifted).toBe(0); // same number: nothing moves
    d = relabel(r.doc, ids[2], '8. Fetch');
    r = makeRoomForStep(d, ids[2], '7b. Fetch', '8. Fetch');
    expect(r.shifted).toBe(3);
    expect(texts(r.doc, ids)).toEqual(['6. Ask', '7. Look up', '8. Fetch', '9. Reply', '9a.1 Log', '10) Done']);
  });

  it('a letter joins an existing step; a free number, or no number, moves nothing', () => {
    const { doc, ids } = chain(['1. a', '2. b', '3. c']);
    expect(makeRoomForStep(relabel(doc, ids[2], '2a. c'), ids[2], '3. c', '2a. c').shifted).toBe(0);
    expect(makeRoomForStep(relabel(doc, ids[2], '5. c'), ids[2], '3. c', '5. c').shifted).toBe(0);
    expect(makeRoomForStep(relabel(doc, ids[2], 'c'), ids[2], '3. c', 'c').shifted).toBe(0);
    const r = makeRoomForStep(relabel(doc, ids[2], '1. c'), ids[2], '3. c', '1. c'); // moved to the front
    expect(texts(r.doc, ids)).toEqual(['2. a', '3. b', '1. c']);
  });
});

describe('renumbering labels from the play order', () => {
  it('closes gaps, letters shared steps, keeps the rest of each label and dotted sub-steps under their parent', () => {
    const { doc, ids } = chain(['2. Ask', '5a Look up', '5b Fetch', '5a.1 Log', 'then', '9: Done']);
    const d = applyPlaySteps(doc, labelSteps(doc));
    const r = renumberSteps(d);
    expect(texts(r.doc, ids)).toEqual(['1. Ask', '2a Look up', '2b Fetch', '2a.1 Log', 'then', '3: Done']);
  });

  it('follows a play order set by clicking, not the old numbers', () => {
    const { doc, ids } = chain(['1. a', '2. b', '3. c']);
    const d = applyPlaySteps(doc, [[ids[2]], [ids[0], ids[1]]]);
    expect(texts(renumberSteps(d).doc, ids)).toEqual(['2a. a', '2b. b', '1. c']);
  });
});

describe('commands', () => {
  beforeEach(() => useUI.setState((s) => ({ prefs: { ...s.prefs, autoRenumberSteps: true } })));

  it('a label edit keeps a label-made play order in step, in one go', () => {
    const { doc, ids } = chain(['1. a', '2a. b', '2b. c', '3. d']);
    const before = applyPlaySteps(doc, labelSteps(doc));
    expect(orderFollowsLabels(before)).toBe(true);
    const r = afterLabelEdit(before, relabel(before, ids[2], '3. c'), ids[2], '2b. c', '3. c');
    expect(r.shifted).toBe(1);
    expect(texts(r.doc, ids)).toEqual(['1. a', '2a. b', '3. c', '4. d']);
    expect(readPlaySteps(r.doc)).toEqual([[ids[0]], [ids[1]], [ids[2]], [ids[3]]]); // 2b now plays on its own
  });

  it('a play order set by hand is left alone; the setting can turn the shifting off', () => {
    const { doc, ids } = chain(['1. a', '2. b', '3. c']);
    const before = applyPlaySteps(doc, [[ids[2]], [ids[0]], [ids[1]]]);
    useUI.setState((s) => ({ prefs: { ...s.prefs, autoRenumberSteps: false } }));
    const r = afterLabelEdit(before, relabel(before, ids[0], '2. a'), ids[0], '1. a', '2. a');
    expect(r.shifted).toBe(0);
    expect(readPlaySteps(r.doc)).toEqual(readPlaySteps(before));
  });

  it('Renumber step labels and Play in label order on every page are one undo step each', () => {
    const { doc, ids } = chain(['3. a', '7. b']);
    const p2 = chain(['1. x', '2. y']);
    useDoc.getState().load({ ...doc, pages: [...doc.pages, { id: 'p2', name: 'Two', elements: p2.doc.elements }] });
    const h = useDoc.getState().past.length;
    renumberStepLabels();
    expect(texts(useDoc.getState().doc, ids)).toEqual(['1. a', '2. b']);
    expect(readPlaySteps(useDoc.getState().doc)).toEqual([[ids[0]], [ids[1]]]);
    playInLabelOrderAllPages();
    const other = useDoc.getState().doc.pages.find((p) => p.id === 'p2')!;
    expect(readPlaySteps({ ...doc, elements: other.elements })).toEqual([[p2.ids[0]], [p2.ids[1]]]);
    expect(useDoc.getState().past.length).toBe(h + 2);
  });
});
