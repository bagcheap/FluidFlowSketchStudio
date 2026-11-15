// Insert ▸ Describe a diagram (AI): type what you want, Claude replies with Mermaid, you check (or edit) the draft,
// ask for changes, then insert it. Opt-in: nothing is sent until Draw is pressed, and only with the user's own key.
import { useMemo, useRef, useState } from 'react';
import { useUI } from '../../store/uiStore';
import * as cmd from '../../store/commands';
import { parseMermaid } from '../../import/mermaid';
import { isSequence, parseSequence } from '../../import/mermaidSequence';
import { Modal } from './Modal';
import {
  AI_MODELS, drawWithClaude, forgetKey, isKeyRemembered, MAX_PROMPT_CHARS, savedKey, savedModel, storeKey, storeModel,
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
  const [ask, setAsk] = useState('');
  const [turns, setTurns] = useState<AiTurn[]>([]); // the conversation behind the current draft
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const info = useMemo(() => (draft ? summary(draft) : null), [draft]);
  const close = () => { abort.current?.abort(); useUI.getState().openDialog(null); };

  const draw = async () => {
    if (busy || !ask.trim()) return;
    storeKey(key, remember);
    storeModel(model);
    // refining: the draft as it is now (the user may have edited it), then the change
    const history: AiTurn[] = draft ? [...turns.slice(0, -1), { role: 'assistant', text: draft }] : [];
    const next: AiTurn[] = [...history, { role: 'user', text: ask.trim() }];
    setBusy(true); setError('');
    abort.current = new AbortController();
    try {
      const mermaid = await drawWithClaude(next, { apiKey: key, model, signal: abort.current.signal });
      setTurns([...next, { role: 'assistant', text: mermaid }]);
      setDraft(mermaid);
      setAsk('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };
  const insert = () => { if (draft && cmd.importMermaid(draft)) close(); };
  const startOver = () => { setTurns([]); setDraft(''); setError(''); };

  return (
    <Modal title="Describe a diagram (AI)" wide footer={<>
      {draft && <button className="btn" onClick={startOver} disabled={busy}>Start over</button>}
      <button className="btn" onClick={close}>{busy ? 'Cancel' : 'Close'}</button>
      <button className="btn primary" data-testid="ai-insert" disabled={busy || !info?.count} onClick={insert}>Insert diagram</button>
    </>}>
      <p className="note">Describe the diagram in your own words and Claude drafts it. You can check the draft, ask for changes, then insert it. This needs internet and your own <b>Anthropic API key</b> (create one at platform.claude.com under API keys; usage is billed to your Anthropic account; see the README for step-by-step help). Only what you type here is sent to Anthropic, and only when you press <b>{draft ? 'Change draft' : 'Draw it'}</b>.</p>
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
      <textarea className="mermaid-text ai-ask" aria-label={draft ? 'Change to make' : 'Describe the diagram'} maxLength={MAX_PROMPT_CHARS}
        placeholder={draft ? 'What should change? e.g. Add a cache between the API and the database.' : PLACEHOLDER}
        value={ask} onChange={(e) => setAsk(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void draw(); } }} />
      <div className="ai-row">
        <button className="btn primary" data-testid="ai-draw" disabled={busy || !ask.trim() || !key.trim()} onClick={() => void draw()}>
          {busy ? 'Asking Claude…' : draft ? 'Change draft' : 'Draw it'}
        </button>
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
