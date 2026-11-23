import { beforeEach, describe, expect, it } from 'vitest';
import { useDoc } from '../src/store/docStore';
import { useUI } from '../src/store/uiStore';
import { setAnimation, setGlobalArrow } from '../src/store/commands';
import { GLOW_SPREAD, playSchedule, renderDocumentAtTime } from '../src/engine/render';
import { defaultToolStyle, makeConnector, newDocument } from '../src/model/defaults';
import { parseDocument, serializeDocument } from '../src/model/schema';
import type { ConnectorElement, FlowDocument } from '../src/model/types';

const D = () => useDoc.getState();
const arrow = (x: number, anim?: ConnectorElement['anim']) => {
  const c = makeConnector({ x, y: 0, elementId: null, anchor: null }, { x: x + 400, y: 0, elementId: null, anchor: null }, { ...defaultToolStyle('arrow'), routing: 'straight' });
  if (anim) c.anim = anim; else delete c.anim;
  return c;
};
const conn = (id: string) => D().doc.elements.find((e) => e.id === id) as ConnectorElement;

describe('Arrow highlight (all arrows)', () => {
  beforeEach(() => {
    D().load(newDocument());
    useUI.setState((s) => ({ prefs: { ...s.prefs, toolStyles: {} } }));
  });

  it('sets the document default and replaces every arrow\'s own value (not locked ones, not other settings)', () => {
    const own = arrow(0, { highlightColor: '#ef4444', segments: 3 });
    const plain = arrow(0);
    const locked = { ...arrow(0, { highlightColor: '#ef4444' }), locked: true };
    const still = arrow(0, { mode: 'none' }); // a lifeline-like arrow that doesn't animate
    D().commit((d) => ({ ...d, elements: [own, plain, locked, still] }));
    const before = D().past.length;
    setGlobalArrow({ highlightColor: '#22c55e' });
    expect(D().doc.animation.connector.highlightColor).toBe('#22c55e');
    expect(conn(own.id).anim).toEqual({ segments: 3 }); // only the colour was replaced
    expect(conn(plain.id).anim).toBeUndefined();
    expect(conn(locked.id).anim).toEqual({ highlightColor: '#ef4444' });
    expect(conn(still.id).anim).toEqual({ mode: 'none' });
    setGlobalArrow({ highlightColor: '#3b82f6' }); // a second change while dragging the picker: same undo step
    expect(D().past.length).toBe(before + 1);
    D().undo();
    expect(conn(own.id).anim).toEqual({ highlightColor: '#ef4444', segments: 3 });
  });

  it('reaches arrows on other pages, and new arrows (the arrow tool forgets that setting)', () => {
    const other = arrow(0, { highlightWidth: 6 });
    D().commit((d) => ({ ...d, pages: [...d.pages, { id: 'p2', name: 'Two', elements: [other] }] }));
    useUI.getState().setToolStyle('arrow', { ...defaultToolStyle('arrow'), connectorAnim: { highlightWidth: 6, speed: 2 } });
    setGlobalArrow({ highlightWidth: 3 });
    const p2 = D().doc.pages.find((p) => p.id === 'p2')!;
    expect((p2.elements[0] as ConnectorElement).anim).toBeUndefined();
    expect(useUI.getState().prefs.toolStyles.arrow.connectorAnim).toEqual({ speed: 2 });
  });

  it('thickness: the highlight is that much thicker than the line, and its glow follows', () => {
    const c = arrow(0);
    const doc: FlowDocument = { ...newDocument(), elements: [c] };
    const highlight = (d: FlowDocument) => renderDocumentAtTime(d, 0.3).items[0].parts.filter((p) => p.k === 'line' && p.color === d.animation.connector.highlightColor);
    const base = highlight(doc);
    expect(Math.max(...base.map((p) => (p as { width: number }).width))).toBeCloseTo(c.style.strokeWidth + GLOW_SPREAD + 1.5); // glow around a 1.5 px-thicker highlight
    const thick: FlowDocument = { ...doc, animation: { ...doc.animation, connector: { ...doc.animation.connector, highlightWidth: 6 } } };
    const widths = highlight(thick).map((p) => (p as { width: number }).width);
    expect(widths).toContain(c.style.strokeWidth + 6);
    expect(Math.max(...widths)).toBeCloseTo(c.style.strokeWidth + 6 + GLOW_SPREAD);
  });

  it('arrow speed also sets how fast arrows playing in order move', () => {
    const c = arrow(0, { window: [0, 0.85] });
    D().commit((d) => ({ ...d, elements: [c] }));
    const slow = playSchedule(D().doc).seconds;
    setAnimation({ arrowSpeedScale: 2 });
    expect(playSchedule(D().doc).seconds).toBeLessThan(slow);
    expect(D().doc.animation.duration).toBeCloseTo(Math.ceil(playSchedule(D().doc).seconds * 10) / 10, 5); // loop refitted
  });

  it('files: thickness is saved and read back; older files get the thickness they always had', () => {
    const doc = { ...newDocument(), animation: { ...newDocument().animation, connector: { ...newDocument().animation.connector, highlightWidth: 4 } } };
    expect(parseDocument(serializeDocument(doc)).doc.animation.connector.highlightWidth).toBe(4);
    const old = JSON.parse(serializeDocument(newDocument()));
    old.schemaVersion = 16; delete old.animation.connector.highlightWidth;
    const r = parseDocument(JSON.stringify(old)).doc;
    expect(r.schemaVersion).toBe(19);
    expect(r.animation.connector.highlightWidth).toBe(1.5);
  });
});

describe('Glow, opacity, pause between steps, caption style', () => {
  beforeEach(() => { D().load(newDocument()); useUI.setState((s) => ({ prefs: { ...s.prefs, toolStyles: {} } })); });

  it('glow and opacity are all-arrows settings too', () => {
    const own = arrow(0, { glow: true, highlightOpacity: 0.4 });
    D().commit((d) => ({ ...d, elements: [own] }));
    setGlobalArrow({ glow: false });
    setGlobalArrow({ highlightOpacity: 0.6 });
    expect(conn(own.id).anim).toBeUndefined();
    const parts = renderDocumentAtTime(D().doc, 0.3).items[0].parts.filter((p) => p.k === 'line' && p.color === D().doc.animation.connector.highlightColor);
    expect(parts.length).toBe(1); // no glow strokes, just the highlight
    expect((parts[0] as { alpha: number }).alpha).toBeCloseTo(0.6);
  });

  it('pause between steps: longer steps, loop refitted; caption size and position reach the frame', () => {
    const a = arrow(0, { window: [0, 0.4] }), b = arrow(0, { window: [0.4, 0.85] });
    a.text = '1. ask'; b.text = '2. answer';
    D().commit((d) => ({ ...d, elements: [a, b], animation: { ...d.animation, captions: true } }));
    const short = playSchedule(D().doc).seconds;
    setAnimation({ stepPause: 2 });
    expect(playSchedule(D().doc).seconds).toBeCloseTo(short + 2 * (2 - 0.35), 5);
    expect(D().doc.animation.duration).toBeCloseTo(Math.ceil(playSchedule(D().doc).seconds * 10) / 10, 5);
    setAnimation({ captionSize: 'large', captionPosition: 'top' });
    const f = renderDocumentAtTime(D().doc, 0.2);
    expect(f.caption).toMatchObject({ text: '1. ask', size: 'large', position: 'top' });
    const saved = parseDocument(serializeDocument(D().doc)).doc.animation;
    expect(saved).toMatchObject({ stepPause: 2, captionSize: 'large', captionPosition: 'top' });
  });
});
