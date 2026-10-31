import { beforeEach, describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { fitToContents, moveElements, parentOf, removeContainer, updateMembership, withMembers, wrapInContainer, CONTAINER_PAD } from '../src/store/containers';
import { containerHeader, renderDocumentAtTime } from '../src/engine/render';
import { hitTest } from '../src/editor/hitTest';
import { parseDocument, serializeDocument } from '../src/model/schema';
import { useDoc } from '../src/store/docStore';
import { useUI } from '../src/store/uiStore';
import { deleteSelection, duplicateSelection, resetToolStyle } from '../src/store/commands';
import type { ContainerElement, FlowDocument } from '../src/model/types';

const box = (x: number, y: number) => makeShape('roundRect', x, y, 100, 60, defaultToolStyle('shape:roundRect'));
const tool = defaultToolStyle('container');
const get = (d: FlowDocument, id: string) => d.elements.find((e) => e.id === id)!;

function setup() {
  const a = box(100, 100), b = box(300, 100), lone = box(800, 100);
  const arrow = makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 0, y: 0, elementId: b.id }, defaultToolStyle('arrow'));
  const doc = { ...newDocument(), elements: [a, b, lone, arrow] };
  const r = wrapInContainer(doc, [a.id, b.id], tool, 'Payments')!;
  return { doc: r.doc, c: get(r.doc, r.id) as ContainerElement, a, b, lone, arrow };
}

describe('containers', () => {
  it('wraps the selection with padding and a title bar, behind its members', () => {
    const { doc, c, a, b } = setup();
    expect(c).toMatchObject({ type: 'container', text: 'Payments', members: [a.id, b.id] });
    // members' bounds include their stroke (2px); the container adds padding, and a title bar on top
    expect(c.x).toBeCloseTo(100 - 2 - CONTAINER_PAD, 5);
    expect(c.x + c.w).toBeCloseTo(400 + 2 + CONTAINER_PAD, 5);
    expect(c.y).toBeCloseTo(100 - 2 - CONTAINER_PAD - containerHeader(c), 5);
    expect(c.y + c.h).toBeCloseTo(160 + 2 + CONTAINER_PAD, 5);
    expect(doc.elements.findIndex((e) => e.id === c.id)).toBeLessThan(doc.elements.findIndex((e) => e.id === a.id));
  });

  it('moves its members, joins shapes dropped inside, lets them leave, and grows to fit', () => {
    const { doc, c, a, lone } = setup();
    const moved = moveElements(doc, new Set(withMembers(doc, [c.id])), 50, 20);
    expect(get(moved, a.id)).toMatchObject({ x: 150, y: 120 });
    // a shape dropped inside joins; one dragged out leaves
    let d = updateMembership({ ...doc, elements: doc.elements.map((e) => (e.id === lone.id ? { ...e, x: 180, y: 110 } : e)) }, [lone.id]);
    expect(parentOf(d, lone.id)?.id).toBe(c.id);
    d = updateMembership({ ...d, elements: d.elements.map((e) => (e.id === a.id ? { ...e, x: 1200, y: 600 } : e)) }, [a.id]);
    expect(parentOf(d, a.id)).toBeUndefined();
    // a member that sticks out makes the container grow
    const grown = updateMembership({ ...doc, elements: doc.elements.map((e) => (e.id === a.id ? { ...e, w: 400 } : e)) }, [a.id]);
    const g = get(grown, c.id);
    expect(g.x + g.w).toBeGreaterThanOrEqual(100 + 400 + CONTAINER_PAD);
  });

  it('nests, fits to contents, and removes itself keeping the contents', () => {
    const { doc, c, a } = setup();
    const inner = wrapInContainer(doc, [a.id], tool, 'Inner')!;
    expect(parentOf(inner.doc, a.id)?.id).toBe(inner.id);
    expect(parentOf(inner.doc, inner.id)?.id).toBe(c.id);
    const big = { ...inner.doc, elements: inner.doc.elements.map((e) => (e.id === inner.id ? { ...e, w: 900, h: 900 } : e)) };
    const fitted = get(fitToContents(big, inner.id), inner.id);
    expect(fitted.w).toBeCloseTo(100 + 2 * CONTAINER_PAD + 4, 0);
    const removed = removeContainer(inner.doc, inner.id);
    expect(removed.elements.some((e) => e.id === inner.id)).toBe(false);
    expect(parentOf(removed, a.id)?.id).toBe(c.id);
  });

  it('is picked by its title bar or border, not its empty inside', () => {
    const { doc, c } = setup();
    expect(hitTest(doc, { x: c.x + 60, y: c.y + 10 }, 1)?.id).toBe(c.id);
    expect(hitTest(doc, { x: c.x + 1, y: c.y + c.h / 2 }, 1)?.id).toBe(c.id);
    expect(hitTest(doc, { x: c.x + 60, y: c.y + c.h - 10 }, 1)).toBeNull();
  });

  it('round-trips through files and repairs bad membership', () => {
    const { doc, c, a, b } = setup();
    expect(parseDocument(serializeDocument(doc)).doc.elements.find((e) => e.id === c.id)).toEqual(c);
    const raw = JSON.parse(serializeDocument(doc));
    const other = { ...raw.elements.find((e: { id: string }) => e.id === c.id), id: 'other', members: [a.id, c.id, 'missing'] };
    raw.elements.push(other);
    raw.elements.find((e: { id: string }) => e.id === c.id).members.push('other', c.id);
    const fixed = parseDocument(raw).doc;
    expect((fixed.elements.find((e) => e.id === c.id) as ContainerElement).members).toEqual([a.id, b.id, 'other']);
    expect((fixed.elements.find((e) => e.id === 'other') as ContainerElement).members).toEqual([]); // a: already taken; c: a loop; missing: gone
    expect(renderDocumentAtTime(doc, 0).items.some((i) => i.id === c.id + ':label')).toBe(true);
  });
});

