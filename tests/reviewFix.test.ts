import { beforeEach, describe, expect, it } from 'vitest';
import { defaultToolStyle, makeShape, newDocument } from '../src/model/defaults';
import { applyAgentDraft, closeAgent, fixFindings, fixFindingsRequest, markFindings, toolContext } from '../src/store/commands';
import { useDoc } from '../src/store/docStore';
import { useUI } from '../src/store/uiStore';
import { reviewToMarkdown, type AiReview, type Finding } from '../src/ai/review';
import { runTool, startSession } from '../src/ai/toolkit';

const finding = (title: string, ids: string[] = []): Finding => ({ severity: 'warning', category: 'missing', title, explanation: `Why ${title}`, suggestion: `Do ${title}`, ids });

function setup() {
  const a = { ...makeShape('rectangle', 0, 0, 120, 60, defaultToolStyle('shape:rectangle')), text: 'API' };
  const doc = { ...newDocument(), elements: [a] };
  useDoc.getState().load(doc);
  const r: AiReview = {
    docId: doc.id, pageId: doc.activePage, at: 0, model: 'claude-opus-5-5', effort: 'medium', summary: '', verdict: 'needs changes',
    findings: [finding('No token step', [a.id]), finding('Wrong order'), finding('Missing cache')], questions: [], sources: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0 }, dropped: 0,
  };
  useUI.getState().setAiReview(r);
  useUI.getState().setReview(true);
  return { a, doc };
}

describe('fixing review findings with Claude', () => {
  beforeEach(() => { useUI.getState().setAgent(false); useUI.getState().setAiReview(null); });

  it('one request for several findings, numbered, each with its suggestion and items', () => {
    const { a } = setup();
    const text = fixFindingsRequest([finding('No token step', [a.id]), finding('Wrong order')]);
    expect(text).toMatch(/^Fix these 2 problems found in a review/);
    expect(text).toContain('1. No token step.\nWhy No token step\nSuggested change: Do No token step\nIt concerns: “API”.');
    expect(text).toContain('2. Wrong order.');
    expect(fixFindingsRequest([finding('Only one')])).toMatch(/^Fix this problem found in a review: Only one\./);
  });

  it('Apply marks the findings it was for as fixed, and closing brings the review list back', () => {
    setup();
    fixFindings([0, 2]);
    const ui = useUI.getState();
    expect(ui.agentOpen).toBe(true);
    expect(ui.review).toBe(false); // the Review panel steps aside while the agent works
    expect(ui.agentFixing).toEqual([0, 2]);
    expect(ui.agentSeed).toContain('1. No token step.');
    expect(ui.agentSeed).toContain('2. Missing cache.');
    // the agent changes the draft; Apply puts it in the document
    const s = startSession(useDoc.getState().doc, toolContext());
    runTool(s, 'add_shape', { label: 'Cache', shape: 'cylinder', near: 's1', place: 'below', container: null });
    expect(applyAgentDraft(s)).toBe(true);
    expect(useUI.getState().aiReview!.fixed).toEqual([0, 2]);
    closeAgent();
    expect(useUI.getState().review).toBe(true);
    expect(useUI.getState().agentFixing).toEqual([]);
  });

  it('Discard or close without applying marks nothing; findings can be marked by hand and unmarked', () => {
    setup();
    fixFindings([1]);
    closeAgent();
    expect(useUI.getState().aiReview!.fixed ?? []).toEqual([]);
    expect(useUI.getState().review).toBe(true);
    markFindings([1, 9], true); // out of range ignored
    expect(useUI.getState().aiReview!.fixed).toEqual([1]);
    markFindings([1], false);
    expect(useUI.getState().aiReview!.fixed).toEqual([]);
  });

  it('the review panel stays closed after the agent if it was closed before', () => {
    setup();
    useUI.getState().setReview(false);
    fixFindings([0]);
    closeAgent();
    expect(useUI.getState().review).toBe(false);
  });

  it('saved notes say which findings were fixed', () => {
    setup();
    markFindings([1], true);
    const md = reviewToMarkdown(useUI.getState().aiReview!, { title: 'T', page: 'P', brief: null, nameOf: () => null, modelLabel: 'M', when: 'now' });
    expect(md).toContain('### 2. Wrong order\n\n**Warning** · missing · fixed');
    expect(md).toContain('### 1. No token step\n\n**Warning** · missing\n');
  });
});

