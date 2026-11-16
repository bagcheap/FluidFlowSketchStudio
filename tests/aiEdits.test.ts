import { describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { applyEdits, describeOps, describePage, EDIT_SCHEMA, parseEdits, type EditTools } from '../src/ai/edits';
import { editWithClaude } from '../src/ai/describe';
import { wrapInContainer } from '../src/store/containers';
import type { ConnectorElement, ContainerElement, FlowDocument, ShapeElement } from '../src/model/types';

const KEY = 'sk-ant-test-0123456789';
const box = (text: string, x: number, y: number) => { const s = makeShape('rectangle', x, y, 140, 60, defaultToolStyle('shape:rectangle')); s.text = text; return s; };
const link = (a: ShapeElement, b: ShapeElement, text = '') => { const c = makeConnector({ x: 0, y: 0, elementId: a.id, anchor: null }, { x: 0, y: 0, elementId: b.id, anchor: null }, defaultToolStyle('arrow')); c.text = text; return c; };
const tools: EditTools = { shape: (k) => defaultToolStyle(`shape:${k}`), arrow: defaultToolStyle('arrow'), container: defaultToolStyle('container'), fit: (e) => e };

function sample() {
  const d = newDocument();
  const api = box('API', 0, 0), db = box('Database', 400, 0), web = box('Web app', -400, 0);
  d.elements = [web, api, db, link(web, api, 'calls'), link(api, db, 'reads')];
  return { d, api, db, web };
}
const els = (d: FlowDocument) => d.elements;
const byText = (d: FlowDocument, t: string) => d.elements.find((e) => e.text === t)!;

describe('AI edits: the page as Claude sees it', () => {
  it('lists shapes, arrows and containers with short ids, labels, kinds, colours and positions', () => {
    const { d } = sample();
    const v = describePage(d);
    const items = JSON.parse(v.json);
    expect(items.map((i: { id: string }) => i.id)).toEqual(['s1', 's2', 's3', 'a1', 'a2']);
    expect(items[1]).toMatchObject({ id: 's2', kind: 'rectangle', label: 'API', x: 0, y: 0, w: 140, h: 60 });
    expect(items[3]).toMatchObject({ arrow: true, from: 's1', to: 's2', label: 'calls', heads: 'end' });
    expect(v.ids.get('s2')).toBe(d.elements[1].id);
  });
});

describe('AI edits: checking the reply', () => {
  it('keeps well-formed operations on known ids and drops everything else', () => {
    const known = new Set(['s1', 's2', 's3', 'a1']);
    const p = parseEdits({
      summary: 'Adds a cache',
      ops: [
        { op: 'add_shape', ref: 'n1', label: 'Cache', shape: 'cylinder', near: 's2', place: 'below', container: null },
        { op: 'connect', from: 's2', to: 'n1', label: 'get', style: 'dashed', heads: 'end' },
        { op: 'connect', from: 's2', to: 's99', label: '', style: 'solid', heads: 'end' }, // unknown id
        { op: 'set_color', ids: ['s3'], fill: 'javascript:alert(1)', line: null }, // not a colour → nothing left
        { op: 'set_color', ids: ['s3'], fill: '#D3F9D8', line: null },
        { op: 'set_label', id: 's1', label: 'Web‮ app\u0000' },
        { op: 'run_script', code: 'alert(1)' }, // not an operation
        { op: 'set_shape', id: 's1', shape: 'nonsense' },
        'garbage',
      ],
    }, known);
    expect(p.ops.map((o) => o.op)).toEqual(['add_shape', 'connect', 'set_color', 'set_label']);
    expect(p.dropped).toBe(5);
    expect(p.ops[2]).toMatchObject({ fill: '#d3f9d8' });
    expect(p.ops[3]).toMatchObject({ label: 'Web app' }); // bidi and control characters stripped
    expect(parseEdits('nonsense', known)).toEqual({ summary: '', ops: [], dropped: 0 });
  });

  it('the schema lists every operation the checker accepts', () => {
    const ops = EDIT_SCHEMA.properties.ops.items.anyOf.map((o) => o.properties.op.enum[0]);
    expect(ops).toEqual(['add_shape', 'connect', 'remove', 'set_label', 'set_shape', 'set_color', 'set_arrow', 'add_container', 'move_into']);
  });
});

describe('AI edits: applying them', () => {
  it('adds a shape next to another, connects it, recolours, renames and describes it all in plain words', () => {
    const { d } = sample();
    const v = describePage(d);
    const p = parseEdits({ summary: '', ops: [
      { op: 'add_shape', ref: 'n1', label: 'Cache', shape: 'cylinder', near: 's2', place: 'below', container: null },
      { op: 'connect', from: 's2', to: 'n1', label: 'get', style: 'dashed', heads: 'end' },
      { op: 'set_color', ids: ['s3'], fill: '#d3f9d8', line: null },
      { op: 'set_label', id: 's1', label: 'Browser' },
    ] }, new Set(v.ids.keys()));
    expect(describeOps(d, v, p.ops)).toEqual([
      'Add cylinder (database) “Cache” below “API”',
      'Connect “API” → “Cache” (“get”), dashed',
      'Colour “Database”: fill #d3f9d8',
      'Rename “Web app” to “Browser”',
    ]);
    const r = applyEdits(d, v, p.ops, tools);
    expect(r.skipped).toBe(0);
    const cache = byText(r.doc, 'Cache') as ShapeElement, api = byText(r.doc, 'API') as ShapeElement;
    expect(cache.shape).toBe('cylinder');
    expect(cache.y).toBeGreaterThan(api.y + api.h); // below the API
    const c = els(r.doc).find((e) => e.type === 'connector' && e.text === 'get') as ConnectorElement;
    expect(c.start.elementId).toBe(api.id); expect(c.end.elementId).toBe(cache.id); expect(c.style.strokeStyle).toBe('dashed');
    expect((byText(r.doc, 'Database') as ShapeElement).style.fill).toBe('#d3f9d8');
    expect(byText(r.doc, 'Browser')).toBeTruthy();
    expect(r.touched).toContain(cache.id);
  });

  it('removing a shape removes its arrows; locked items are skipped; reversing swaps an arrow', () => {
    const { d, api, db } = sample();
    d.elements = d.elements.map((e) => (e.id === db.id ? { ...e, locked: true } : e));
    const v = describePage(d);
    const p = parseEdits({ summary: '', ops: [{ op: 'remove', id: 's3' }, { op: 'set_arrow', id: 'a1', style: null, heads: null, reverse: true }, { op: 'remove', id: 's1' }] }, new Set(v.ids.keys()));
    const r = applyEdits(d, v, p.ops, tools);
    expect(r.skipped).toBe(1); // the locked database
    expect(els(r.doc).some((e) => e.text === 'Web app')).toBe(false);
    expect(els(r.doc).some((e) => e.type === 'connector' && e.text === 'calls')).toBe(false); // went with Web app
    expect(els(r.doc).some((e) => e.id === db.id)).toBe(true);
    expect(els(r.doc).filter((e) => e.type === 'connector').every((e) => (e as ConnectorElement).start.elementId === api.id)).toBe(true);
  });

  it('puts shapes in a new container, and moves them out again', () => {
    const { d } = sample();
    const v = describePage(d);
    const p = parseEdits({ summary: '', ops: [{ op: 'add_container', ref: 'g1', title: 'Backend', members: ['s2', 's3'] }] }, new Set(v.ids.keys()));
    const r = applyEdits(d, v, p.ops, tools);
    const g = els(r.doc).find((e) => e.type === 'container') as ContainerElement;
    expect(g.text).toBe('Backend');
    expect(g.members.sort()).toEqual([byText(r.doc, 'API').id, byText(r.doc, 'Database').id].sort());
    const v2 = describePage(r.doc);
    const out = parseEdits({ summary: '', ops: [{ op: 'move_into', ids: ['s2'], container: null }] }, new Set(v2.ids.keys()));
    const r2 = applyEdits(r.doc, v2, out.ops, tools);
    expect((els(r2.doc).find((e) => e.type === 'container') as ContainerElement).members).toEqual([byText(r.doc, 'Database').id]);
  });

  it('a container is described with its members', () => {
    const { d, api, db } = sample();
    const w = wrapInContainer(d, [api.id, db.id], defaultToolStyle('container'), 'Backend')!;
    const items = JSON.parse(describePage(w.doc).json);
    expect(items.find((i: { container?: boolean }) => i.container)).toMatchObject({ title: 'Backend' });
    expect(items.filter((i: { in?: string }) => i.in === 'c1').length).toBe(2);
  });
});

describe('AI edits: the request', () => {
  it('sends the page and the request with the edit schema, and returns the parsed JSON', async () => {
    const calls: RequestInit[] = [];
    const f = (async (_url: string, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: JSON.stringify({ summary: 'ok', ops: [] }) }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const out = await editWithClaude('[{"id":"s1"}]', 'add a cache', { apiKey: KEY, model: 'claude-opus-5-5', fetch: f });
    expect(out).toEqual({ summary: 'ok', ops: [] });
    const body = JSON.parse(String(calls[0].body));
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.messages[0].content).toContain('[{"id":"s1"}]');
    expect(body.messages[0].content).toContain('Request: add a cache');
  });
});
