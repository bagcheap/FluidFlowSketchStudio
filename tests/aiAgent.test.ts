import { describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { DEFAULT_STEPS, estimateAgentCost, firstMessage, runAgent, runEstimate, startAgent } from '../src/ai/agent';
import { diffPage, newProblems } from '../src/ai/diff';
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
    const reply = await runAgent(state, text, { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', pictures: false, fetch: f }, (e) => { if (e.kind === 'tool') events.push(`${e.name}:${e.ok}`); });
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
    expect(loop.calls).toHaveLength(DEFAULT_STEPS);
    expect(reply).toContain('Stopped at the step limit (12)');
    expect(state.stop).toBe('steps');
    const s2 = startAgent(doc, { styles }, 'claude-opus-5-5');
    await expect(runAgent(s2, 'x', { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', pictures: false, fetch: fakeApi(msg([], 'refusal')).f })).rejects.toThrow('declined');
    await expect(runAgent(s2, 'x', { apiKey: '', model: 'claude-opus-5-5', effort: 'medium', pictures: false })).rejects.toThrow('API key');
    const bad = (async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }), { status: 401, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const s3 = startAgent(doc, { styles }, 'claude-opus-5-5');
    await expect(runAgent(s3, 'x', { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', pictures: false, fetch: bad })).rejects.toThrow('did not accept that API key');
    expect(s3.messages).toEqual([]);
  });
});

describe('agent cost control', () => {
  const lint = (id: string) => use(id, 'lint', {});

  it('a chosen step limit stops the run there, and Claude is warned when two steps are left', async () => {
    const doc = sample();
    const state = startAgent(doc, { styles }, 'claude-opus-5-5');
    const { f, calls } = fakeApi(msg([lint('a')]), msg([lint('b')]), msg([lint('c')]), msg([lint('d')]));
    await runAgent(state, 'Check', { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', pictures: false, maxSteps: 3, fetch: f });
    expect(calls).toHaveLength(3);
    expect(state.stop).toBe('steps');
    expect(calls[0].messages[0].content as unknown as { text: string }[]).toEqual([expect.objectContaining({ text: expect.stringContaining('You have at most 3 steps') })]);
    const lastResults = calls[1].messages.at(-1)!.content as { content: { text: string }[] }[];
    expect(lastResults.at(-1)!.content.at(-1)!.text).toBe('2 steps left: wrap up and call finish.');
    const final = calls[2].messages.at(-1)!.content as { content: { text: string }[] }[];
    expect(final.at(-1)!.content.at(-1)!.text).toBe('This is your last step: call finish now.');
  });

  it('a spending limit stops before the next request would go over it', async () => {
    const doc = sample();
    const state = startAgent(doc, { styles }, 'claude-opus-5-5');
    // each request: 2000 in, 300 out, 1000 cache reads, 500 cache writes ≈ $0.0166 at Opus prices
    const { f, calls } = fakeApi(msg([lint('a')]));
    const reply = await runAgent(state, 'Check', { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', pictures: false, maxSteps: 25, maxSpend: 0.05, fetch: f });
    expect(calls).toHaveLength(2); // a third would pass $0.05
    expect(state.stop).toBe('spend');
    expect(reply).toContain('spending limit ($0.05)');
    expect(state.spent).toBeLessThanOrEqual(0.05);
    // no limit: runs to the step limit
    const s2 = startAgent(doc, { styles }, 'claude-opus-5-5');
    await runAgent(s2, 'Check', { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', pictures: false, maxSteps: 4, maxSpend: null, fetch: fakeApi(msg([lint('a')])).f });
    expect(s2.steps).toBe(4);
  });

  it('finish ends the run with a summary, Claude’s own confidence and what is left; a follow-up can go on', async () => {
    const doc = sample();
    const state = startAgent(doc, { styles }, 'claude-opus-5-5');
    const { f } = fakeApi(
      msg([use('t1', 'set_label', { id: 's1', label: 'Browser' }), use('t2', 'finish', { summary: 'Renamed Web to Browser.', confidence: 'medium', remaining: ['Check the arrow label still fits.'] })]),
    );
    const reply = await runAgent(state, 'Rename Web', { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', pictures: false, fetch: f });
    expect(reply).toBe('Renamed Web to Browser.');
    expect(state).toMatchObject({ stop: 'finished', confidence: 'medium', remaining: ['Check the arrow label still fits.'], steps: 1 });
    expect(state.session.doc.elements[0].text).toBe('Browser');
    const more = fakeApi(msg([use('t3', 'finish', { summary: 'Nothing else needed.', confidence: 'high', remaining: [] })]));
    await runAgent(state, 'Anything else?', { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', pictures: false, fetch: more.f });
    expect(state).toMatchObject({ confidence: 'high', steps: 1 });
  });

  it('Stop (abort) ends the run calmly and keeps the draft', async () => {
    const doc = sample();
    const state = startAgent(doc, { styles }, 'claude-opus-5-5');
    const ac = new AbortController();
    const f = (async (_u: string | URL | Request, init?: RequestInit) => {
      ac.abort();
      return new Response(JSON.stringify(msg([use('t1', 'set_label', { id: 's1', label: 'Browser' })])), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const reply = await runAgent(state, 'Rename', { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', pictures: false, signal: ac.signal, fetch: f }).catch((e) => String(e));
    expect(state.stop === 'cancelled' || /Cancelled/.test(String(reply))).toBe(true);
  });

  it('estimates: more steps, high effort and pictures cost more; the limit caps the worst case', () => {
    const text = 'x'.repeat(14000); // about 4,000 tokens of page
    const m = estimateAgentCost('claude-opus-5-5', 'medium', false, text, 5);
    expect(m).toBeGreaterThan(0.01);
    expect(m).toBeLessThan(0.3);
    expect(estimateAgentCost('claude-opus-5-5', 'medium', false, text, 12)).toBeGreaterThan(m);
    expect(estimateAgentCost('claude-opus-5-5', 'high', false, text, 5)).toBeGreaterThan(m);
    expect(estimateAgentCost('claude-opus-5-5', 'medium', true, text, 5)).toBeGreaterThan(m);
    expect(estimateAgentCost('claude-haiku-5-5', 'medium', false, text, 5)).toBeLessThan(m / 10);
    const e = runEstimate('claude-opus-5-5', 'high', true, text, 25, 0.25);
    expect(e.typical).toBeLessThan(e.atLimit + 1e-9);
    expect(e.atLimit).toBeLessThanOrEqual(0.25);
  });

  it('new problems: what the draft breaks that the page did not have', () => {
    const doc = sample();
    const loose = { ...makeConnector({ x: 0, y: 0, elementId: doc.elements[0].id }, { x: 900, y: 0, elementId: null }, defaultToolStyle('arrow')), text: 'dangling' };
    expect(newProblems(doc, doc)).toEqual([]);
    expect(newProblems(doc, { ...doc, elements: [...doc.elements, loose] })).toEqual(['Arrow “dangling” has an end that isn’t attached to anything']);
  });
});
