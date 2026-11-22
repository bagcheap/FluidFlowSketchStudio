import { beforeEach, describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeShape, makeText, newDocument } from '../src/model/defaults';
import { applyThemeToDoc, THEMES, themeToolStyle } from '../src/store/themes';
import { useDoc } from '../src/store/docStore';
import { useUI } from '../src/store/uiStore';
import { applyTheme, motionLevelOf, setGlobalArrow, setMotionLevel } from '../src/store/commands';
import type { ConnectorElement, ShapeElement } from '../src/model/types';

const blueprint = THEMES.find((t) => t.id === 'blueprint')!;
const shape = (fill: string, extra: Partial<ShapeElement> = {}) => {
  const s = makeShape('rectangle', 0, 0, 100, 60, defaultToolStyle('shape:rectangle'));
  return { ...s, style: { ...s.style, fill, fillStyle: 'solid' as const }, ...extra };
};

describe('Diagram themes', () => {
  it('recolours background, grid, shapes, text and arrows on every page; fills keep their variety', () => {
    const red = shape('#ffc9c9'), blue = shape('#a5d8ff'), red2 = shape('#ffc9c9');
    const clear = { ...shape('transparent'), style: { ...shape('x').style, fill: 'transparent', fillStyle: 'none' as const, stroke: 'transparent' } };
    const locked = { ...shape('#ffc9c9'), locked: true };
    const arrow = makeConnector({ x: 0, y: 0, elementId: red.id, anchor: null }, { x: 0, y: 0, elementId: blue.id, anchor: null }, defaultToolStyle('arrow'));
    arrow.anim = { highlightColor: '#ef4444', segments: 2 };
    const label = makeText(0, 0, 'note', defaultToolStyle('text'));
    const other = shape('#d3f9d8');
    const d = { ...newDocument(), elements: [red, blue, red2, clear, locked, arrow, label] };
    d.pages = [...d.pages, { id: 'p2', name: 'Two', elements: [other] }];
    const r = applyThemeToDoc(d, blueprint);
    expect(r.canvas).toMatchObject({ background: blueprint.background, grid: blueprint.grid });
    const by = (id: string) => [...r.elements, ...r.pages.flatMap((p) => p.elements)].find((e) => e.id === id)!;
    expect(by(red.id).style.fill).toBe(blueprint.fills[0]);
    expect(by(blue.id).style.fill).toBe(blueprint.fills[1]);
    expect(by(red2.id).style.fill).toBe(blueprint.fills[0]); // same colour before, same colour after
    expect(by(other.id).style.fill).toBe(blueprint.fills[2]); // other pages too
    expect(by(red.id).style.stroke).toBe(blueprint.stroke);
    expect(by(red.id).textStyle.color).toBe(blueprint.text);
    expect(by(clear.id).style).toMatchObject({ fill: 'transparent', stroke: 'transparent' }); // see-through stays
    expect(by(locked.id).style.fill).toBe('#ffc9c9'); // locked stays
    const a = by(arrow.id) as ConnectorElement;
    expect(a.style.stroke).toBe(blueprint.arrow);
    expect(a.anim).toEqual({ segments: 2 }); // its own highlight colour gives way to the theme's
    expect(r.animation.connector).toMatchObject({ highlightColor: blueprint.highlight, returnColor: blueprint.ret });
    expect(by(label.id).textStyle.color).toBe(blueprint.text);
  });

  it('tool styles follow, so new shapes and arrows match', () => {
    const s = themeToolStyle('shape:rectangle', defaultToolStyle('shape:rectangle'), blueprint);
    expect(s.style).toMatchObject({ stroke: blueprint.stroke, fill: blueprint.fills[0] });
    expect(s.textStyle.color).toBe(blueprint.text);
    const a = themeToolStyle('arrow', { ...defaultToolStyle('arrow'), connectorAnim: { highlightColor: '#ef4444', speed: 2 } }, blueprint);
    expect(a.style.stroke).toBe(blueprint.arrow);
    expect(a.connectorAnim).toEqual({ speed: 2 });
  });

  describe('commands', () => {
    beforeEach(() => { useDoc.getState().load(newDocument()); useUI.setState((s) => ({ prefs: { ...s.prefs, toolStyles: {} } })); });

    it('applyTheme is one undo step and sets every tool\'s colours', () => {
      const s = shape('#ffc9c9');
      useDoc.getState().commit((d) => ({ ...d, elements: [s] }));
      const before = useDoc.getState().past.length;
      applyTheme('dark');
      expect(useDoc.getState().past.length).toBe(before + 1);
      expect(useDoc.getState().doc.canvas.background).toBe(THEMES.find((t) => t.id === 'dark')!.background);
      expect(useUI.getState().toolStyle('shape:ellipse').style.stroke).toBe(THEMES.find((t) => t.id === 'dark')!.stroke);
      useDoc.getState().undo();
      expect(useDoc.getState().doc.elements[0].style.fill).toBe('#ffc9c9');
    });

    it('shape motion levels: still, calm, natural, lively', () => {
      expect(motionLevelOf(useDoc.getState().doc.animation)).toBe('still'); // new diagrams start still
      setMotionLevel('lively');
      const a = useDoc.getState().doc.animation;
      expect(a.shape.mode).toBe('combined');
      expect([a.intensityScale, a.speedScale]).toEqual([1.8, 1.4]);
      expect(motionLevelOf(a)).toBe('lively');
      setMotionLevel('calm');
      expect(motionLevelOf(useDoc.getState().doc.animation)).toBe('calm');
      setMotionLevel('still');
      expect(useDoc.getState().doc.animation.shape.mode).toBe('off');
    });

    it('round-trip pause is an all-arrows setting', () => {
      const c = makeConnector({ x: 0, y: 0, elementId: null, anchor: null }, { x: 300, y: 0, elementId: null, anchor: null }, defaultToolStyle('arrow'));
      c.anim = { direction: 'roundTrip', turnPause: 0.4 };
      useDoc.getState().commit((d) => ({ ...d, elements: [c] }));
      setGlobalArrow({ turnPause: 0.2 });
      expect(useDoc.getState().doc.animation.connector.turnPause).toBe(0.2);
      expect((useDoc.getState().doc.elements[0] as ConnectorElement).anim).toEqual({ direction: 'roundTrip' });
    });
  });
});
