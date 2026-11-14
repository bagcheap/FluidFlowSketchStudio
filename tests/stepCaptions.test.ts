import { describe, expect, it } from 'vitest';
import { currentStep, playSchedule, renderDocumentAtTime, stepCaption, STEP_DIM } from '../src/engine/render';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { parseDocument, serializeDocument } from '../src/model/schema';
import { applyPlaySteps } from '../src/store/sequence';
import type { ContainerElement, FlowDocument } from '../src/model/types';
import { baseFields } from '../src/model/defaults';

// A → B → C → D, with arrows "1. ask", "2. look up" and (together) "3a. reply" + "3b. log"; E is not involved
function diagram(captions: boolean, stepFocus: boolean) {
  const t = defaultToolStyle('shape:rectangle');
  const [A, B, C, D, E] = [0, 1, 2, 3, 4].map((i) => makeShape('rectangle', i * 220, 0, 120, 60, t));
  const arrow = (p: typeof A, q: typeof A, text: string) => ({ ...makeConnector({ x: 0, y: 0, elementId: p.id }, { x: 0, y: 0, elementId: q.id }, { ...defaultToolStyle('arrow'), routing: 'straight' as const }), text });
  const a1 = arrow(A, B, '1. ask'), a2 = arrow(B, C, '2. look up'), a3 = arrow(C, D, '3a. reply'), a4 = arrow(C, B, '3b. log');
  const box: ContainerElement = { ...baseFields(defaultToolStyle('container')), type: 'container', x: -40, y: -60, w: 1200, h: 200, text: 'All', members: [], anim: { mode: 'off' } };
  let doc: FlowDocument = { ...newDocument(), elements: [box, A, B, C, D, E, a1, a2, a3, a4] };
  doc = applyPlaySteps(doc, [[a1.id], [a2.id], [a3.id, a4.id]]);
  doc = { ...doc, animation: { ...doc.animation, captions, stepFocus, duration: Math.ceil(playSchedule(doc).seconds * 10) / 10, loop: true, seamless: true } };
  return { doc, A, B, C, D, E, box, a1, a2, a3, a4 };
}
const L = (doc: FlowDocument) => doc.animation.duration;
/** a time well inside step k (after its fade-in) */
const inStep = (doc: FlowDocument, k: number) => { const s = playSchedule(doc).steps; const next = s[k + 1]?.start ?? 1; return ((s[k].start + next) / 2) * L(doc); };
const item = (f: ReturnType<typeof renderDocumentAtTime>, id: string) => f.items.find((i) => i.id === id)!;

describe('step captions and highlighted boxes', () => {
  it('the current step lasts until the next one starts, and fades in', () => {
    const { doc, a1, a2, a3, a4 } = diagram(true, true);
    expect(currentStep(doc, inStep(doc, 0))!.ids).toEqual([a1.id]);
    expect(currentStep(doc, inStep(doc, 1))!.ids).toEqual([a2.id]);
    expect(currentStep(doc, inStep(doc, 2))!.ids.sort()).toEqual([a3.id, a4.id].sort());
    const start = playSchedule(doc).steps[1].start * L(doc);
    expect(currentStep(doc, start + 0.01)!.fade).toBeLessThan(0.2);
    expect(currentStep(doc, start + 0.5)!.fade).toBe(1);
  });

  it('captions show the playing step\'s labels, joined when arrows play together', () => {
    const { doc, a3, a4 } = diagram(true, false);
    expect(renderDocumentAtTime(doc, inStep(doc, 0)).caption).toEqual({ text: '1. ask', alpha: 1 });
    expect(renderDocumentAtTime(doc, inStep(doc, 1)).caption?.text).toBe('2. look up');
    expect(stepCaption(doc, [a3.id, a4.id])).toBe('3a. reply · 3b. log');
    expect(renderDocumentAtTime(doc, inStep(doc, 2)).caption?.text).toBe('3a. reply · 3b. log');
  });

  it('highlight: the step\'s shapes glow in its highlight colour, other shapes dim, containers stay', () => {
    const { doc, A, B, C, E, box, a1, a2 } = diagram(false, true);
    const f = renderDocumentAtTime(doc, inStep(doc, 0)); // step 1: A → B
    const hl = doc.animation.connector.highlightColor;
    const glows = (id: string) => item(f, id).parts.some((p) => p.k === 'line' && (p as { color: string }).color === hl);
    expect(glows(A.id) && glows(B.id)).toBe(true);
    expect(glows(C.id) || glows(E.id)).toBe(false);
    expect(item(f, A.id).opacity).toBe(A.style.opacity);
    expect(item(f, C.id).opacity).toBeCloseTo(C.style.opacity * (1 - STEP_DIM));
    expect(item(f, E.id).opacity).toBeCloseTo(E.style.opacity * (1 - STEP_DIM));
    expect(item(f, a1.id).opacity).toBe(a1.style.opacity); // the playing arrow isn't dimmed
    expect(item(f, a2.id).opacity).toBeLessThan(a2.style.opacity);
    expect(item(f, box.id).opacity).toBe(box.style.opacity);
    expect(f.caption).toBeUndefined(); // captions are a separate switch
  });

  it('both off: frames are exactly as before (no caption, nothing dimmed or glowing)', () => {
    const on = diagram(false, false);
    const t = inStep(on.doc, 1);
    const f = renderDocumentAtTime(on.doc, t);
    expect(f.caption).toBeUndefined();
    for (const el of [on.A, on.B, on.C, on.E]) expect(item(f, el.id).opacity).toBe(el.style.opacity);
    // turning the switches on and off again changes nothing
    const back = renderDocumentAtTime({ ...on.doc, animation: { ...on.doc.animation, captions: false, stepFocus: false } }, t);
    expect(JSON.stringify(back.items)).toBe(JSON.stringify(f.items));
  });

  it('the loop still joins up: the end of the loop shows the same caption, dimming and glows as the start', () => {
    const { doc } = diagram(true, true);
    const a = renderDocumentAtTime(doc, 0), b = renderDocumentAtTime(doc, L(doc));
    const look = (f: typeof a) => f.items.map((i) => [i.id, i.opacity.toFixed(6), i.parts.length]);
    expect(look(b)).toEqual(look(a));
    expect(b.caption).toEqual(a.caption);
  });

  it('the switches are saved, default to off, and older files open with them off', () => {
    const { doc } = diagram(true, true);
    const again = parseDocument(serializeDocument(doc)).doc;
    expect([again.animation.captions, again.animation.stepFocus]).toEqual([true, true]);
    expect([newDocument().animation.captions ?? false, newDocument().animation.stepFocus ?? false]).toEqual([false, false]);
    const raw = JSON.parse(serializeDocument(doc));
    raw.schemaVersion = 11; delete raw.animation.captions; delete raw.animation.stepFocus;
    const old = parseDocument(JSON.stringify(raw)).doc;
    expect([old.animation.captions, old.animation.stepFocus]).toEqual([false, false]);
    raw.animation.captions = 'yes';
    expect(parseDocument(JSON.stringify(raw)).doc.animation.captions).toBe(false);
  });
});
