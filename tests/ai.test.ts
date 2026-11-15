import { describe, expect, it } from 'vitest';
import { buildMessages, cleanKey, drawWithClaude, extractMermaid, SYSTEM_PROMPT } from '../src/ai/describe';
import { parseMermaid } from '../src/import/mermaid';

const KEY = 'sk-ant-test-0123456789';

/** A fetch that records the request and answers like the Messages API. */
function fakeFetch(reply: { status?: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, calls };
}

const message = (text: string, stop = 'end_turn') => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: stop, stop_sequence: null,
  content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 20 },
});

describe('AI describe-a-diagram', () => {
  it('reads the Mermaid out of a reply: mermaid fence, any fence, bare text, or nothing', () => {
    expect(extractMermaid('Here you go:\n```mermaid\nflowchart LR\n  A --> B\n```\nEnjoy')).toBe('flowchart LR\n  A --> B');
    expect(extractMermaid('```\ngraph TD\nA-->B\n```')).toBe('graph TD\nA-->B');
    expect(extractMermaid('sequenceDiagram\n  A->>B: hi')).toBe('sequenceDiagram\n  A->>B: hi');
    expect(extractMermaid('```mermaid\nflowchart LR\n  A --> B')).toBe('flowchart LR\n  A --> B'); // cut off: still read
    expect(extractMermaid('Sorry, I can only help with diagrams.')).toBe('');
  });

  it('builds the conversation: description, then each draft and change request', () => {
    const m = buildMessages([
      { role: 'user', text: 'login flow' }, { role: 'assistant', text: 'flowchart LR\nA-->B' }, { role: 'user', text: 'add a cache' },
    ]);
    expect(m.map((x) => x.role)).toEqual(['user', 'assistant', 'user']);
    expect(m[1].content).toBe('```mermaid\nflowchart LR\nA-->B\n```');
  });

  it('only accepts plausible keys', () => {
    expect(cleanKey(`  ${KEY}  `)).toBe(KEY);
    expect(cleanKey('short')).toBe('');
    expect(cleanKey('has space in it 123')).toBe('');
    expect(cleanKey(42)).toBe('');
  });

  it('sends the description to the Messages API with the key and returns the drawn Mermaid', async () => {
    const { f, calls } = fakeFetch({ body: message('```mermaid\nflowchart LR\n  U([User]) -->|1. sign in| W[Web app]\n  W -->|2. check| A[(Auth)]\n```') });
    const out = await drawWithClaude([{ role: 'user', text: 'A user signs in to the web app, which checks auth' }], { apiKey: KEY, model: 'claude-opus-5-5', fetch: f });
    expect(parseMermaid(out).nodes.length).toBe(3);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    const h = new Headers(calls[0].init.headers);
    expect(h.get('authorization') ?? h.get('x-api-key')).toContain(KEY);
    expect(h.get('anthropic-beta')).toBe('server-side-fallback-2026-07-01');
    expect(h.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.system).toBe(SYSTEM_PROMPT);
    expect(body.messages).toEqual([{ role: 'user', content: 'A user signs in to the web app, which checks auth' }]);
    expect(body.fallbacks).toBe('default');
    expect(body.thinking).toBeUndefined(); // adaptive by default
  });

  it('explains failures plainly: bad key, refusal, no diagram, missing key', async () => {
    const bad = fakeFetch({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
    await expect(drawWithClaude([{ role: 'user', text: 'x' }], { apiKey: KEY, model: 'claude-sonnet-5-5', fetch: bad.f })).rejects.toThrow(/did not accept that API key/);
    const refused = fakeFetch({ body: message('', 'refusal') });
    await expect(drawWithClaude([{ role: 'user', text: 'x' }], { apiKey: KEY, model: 'claude-opus-5-5', fetch: refused.f })).rejects.toThrow(/declined/);
    const chat = fakeFetch({ body: message('I would draw two boxes.') });
    await expect(drawWithClaude([{ role: 'user', text: 'x' }], { apiKey: KEY, model: 'claude-opus-5-5', fetch: chat.f })).rejects.toThrow(/did not reply with a diagram/);
    const none = fakeFetch({ body: message('') });
    await expect(drawWithClaude([{ role: 'user', text: 'x' }], { apiKey: '', model: 'claude-opus-5-5', fetch: none.f })).rejects.toThrow(/API key/);
    expect(none.calls.length).toBe(0); // nothing sent without a key
  });

  it('Haiku requests carry no fallback setting', async () => {
    const { f, calls } = fakeFetch({ body: message('```mermaid\nflowchart LR\nA-->B\n```') });
    await drawWithClaude([{ role: 'user', text: 'two boxes' }], { apiKey: KEY, model: 'claude-haiku-5-5', fetch: f });
    expect(JSON.parse(String(calls[0].init.body)).fallbacks).toBeUndefined();
  });
});

describe('AI session kept on this computer', () => {
  it('saves and restores prompts, draft and the prompt box; stored data is checked', async () => {
    const { saveSession, loadSession, cleanSession } = await import('../src/ai/describe');
    saveSession({ turns: [{ role: 'user', text: 'login flow' }, { role: 'assistant', text: 'flowchart LR\nA-->B' }], draft: 'flowchart LR\nA-->B-->C', ask: 'login flow' });
    expect(loadSession()).toEqual({ turns: [{ role: 'user', text: 'login flow' }, { role: 'assistant', text: 'flowchart LR\nA-->B' }], draft: 'flowchart LR\nA-->B-->C', ask: 'login flow' });
    // hostile or damaged data
    expect(cleanSession({ turns: [{ role: 'system', text: 'x' }, { role: 'assistant', text: 'orphan' }, { role: 'user', text: 42 }, { role: 'user', text: 'ok' }], draft: 7, ask: 'a'.repeat(50_000) }))
      .toEqual({ turns: [{ role: 'user', text: 'ok' }], draft: '', ask: 'a'.repeat(20_000) });
    localStorage.setItem('flowsketch:aiSession', '{not json');
    expect(loadSession()).toEqual({ turns: [], draft: '', ask: '' });
  });
});
