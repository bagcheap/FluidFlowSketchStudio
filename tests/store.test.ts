import { beforeEach, describe, expect, it } from 'vitest';
import { deleteElements, mapElements, useDoc } from '../src/store/docStore';
import { useUI } from '../src/store/uiStore';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';

const D = () => useDoc.getState();

describe('history', () => {
  beforeEach(() => D().load(newDocument()));

  it('groups a drag into one undo step and coalesces rapid slider edits', () => {
    const s = makeShape('roundRect', 0, 0, 100, 50, defaultToolStyle('shape:roundRect'));
    D().commit((d) => ({ ...d, elements: [s] }));
    D().begin();
    for (let i = 1; i <= 50; i++) D().live((d) => mapElements(d, [s.id], (e) => ({ ...e, x: i })));
    D().end();
    expect(D().past.length).toBe(2);
    for (let w = 1; w <= 20; w++) D().commit((d) => mapElements(d, [s.id], (e) => ({ ...e, style: { ...e.style, strokeWidth: w } })), 'stroke');
    expect(D().past.length).toBe(3);
    D().undo();
    expect(D().doc.elements[0].style.strokeWidth).toBe(2);
    expect(D().doc.elements[0].x).toBe(50);
    D().undo();
    expect(D().doc.elements[0].x).toBe(0);
    D().redo(); D().redo();
    expect(D().doc.elements[0].style.strokeWidth).toBe(20);
  });

  it('cancel restores the pre-interaction document without a history entry', () => {
    D().begin();
    D().live((d) => ({ ...d, title: 'temp' }));
    D().cancel();
    expect(D().doc.title).toBe('Untitled diagram');
    expect(D().past.length).toBe(0);
  });
});

describe('deleting shapes', () => {
  it('detaches connectors rather than leaving dangling references', () => {
    const a = makeShape('roundRect', 0, 0, 100, 50, defaultToolStyle('shape:roundRect'));
    const b = makeShape('roundRect', 300, 0, 100, 50, defaultToolStyle('shape:roundRect'));
    const c = makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 0, y: 0, elementId: b.id }, defaultToolStyle('arrow'));
    const doc = deleteElements({ ...newDocument(), elements: [a, b, c] }, new Set([a.id]));
    const cc = doc.elements.find((e) => e.id === c.id) as typeof c;
    expect(cc.start.elementId).toBeNull();
    expect(cc.start.x).toBe(50);
    expect(cc.end.elementId).toBe(b.id);
  });
});

describe('remembered tool styles', () => {
  it('keeps separate defaults per tool and supports a shared style', () => {
    const u = useUI.getState();
    const r = u.toolStyle('shape:rectangle');
    u.setToolStyle('shape:rectangle', { ...r, style: { ...r.style, stroke: '#1971c2' } });
    const d = u.toolStyle('shape:diamond');
    u.setToolStyle('shape:diamond', { ...d, style: { ...d.style, stroke: '#e03131' } });
    expect(useUI.getState().toolStyle('shape:rectangle').style.stroke).toBe('#1971c2');
    expect(useUI.getState().toolStyle('shape:diamond').style.stroke).toBe('#e03131');
    useUI.getState().updatePrefs({ sharedStyles: true, sharedStyle: useUI.getState().toolStyle('shape:diamond') });
    expect(useUI.getState().toolStyle('shape:ellipse').style.stroke).toBe('#e03131');
    useUI.getState().updatePrefs({ sharedStyles: false });
    expect(useUI.getState().toolStyle('shape:rectangle').style.stroke).toBe('#1971c2');
  });
});
