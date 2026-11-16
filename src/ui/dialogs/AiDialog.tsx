// Insert ▸ Describe a diagram (AI): type what you want, Claude replies with Mermaid, you check (or edit) the draft,
// ask for changes, then insert it. Opt-in: nothing is sent until Draw is pressed, and only with the user's own key.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useUI } from '../../store/uiStore';
import * as cmd from '../../store/commands';
import { parseMermaid } from '../../import/mermaid';
import { isSequence, parseSequence } from '../../import/mermaidSequence';
import { Modal } from './Modal';
import { useDoc } from '../../store/docStore';
import { describeOps, describePage, parseEdits, type EditOp, type PageView } from '../../ai/edits';
import {
  AI_MODELS, drawWithClaude, editWithClaude, forgetKey, isKeyRemembered, loadSession, MAX_PROMPT_CHARS, saveSession, savedKey, savedModel, storeKey, storeModel,
  type AiModel, type AiTurn,
} from '../../ai/describe';

/** The API key and model rows, shared by both AI dialogs. */
function KeyRows({ k, setK, remember, setRemember, model, setModel }: { k: string; setK: (v: string) => void; remember: boolean; setRemember: (v: boolean) => void; model: AiModel; setModel: (m: AiModel) => void }) {
  return <>
    <div className="ai-row">
      <label className="row-label" htmlFor="ai-key">API key</label>
      <input id="ai-key" className="ai-key" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={k} onChange={(e) => setK(e.target.value)} />
      <label className="ai-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this computer</label>
      {isKeyRemembered() && <button className="btn small" onClick={() => { forgetKey(); setK(''); setRemember(false); }}>Forget key</button>}
    </div>
    <div className="ai-row">
      <label className="row-label" htmlFor="ai-model">Model</label>
      <select id="ai-model" value={model} onChange={(e) => setModel(e.target.value as AiModel)}>
        {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
    </div>
  </>;
}

const PLACEHOLDER = 'e.g. A user signs in through the web app, which checks the auth service, then loads their orders from the API and its database.';

function summary(text: string): { count: number; line: string } {
  if (isSequence(text)) {
    const s = parseSequence(text);
    return { count: s.participants.length, line: `Sequence diagram: ${s.participants.length} participants, ${s.steps.filter((x) => x.k === 'msg').length} messages.` };
  }
  const g = parseMermaid(text);
  return { count: g.nodes.length, line: g.nodes.length ? `${g.nodes.length} shapes, ${g.edges.length} arrows${g.groups.length ? `, ${g.groups.length} containers` : ''}.` : 'No shapes in this draft.' };
}

export function AiDialog() {
  const [key, setKey] = useState(savedKey);
  const [remember, setRemember] = useState(isKeyRemembered);
  const [model, setModel] = useState<AiModel>(savedModel);
  const [saved] = useState(loadSession); // the last session on this computer, shown again
  const [ask, setAsk] = useState(saved.ask);
  const [turns, setTurns] = useState<AiTurn[]>(saved.turns); // the conversation behind the current draft
  const [draft, setDraft] = useState(saved.draft);
  // keep the session (prompts, draft as edited, the prompt box) so reopening the dialog shows it again
  useEffect(() => { saveSession({ turns, draft, ask }); }, [turns, draft, ask]);
  const prompts = turns.filter((t) => t.role === 'user').map((t) => t.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const info = useMemo(() => (draft ? summary(draft) : null), [draft]);
  const close = () => { abort.current?.abort(); useUI.getState().openDialog(null); };

  /** Draw: from the prompt alone (fresh), or as a change to the current draft (refine). */
  const draw = async (refine: boolean) => {
    if (busy || !ask.trim()) return;
    storeKey(key, remember);
    storeModel(model);
    // refining: the draft as it is now (the user may have edited it), then the change
    const history: AiTurn[] = refine && draft ? [...turns.slice(0, -1), { role: 'assistant', text: draft }] : [];
    const next: AiTurn[] = [...history, { role: 'user', text: ask.trim() }];
    setBusy(true); setError('');
    abort.current = new AbortController();
    try {
      const mermaid = await drawWithClaude(next, { apiKey: key, model, signal: abort.current.signal });
      setTurns([...next, { role: 'assistant', text: mermaid }]);
      setDraft(mermaid); // the prompt stays in the box, to tweak and try again
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };
  const insert = () => { if (draft && cmd.importMermaid(draft)) close(); };
  const startOver = () => { setTurns([]); setDraft(''); setAsk(''); setError(''); };

  return (
    <Modal title="Describe a diagram (AI)" wide footer={<>
      {draft && <button className="btn" onClick={startOver} disabled={busy}>Start over</button>}
      <button className="btn" onClick={close}>{busy ? 'Cancel' : 'Close'}</button>
      <button className="btn primary" data-testid="ai-insert" disabled={busy || !info?.count} onClick={insert}>Insert diagram</button>
    </>}>
      <p className="note">Describe the diagram in your own words and Claude drafts it. You can check the draft, ask for changes, then insert it. This needs internet and your own <b>Anthropic API key</b> (create one at platform.claude.com under API keys; usage is billed to your Anthropic account; see the README for step-by-step help). Only what you type here is sent to Anthropic, and only when you press <b>{draft ? 'Draw again' : 'Draw it'}</b> or <b>Change draft</b>. Your prompts and the last draft are kept on this computer, so they are here again next time.</p>
      <KeyRows k={key} setK={setKey} remember={remember} setRemember={setRemember} model={model} setModel={setModel} />
      {prompts.length > 0 && <details className="note ai-prompts" open={prompts.length > 1}>
        <summary>{prompts.length === 1 ? 'Prompt used for this draft' : `Prompts used for this draft (${prompts.length})`}</summary>
        <ol>{prompts.map((p, i) => <li key={i}>
          <span className="ai-prompt-text">{p}</span>
          <button className="btn small" title="Put this prompt back in the box to tweak it" onClick={() => setAsk(p)}>Edit</button>
        </li>)}</ol>
      </details>}
      <textarea className="mermaid-text ai-ask" aria-label="Prompt" data-testid="ai-prompt" maxLength={MAX_PROMPT_CHARS}
        placeholder={draft ? 'Tweak the description and Draw again, or say what should change (e.g. Add a cache between the API and the database) and Change draft.' : PLACEHOLDER}
        value={ask} onChange={(e) => setAsk(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void draw(!!draft); } }} />
      <div className="ai-row">
        <button className={`btn ${draft ? '' : 'primary'}`} data-testid="ai-draw" disabled={busy || !ask.trim() || !key.trim()} onClick={() => void draw(false)}
          title={draft ? 'Draw a new draft from just this prompt' : undefined}>
          {busy ? 'Asking Claude…' : draft ? 'Draw again' : 'Draw it'}
        </button>
        {draft && !busy && <button className="btn primary" data-testid="ai-change" disabled={!ask.trim() || !key.trim()} onClick={() => void draw(true)}
          title="Send the current draft with this prompt as the change to make">Change draft</button>}
        {error && <span className="ai-error" role="alert">{error}</span>}
      </div>
      {draft && <>
        <p className="note">Draft (Mermaid; you can edit it):</p>
        <textarea className="mermaid-text" aria-label="Draft diagram" data-testid="ai-draft" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <p className={`note ${info?.count ? 'ok' : ''}`} aria-live="polite">{info?.line}</p>
      </>}
    </Modal>
  );
}

// ---- Change this page (AI) ------------------------------------------------------------------------------------------

const EDIT_ASK = 'flowsketch:aiEditAsk';
const lastEditAsk = () => { try { const v = localStorage.getItem(EDIT_ASK); return typeof v === 'string' ? v.slice(0, MAX_PROMPT_CHARS) : ''; } catch { return ''; } };

/**
 * Change this page with AI: say what to change; Claude gets the page (labels, kinds, colours, positions, arrows) and
 * replies with edit operations, which are checked and listed in plain words. Untick any you don't want, then Apply
 * (one undo step). Nothing is sent until "Suggest changes" is pressed.
 */
export function AiEditDialog() {
  const [key, setKey] = useState(savedKey);
  const [remember, setRemember] = useState(isKeyRemembered);
  const [model, setModel] = useState<AiModel>(savedModel);
  const [ask, setAsk] = useState(lastEditAsk);
  useEffect(() => { try { localStorage.setItem(EDIT_ASK, ask); } catch { /* storage unavailable */ } }, [ask]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<{ view: PageView; summary: string; ops: EditOp[]; lines: string[]; dropped: number } | null>(null);
  const [off, setOff] = useState<Set<number>>(new Set()); // unticked changes
  const abort = useRef<AbortController | null>(null);
  const count = useDoc((s) => s.doc.elements.length);
  const close = () => { abort.current?.abort(); useUI.getState().openDialog(null); };

  const suggest = async () => {
    if (busy || !ask.trim()) return;
    storeKey(key, remember);
    storeModel(model);
    const doc = useDoc.getState().doc;
    const view = describePage(doc);
    setBusy(true); setError(''); setPlan(null); setOff(new Set());
    abort.current = new AbortController();
    try {
      const raw = await editWithClaude(view.json, ask, { apiKey: key, model, signal: abort.current.signal });
      const p = parseEdits(raw, new Set(view.ids.keys()));
      setPlan({ view, summary: p.summary, ops: p.ops, lines: describeOps(doc, view, p.ops), dropped: p.dropped });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };
  const chosen = plan ? plan.ops.filter((_, i) => !off.has(i)) : [];
  const apply = () => { if (plan && cmd.applyAiEdits(plan.view, chosen)) close(); };

  return (
    <Modal title="Change this page (AI)" wide footer={<>
      <button className="btn" onClick={close}>{busy ? 'Cancel' : 'Close'}</button>
      <button className="btn primary" data-testid="ai-apply" disabled={busy || !chosen.length} onClick={apply}>
        {chosen.length ? `Apply ${chosen.length} change${chosen.length === 1 ? '' : 's'}` : 'Apply'}
      </button>
    </>}>
      <p className="note">Say what should change on this page and Claude suggests the edits. You see them first and choose which to apply (one undo step). This needs internet and your own <b>Anthropic API key</b>. When you press <b>Suggest changes</b>, this page's text, shapes, colours, positions and arrows are sent to Anthropic, with your request. Pictures and other pages are not sent.</p>
      <KeyRows k={key} setK={setKey} remember={remember} setRemember={setRemember} model={model} setModel={setModel} />
      <textarea className="mermaid-text ai-ask" aria-label="Change request" data-testid="ai-edit-prompt" maxLength={MAX_PROMPT_CHARS}
        placeholder="e.g. Add a cache between the API and the database, colour all databases green, and number the arrows in the order the request flows."
        value={ask} onChange={(e) => setAsk(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void suggest(); } }} />
      <div className="ai-row">
        <button className={`btn ${plan ? '' : 'primary'}`} data-testid="ai-suggest" disabled={busy || !ask.trim() || !key.trim() || !count} onClick={() => void suggest()}>
          {busy ? 'Asking Claude…' : plan ? 'Suggest again' : 'Suggest changes'}
        </button>
        {!count && <span className="note">This page is empty: use Describe a diagram instead.</span>}
        {error && <span className="ai-error" role="alert">{error}</span>}
      </div>
      {plan && <div className="ai-plan" data-testid="ai-plan">
        {plan.summary && <p className="note ok">{plan.summary}</p>}
        {plan.lines.length ? <ul className="ai-ops">
          {plan.lines.map((l, i) => <li key={i}><label className="ai-check">
            <input type="checkbox" checked={!off.has(i)} onChange={(e) => setOff((s) => { const n = new Set(s); if (e.target.checked) n.delete(i); else n.add(i); return n; })} />
            <span>{l}</span>
          </label></li>)}
        </ul> : <p className="note">No changes suggested.</p>}
        {plan.dropped > 0 && <p className="note">{plan.dropped} suggested change{plan.dropped === 1 ? ' was' : 's were'} left out because {plan.dropped === 1 ? 'it' : 'they'} named something not on the page.</p>}
      </div>}
    </Modal>
  );
}
