import { describe, expect, it } from 'vitest';
import { spacingSnap, type Box } from '../src/editor/spacing';

const b = (x: number, y: number, w = 100, h = 60): Box => ({ x, y, w, h });

describe('equal-spacing guides', () => {
  it('snaps halfway between the neighbours on either side and marks both gaps', () => {
    // left 0..100, right 400..500; a 100-wide box fits halfway at 200 (gaps of 100 each side)
    const r = spacingSnap(b(204, 5), [b(0, 0), b(400, 10)], true, 6)!;
    expect(r.d).toBeCloseTo(-4);
    expect(r.marks.map((m) => [m.x1, m.x2, m.gap])).toEqual([[100, 200, 100], [300, 400, 100]]);
    expect(r.marks.every((m) => m.y1 === m.y2 && m.y1 > 0 && m.y1 < 70)).toBe(true); // across the shared row
  });

  it('repeats a gap that is already there: after the last box, or before the first', () => {
    const row = [b(0, 0), b(150, 0)]; // gap 50 between them
    const after = spacingSnap(b(297, 0), row, true, 6)!; // 250 + 50 = 300
    expect(after.d).toBeCloseTo(3);
    expect(after.marks.map((m) => [m.x1, m.x2])).toEqual([[250, 300], [100, 150]]); // the new gap and the existing one
    const before = spacingSnap(b(-148, 0), row, true, 6)!; // 0 - 50 - 100 = -150
    expect(before.d).toBeCloseTo(-2);
  });

  it('works up and down a column the same way', () => {
    const r = spacingSnap(b(0, 197), [b(0, 0, 100, 60), b(10, 400, 100, 60)], false, 6)!; // halfway: (60 + 400 - 60) / 2 = 200
    expect(r.d).toBeCloseTo(3);
    expect(r.marks.every((m) => m.x1 === m.x2)).toBe(true);
    expect(r.marks.map((m) => [m.y1, m.y2])).toEqual([[60, 200], [260, 400]]);
  });

  it('ignores boxes outside the row, and positions further away than the tolerance', () => {
    expect(spacingSnap(b(204, 500), [b(0, 0), b(400, 10)], true, 6)).toBeNull(); // not in the same row
    expect(spacingSnap(b(220, 5), [b(0, 0), b(400, 10)], true, 6)).toBeNull(); // 20 px off
    expect(spacingSnap(b(204, 5), [b(0, 0)], true, 6)).toBeNull(); // nothing to be equal to
  });

  it('picks the nearest of several candidates', () => {
    // existing gaps of 30 and 60; the box sits 58 px after the last box: 60 wins
    const row = [b(0, 0), b(130, 0), b(290, 0)];
    const r = spacingSnap(b(448, 0), row, true, 6)!;
    expect(r.d).toBeCloseTo(2);
    expect(r.marks[0].gap).toBe(60);
  });
});
