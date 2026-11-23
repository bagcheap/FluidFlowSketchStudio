import { describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { firstMessage, runAgent, startAgent, MAX_TURNS } from '../src/ai/agent';
import { diffPage } from '../src/ai/diff';
import { estimateCost } from '../src/ai/review';
import type { EditTools } from '../src/ai/edits';
import type { FlowDocument, ShapeElement } from '../src/model/types';

const KEY = 'sk-ant-test-0000000000';
const styles: EditTools = { shape: (k) => defaultToolStyle(`shape:${k}`), arrow: defaultToolStyle('arrow'), container: defaultToolStyle('container'), fit: (e) => e };
const box = (x: number, text: string): ShapeElement => ({ ...makeShape('rectangle', x, 0, 100, 60, defaultToolStyle('shape:rectangle')), text });
function sample(): FlowDocument {
  const a = box(0, 'Web'), b = box(300, 'API');
  const c = { ...makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 0, y: 0, elementId: b.id }, defaultToolStyle('arrow')), text: '1. request' };
  return { ...newDocument(), elements: [a, b, c] };
}

/** A fake Anthropic API answering each request with the next scripted reply, keeping the requests. */
function fakeApi(...replies: unknown[]) {
  const calls: { messages: { role: string; content: unknown }[]; tools: { name: string; strict?: boolean }[]; system: unknown; output_config: { effort: string } }[] = [];
  const f = (async (_u: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    const body = replies[Math.min(calls.length - 1, replies.length - 1)];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, calls };
}
const msg = (content: unknown[], stop = 'tool_use') => ({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: stop, stop_sequence: null, content,
  usage: { input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500 } });
const use = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });

