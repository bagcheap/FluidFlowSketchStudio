import { describe, expect, it } from 'vitest';
import { makeLookup, playSchedule, renderDocumentAtTime } from '../src/engine/render';
import { connectorPath } from '../src/engine/connectors';
import { resolveConnectorAnim } from '../src/engine/animation';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { parseDocument, serializeDocument } from '../src/model/schema';
import { clearAllPlayOrder, importMermaid, playInLabelOrder, playOrderClick } from '../src/store/commands';
import { useDoc } from '../src/store/docStore';
import { applyPlaySteps, labelStep, labelSteps, playStepLabels, readPlaySteps, togglePlayStep } from '../src/store/sequence';
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

  it('arrows left out of the order stay still while there is one; Clear takes every arrow out', () => {
    const { doc, ids } = fourArrows();
    const d = applyPlaySteps(doc, [[ids[0]], [ids[1]]]);
    const anim = (x: FlowDocument, id: string) => (x.elements.find((e) => e.id === id) as ConnectorElement).anim;
    expect(anim(d, ids[2])?.window).toBeUndefined();
    for (let t = 0; t < 6; t += 0.25) expect(lit(d, ids[2], t)).toBe(false); // no highlight at any time
    expect([0.5, 1, 1.5, 2].some((t) => lit(doc, ids[2], t))).toBe(true); // without an order it animates as usual
    const cleared = applyPlaySteps(d, []);
    expect(ids.every((id) => !anim(cleared, id)?.window)).toBe(true);
  });

  it('clicking arrows in the editor builds the order, one undo step each, and sets the loop length', () => {
    const { doc, ids } = fourArrows();
    useDoc.getState().replace(() => ({ ...doc, animation: { ...doc.animation, duration: 2 } }));
    playOrderClick(ids[3], false);
    playOrderClick(ids[1], false);
    playOrderClick(ids[0], true);
    expect(readPlaySteps(useDoc.getState().doc)).toEqual([[ids[3]], [ids[0], ids[1]]]); // within a step: document order (they play together)
    const now = useDoc.getState().doc;
    expect(now.animation.duration).toBeCloseTo(Math.ceil(playSchedule(now).seconds * 10) / 10, 5); // the loop fits the steps
    useDoc.getState().undo();
    expect(readPlaySteps(useDoc.getState().doc)).toEqual([[ids[3]], [ids[1]]]);
    clearAllPlayOrder();
    expect(readPlaySteps(useDoc.getState().doc)).toEqual([]);
  });

  it('every arrow moves at the same speed, however long it is; more arrows make a longer loop', () => {
    const t = defaultToolStyle('shape:rectangle');
    const a = makeShape('rectangle', 0, 0, 80, 60, t), b = makeShape('rectangle', 160, 0, 80, 60, t), c = makeShape('rectangle', 900, 0, 80, 60, t);
    const short = makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 0, y: 0, elementId: b.id }, defaultToolStyle('arrow'));
    const long = makeConnector({ x: 0, y: 0, elementId: b.id }, { x: 0, y: 0, elementId: c.id }, defaultToolStyle('arrow'));
    const base: FlowDocument = { ...newDocument(), elements: [a, b, c, short, long] };
    const d = applyPlaySteps(base, [[short.id], [long.id]]);
    const s = playSchedule(d);
    const lookup = makeLookup(d, null);
    const travel = (id: string) => { const c = d.elements.find((e) => e.id === id) as ConnectorElement; const len = connectorPath(c, lookup).length; return len + Math.min(resolveConnectorAnim(d.animation, c).highlightLength, len); };
    const speed = (id: string) => { const [x, y] = s.win.get(id)!; return travel(id) / ((y - x) * s.seconds); };
    expect(speed(long.id) / speed(short.id)).toBeCloseTo(1, 6);
    // the long arrow's step lasts much longer than the short one's
    const dur = (id: string) => { const [x, y] = s.win.get(id)!; return y - x; };
    expect(dur(long.id) / dur(short.id)).toBeGreaterThan(3);
    // one more step: a longer loop
    expect(playSchedule(applyPlaySteps({ ...base, elements: [...base.elements, { ...short, id: 'extra' }] }, [[short.id], [long.id], ['extra']])).seconds).toBeGreaterThan(s.seconds);
  });

  it('two-headed arrows play out and back; one-headed ones the way they point', () => {
    const { doc, ids } = fourArrows();
    const both = doc.elements.map((e) => (e.id === ids[1] ? { ...(e as ConnectorElement), startHead: 'arrow' as const } : e));
    const d = applyPlaySteps({ ...doc, elements: both }, [[ids[0]], [ids[1]]]);
    const dir = (id: string) => (d.elements.find((e) => e.id === id) as ConnectorElement).anim?.direction;
    expect(dir(ids[1])).toBe('roundTrip');
    expect(dir(ids[0]) ?? 'forward').toBe('forward');
  });

  it('imported two-headed arrows play out and back (flowchart <-->, sequence <<->>)', () => {
    const conns = () => useDoc.getState().doc.elements.filter((e): e is ConnectorElement => e.type === 'connector' && !!e.text);
    useDoc.getState().replace((d) => ({ ...d, elements: [] }));
    importMermaid('graph LR\n  A <-->|both| B\n  B -->|one| C');
    const f = conns();
    expect(f.find((c) => c.text === 'both')!.anim?.direction).toBe('roundTrip');
    expect(f.find((c) => c.text === 'one')!.anim?.direction ?? 'forward').not.toBe('roundTrip');
    useDoc.getState().replace((d) => ({ ...d, elements: [] }));
    importMermaid('sequenceDiagram\n  A<<->>B: sync\n  A->>B: call');
    const q = conns();
    expect(q.find((c) => c.text === 'sync')!.anim?.direction).toBe('roundTrip');
    expect(q.find((c) => c.text === 'call')!.anim?.direction ?? 'forward').toBe('forward');
  });

  it('reads step numbers at the start of labels', () => {
    expect(labelStep('1. Access Portal')).toEqual({ n: 1, sub: '', depth: 0, path: '' });
    expect(labelStep('8a. Live MS Graph')).toEqual({ n: 8, sub: 'a', depth: 0, path: '' });
    expect(labelStep('  12B) Thing')).toEqual({ n: 12, sub: 'b', depth: 0, path: '' });
    expect(labelStep('3: call')).toEqual({ n: 3, sub: '', depth: 0, path: '' });
    expect(labelStep('4 - go')).toEqual({ n: 4, sub: '', depth: 0, path: '' });
    expect(labelStep('7')).toEqual({ n: 7, sub: '', depth: 0, path: '' });
    expect(labelStep('8a.1. Query & Enforce SPO ACLs')).toEqual({ n: 8, sub: 'a', depth: 1, path: '.1' });
    expect(labelStep('4.2.1 deeper')).toEqual({ n: 4, sub: '', depth: 2, path: '.2.1' });
    for (const t of ['2FA check', 'v2 API', 'Login', '', '1234. too long', '4ab. two letters']) expect(labelStep(t), t).toBeNull();
  });

  it('label order: numbers in order, same number with letters together; an unnumbered arrow follows the one before it', () => {
    const { doc, ids } = fourArrows();
    const named = ['6b. later', '4a. first', 'not numbered', '6a. later too'];
    const d = { ...doc, elements: doc.elements.map((e) => { const i = ids.indexOf(e.id); return i < 0 ? e : { ...e, text: named[i] }; }) } as FlowDocument;
    // step 4: 4a; then the unnumbered arrow out of the shape 4a leads into; step 6: 6a then 6b
    expect(labelSteps(d)).toEqual([[ids[1]], [ids[2]], [ids[3], ids[0]]]);
    expect(playStepLabels(labelSteps(d))).toEqual(new Map([[ids[1], '1'], [ids[2], '2'], [ids[3], '3a'], [ids[0], '3b']]));
  });

  it('badges name arrows that share a step with letters', () => {
    expect(playStepLabels([['a'], ['b', 'c'], ['d'], ['e', 'f', 'g']])).toEqual(new Map([['a', '1'], ['b', '2a'], ['c', '2b'], ['d', '3'], ['e', '4a'], ['f', '4b'], ['g', '4c']]));
  });

  it('Play in label order, and imported flowcharts with numbered labels, play 1, 2, 3, 4a+4b, 5', () => {
    useDoc.getState().replace((d) => ({ ...d, elements: [] }));
    importMermaid('graph LR\n  A -->|1. one| B\n  B -->|2. two| C\n  C -->|3. three| D\n  D -->|4a. left| E\n  D -->|4b. right| F\n  E -->|5. five| G\n  G --> H');
    const doc = useDoc.getState().doc;
    const byText = (t: string) => doc.elements.find((e) => e.type === 'connector' && e.text === t)!.id;
    const plain = doc.elements.find((e) => e.type === 'connector' && !e.text) as ConnectorElement;
    // the unnumbered G --> H follows step 5 (which leads into G)
    const want = [[byText('1. one')], [byText('2. two')], [byText('3. three')], [byText('4a. left'), byText('4b. right')], [byText('5. five')], [plain.id]];
    expect(readPlaySteps(doc)).toEqual(want); // ordered on import
    // after Clear, the command puts the same order back
    clearAllPlayOrder();
    expect(readPlaySteps(useDoc.getState().doc)).toEqual([]);
    playInLabelOrder();
    expect(readPlaySteps(useDoc.getState().doc)).toEqual(want);
    // a flowchart with fewer than two numbered arrows isn't ordered on import
    useDoc.getState().replace((d) => ({ ...d, elements: [] }));
    importMermaid('graph LR\n  A -->|1. only| B\n  B --> C');
    expect(readPlaySteps(useDoc.getState().doc)).toEqual([]);
  });

  it('unnumbered arrows fanning out after a numbered one play together right after it; ones with nothing numbered leading in stay still', () => {
    useDoc.getState().replace((d) => ({ ...d, elements: [] }));
    importMermaid('flowchart LR\n  U <-->|1. Ask| A\n  A <-->|2a. Query| G\n  A <-->|2b. Query| S\n  G -->|Enforces ACLs| P & Q & R\n  P --> Z\n  X -->|Unrelated| Y\n  A -->|3. Answer| U');
    const doc = useDoc.getState().doc;
    const conns = doc.elements.filter((e): e is ConnectorElement => e.type === 'connector');
    const by = (t: string) => conns.filter((c) => c.text === t).map((c) => c.id);
    const name = (id: string) => (doc.elements.find((e) => e.id === id) as { text: string }).text;
    const pz = conns.find((c) => !c.text)!.id; // P --> Z follows the fan-out in turn
    expect(readPlaySteps(doc)).toEqual([by('1. Ask'), [...by('2a. Query'), ...by('2b. Query')], by('Enforces ACLs'), [pz], by('3. Answer')]);
    const lone = by('Unrelated')[0];
    expect(name(lone)).toBe('Unrelated');
    expect(conns.find((c) => c.id === lone)!.anim?.window).toBeUndefined();
    const hl = (id: string, t: number) => {
      const c = conns.find((x) => x.id === id)!;
      const colour = resolveConnectorAnim(doc.animation, c).highlightColor;
      return renderDocumentAtTime(doc, t).items.find((i) => i.id === id)!.parts.some((p) => p.k === 'line' && (p as { color: string }).color === colour);
    };
    const L = doc.animation.duration;
    for (let k = 0; k < 40; k++) expect(hl(lone, (k / 40) * L)).toBe(false); // never lights up
    // the fan-out arrows light up together, after step 2 and before step 3
    const { win } = playSchedule(doc);
    const fan = by('Enforces ACLs');
    expect(new Set(fan.map((id) => win.get(id)![0])).size).toBe(1);
    expect(win.get(fan[0])![0]).toBeGreaterThan(win.get(by('2a. Query')[0])![0]);
    expect(win.get(fan[0])![0]).toBeLessThan(win.get(by('3. Answer')[0])![0]);
  });

  it('dotted sub-steps (8a.1, 8a.2…) play together after step 8 and before 9', () => {
    useDoc.getState().replace((d) => ({ ...d, elements: [] }));
    importMermaid('flowchart LR\n  A -->|7. seven| B\n  B <-->|8a. Graph| G\n  G <-->|8a.2. OneDrive| OD\n  G <-->|8a.1. SPO| SPO\n  B <-->|8b. SNOW| S\n  G <-->|8a.10. Tenth| X\n  B -->|9. nine| A');
    const doc = useDoc.getState().doc;
    const txt = (id: string) => (doc.elements.find((e) => e.id === id) as { text: string }).text;
    // (arrows in one step play together; compare each step as a set)
    expect(readPlaySteps(doc).map((g) => g.map(txt).sort())).toEqual([['7. seven'], ['8a. Graph', '8b. SNOW'], ['8a.1. SPO', '8a.10. Tenth', '8a.2. OneDrive'], ['9. nine']]);
  });
});
