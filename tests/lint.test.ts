import { describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { lintPage, segmentHitsRect } from '../src/lint/lint';
import { separateBoxes, separation, SEPARATE_GAP } from '../src/layout/separate';
import { applyPlaySteps, labelSteps } from '../src/store/sequence';
import { wrapInContainer } from '../src/store/containers';
import type { ConnectorElement, ContainerElement, FlowDocument, ShapeElement } from '../src/model/types';

const box = (x: number, y: number, text = 'Box', w = 100, h = 60): ShapeElement => ({ ...makeShape('rectangle', x, y, w, h, defaultToolStyle('shape:rectangle')), text });
const arrow = (a: ShapeElement | null, b: ShapeElement | null, text = ''): ConnectorElement => ({
  ...makeConnector({ x: a ? a.x + a.w : 0, y: a ? a.y + 30 : 0, elementId: a?.id ?? null }, { x: b ? b.x : 500, y: b ? b.y + 30 : 0, elementId: b?.id ?? null }, { ...defaultToolStyle('arrow'), routing: 'straight' }),
  text,
});
const page = (...elements: FlowDocument['elements']): FlowDocument => ({ ...newDocument(), elements });
const rules = (d: FlowDocument) => lintPage(d).map((i) => i.rule);

describe('lint', () => {
  it('a tidy diagram has nothing to report', () => {
    const a = box(0, 0, 'Client'), b = box(300, 0, 'Server');
    expect(lintPage(page(a, b, arrow(a, b, 'request')))).toEqual([]);
  });

  it('loose arrow ends', () => {
    const a = box(0, 0);
    const issues = lintPage(page(a, arrow(a, null)));
    expect(issues[0]).toMatchObject({ rule: 'loose-end', severity: 'warning' });
    expect(issues[0].message).toContain('has an end that isn’t attached');
  });

  it('an arrow passing through a shape (not its own ends), with a routing fix', () => {
    const a = box(0, 0, 'A'), mid = box(200, 0, 'Middle'), b = box(400, 0, 'B');
    const c = arrow(a, b, 'long way');
    const i = lintPage(page(a, mid, b, c, arrow(a, mid, 'x'), arrow(mid, b, 'y'))).find((x) => x.rule === 'through-shape')!;
    expect(i.ids).toEqual([c.id, mid.id]);
    expect(i.message).toBe('Arrow “long way” passes through “Middle”');
    expect(i.fix?.kind).toBe('routeArrows');
    expect(segmentHitsRect({ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 3, y: 0, w: 2, h: 10 })).toBe(true);
    expect(segmentHitsRect({ x: 0, y: 50 }, { x: 10, y: 50 }, { x: 3, y: 0, w: 2, h: 10 })).toBe(false);
  });

  it('overlapping shapes, but not one placed inside another or edges that touch', () => {
    const a = box(0, 0, 'A'), b = box(50, 20, 'B'), inner = box(400, 0, 'Big', 300, 200), small = box(450, 50, 'Small', 60, 40);
    const e1 = box(0, 500, 'E1'), e2 = box(98, 500, 'E2');
    const issues = lintPage(page(a, b, inner, small, e1, e2));
    expect(issues.filter((i) => i.rule === 'overlap').map((i) => i.ids)).toEqual([[a.id, b.id]]);
    expect(issues.find((i) => i.rule === 'overlap')!.fix).toEqual({ kind: 'separate', label: 'Move apart' });
  });

  it('step numbers: duplicates, gaps (with a renumber fix), arrows that play at once, a mismatched order, unnumbered arrows', () => {
    const s = [0, 1, 2, 3, 4].map((i) => box(i * 200, 0, `S${i}`));
    const one = arrow(s[0], s[1], '1. a'), twoA = arrow(s[1], s[2], '2. b'), twoB = arrow(s[1], s[3], '2. c'), four = arrow(s[2], s[4], '4. d'), plain = arrow(s[3], s[4], '');
    const d = page(...s, one, twoA, twoB, four, plain);
    const all = lintPage(d);
    expect(all.find((i) => i.rule === 'duplicate-step')!.message).toContain('2 arrows are numbered 2');
    expect(all.find((i) => i.rule === 'step-gap')).toMatchObject({ message: 'There is no step 3', fix: { kind: 'renumber' } });
    expect(all.find((i) => i.rule === 'no-order')?.fix?.kind).toBe('labelOrder');
    const ordered = applyPlaySteps(d, labelSteps(d));
    expect(rules(ordered)).not.toContain('no-order');
    expect(rules(ordered)).not.toContain('order-mismatch');
    const shuffled = applyPlaySteps(d, [[four.id], [one.id], [twoA.id, twoB.id]]);
    expect(rules(shuffled)).toContain('order-mismatch');
    expect(lintPage(shuffled).find((i) => i.rule === 'not-in-order')!.ids).toEqual([plain.id]);
  });

  it('unlabelled and unconnected shapes, and empty containers (most serious first)', () => {
    const a = box(0, 0, 'A'), b = box(300, 0, 'B'), blank = box(0, 300, ''), alone = box(300, 300, 'Alone');
    let d = page(a, b, blank, alone, arrow(a, b, 'go'), arrow(blank, a, 'x'));
    d = wrapInContainer(d, [alone.id], defaultToolStyle('container'), 'Group')!.doc;
    d = { ...d, elements: d.elements.filter((e) => e.id !== alone.id).map((e) => (e.type === 'container' ? { ...e, members: [] } as ContainerElement : e)) };
    const issues = lintPage(d);
    expect(issues.find((i) => i.rule === 'unlabelled')!.ids).toEqual([blank.id]);
    expect(issues.find((i) => i.rule === 'empty-container')!.fix?.kind).toBe('delete');
    expect(issues.map((i) => i.severity)).toEqual([...issues.map((i) => i.severity)].sort((x, y) => ['error', 'warning', 'info'].indexOf(x) - ['error', 'warning', 'info'].indexOf(y)));
    // a shape on its own is reported only when the page has arrows at all
    expect(rules(page(box(0, 0, 'A'), box(300, 0, 'B')))).toEqual([]);
    const d2 = page(a, b, alone, arrow(a, b, 'go'));
    expect(lintPage(d2).find((i) => i.rule === 'unconnected')!.message).toBe('“Alone” isn’t connected to anything');
  });
});

describe('Move apart (overlap fix)', () => {
  const near = (r: { x: number; y: number; w: number; h: number }, q: { x: number; y: number; w: number; h: number }) =>
    r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h;
  it('the smaller shape moves the shortest way out, with a gap', () => {
    const big = box(0, 0, 'Big', 200, 120), small = box(170, 30, 'Small', 80, 50);
    const s = separation(page(big, small), big.id, small.id)!;
    expect(s.id).toBe(small.id);
    expect(s.dy).toBe(0); // out to the right: the nearest side (bounds include a small margin for the stroke)
    expect(s.dx).toBeGreaterThanOrEqual(200 + SEPARATE_GAP - 170);
    expect(s.dx).toBeLessThan(200 + SEPARATE_GAP - 170 + 10);
    const r = separateBoxes(page(big, small), big.id, small.id)!;
    const moved = r.doc.elements.find((e) => e.id === small.id) as ShapeElement;
    expect(near(moved, big)).toBe(false);
    expect(lintPage(r.doc).some((i) => i.rule === 'overlap')).toBe(false);
  });

  it('steps past another shape in the way, and moves the unlocked one when the other is locked', () => {
    const big = box(0, 0, 'Big', 200, 120), small = box(170, 30, 'Small', 80, 50), blocker = box(230, 0, 'Blocker', 100, 120);
    const r = separateBoxes(page(big, small, blocker), big.id, small.id)!;
    const moved = r.doc.elements.find((e) => e.id === small.id) as ShapeElement;
    for (const o of [big, blocker]) expect(near(moved, o)).toBe(false);
    const lockedSmall = { ...small, locked: true };
    expect(separation(page(big, lockedSmall), big.id, small.id)!.id).toBe(big.id);
    expect(separation(page({ ...big, locked: true }, lockedSmall), big.id, small.id)).toBeNull();
    expect(lintPage(page({ ...big, locked: true }, lockedSmall)).find((i) => i.rule === 'overlap')!.fix).toBeUndefined();
  });

  it('prefers a spot that keeps the shape inside its container', () => {
    const a = box(0, 0, 'A', 100, 60), b = box(60, 10, 'B', 100, 60);
    let d = page(a, b);
    d = wrapInContainer(d, [a.id, b.id], defaultToolStyle('container'), 'Group')!.doc;
    // A moves (same size, first). The shortest way out is to the left, but its centre would leave the container
    // (and up or down too); to the right keeps it inside, so that wins although it is further
    d = { ...d, elements: d.elements.map((e) => (e.type === 'container' ? { ...e, x: 10, y: -40, w: 400, h: 130 } : e)) };
    const s = separation(d, a.id, b.id)!;
    expect(s.dy).toBe(0);
    expect(s.dx).toBeGreaterThan(0);
  });
});
