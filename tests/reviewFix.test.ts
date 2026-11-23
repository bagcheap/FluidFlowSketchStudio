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