describe('AI agent', () => {
  it('runs the tools Claude asks for on a draft, sends each result back, and ends with its summary', async () => {
    const doc = sample();
    const state = startAgent(doc, { styles }, 'claude-opus-5-5');
    const { f, calls } = fakeApi(
      msg([{ type: 'text', text: 'Adding a cache.' }, use('t1', 'add_shape', { label: 'Cache', shape: 'cylinder', near: 's2', place: 'below', container: null }), use('t2', 'connect', { from: 's2', to: 's3', label: '2. look up', style: 'dashed', heads: 'end' })]),
      msg([use('t3', 'lint', {})]),
      msg([{ type: 'text', text: 'Added a cache below the API and connected it.' }], 'end_turn'),
    );
    const events: string[] = [];
    const text = firstMessage(state, 'Add a cache below the API', null, [doc.elements[1].id]);
    expect(text).toContain('## Request\nAdd a cache below the API');
    expect(text).toContain('(The user has selected: s2)');
    const reply = await runAgent(state, text, { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', pictures: false, fetch: f }, (e) => events.push(`${e.name}:${e.ok}`));
    expect(reply).toBe('Added a cache below the API and connected it.');
    expect(events).toEqual(['add_shape:true', 'connect:true', 'lint:true']);
    expect(calls).toHaveLength(3);
    // strict tools, no snapshot without pictures; cached system prompt; one moving cache breakpoint
    expect(calls[0].tools.every((t) => t.strict)).toBe(true);
    expect(calls[0].tools.some((t) => t.name === 'snapshot')).toBe(false);
    expect((calls[0].system as { cache_control?: unknown }[])[0].cache_control).toEqual({ type: 'ephemeral' });
    const second = calls[1].messages;
    expect(second.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    const results = second[2].content as { type: string; tool_use_id: string; is_error?: boolean; cache_control?: unknown }[];
    expect(results.map((r) => r.tool_use_id)).toEqual(['t1', 't2']);
    expect(results.at(-1)!.cache_control).toEqual({ type: 'ephemeral' });
    expect(JSON.stringify(second[0])).not.toContain('cache_control'); // only the last block carries the breakpoint
    // the draft changed, the original did not
    expect(state.session.doc.elements).toHaveLength(5);
    expect(doc.elements).toHaveLength(3);
    const d = diffPage(doc, state.session.doc);
    expect(d.added).toHaveLength(2);
    expect(d.lines.slice(0, 2)).toEqual(['Added “Cache”', 'Added arrow “2. look up”']);
    expect(state.usage).toMatchObject({ input: 6000, output: 900, cacheRead: 3000, cacheWrite: 1500 });
    expect(estimateCost('claude-opus-5-5', state.usage)).toBeCloseTo((6000 * 4 + 900 * 20 + 3000 * 0.2 + 1500 * 5) / 1e6, 8);
  });

  it('a follow-up continues the same conversation and the same draft', async () => {
    const doc = sample();
    const state = startAgent(doc, { styles }, 'claude-opus-5-5');
    const one = fakeApi(msg([use('t1', 'set_label', { id: 's1', label: 'Browser' })]), msg([{ type: 'text', text: 'Renamed.' }], 'end_turn'));
    await runAgent(state, firstMessage(state, 'Rename Web to Browser', null, []), { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', pictures: true, fetch: one.f });
    expect(one.calls[0].tools.some((t) => t.name === 'snapshot')).toBe(true);
    const two = fakeApi(msg([use('t2', 'set_color', { ids: ['s1'], fill: '#d3f9d8', line: null })]), msg([{ type: 'text', text: 'Coloured it green.' }], 'end_turn'));
    await runAgent(state, 'Now make it green', { apiKey: KEY, model: 'claude-opus-5-5', effort: 'high', pictures: true, fetch: two.f });
    expect(two.calls[0].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(two.calls[0].output_config.effort).toBe('high');
    const s1 = state.session.doc.elements[0];
    expect([s1.text, s1.style.fill]).toEqual(['Browser', '#d3f9d8']);
    expect(diffPage(doc, state.session.doc).lines).toEqual(['Changed “Browser”: label, style']);
  });

  it('untrusted calls come back as errors for Claude, not changes; snapshots go back as pictures', async () => {
    const doc = sample();
    const state = startAgent(doc, { styles, snapshot: async () => ({ mediaType: 'image/png', data: 'iVBORw0KGgo=' }) }, 'claude-opus-5-5');
    const { f, calls } = fakeApi(
      msg([use('t1', 'run_shell', { cmd: 'rm -rf /' }), use('t2', 'remove', { id: 'el_not_a_short_id' }), use('t3', 'snapshot', {})]),
      msg([{ type: 'text', text: 'Nothing to do.' }], 'end_turn'),
    );
    await runAgent(state, firstMessage(state, 'Tidy up', null, []), { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', pictures: true, fetch: f });
    const results = calls[1].messages[2].content as { is_error?: boolean; content: { type: string }[] }[];
    expect(results.map((r) => !!r.is_error)).toEqual([true, true, false]);
    expect(results[2].content.map((c) => c.type)).toEqual(['text', 'image']);
    expect(state.session.doc).toBe(doc); // nothing changed
    expect(diffPage(doc, state.session.doc).lines).toEqual([]);
  });

  it('stops after the turn limit; refusals and missing keys are plain errors; a failed request leaves no dangling turn', async () => {
    const doc = sample();
    const loop = fakeApi(msg([use('t', 'lint', {})]));
    const state = startAgent(doc, { styles }, 'claude-opus-5-5');
    const reply = await runAgent(state, 'Keep checking', { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', pictures: false, fetch: loop.f });
    expect(loop.calls).toHaveLength(MAX_TURNS);
    expect(reply).toContain('Stopped after many steps');
    const s2 = startAgent(doc, { styles }, 'claude-opus-5-5');
    await expect(runAgent(s2, 'x', { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', pictures: false, fetch: fakeApi(msg([], 'refusal')).f })).rejects.toThrow('declined');
    await expect(runAgent(s2, 'x', { apiKey: '', model: 'claude-opus-5-5', effort: 'medium', pictures: false })).rejects.toThrow('API key');
    const bad = (async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }), { status: 401, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const s3 = startAgent(doc, { styles }, 'claude-opus-5-5');
    await expect(runAgent(s3, 'x', { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', pictures: false, fetch: bad })).rejects.toThrow('did not accept that API key');
    expect(s3.messages).toEqual([]);
  });
});
