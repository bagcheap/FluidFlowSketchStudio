import { describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, newDocument } from '../src/model/defaults';
import { highlightTrain, playSchedule, renderDocumentAtTime } from '../src/engine/render';
import type { ConnectorElement } from '../src/model/types';

const HL = '#3b82f6';
function arrowDoc(length: number, anim: Partial<ConnectorElement['anim']>) {
  const d = newDocument('t');
  const c = makeConnector({ x: 0, y: 0, elementId: null, anchor: null }, { x: length, y: 0, elementId: null, anchor: null }, { ...defaultToolStyle('arrow'), routing: 'straight' });
  c.anim = { mode: 'travel', ...anim };
  d.elements = [c];
  return d;
}
/** The highlight bars drawn at time t (solid lines in the highlight colour), as [from x, to x]. */
function bars(d: ReturnType<typeof arrowDoc>, t: number) {
  return renderDocumentAtTime(d, t).items[0].parts
    .filter((p) => p.k === 'line' && p.color === HL && p.alpha >= 0.99)
    .map((p) => { const xs = (p as { pts: number[] }).pts.filter((_, i) => i % 2 === 0); return [Math.min(...xs), Math.max(...xs)]; })
    .sort((a, b) => a[0] - b[0]);
}

describe('Segments', () => {
  it('looping: n separate highlights, even on a short arrow with long highlights', () => {
    expect(bars(arrowDoc(600, { segments: 4 }), 0.3).length).toBeGreaterThanOrEqual(3);
    const short = bars(arrowDoc(120, { segments: 4, highlightLength: 120 }), 0.37);
    expect(short.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < short.length; i++) expect(short[i][0]).toBeGreaterThan(short[i - 1][1] + 1); // gaps between them
  });

  it('in a play step: a train of n highlights following each other; the step lasts until the last arrives', () => {
    const one = arrowDoc(600, { segments: 1, window: [0, 0.85] });
    const four = arrowDoc(600, { segments: 4, window: [0, 0.85] });
    const s1 = playSchedule(one).seconds, s4 = playSchedule(four).seconds;
    expect(s4).toBeGreaterThan(s1);
    const { total, gap } = highlightTrain(600, 36, 4);
    expect(total).toBe(600 + 36 + 3 * gap);
    // part-way through the step all four are on the arrow, one behind the other
    const L = four.animation.duration;
    let most = 0;
    for (let k = 1; k < 40; k++) most = Math.max(most, bars(four, (k / 40) * L * 0.85).length);
    expect(most).toBe(4);
    expect(Math.max(...Array.from({ length: 39 }, (_, k) => bars(one, ((k + 1) / 40) * L * 0.85).length))).toBe(1);
  });
});
