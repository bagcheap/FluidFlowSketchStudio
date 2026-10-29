import { beforeEach, describe, expect, it } from 'vitest';
import { deleteElements, mapElements, useDoc } from '../src/store/docStore';
import { useUI } from '../src/store/uiStore';
import { applyStyle, cloneElements, copySelection, flip, paste, swapDirection } from '../src/store/commands';
import { connectorPath } from '../src/engine/connectors';
import { makeLookup, renderDocumentAtTime } from '../src/engine/render';
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

describe('cloning (duplicate / paste / Alt-drag)', () => {
  it('gives copies their own group, unlocks them and remaps internal connections', () => {
    const a = makeShape('roundRect', 0, 0, 100, 50, defaultToolStyle('shape:roundRect'));
    const b = makeShape('roundRect', 300, 0, 100, 50, defaultToolStyle('shape:roundRect'));
    a.groupIds = ['grp1']; b.groupIds = ['grp1']; a.locked = true;
    const c = makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 0, y: 0, elementId: b.id }, defaultToolStyle('arrow'));
    c.groupIds = ['grp1'];
    const doc = { ...newDocument(), elements: [a, b, c] };
    const [ca, cb, cc] = cloneElements(doc, [a, b, c], 0, 0);
    expect(ca.groupIds).toEqual(cb.groupIds);
    expect(ca.groupIds[0]).not.toBe('grp1');
    expect(ca.locked).toBe(false);
    expect(ca.id).not.toBe(a.id);
    expect((cc as typeof c).start.elementId).toBe(ca.id);
    expect((cc as typeof c).end.elementId).toBe(cb.id);
  });
});

describe('Edit ▸ Paste (no clipboard event)', () => {
  let systemText = '';
  let writeOk = true;
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (t: string) => { if (!writeOk) throw new Error('denied'); systemText = t; },
        readText: async () => systemText,
      },
    });
    const s = makeShape('roundRect', 0, 0, 100, 50, defaultToolStyle('shape:roundRect'));
    D().load({ ...newDocument(), elements: [s] });
    useUI.getState().select([s.id]);
  });

  it('pastes text copied in another app after copying shapes here', async () => {
    writeOk = true;
    copySelection();
    await Promise.resolve();
    systemText = 'from another app';
    await paste();
    expect(D().doc.elements.map((e) => e.text)).toContain('from another app');
  });

  it('falls back to the copied shapes when they never reached the system clipboard', async () => {
    writeOk = false; systemText = 'older text';
    copySelection();
    await Promise.resolve();
    await paste();
    const els = D().doc.elements;
    expect(els.length).toBe(2);
    expect(els.every((e) => e.type === 'shape')).toBe(true);
  });
});

describe('locked objects', () => {
  it('are not changed by paste style or flip', () => {
    const a = makeShape('triangle', 0, 0, 100, 50, defaultToolStyle('shape:triangle'));
    const b = makeShape('triangle', 200, 0, 100, 50, defaultToolStyle('shape:triangle'));
    a.locked = true;
    D().load({ ...newDocument(), elements: [a, b] });
    useUI.getState().select([a.id, b.id]);
    const red = { ...defaultToolStyle('shape:triangle') };
    red.style = { ...red.style, stroke: '#e03131' };
    applyStyle([a.id, b.id], red);
    flip('h');
    const [la, lb] = D().doc.elements as typeof a[];
    expect(la).toEqual(a);
    expect(lb.style.stroke).toBe('#e03131');
    expect(lb.flipX).toBe(true);
  });
});

describe('swap arrow direction', () => {
  const setup = () => {
    const a = makeShape('roundRect', 0, 0, 100, 50, defaultToolStyle('shape:roundRect'));
    const b = makeShape('roundRect', 400, 200, 100, 50, defaultToolStyle('shape:roundRect'));
    const c = makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 0, y: 0, elementId: b.id }, defaultToolStyle('arrow'));
    c.curvature = 0.4; c.labelPos = 0.3; c.labelOffset = 18; c.text = 'Request';
    D().load({ ...newDocument(), elements: [a, b, c] });
    return c;
  };
  const labelAt = () => {
    const doc = D().doc;
    const c = doc.elements[2];
    const item = renderDocumentAtTime(doc, 0, { flags: { still: true } }).items.find((i) => i.id === c.id + ':label')!;
    return (item.parts.find((p) => p.k === 'text') as { lines: { x: number; y: number }[] }).lines[0];
  };

  it('reverses the arrow but keeps its curve and label in place', () => {
    const c = setup();
    const before = connectorPath(c, makeLookup(D().doc, null)).pts;
    const label = labelAt();
    swapDirection([c.id]);
    const s = D().doc.elements[2] as typeof c;
    expect(s.start.elementId).toBe(c.end.elementId);
    expect(s.end.elementId).toBe(c.start.elementId);
    const after = connectorPath(s, makeLookup(D().doc, null)).pts;
    expect(after[0].x).toBeCloseTo(before[before.length - 1].x, 6);
    expect(after[0].y).toBeCloseTo(before[before.length - 1].y, 6);
    const mid = (pts: typeof before) => pts[Math.floor(pts.length / 2)];
    expect(Math.hypot(mid(after).x - mid(before).x, mid(after).y - mid(before).y)).toBeLessThan(3); // same bulge
    expect(labelAt().x).toBeCloseTo(label.x, 1);
    expect(labelAt().y).toBeCloseTo(label.y, 1);
    expect(D().past.length).toBe(1);
  });

  it('never stores -0 and leaves locked arrows alone', () => {
    const c = setup();
    D().commit((d) => mapElements(d, [c.id], (e) => ({ ...e, curvature: 0, labelOffset: 0 })));
    swapDirection([c.id]);
    const s = D().doc.elements[2] as typeof c;
    expect(Object.is(s.curvature, -0) || Object.is(s.labelOffset, -0)).toBe(false);
    D().commit((d) => mapElements(d, [c.id], (e) => ({ ...e, locked: true })));
    const locked = D().doc.elements[2];
    swapDirection([c.id]);
    expect(D().doc.elements[2]).toBe(locked);
  });
});
