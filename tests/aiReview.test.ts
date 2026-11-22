import { describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { parseDocument, sanitizeBrief, serializeDocument } from '../src/model/schema';
import { estimateCost, FINDINGS_TOOL, parseReview, reviewText, reviewWithClaude } from '../src/ai/review';
import type { DiagramBrief, FlowDocument, ShapeElement } from '../src/model/types';

const KEY = 'sk-ant-test-0000000000';
const box = (x: number, text: string): ShapeElement => ({ ...makeShape('rectangle', x, 0, 100, 60, defaultToolStyle('shape:rectangle')), text });
function sample(): FlowDocument {
  const a = box(0, 'Browser'), b = box(300, 'Auth server');
  const c = { ...makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 0, y: 0, elementId: b.id }, defaultToolStyle('arrow')), text: '1. password grant', note: 'Uses the implicit flow' };
  return { ...newDocument(), elements: [a, b, c] };
}
const brief: DiagramBrief = { about: 'How a single-page app signs a user in', domain: 'OAuth 2.0 / OIDC', audience: 'developers', assumptions: '', focus: 'Is the grant type right?' };

/** A fake Anthropic API: answers each request with the next reply in the list, and keeps the requests. */
function fakeApi(...replies: unknown[]) {
  const calls: Record<string, unknown>[] = [];
  const f = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    const body = replies[Math.min(calls.length - 1, replies.length - 1)];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, calls };
}
const msg = (content: unknown[], stop = 'tool_use', usage: Record<string, unknown> = { input_tokens: 1000, output_tokens: 200 }) =>
  ({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: stop, stop_sequence: null, content, usage });
const report = (input: unknown) => ({ type: 'tool_use', id: 'toolu_1', name: 'report_findings', input });
const GOOD = {
  summary: 'Shows a SPA sign-in, but with an outdated grant.', verdict: 'needs changes',
  findings: [
    { severity: 'suggestion', category: 'clarity', items: [], title: 'Name the token', explanation: 'Say which token is returned.', suggestion: 'Add "ID token".' },
    { severity: 'error', category: 'factual', items: ['a1', 's2', 'zz9'], title: 'Password grant is deprecated', explanation: 'OAuth 2.0 Security BCP forbids it.', suggestion: 'Use authorization code with PKCE.' },
  ],
  questions: ['Is there a backend for the frontend?'],
};

