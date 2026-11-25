import { describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { spreadOut } from '../src/layout/arrange';
import { labelToCallout, stepPrefix } from '../src/layout/labels';
import { wrapInContainer } from '../src/store/containers';
import { layoutScore, LONG_LABEL } from '../src/lint/score';
import { CALLOUT_TEXT, estimateText, runTool, startSession, type ToolContext } from '../src/ai/toolkit';
import { applyEdits, describePage, type EditTools } from '../src/ai/edits';
import { elementBounds } from '../src/engine/render';
import type { ConnectorElement, ContainerElement, FlowDocument, ShapeElement, TextElement } from '../src/model/types';

const styles: EditTools = { shape: (k) => defaultToolStyle(`shape:${k}`), arrow: defaultToolStyle('arrow'), container: defaultToolStyle('container'), fit: (e) => e };
const ctx: ToolContext = { styles };
const box = (x: number, y: number, text: string): ShapeElement => ({ ...makeShape('rectangle', x, y, 100, 60, defaultToolStyle('shape:rectangle')), text });
const arrow = (a: ShapeElement, b: ShapeElement, text = ''): ConnectorElement => ({ ...makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 0, y: 0, elementId: b.id }, { ...defaultToolStyle('arrow'), routing: 'straight' as const }), text });
const doc = (...elements: FlowDocument['elements']): FlowDocument => ({ ...newDocument(), elements });
const get = <T,>(d: FlowDocument, id: string) => d.elements.find((e) => e.id === id) as T;

/** Three shapes in a coloured container, cramped, plus one outside. */
function crowded() {
  const a = box(0, 0, 'A'), b = box(110, 0, 'B'), c = box(0, 70, 'C'), out = box(300, 0, 'Out');
  let d = doc(a, b, c, out, arrow(a, b, '1. go'));
  const w = wrapInContainer(d, [a.id, b.id, c.id], { ...defaultToolStyle('container'), style: { ...defaultToolStyle('container').style, fill: '#c5f6fa', stroke: '#0c8599' } }, 'Microsoft Entra ID')!;
  d = w.doc;
  return { d, a, b, c, out, k: w.id };
}

describe('Spread out', () => {
  it('pushes things apart, keeps sizes, grows containers round their contents with the same padding and colours', () => {
    const { d, a, b, c, k } = crowded();
    const k0 = get<ContainerElement>(d, k);
    const pad0 = { l: get<ShapeElement>(d, a.id).x - k0.x, t: get<ShapeElement>(d, a.id).y - k0.y };
    const s = spreadOut(d, 1.6);
    const A = get<ShapeElement>(s, a.id), B = get<ShapeElement>(s, b.id), C = get<ShapeElement>(s, c.id), K = get<ContainerElement>(s, k);
    expect([A.w, A.h]).toEqual([100, 60]);
    expect(B.x - (A.x + A.w)).toBeGreaterThan(10 + 30); // the 10 px gap grew
    expect(C.y - (A.y + A.h)).toBeGreaterThan(10);
    expect(K.style.fill).toBe('#c5f6fa');
    expect(K.members).toEqual(k0.members);
    for (const m of [A, B, C]) { const r = elementBounds(s, m); expect(r.x >= K.x && r.y >= K.y && r.x + r.w <= K.x + K.w && r.y + r.h <= K.y + K.h).toBe(true); }
    expect(A.x - K.x).toBeCloseTo(pad0.l, 0); expect(A.y - K.y).toBeCloseTo(pad0.t, 0);
    expect(layoutScore(s).cramped).toBeLessThan(layoutScore(d).cramped);
  });

  it('a factor of 1 (or nonsense) changes nothing; locked items stay', () => {
    const { d, a } = crowded();
    expect(spreadOut(d, 1)).toBe(d);
    expect(spreadOut(d, Number.NaN)).toBe(d);
    const locked = { ...d, elements: d.elements.map((e) => (e.id === a.id ? { ...e, locked: true } : e)) };
    expect(get<ShapeElement>(spreadOut(locked, 2), a.id).x).toBe(get<ShapeElement>(locked, a.id).x);
  });
});

