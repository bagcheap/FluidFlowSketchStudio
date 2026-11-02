import { beforeEach, describe, expect, it } from 'vitest';
import { cycleFill, defaultToolStyle, HUES, makeShape, newDocument, nextFillColor } from '../src/model/defaults';
import { cycleKeyHeld } from '../src/ui/modifiers';
import { useDoc } from '../src/store/docStore';
import { useUI } from '../src/store/uiStore';
import { addContainer } from '../src/store/commands';

describe('Cmd fill cycling', () => {
  it('steps to the next hue in the same strength row and wraps around', () => {
    expect(nextFillColor('#fff3bf')).toBe('#d3f9d8'); // pale yellow → pale green
    expect(nextFillColor('#FFF3BF')).toBe('#d3f9d8');
    expect(nextFillColor(HUES.tint[9])).toBe(HUES.tint[0]); // pale pink → pale red
    expect(nextFillColor(HUES.bold[2])).toBe(HUES.bold[3]);
    expect(nextFillColor(HUES.deep[9])).toBe(HUES.deep[0]);
  });

  it('starts at pale red from white, greys, custom colours and no fill', () => {
    for (const c of ['#ffffff', '#e9ecef', '#123456', 'transparent']) expect(nextFillColor(c)).toBe(HUES.tint[0]);
  });

  it('turns no fill into a solid fill and leaves the rest of the style alone', () => {
    const ts = defaultToolStyle('shape:rectangle');
    const none = { ...ts, style: { ...ts.style, fill: 'transparent', fillStyle: 'none' as const } };
    const c = cycleFill(none);
    expect(c.style).toEqual({ ...none.style, fill: HUES.tint[0], fillStyle: 'solid' });
    const hatch = { ...ts, style: { ...ts.style, fill: '#fff3bf', fillStyle: 'hachure' as const } };
    expect(cycleFill(hatch).style.fillStyle).toBe('hachure');
  });

  describe('Add container with Ctrl held', () => {
    beforeEach(() => {
      useDoc.getState().load(newDocument());
      useUI.getState().updatePrefs({ toolStyles: {} });
    });
    it('uses and remembers the next fill colour; without Ctrl the remembered colour is reused', () => {
      const a = makeShape('rectangle', 0, 0, 100, 60, defaultToolStyle('shape:rectangle'));
      useDoc.getState().commit((d) => ({ ...d, elements: [a] }));
      const before = useUI.getState().toolStyle('container').style.fill;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
      expect(cycleKeyHeld()).toBe(true);
      useUI.getState().select([a.id]);
      addContainer();
      const fill1 = useUI.getState().toolStyle('container').style.fill;
      expect(fill1).toBe(nextFillColor(before));
      const c1 = useDoc.getState().doc.elements.find((e) => e.type === 'container')!;
      expect(c1.style.fill).toBe(fill1);
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', ctrlKey: false }));
      expect(cycleKeyHeld()).toBe(false);
      useUI.getState().select([a.id]);
      addContainer();
      expect(useUI.getState().toolStyle('container').style.fill).toBe(fill1);
    });
  });
});
