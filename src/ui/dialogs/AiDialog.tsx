// Insert ▸ Describe a diagram (AI): type what you want, Claude replies with Mermaid, you check (or edit) the draft,
// ask for changes, then insert it. Opt-in: nothing is sent until Draw is pressed, and only with the user's own key.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useUI } from '../../store/uiStore';
import * as cmd from '../../store/commands';
import { parseMermaid } from '../../import/mermaid';
import { isSequence, parseSequence } from '../../import/mermaidSequence';
import { Modal } from './Modal';
import {
  AI_MODELS, drawWithClaude, forgetKey, isKeyRemembered, loadSession, MAX_PROMPT_CHARS, saveSession, savedKey, savedModel, storeKey, storeModel,
  type AiModel, type AiTurn,
} from '../../ai/describe';

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
      <div className="ai-row">
        <label className="row-label" htmlFor="ai-key">API key</label>
        <input id="ai-key" className="ai-key" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
        <label className="ai-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this computer</label>
        {isKeyRemembered() && <button className="btn small" onClick={() => { forgetKey(); setKey(''); setRemember(false); }}>Forget key</button>}
      </div>
      <div className="ai-row">
        <label className="row-label" htmlFor="ai-model">Model</label>
        <select id="ai-model" value={model} onChange={(e) => setModel(e.target.value as AiModel)}>
          {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>
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
