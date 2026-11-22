import { beforeEach, describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { afterLabelEdit, applyStyle, cloneElements, deleteSelection, playInLabelOrderAllPages, renumberStepLabels, styleOf } from '../src/store/commands';
import { playSchedule } from '../src/engine/render';
import { sanitizeToolStyle } from '../src/model/schema';
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

  describe('a newly drawn arrow, then labelled', () => {
    /** A page whose order came from its labels, plus one new, unlabelled arrow from shape `from` to shape `to`. */
    function withNewArrow(labels: string[], from: number, to: number) {
      const { doc, ids } = chain(labels);
      const ordered = applyPlaySteps(doc, labelSteps(doc));
      const shapes = ordered.elements.filter((e) => e.type === 'shape');
      const fresh = makeConnector({ x: 0, y: 0, elementId: shapes[from].id }, { x: 0, y: 0, elementId: shapes[to].id }, defaultToolStyle('arrow'));
      return { before: { ...ordered, elements: [...ordered.elements, fresh] }, ids, id: fresh.id };
    }
    const stepTexts = (d: FlowDocument) => readPlaySteps(d).map((g) => g.map((id) => (d.elements.find((e) => e.id === id) as ConnectorElement).text).sort());

    it('6a, 6b + a new arrow labelled 6c: it joins step 6', () => {
      const { before, id } = withNewArrow(['5. x', '6a. y', '6b. z', '7. w'], 3, 1);
      expect(orderFollowsLabels(before)).toBe(true); // the unlabelled new arrow doesn't count against it
      const r = afterLabelEdit(before, relabel(before, id, '6c. new'), id, '', '6c. new');
      expect(r.shifted).toBe(0);
      expect(stepTexts(r.doc)).toEqual([['5. x'], ['6a. y', '6b. z', '6c. new'], ['7. w']]);
    });

    it('2, 3 + a new arrow labelled 3: it becomes step 3 and the old 3 onwards move up', () => {
      const { before, ids, id } = withNewArrow(['1. a', '2. b', '3. c', '4. d'], 4, 0);
      const r = afterLabelEdit(before, relabel(before, id, '3. new'), id, '', '3. new');
      expect(r.shifted).toBe(2);
      expect(texts(r.doc, ids)).toEqual(['1. a', '2. b', '4. c', '5. d']);
      expect(stepTexts(r.doc)).toEqual([['1. a'], ['2. b'], ['3. new'], ['4. c'], ['5. d']]);
    });
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

describe('closing gaps', () => {
  beforeEach(() => useUI.setState((s) => ({ prefs: { ...s.prefs, autoRenumberSteps: true } })));

  it('deleting arrow 3: 4 becomes the new 3, and the label-made play order follows (one undo step)', () => {
    const { doc, ids } = chain(['1. a', '2. b', '3. c', '4. d', '4a.1 e', '5) f']);
    useDoc.getState().load(applyPlaySteps(doc, labelSteps(doc)));
    useUI.getState().select([ids[2]]);
    const h = useDoc.getState().past.length;
    deleteSelection();
    const d = useDoc.getState().doc;
    const left = [ids[0], ids[1], ids[3], ids[4], ids[5]];
    expect(texts(d, left)).toEqual(['1. a', '2. b', '3. d', '3a.1 e', '4) f']);
    expect(readPlaySteps(d)).toEqual([[ids[0]], [ids[1]], [ids[3]], [ids[4]], [ids[5]]]);
    expect(useDoc.getState().past.length).toBe(h + 1);
    useDoc.getState().undo();
    expect(texts(useDoc.getState().doc, ids)).toEqual(['1. a', '2. b', '3. c', '4. d', '4a.1 e', '5) f']);
  });

  it('deleting one of 3a and 3b leaves the numbers alone (3 is still there); deleting 2 and 4 closes both gaps', () => {
    const { doc, ids } = chain(['1. a', '2. b', '3a. c', '3b. d', '4. e', '5. f']);
    useDoc.getState().load(doc);
    useUI.getState().select([ids[3]]);
    deleteSelection();
    expect(texts(useDoc.getState().doc, [ids[0], ids[1], ids[2], ids[4], ids[5]])).toEqual(['1. a', '2. b', '3a. c', '4. e', '5. f']);
    useUI.getState().select([ids[1], ids[4]]);
    deleteSelection();
    expect(texts(useDoc.getState().doc, [ids[0], ids[2], ids[5]])).toEqual(['1. a', '2a. c', '3. f']);
  });

  it('removing the number from a label closes the gap; changing 3 to 5 moves it like a list item', () => {
    const { doc, ids } = chain(['1. a', '2. b', '3. c', '4. d', '5. e', '6. f']);
    let r = afterLabelEdit(doc, relabel(doc, ids[2], 'c'), ids[2], '3. c', 'c');
    expect(texts(r.doc, ids)).toEqual(['1. a', '2. b', 'c', '3. d', '4. e', '5. f']);
    r = afterLabelEdit(doc, relabel(doc, ids[2], '5. c'), ids[2], '3. c', '5. c');
    expect(texts(r.doc, ids)).toEqual(['1. a', '2. b', '5. c', '3. d', '4. e', '6. f']);
  });

  it('with the setting off, nothing is renumbered', () => {
    useUI.setState((s) => ({ prefs: { ...s.prefs, autoRenumberSteps: false } }));
    const { doc, ids } = chain(['1. a', '2. b', '3. c']);
    useDoc.getState().load(doc);
    useUI.getState().select([ids[1]]);
    deleteSelection();
    expect(texts(useDoc.getState().doc, [ids[0], ids[2]])).toEqual(['1. a', '3. c']);
  });
});

describe('new arrows and the play order', () => {
  beforeEach(() => useUI.setState((s) => ({ prefs: { ...s.prefs, autoRenumberSteps: true } })));
  const ordered = (labels: string[]) => { const { doc, ids } = chain(labels); return { doc: applyPlaySteps(doc, labelSteps(doc)), ids }; };
  const lastStep = (d: FlowDocument) => playSchedule(d).steps.at(-1)!.ids;

  it('a style taken from an arrow in the order never carries its place (tool defaults, paste style, copies)', () => {
    const { doc, ids } = ordered(['1. a', '2. b', '3. c']);
    const two = doc.elements.find((e) => e.id === ids[1]) as ConnectorElement;
    expect(styleOf(two).connectorAnim?.window).toBeUndefined();
    expect(sanitizeToolStyle({ ...styleOf(two), connectorAnim: { window: [0.2, 0.3], speed: 2 } }, defaultToolStyle('arrow')).connectorAnim).toEqual({ speed: 2 });
    expect(makeConnector({ x: 0, y: 0 }, { x: 9, y: 0 }, { ...defaultToolStyle('arrow'), connectorAnim: { window: [0.2, 0.3] } } as never).anim?.window).toBeUndefined();
    const [copy] = cloneElements(doc, [two], 10, 10) as ConnectorElement[];
    expect(copy.anim?.window).toBeUndefined();
    expect((cloneElements(doc, [two], 0, 0, true)[0] as ConnectorElement).anim?.window).toEqual(two.anim!.window); // a duplicated page keeps its order
    useDoc.getState().load(doc);
    applyStyle([ids[2]], styleOf(two)); // paste style: arrow 3 keeps its own place
    expect(readPlaySteps(useDoc.getState().doc)).toEqual([[ids[0]], [ids[1]], [ids[2]]]);
  });

  it('1) a new arrow plays last; 2) labelling it places it; 3) a label without a clear number keeps it last', () => {
    const { doc, ids } = ordered(['1. a', '2. b', '3. c']);
    const shapes = doc.elements.filter((e) => e.type === 'shape');
    const fresh = makeConnector({ x: 0, y: 0, elementId: shapes[3].id }, { x: 0, y: 0, elementId: shapes[0].id }, defaultToolStyle('arrow'));
    const before = { ...doc, elements: [...doc.elements, fresh] };
    expect(lastStep(before)).toEqual([fresh.id]); // 1) plays after step 3
    const r = afterLabelEdit(before, relabel(before, fresh.id, '2. new'), fresh.id, '', '2. new');
    expect(readPlaySteps(r.doc)).toEqual([[ids[0]], [fresh.id], [ids[1]], [ids[2]]]); // 2) it is step 2, the rest move up
    expect(texts(r.doc, ids)).toEqual(['1. a', '3. b', '4. c']);
    const oops = afterLabelEdit(before, relabel(before, fresh.id, 'two'), fresh.id, '', 'two');
    expect(readPlaySteps(oops.doc)).toEqual([[ids[0]], [ids[1]], [ids[2]]]); // 3) not placed…
    expect(lastStep(oops.doc)).toEqual([fresh.id]); // …so it still plays last
  });

  it('removing an arrow\'s number moves it to the end (the others close up)', () => {
    const { doc, ids } = ordered(['1. a', '2. b', '3. c']);
    const r = afterLabelEdit(doc, relabel(doc, ids[1], 'b'), ids[1], '2. b', 'b');
    expect(texts(r.doc, ids)).toEqual(['1. a', 'b', '2. c']);
    expect(readPlaySteps(r.doc)).toEqual([[ids[0]], [ids[2]]]);
    expect(lastStep(r.doc)).toEqual([ids[1]]);
  });

  it('an arrow in the order with its animation turned off is skipped: no gap where it was', () => {
    const { doc, ids } = ordered(['1. a', '2. b', '3. c']);
    const off = { ...doc, elements: doc.elements.map((e) => (e.id === ids[1] ? { ...e, anim: { ...(e as ConnectorElement).anim, mode: 'none' as const } } : e)) } as FlowDocument;
    expect(playSchedule(off).steps.map((g) => g.ids)).toEqual([[ids[0]], [ids[2]]]);
    expect(playSchedule(off).seconds).toBeLessThan(playSchedule(doc).seconds);
  });
});
