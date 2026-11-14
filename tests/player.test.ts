import { describe, expect, it } from 'vitest';
import { playSchedule } from '../src/engine/render';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { MAX_NOTE, parseDocument, serializeDocument } from '../src/model/schema';
import { setLink, setNote } from '../src/store/commands';
import { useDoc } from '../src/store/docStore';
import { addPage, deletePage, switchPage } from '../src/store/pages';
import { applyPlaySteps } from '../src/store/sequence';
import { nextSegment, prevStop, stepAt, stepStarts, stopAfter } from '../src/player/steps';
import type { FlowDocument } from '../src/model/types';

/** Four boxes in a row with arrows 1→2→3→4 playing in order. */
function ordered(): FlowDocument {
  const t = defaultToolStyle('shape:rectangle');
  const shapes = [0, 1, 2, 3].map((i) => makeShape('rectangle', i * 300, 0, 120, 60, t));
  const arrows = [0, 1, 2].map((i) => makeConnector({ x: 0, y: 0, elementId: shapes[i].id }, { x: 0, y: 0, elementId: shapes[i + 1].id }, { ...defaultToolStyle('arrow'), routing: 'straight' as const }));
  const doc = applyPlaySteps({ ...newDocument(), elements: [...shapes, ...arrows] }, arrows.map((a) => [a.id]));
  return { ...doc, animation: { ...doc.animation, duration: Math.ceil(playSchedule(doc).seconds * 10) / 10 } };
}

describe('interactive player: stepping', () => {
  it('Next plays one step at a time and pauses before the following one; after the last it starts again', () => {
    const doc = ordered();
    const starts = stepStarts(doc);
    expect(starts.length).toBe(3);
    let t = 0;
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      const s = nextSegment(doc, t)!;
      expect(s.from).toBe(t);
      expect(s.to).toBeGreaterThan(s.from);
      t = s.to;
      seen.push(stepAt(doc, t)); // paused showing the step that just played
      if (i < 2) expect(t).toBeLessThan(starts[i + 1]); // the next one hasn't started
    }
    expect(seen).toEqual([0, 1, 2]);
    expect(t).toBeLessThan(doc.animation.duration);
    // after the last step: back to the start and play the first one again
    expect(nextSegment(doc, t)).toEqual({ from: 0, to: stopAfter(doc, 0) });
  });

  it('mid-step, Next finishes that step; Previous goes back to the pause before it, then further back', () => {
    const doc = ordered();
    const starts = stepStarts(doc);
    const mid = (starts[1] + starts[2]) / 2 - 0.2; // during step 2
    expect(nextSegment(doc, mid)).toEqual({ from: mid, to: stopAfter(doc, 1) });
    expect(prevStop(doc, mid)).toBe(stopAfter(doc, 0));
    expect(prevStop(doc, stopAfter(doc, 1))).toBe(stopAfter(doc, 0));
    expect(prevStop(doc, stopAfter(doc, 0))).toBe(0);
    expect(prevStop(doc, 0)).toBe(0);
  });

  it('without a play order there is nothing to step through', () => {
    const doc = { ...newDocument(), elements: [makeShape('rectangle', 0, 0, 100, 60, defaultToolStyle('shape:rectangle'))] };
    expect(stepStarts(doc)).toEqual([]);
    expect(nextSegment(doc, 0)).toBeNull();
  });
});

describe('interactive player: page links and hover notes', () => {
  function twoPages() {
    let doc: FlowDocument = { ...newDocument(), elements: [makeShape('rectangle', 0, 0, 100, 60, defaultToolStyle('shape:rectangle'))] };
    doc = addPage(doc, 'Detail');
    const detail = doc.pages[1].id, overview = doc.pages[0].id;
    doc = switchPage(doc, overview);
    return { doc, detail, overview, shape: doc.elements[0] };
  }

  it('are saved with the file and read back; notes are plain text, capped in length', () => {
    const { doc, detail, shape } = twoPages();
    const d = { ...doc, elements: doc.elements.map((e) => (e.id === shape.id ? { ...e, link: detail, note: 'Owns the\ntoken\u0007 cache‮' } : e)) };
    const back = parseDocument(serializeDocument(d)).doc.elements[0];
    expect(back.link).toBe(detail);
    expect(back.note).toBe('Owns the\ntoken cache'); // line break kept, control and bidi characters gone
    const long = { ...doc, elements: doc.elements.map((e) => ({ ...e, note: 'x'.repeat(5000) })) };
    expect(parseDocument(serializeDocument(long)).doc.elements[0].note!.length).toBe(MAX_NOTE);
    // not strings, or empty: nothing
    const odd = JSON.parse(serializeDocument(doc));
    odd.pages[0].elements[0].note = { html: '<b>x</b>' }; odd.pages[0].elements[0].link = 42;
    const e = parseDocument(JSON.stringify(odd)).doc.elements[0];
    expect(e.note).toBeUndefined(); expect(e.link).toBeUndefined();
  });

  it('a link must go to another page of the same file', () => {
    const { doc, overview, shape } = twoPages();
    for (const link of ['page_nowhere', overview]) {
      const d = { ...doc, elements: doc.elements.map((e) => (e.id === shape.id ? { ...e, link } : e)) };
      const r = parseDocument(serializeDocument(d));
      expect(r.doc.elements[0].link).toBeUndefined();
      expect(r.warnings.some((w) => /link/.test(w))).toBe(true);
    }
  });

  it('set from the Inspector (one undo step each); deleting the page removes links to it; older files open', () => {
    const { doc, detail, shape } = twoPages();
    useDoc.getState().replace(() => doc);
    setLink([shape.id], detail);
    expect(useDoc.getState().doc.elements[0].link).toBe(detail);
    setLink([shape.id], useDoc.getState().doc.activePage); // its own page: no link
    expect(useDoc.getState().doc.elements[0].link).toBeUndefined();
    useDoc.getState().undo();
    expect(useDoc.getState().doc.elements[0].link).toBe(detail);
    setNote([shape.id], 'Hello ');
    expect(useDoc.getState().doc.elements[0].note).toBe('Hello '); // a trailing space survives typing
    setNote([shape.id], '   ');
    expect(useDoc.getState().doc.elements[0].note).toBeUndefined();
    const gone = deletePage(useDoc.getState().doc, detail);
    expect(gone.elements[0].link).toBeUndefined();
    const v13 = JSON.parse(serializeDocument(doc));
    v13.schemaVersion = 13;
    expect(parseDocument(JSON.stringify(v13)).doc.elements[0].link).toBeUndefined();
  });
});