describe('container commands', () => {
  const D = () => useDoc.getState();
  beforeEach(() => { const { doc } = setup(); D().load(doc); });

  it('duplicates a container with copies inside (not nested in the original), and deletes it with its contents', () => {
    const c = D().doc.elements.find((e) => e.type === 'container') as ContainerElement;
    useUI.getState().select([c.id]);
    duplicateSelection();
    const copy = D().doc.elements.filter((e) => e.type === 'container').find((e) => e.id !== c.id) as ContainerElement;
    expect(copy.members).toHaveLength(2);
    expect(copy.members.some((m) => c.members.includes(m))).toBe(false);
    expect(parentOf(D().doc, copy.id)).toBeUndefined(); // overlapping the original is not "inside" it
    expect(useUI.getState().selection).toEqual([copy.id]);
    const before = D().doc.elements.length; // 4 originals + container + its copy with 2 members
    useUI.getState().select([c.id]);
    deleteSelection();
    expect(D().doc.elements.length).toBe(before - 3); // the container and its 2 members; the arrow stays, detached
    expect(D().doc.elements.some((e) => e.id === copy.id)).toBe(true);
    D().undo();
    expect(D().doc.elements.length).toBe(before);
  });

  it('resets a tool style', () => {
    const u = useUI.getState();
    u.setToolStyle('shape:diamond', { ...u.toolStyle('shape:diamond'), style: { ...u.toolStyle('shape:diamond').style, stroke: '#e03131' } });
    resetToolStyle('shape:diamond');
    expect(useUI.getState().toolStyle('shape:diamond').style.stroke).toBe(defaultToolStyle('shape:diamond').style.stroke);
  });
});

describe('containers and arrows', () => {
  it('does not grow to fit an arrow that leads outside it', () => {
    const { doc, c, b, arrow } = setup();
    const withArrow = wrapInContainer(doc, [...(doc.elements.find((e) => e.id === c.id) as ContainerElement).members, arrow.id].filter((v, i, a) => a.indexOf(v) === i), tool)!;
    const cc = get(withArrow.doc, withArrow.id);
    // drag b far away: it leaves; the arrow (still attached to b) must not stretch the container
    const moved = updateMembership({ ...withArrow.doc, elements: withArrow.doc.elements.map((e) => (e.id === b.id ? { ...e, x: 2000, y: 2000 } : e)) }, [b.id]);
    const after = get(moved, withArrow.id);
    expect(after.x + after.w).toBeLessThan(cc.x + cc.w + 1);
  });
});