describe('labels to callouts', () => {
  const long = '17. Entra OBO: /token (jwt-bearer, requested_token_use=on_behalf_of, assertion = user token, client = agent app ID + secret/cert) → token with aud = SF exchange app';
  it('keeps the step number and a few words on the arrow, puts the whole text in a callout nearby', () => {
    const a = box(0, 0, 'Gateway'), b = box(600, 0, 'Entra'), c = arrow(a, b, long);
    const d = doc(a, b, c);
    expect(layoutScore(d).longLabels).toBe(1);
    const r = labelToCallout(d, c.id, 'Entra OBO token exchange', CALLOUT_TEXT, estimateText)!;
    const ar = get<ConnectorElement>(r.doc, c.id), co = get<TextElement>(r.doc, r.calloutId);
    expect(ar.text).toBe('17. Entra OBO token exchange');
    expect(ar.note).toBe(long);
    expect(co.type).toBe('text');
    expect(co.text).toBe(long);
    expect(co.w).toBeLessThanOrEqual(240);
    // near the arrow, clear of the shapes
    for (const s of [a, b]) { const sb = elementBounds(r.doc, s); expect(co.x + co.w <= sb.x || co.x >= sb.x + sb.w || co.y + co.h <= sb.y || co.y >= sb.y + sb.h).toBe(true); }
    expect(Math.abs(co.y + co.h / 2 - 30)).toBeLessThan(560);
    expect(layoutScore(r.doc).longLabels).toBe(0);
    expect(ar.text.length).toBeLessThanOrEqual(LONG_LABEL);
  });
  it('adds the step number when the short label leaves it out; ignores unlabelled and locked arrows', () => {
    const a = box(0, 0, 'A'), b = box(500, 0, 'B'), c = arrow(a, b, '8a.1 first use only: browser redirect to Entra');
    expect(stepPrefix(c.text)).toBe('8a.1');
    const r = labelToCallout(doc(a, b, c), c.id, 'sign-in redirect', CALLOUT_TEXT, estimateText)!;
    expect(get<ConnectorElement>(r.doc, c.id).text).toBe('8a.1. sign-in redirect');
    expect(labelToCallout(doc(a, b, arrow(a, b, '')), 'x', 'y', CALLOUT_TEXT, estimateText)).toBeNull();
    const lk = { ...c, locked: true };
    expect(labelToCallout(doc(a, b, lk), lk.id, 'y', CALLOUT_TEXT, estimateText)).toBeNull();
  });
});

describe('Claude keeps container colours', () => {
  it('the page shows container colours, and a container removed and added again keeps its look', () => {
    const { d, a, b, c } = crowded();
    const view = describePage(d);
    expect(view.json).toContain('"fill":"#c5f6fa"');
    const sh = (id: string) => [...view.ids].find(([, v]) => v === id)![0];
    const cShort = [...view.ids].find(([k]) => k.startsWith('c'))![0];
    const r = applyEdits(d, view, [
      { op: 'move_into', ids: [sh(a.id), sh(b.id), sh(c.id)], container: null },
      { op: 'remove', id: cShort },
      { op: 'add_container', ref: 'n1', title: 'microsoft entra id', members: [sh(a.id), sh(b.id), sh(c.id)] },
    ], styles);
    const k = r.doc.elements.find((e) => e.type === 'container') as ContainerElement;
    expect(k.style.fill).toBe('#c5f6fa');
    expect(k.style.stroke).toBe('#0c8599');
  });

  it('the agent tools: spread_out and label_to_callout', async () => {
    const { d } = crowded();
    const s = startSession(d, ctx);
    expect(await runTool(s, 'spread_out', { factor: 9 })).toMatchObject({ ok: false });
    expect(await runTool(s, 'spread_out', { factor: 1.5 })).toMatchObject({ ok: true });
    const r = await runTool(s, 'label_to_callout', { id: 'a1', short_label: 'go now' });
    expect(r).toMatchObject({ ok: true });
    expect(JSON.parse((r as { content: string }).content)).toMatchObject({ label: '1. go now' });
    expect(await runTool(s, 'label_to_callout', { id: 's1', short_label: 'x' })).toMatchObject({ ok: false });
  });
});