describe('AI review', () => {
  it('the brief is saved in the file, cleaned and capped; an empty brief is not saved', () => {
    const d = { ...sample(), brief: { ...brief, assumptions: 'x‮y\u0007' + 'z'.repeat(3000) } };
    const back = parseDocument(serializeDocument(d)).doc;
    expect(back.brief!.about).toBe(brief.about);
    expect(back.brief!.assumptions.startsWith('xyz')).toBe(true);
    expect(back.brief!.assumptions.length).toBe(2000);
    expect(sanitizeBrief({ about: ' ', domain: 3 })).toBeNull();
    expect(parseDocument(serializeDocument({ ...sample(), brief: { about: '', domain: '', audience: '', assumptions: '', focus: '' } })).doc.brief).toBeUndefined();
  });

  it('what is sent: the brief, the page with short ids, play order and automatic checks; notes only when asked', () => {
    const { text, view } = reviewText(sample(), brief, false);
    expect(text).toContain('System or domain: OAuth 2.0 / OIDC');
    expect(text).toContain('"label":"1. password grant"');
    expect(text).toContain('all arrows play at the same time');
    expect(text).not.toContain('implicit flow');
    expect([...view.ids.keys()]).toEqual(['s1', 's2', 'a1']);
    expect(reviewText(sample(), brief, true).text).toContain('- a1: Uses the implicit flow');
    expect(reviewText(sample(), null, false).text).toContain('(no brief given');
  });

  it('checks the report: known ids only, errors first, text cleaned, verdict kept', () => {
    const { view } = reviewText(sample(), brief, false);
    const r = parseReview({ ...GOOD, findings: [...GOOD.findings, { severity: 'loud', category: 'x', items: 'a1', title: '', explanation: 'no title' }, { severity: 'warning', category: 'naming', items: ['s1'], title: 'Bad‮ name\u0000', explanation: '', suggestion: '' }] }, view);
    expect(r.findings.map((f) => f.title)).toEqual(['Password grant is deprecated', 'Bad name', 'Name the token']);
    expect(r.findings[0].ids).toEqual([view.ids.get('a1'), view.ids.get('s2')]); // the unknown "zz9" is dropped
    expect(r.dropped).toBe(1); // the finding without a title
    expect(r.verdict).toBe('needs changes');
    expect(r.questions).toEqual(['Is there a backend for the frontend?']);
    expect(parseReview('not an object', view)).toMatchObject({ summary: '', verdict: 'looks right', findings: [], questions: [] });
  });

  it('sends one request with the strict report tool, the picture, and the chosen effort; reads the report', async () => {
    const { f, calls } = fakeApi(msg([{ type: 'text', text: 'Reviewing.' }, report(GOOD)]));
    const r = await reviewWithClaude(sample(), brief, { apiKey: KEY, model: 'claude-opus-5-5', effort: 'high', webSearch: false, includeNotes: false, image: { mediaType: 'image/png', data: 'iVBORw0KGgo=' }, fetch: f });
    expect(calls).toHaveLength(1);
    const body = calls[0] as { tools: { name: string; strict?: boolean; type?: string }[]; output_config: { effort: string }; messages: { content: { type: string }[] }[] };
    expect(body.tools).toEqual([expect.objectContaining({ name: 'report_findings', strict: true })]);
    expect(body.output_config.effort).toBe('high');
    expect(body.messages[0].content.map((c) => c.type)).toEqual(['text', 'image']);
    expect(r.findings[0].title).toBe('Password grant is deprecated');
    expect(r.usage).toEqual({ input: 1000, output: 200, cacheRead: 0, webSearches: 0 });
    expect(estimateCost('claude-opus-5-5', r.usage)).toBeCloseTo(0.008, 5);
  });

  it('with web search: offers the search tool, resumes a paused turn, and keeps only web links as sources', async () => {
    const searched = { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [
      { type: 'web_search_result', url: 'https://datatracker.ietf.org/doc/rfc9700/', title: 'OAuth 2.0 Security BCP' },
      { type: 'web_search_result', url: 'javascript:alert(1)', title: 'bad' },
    ] };
    const { f, calls } = fakeApi(
      msg([{ type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'oauth password grant' } }, searched], 'pause_turn', { input_tokens: 500, output_tokens: 50, server_tool_use: { web_search_requests: 1 } }),
      msg([report(GOOD)]),
    );
    const r = await reviewWithClaude(sample(), brief, { apiKey: KEY, model: 'claude-sonnet-5-5', effort: 'medium', webSearch: true, includeNotes: false, fetch: f });
    expect(calls).toHaveLength(2);
    expect((calls[0] as { tools: { type?: string; name: string }[] }).tools.map((t) => t.type ?? t.name)).toEqual(['report_findings', 'web_search_20260209']);
    const resumed = calls[1] as { messages: { role: string }[] };
    expect(resumed.messages.map((m) => m.role)).toEqual(['user', 'assistant']); // re-sent as it was, no extra "continue"
    expect(r.sources).toEqual([{ url: 'https://datatracker.ietf.org/doc/rfc9700/', title: 'OAuth 2.0 Security BCP' }]);
    expect(r.usage.webSearches).toBe(1);
    expect(r.usage.input).toBe(1500);
  });

  it('a reply without the report gets one reminder; refusals, empty pages and missing keys are plain errors', async () => {
    const { f, calls } = fakeApi(msg([{ type: 'text', text: 'Looks fine to me.' }], 'end_turn'), msg([report({ ...GOOD, findings: [] })]));
    const r = await reviewWithClaude(sample(), brief, { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', webSearch: false, includeNotes: false, fetch: f });
    expect(calls).toHaveLength(2);
    expect((calls[1] as { messages: { role: string; content: unknown }[] }).messages.at(-1)!.content).toContain('report_findings');
    expect(r.findings).toEqual([]);
    const never = fakeApi(msg([{ type: 'text', text: 'Fine.' }], 'end_turn'));
    await expect(reviewWithClaude(sample(), brief, { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', webSearch: false, includeNotes: false, fetch: never.f })).rejects.toThrow('did not return a review');
    expect(never.calls).toHaveLength(2);
    const refused = fakeApi(msg([], 'refusal'));
    await expect(reviewWithClaude(sample(), brief, { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', webSearch: false, includeNotes: false, fetch: refused.f })).rejects.toThrow('declined');
    await expect(reviewWithClaude({ ...sample(), elements: [] }, brief, { apiKey: KEY, model: 'claude-opus-5-5', effort: 'medium', webSearch: false, includeNotes: false })).rejects.toThrow('empty');
    await expect(reviewWithClaude(sample(), brief, { apiKey: '', model: 'claude-opus-5-5', effort: 'medium', webSearch: false, includeNotes: false })).rejects.toThrow('API key');
  });

  it('the report tool schema is strict-compatible (every object closed, every property required)', () => {
    const check = (s: Record<string, unknown>) => {
      if (s.type === 'object') {
        expect(s.additionalProperties).toBe(false);
        expect([...(s.required as string[])].sort()).toEqual(Object.keys(s.properties as object).sort());
        for (const v of Object.values(s.properties as Record<string, Record<string, unknown>>)) check(v);
      }
      if (s.type === 'array') check(s.items as Record<string, unknown>);
    };
    check(FINDINGS_TOOL.input_schema);
  });
});
