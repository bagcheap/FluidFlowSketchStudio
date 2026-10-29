import { describe, expect, it } from 'vitest';
import { planGif, type GifSettings } from '../src/export/gif';
import { defaultToolStyle, makeShape, newDocument } from '../src/model/defaults';

const settings = (p: Partial<GifSettings>): GifSettings => ({
  width: 320, height: 0, fps: 15, duration: 4, loopCount: 0, background: '#fff', colors: 64,
  dither: false, globalPalette: true, seamless: true, fit: 'content', padding: 20, ...p,
});

describe('planGif', () => {
  const doc = { ...newDocument(), elements: [makeShape('roundRect', 0, 0, 100, 50, defaultToolStyle('shape:roundRect'))] };
  const total = (d: number[]) => d.reduce((a, b) => a + b, 0);

  it('plays a seamless loop in exactly its duration, even when duration × fps is fractional', () => {
    const plan = planGif(doc, settings({ duration: 2.5, fps: 15 })); // 37.5 frames -> 38
    expect(plan.frames).toBe(38);
    expect(total(plan.delaysCs)).toBe(250);
    expect(Math.max(...plan.delaysCs) - Math.min(...plan.delaysCs)).toBeLessThanOrEqual(1);
  });

  it('keeps the frame-rate spacing when not seamless', () => {
    const plan = planGif(doc, settings({ duration: 2, fps: 10, seamless: false }));
    expect(plan.delaysCs.every((d) => d === 10)).toBe(true);
  });
});