describe('the last review comes back', () => {
  it('Show last review brings back a closed review with its fixed marks', async () => {
    const { a } = setup();
    const { showAiReview, showLastReview, hasLastReview } = await import('../src/store/commands');
    showAiReview(useUI.getState().aiReview!);
    markFindings([2], true);
    await new Promise((r) => setTimeout(r, 0));
    useUI.getState().setAiReview(null);
    useUI.getState().setReview(false);
    expect(hasLastReview()).toBe(true);
    await showLastReview();
    const r = useUI.getState().aiReview!;
    expect(useUI.getState().review).toBe(true);
    expect(r.findings.map((f) => f.title)).toEqual(['No token step', 'Wrong order', 'Missing cache']);
    expect(r.fixed).toEqual([2]);
    expect(r.findings[0].ids).toEqual([a.id]);
  });

  it('a stored review is checked again: wrong page, hostile fields, items no longer on the page', async () => {
    const { cleanStoredReview } = await import('../src/ai/review');
    const onPage = new Set(['keep']);
    expect(cleanStoredReview({ docId: 'd', pageId: 'other' }, 'd', 'p', onPage)).toBeNull();
    expect(cleanStoredReview('nope', 'd', 'p', onPage)).toBeNull();
    const r = cleanStoredReview({
      docId: 'd', pageId: 'p', at: 5, model: 'evil', effort: 'max', verdict: 'pwned', summary: 'x'.repeat(5000),
      findings: [{ title: 'T‮', severity: 'fatal', category: 'zzz', ids: ['keep', 'gone', 7], explanation: 1 }, { title: '' }],
      sources: [{ url: 'javascript:alert(1)', title: 'bad' }, { url: 'https://example.com/a', title: 'ok' }],
      fixed: [0, 0, 5, -1, 'x'], usage: { input: -3, output: 'lots' }, dropped: 1e9,
    }, 'd', 'p', onPage)!;
    expect(r.model).toBe('claude-opus-5-5');
    expect(r.effort).toBe('medium');
    expect(r.verdict).toBe('minor issues');
    expect(r.summary.length).toBe(2000);
    expect(r.findings).toEqual([{ severity: 'suggestion', category: 'other', title: 'T', explanation: '', suggestion: '', ids: ['keep'] }]);
    expect(r.sources).toEqual([{ url: 'https://example.com/a', title: 'ok' }]);
    expect(r.fixed).toEqual([0]);
    expect(r.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0 });
    expect(r.dropped).toBe(1000);
  });

  it('no saved review: says so', async () => {
    const { a } = setup();
    void a;
    useUI.getState().setAiReview(null);
    const { showLastReview, hasLastReview } = await import('../src/store/commands');
    const doc = { ...useDoc.getState().doc, id: 'fresh-doc' };
    useDoc.getState().load(doc);
    expect(hasLastReview()).toBe(false);
    await showLastReview();
    expect(useUI.getState().aiReview).toBeNull();
  });
});

describe('answering Claude’s questions', () => {
  it('answers are kept with the review, come back with it, and go with fixes', async () => {
    setup();
    const { answerQuestion, showAiReview, showLastReview, fixFindingsRequest: req } = await import('../src/store/commands');
    showAiReview({ ...useUI.getState().aiReview!, questions: ['Is OBO done in the agent on purpose?', 'Where is the agent deployed?'] });
    answerQuestion(0, 'Yes: the gateway can’t reach Entra.');
    expect(useUI.getState().aiReview!.answers).toEqual(['Yes: the gateway can’t reach Entra.', '']);
    expect(req([finding('Wrong order')])).toContain("The author answered the review's questions:\n- Q: Is OBO done in the agent on purpose?\n  A: Yes: the gateway can’t reach Entra.");
    await new Promise((r) => setTimeout(r, 450)); // saved a moment after typing stops
    useUI.getState().setAiReview(null);
    await showLastReview();
    expect(useUI.getState().aiReview!.answers).toEqual(['Yes: the gateway can’t reach Entra.', '']);
    const md = reviewToMarkdown(useUI.getState().aiReview!, { title: 'T', page: 'P', brief: null, nameOf: () => null, modelLabel: 'M', when: 'now' });
    expect(md).toContain('- Is OBO done in the agent on purpose?\n  - **Answer:** Yes: the gateway can’t reach Entra.');
  });

  it('the next review sends the answered questions; stored answers stay in step with their questions', async () => {
    const { reviewText, cleanStoredReview, answeredOf } = await import('../src/ai/review');
    const { doc } = setup();
    const text = reviewText(doc, null, false, [{ q: 'Where is it deployed?', a: 'Cloud Run' }]).text;
    expect(text).toContain('## Your questions from the last review, answered by the author\nQ: Where is it deployed?\nA: Cloud Run');
    expect(reviewText(doc, null, false).text).not.toContain('answered by the author');
    const r = cleanStoredReview({ docId: doc.id, pageId: doc.activePage, questions: ['', 'Second?', 'Third?'], answers: ['dropped with its empty question', 'two', 42] }, doc.id, doc.activePage, new Set())!;
    expect(r.questions).toEqual(['Second?', 'Third?']);
    expect(r.answers).toEqual(['two', '']);
    expect(answeredOf(r)).toEqual([{ q: 'Second?', a: 'two' }]);
  });
});

describe('panel place', () => {
  it('a remembered place is type-checked and clamped', async () => {
    const { loadPanelPos } = await import('../src/ui/panelSize');
    localStorage.setItem('flowsketch:panelPos:t', JSON.stringify({ x: 120.4, y: -30 }));
    expect(loadPanelPos('t')).toEqual({ x: 120, y: 0 });
    localStorage.setItem('flowsketch:panelPos:t', '{"x":"1"}');
    expect(loadPanelPos('t')).toBeNull();
    localStorage.setItem('flowsketch:panelPos:t', 'nonsense');
    expect(loadPanelPos('t')).toBeNull();
  });
});
