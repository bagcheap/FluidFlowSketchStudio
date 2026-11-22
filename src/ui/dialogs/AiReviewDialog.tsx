// Review with Claude (AI): the diagram brief, what to include, then Claude checks the page against the brief and its
// knowledge of the domain. Findings appear in the Review panel. Opt-in: nothing is sent until Review is pressed, and
// only with the user's own key. "What will be sent" shows the exact text.
import { useRef, useState } from 'react';
import { useUI } from '../../store/uiStore';
import { useDoc } from '../../store/docStore';
import * as cmd from '../../store/commands';
import { Modal } from './Modal';
import { Segmented } from '../controls';
import { KeyRows, useApiKey } from './AiDialog';
import { savedModel, storeModel, type AiModel } from '../../ai/describe';
import { estimateCost, loadChoices, reviewText, reviewWithClaude, saveChoices, type ReviewChoices } from '../../ai/review';
import { pageSnapshot } from '../../export/staticExport';
import { BRIEF_MAX } from '../../model/schema';
import type { DiagramBrief } from '../../model/types';

const EMPTY: DiagramBrief = { about: '', domain: '', audience: '', assumptions: '', focus: '' };
const FIELDS: { key: keyof DiagramBrief; label: string; placeholder: string; rows: number }[] = [
  { key: 'about', label: 'What it shows', rows: 3, placeholder: 'e.g. How a user signs in to our web app with their company account and how the app then calls our API on their behalf.' },
  { key: 'domain', label: 'System or domain', rows: 1, placeholder: 'e.g. Microsoft Entra ID, OAuth 2.0 / OpenID Connect, Google Cloud' },
  { key: 'audience', label: 'Audience', rows: 1, placeholder: 'e.g. developers new to the project' },
  { key: 'assumptions', label: 'Assumptions', rows: 2, placeholder: 'e.g. Single tenant. Tokens are cached by the backend, not the browser.' },
  { key: 'focus', label: 'What to check', rows: 2, placeholder: 'e.g. Is the token flow correct and in the right order? Anything missing?' },
];

/** "about $0.12" */
export const money = (usd: number) => (usd < 0.01 ? 'under $0.01' : `about $${usd.toFixed(2)}`);

export function AiReviewDialog() {
  const api = useApiKey();
  const doc = useDoc((s) => s.doc);
  const [model, setModel] = useState<AiModel>(savedModel);
  const [brief, setBrief] = useState<DiagramBrief>(() => ({ ...EMPTY, ...(useDoc.getState().doc.brief ?? {}) }));
  const [choices, setChoices] = useState<ReviewChoices>(loadChoices);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const choose = (c: Partial<ReviewChoices>) => setChoices((o) => { const n = { ...o, ...c }; saveChoices(n); return n; });
  const close = () => { abort.current?.abort(); cmd.setBrief(brief); useUI.getState().openDialog(null); };
  const preview = reviewText(doc, brief, choices.includeNotes).text;
  const empty = !doc.elements.length;

  const review = async () => {
    if (busy || empty) return;
    await api.keep();
    storeModel(model);
    cmd.setBrief(brief);
    const d = useDoc.getState().doc;
    setBusy(true); setError('');
    abort.current = new AbortController();
    try {
      const image = choices.includeImage ? await pageSnapshot(d) : null;
      const r = await reviewWithClaude(d, d.brief ?? null, { apiKey: api.key, model, effort: choices.effort, webSearch: choices.webSearch, includeNotes: choices.includeNotes, image, signal: abort.current.signal });
      cmd.showAiReview({ ...r, docId: d.id, pageId: d.activePage, at: Date.now() });
      const n = r.findings.length;
      useUI.getState().toast(`Claude's review: ${n ? `${n} finding${n === 1 ? '' : 's'}` : 'no problems found'} (${money(estimateCost(model, r.usage))}${r.usage.webSearches ? ` + ${r.usage.webSearches} web search${r.usage.webSearches === 1 ? '' : 'es'}` : ''})`, 'success');
      useUI.getState().openDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  return (
    <Modal title="Review with Claude (AI)" wide footer={<>
      <button className="btn" onClick={close}>{busy ? 'Cancel' : 'Close'}</button>
      <button className="btn primary" data-testid="ai-review" disabled={busy || empty || !api.key.trim()} onClick={() => void review()}>{busy ? 'Reviewing…' : 'Review'}</button>
    </>}>
      <p className="note">Claude checks this page against what you say it shows and what it knows about the subject: wrong or outdated facts, missing steps, wrong order or direction, naming. The findings appear in the Review panel. This needs internet and your own <b>Anthropic API key</b>, and costs a few cents. When you press <b>Review</b>, the brief and this page's labels, shapes and arrows are sent to Anthropic (see what will be sent below). Other pages are not sent.</p>
      <fieldset className="ai-brief">
        <legend>Brief <span className="note">(saved with the diagram)</span></legend>
        {FIELDS.map((f) => <div className="ai-row" key={f.key}>
          <label className="row-label" htmlFor={`brief-${f.key}`}>{f.label}</label>
          {f.rows > 1
            ? <textarea id={`brief-${f.key}`} rows={f.rows} maxLength={BRIEF_MAX} placeholder={f.placeholder} value={brief[f.key]} onChange={(e) => setBrief({ ...brief, [f.key]: e.target.value })} />
            : <input id={`brief-${f.key}`} maxLength={BRIEF_MAX} placeholder={f.placeholder} value={brief[f.key]} onChange={(e) => setBrief({ ...brief, [f.key]: e.target.value })} />}
        </div>)}
      </fieldset>
      <KeyRows api={api} model={model} setModel={setModel} />
      <div className="ai-row">
        <span className="row-label">Effort</span>
        <Segmented label="Effort" value={choices.effort} onChange={(v) => choose({ effort: v })} options={[{ v: 'medium', label: 'Medium', title: 'Thorough and cheaper (recommended)' }, { v: 'high', label: 'High', title: 'Thinks longer: for large or important diagrams; costs more' }]} />
      </div>
      <div className="ai-row ai-options">
        <label className="ai-check"><input type="checkbox" checked={choices.includeImage} onChange={(e) => choose({ includeImage: e.target.checked })} /> Include a picture of the page</label>
        <label className="ai-check"><input type="checkbox" checked={choices.includeNotes} onChange={(e) => choose({ includeNotes: e.target.checked })} /> Include hover notes</label>
        <label className="ai-check" title="Claude may search the web for facts that changed after its training. Each search costs extra, and your organisation may need to turn web search on in the Anthropic Console.">
          <input type="checkbox" checked={choices.webSearch} onChange={(e) => choose({ webSearch: e.target.checked })} /> Search the web for current facts (costs extra)
        </label>
      </div>
      <details className="ai-sent">
        <summary>What will be sent</summary>
        <pre data-testid="ai-review-preview">{preview}{choices.includeImage ? '\n\n(+ a picture of this page)' : ''}</pre>
      </details>
      {empty && <p className="note">This page is empty: there is nothing to review.</p>}
      {error && <p className="ai-error" role="alert">{error}</p>}
    </Modal>
  );
}
