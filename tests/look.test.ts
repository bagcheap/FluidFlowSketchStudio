import { describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { layoutScore, PENALTY, scoreLine } from '../src/lint/score';
import { MAX_MOVE, runTool, startSession, type ToolContext } from '../src/ai/toolkit';
import { firstMessage, LOOK_RULES, startAgent, systemPrompt, AGENT_SYSTEM_PROMPT } from '../src/ai/agent';
import type { EditTools } from '../src/ai/edits';
import type { FlowDocument, ShapeElement } from '../src/model/types';

const styles: EditTools = { shape: (k) => defaultToolStyle(`shape:${k}`), arrow: defaultToolStyle('arrow'), container: defaultToolStyle('container'), fit: (e) => e };
const ctx: ToolContext = { styles };
const box = (x: number, y: number, text: string, w = 100, h = 60, extra = {}): ShapeElement => ({ ...makeShape('rectangle', x, y, w, h, defaultToolStyle('shape:rectangle')), text, ...extra });
const arrow = (a: ShapeElement, b: ShapeElement, text = '') => ({ ...makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 0, y: 0, elementId: b.id }, { ...defaultToolStyle('arrow'), routing: 'straight' as const }), text });
const doc = (...elements: FlowDocument['elements']): FlowDocument => ({ ...newDocument(), elements });
const el = (d: FlowDocument, id: string) => d.elements.find((e) => e.id === id) as ShapeElement;

describe('layout score', () => {
  it('a tidy page scores 100', () => {
    const a = box(0, 0, 'A'), b = box(300, 0, 'B'), c = box(600, 0, 'C');
    const s = layoutScore(doc(a, b, c, arrow(a, b), arrow(b, c)));
    expect(s).toEqual({ score: 100, crossings: 0, overlaps: 0, throughShapes: 0, labelClashes: 0, misaligned: 0, outside: 0, cramped: 0, longLabels: 0 });
    expect(scoreLine(s)).toBe('100/100');
  });

  it('counts overlaps, near-miss alignment, crossings, arrows through shapes and cramped pairs', () => {
    const a = box(0, 0, 'A'), b = box(40, 20, 'B'); // overlap
    expect(layoutScore(doc(a, b)).overlaps).toBe(1);
    const c = box(0, 0, 'C'), d = box(300, 6, 'D'); // a row 6 px off
    const s1 = layoutScore(doc(c, d));
    expect(s1.misaligned).toBe(1);
    expect(s1.score).toBe(100 - PENALTY.misaligned);
    // two arrows making an X
    const tl = box(0, 0, 'tl'), br = box(400, 400, 'br'), tr = box(400, 0, 'tr'), bl = box(0, 400, 'bl');
    expect(layoutScore(doc(tl, br, tr, bl, arrow(tl, br), arrow(tr, bl))).crossings).toBe(1);
    // an arrow straight through a shape between its ends
    const l = box(0, 0, 'l'), m = box(300, 0, 'm'), r = box(600, 0, 'r');
    expect(layoutScore(doc(l, m, r, arrow(l, r))).throughShapes).toBe(1);
    const p = box(0, 300, 'p'), q = box(105, 300, 'q');
    expect(layoutScore(doc(p, q)).cramped).toBe(1);
    expect(scoreLine(layoutScore(doc(a, b)))).toBe(`${100 - PENALTY.overlap}/100: 1 overlapping shape pair`);
  });
});

describe('layout tools for Claude', () => {
  function page() {
    const a = box(0, 0, 'A'), b = box(300, 7, 'B', 80, 50), c = box(520, -4, 'C'), lock = box(900, 30, 'L', 100, 60, { locked: true });
    return { d: doc(a, b, c, lock), a, b, c, lock };
  }

  it('align, distribute, match_size and move work on short ids and raise the score', async () => {
    const { d } = page();
    const s = startSession(d, ctx);
    const before = layoutScore(s.doc).score;
    expect(await runTool(s, 'align', { ids: ['s1', 's2', 's3'], edge: 'vcenter' })).toMatchObject({ ok: true });
    const ys = s.doc.elements.slice(0, 3).map((e) => (e as ShapeElement).y + (e as ShapeElement).h / 2);
    expect(new Set(ys.map((y) => Math.round(y))).size).toBe(1);
    expect(await runTool(s, 'distribute', { ids: ['s1', 's2', 's3'], axis: 'across' })).toMatchObject({ ok: true });
    expect(await runTool(s, 'match_size', { reference: 's1', ids: ['s2'], mode: 'both' })).toMatchObject({ ok: true });
    expect(el(s.doc, s.view.ids.get('s2')!)).toMatchObject({ w: 100, h: 60 });
    expect(await runTool(s, 'move', { ids: ['s3'], dx: 20, dy: 0 })).toMatchObject({ ok: true });
    expect(layoutScore(s.doc).score).toBeGreaterThanOrEqual(before);
    const r = JSON.parse((await runTool(s, 'layout_score', {}) as { content: string }).content);
    expect(r.score).toBe(layoutScore(s.doc).score);
  });

  it('refuses locked items, unknown ids, too few items and wild moves', async () => {
    const { d, lock } = page();
    const s = startSession(d, ctx);
    expect(await runTool(s, 'align', { ids: ['s4', 'zz'], edge: 'left' })).toMatchObject({ ok: false }); // only the locked one is real
    expect(await runTool(s, 'distribute', { ids: ['s1', 's2'], axis: 'down' })).toMatchObject({ ok: false });
    expect(await runTool(s, 'move', { ids: ['s1'], dx: MAX_MOVE + 1, dy: 0 })).toMatchObject({ ok: false });
    expect(await runTool(s, 'move', { ids: ['s1'], dx: 'NaN', dy: 0 })).toMatchObject({ ok: false });
    expect(await runTool(s, 'move', { ids: ['s4'], dx: 10, dy: 0 })).toMatchObject({ ok: false });
    expect(await runTool(s, 'match_size', { reference: 'nope', ids: ['s1'], mode: 'both' })).toMatchObject({ ok: false });
    expect(el(s.doc, lock.id).x).toBe(900);
    expect(s.changes).toBe(0);
  });
});

describe('Improve the look mode', () => {
  it('adds the layout rules to the system prompt and the current score to the first message', () => {
    expect(systemPrompt('edit')).toBe(AGENT_SYSTEM_PROMPT);
    expect(systemPrompt('look')).toBe(AGENT_SYSTEM_PROMPT + LOOK_RULES);
    expect(LOOK_RULES).toContain('layout_score');
    const a = box(0, 0, 'A'), b = box(40, 20, 'B');
    const look = startAgent(doc(a, b), ctx, 'claude-opus-5-5', 'look');
    expect(firstMessage(look, 'Tidy up', null, [])).toContain(`## Layout score now\n${100 - PENALTY.overlap}/100: 1 overlapping shape pair`);
    const edit = startAgent(doc(a, b), ctx, 'claude-opus-5-5');
    expect(firstMessage(edit, 'Tidy up', null, [])).not.toContain('Layout score');
  });
});
