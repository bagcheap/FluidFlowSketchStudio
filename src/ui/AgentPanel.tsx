// Edit with Claude (AI agent): say what to change; Claude works through the diagram tools step by step on a draft,
// which the canvas shows (green = added, amber = changed, red = removed). Then Apply (one undo step), ask for more
// changes in the same conversation, or Discard. Opt-in: needs the user's own key; nothing is sent until Run.
import { useEffect, useRef, useState } from 'react';
import { Bot, Square, X } from 'lucide-react';
import { useUI } from '../store/uiStore';
import { useDoc } from '../store/docStore';
import * as cmd from '../store/commands';
import { Segmented } from './controls';
import { KeyRows, useApiKey } from './dialogs/AiDialog';
import { money } from './dialogs/AiReviewDialog';
import { MAX_PROMPT_CHARS, savedModel, storeModel, type AiModel } from '../ai/describe';
import { firstMessage, runAgent, startAgent, type AgentState } from '../ai/agent';
import { estimateCost, type ReviewEffort } from '../ai/review';


/** What each tool did, in words, for the progress list. */
const DID: Record<string, string> = {
  describe_page: 'Read the page', get_item: 'Looked at an item', find_items: 'Searched the page', list_pages: 'Listed the pages', get_play_order: 'Read the play order',
  add_shape: 'Added a shape', connect: 'Added an arrow', remove: 'Removed an item', set_label: 'Changed a label', set_shape: 'Changed a shape’s kind',
  set_color: 'Changed colours', set_arrow: 'Changed an arrow', add_container: 'Added a container', move_into: 'Moved items into a container',
  renumber_steps: 'Renumbered the steps', play_in_label_order: 'Set the play order', auto_layout: 'Laid out the page again', route_arrows: 'Routed arrows',
  apply_theme: 'Applied a theme', lint: 'Checked the page', snapshot: 'Looked at a picture of the draft',
};
const OPTS = 'flowsketch:aiAgentOptions';
function loadOpts(): { effort: ReviewEffort; pictures: boolean } {
  try { const o = JSON.parse(localStorage.getItem(OPTS) ?? 'null'); return { effort: o?.effort === 'high' ? 'high' : 'medium', pictures: typeof o?.pictures === 'boolean' ? o.pictures : true }; } catch { return { effort: 'medium', pictures: true }; }
}

export function AgentPanel() {
  const open = useUI((s) => s.agentOpen);
  return open ? <AgentBody /> : null;
}

function AgentBody() {
  const api = useApiKey();
  const seed = useUI((s) => s.agentSeed);
  const draft = useUI((s) => s.draft);
  const [model, setModel] = useState<AiModel>(savedModel);
  const [opts, setOpts] = useState(loadOpts);
  const [ask, setAsk] = useState(seed);
  const [more, setMore] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [log, setLog] = useState<{ text: string; ok: boolean }[]>([]);
  const [, setTick] = useState(0);
  const state = useRef<AgentState | null>(null);
  const abort = useRef<AbortController | null>(null);
  const count = useDoc((s) => s.doc.elements.length);
  useEffect(() => { if (seed) setAsk(seed); }, [seed]);
  useEffect(() => () => abort.current?.abort(), []);
  const choose = (o: Partial<typeof opts>) => setOpts((p) => { const n = { ...p, ...o }; try { localStorage.setItem(OPTS, JSON.stringify(n)); } catch { /* storage unavailable */ } return n; });

  const s = state.current;
  const changes = draft ? draft.diff.lines : [];

  const run = async (text: string, fresh: boolean) => {
    if (busy || !text.trim()) return;
    await api.keep();
    storeModel(model);
    const doc = useDoc.getState().doc;
    if (fresh || !state.current) {
      state.current = startAgent(doc, cmd.toolContext(), model);
      setLog([]);
      text = firstMessage(state.current, text, doc.brief ?? null, useUI.getState().selection);
    }
    const st = state.current;
    cmd.showDraft(st.session);
    setBusy(true); setError('');
    abort.current = new AbortController();
    try {
      await runAgent(st, text, { apiKey: api.key, model: st.model, effort: opts.effort, pictures: opts.pictures, signal: abort.current.signal }, (e) => {
        if (state.current !== st) return; // discarded meanwhile
        setLog((l) => [...l, { text: `${DID[e.name] ?? e.name}${e.ok ? '' : ' (couldn’t)'}`, ok: e.ok }]);
        cmd.showDraft(st.session);
        setTick((t) => t + 1);
      });
      setMore('');
    } catch (e) {
      if (state.current === st) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (state.current === st) cmd.showDraft(st.session);
      setBusy(false);
      abort.current = null;
      setTick((t) => t + 1);
    }
  };
  const discard = () => { abort.current?.abort(); state.current = null; useUI.getState().setDraft(null); setLog([]); setError(''); setTick((t) => t + 1); };
  const apply = () => { if (state.current && cmd.applyAgentDraft(state.current.session)) { state.current = null; cmd.closeAgent(); } };
  const close = async () => {
    if (state.current?.session.changes && !(await useUI.getState().ask('Discard Claude’s draft? Nothing it changed will be kept.', 'Discard'))) return;
    abort.current?.abort();
    cmd.closeAgent();
  };

  return (
    <section className="agent-panel no-canvas" aria-label="Edit with Claude">
      <header>
        <Bot size={15} aria-hidden />
        <strong>Edit with Claude</strong>
        <span className="agent-cost">{s ? money(estimateCost(s.model, s.usage)) : ''}</span>
        <button className="icon-btn sm" aria-label="Close Edit with Claude" title="Close" onClick={() => void close()}><X size={14} /></button>
      </header>
      <div className="agent-scroll">
        {!s && <>
          <p className="note">Say what to change on this page. Claude works on a <b>draft</b> step by step, and you see it on the canvas before anything changes. Uses your own <b>Anthropic API key</b>; this page, its brief and the draft’s progress (and pictures, if ticked) are sent to Anthropic when you press Run.</p>
          <textarea className="agent-ask" aria-label="What should change" data-testid="agent-ask" maxLength={MAX_PROMPT_CHARS} rows={4} value={ask} onChange={(e) => setAsk(e.target.value)}
            placeholder="e.g. Add a token cache between the API and the identity provider, connect it, and renumber the steps."
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void run(ask, true); } }} />
          <KeyRows api={api} model={model} setModel={setModel} />
          <div className="ai-row">
            <span className="row-label">Effort</span>
            <Segmented label="Agent effort" value={opts.effort} onChange={(v) => choose({ effort: v })} options={[{ v: 'medium', label: 'Medium', title: 'Good for most changes' }, { v: 'high', label: 'High', title: 'For large restructures; costs more' }]} />
          </div>
          <label className="ai-check"><input type="checkbox" checked={opts.pictures} onChange={(e) => choose({ pictures: e.target.checked })} /> Let Claude look at pictures of the draft</label>
          <div className="ai-row">
            <button className="btn primary" data-testid="agent-run" disabled={busy || !ask.trim() || !api.key.trim() || !count} onClick={() => void run(ask, true)}>Run</button>
            {!count && <span className="note">This page is empty: use Describe a diagram instead.</span>}
          </div>
        </>}
        {s && <>
          <p className="agent-request"><b>You asked:</b> {ask}</p>
          <ol className="agent-log" aria-label="What Claude did">
            {log.map((l, i) => <li key={i} className={l.ok ? '' : 'failed'}>{l.text}</li>)}
            {busy && <li className="working">Working…</li>}
          </ol>
          {s.reply && !busy && <p className="agent-reply" data-testid="agent-reply">{s.reply}</p>}
          {!busy && <div className="agent-changes">
            <b>{changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'} in the draft` : 'No changes in the draft'}</b>
            {changes.length > 0 && <ul>{changes.slice(0, 60).map((l, i) => <li key={i}>{l}</li>)}</ul>}
            {changes.length > 0 && <p className="note">On the canvas: <span className="mk add">added</span> <span className="mk chg">changed</span> <span className="mk del">removed</span>. You can pan and zoom to look; editing waits until you apply or discard.</p>}
          </div>}
        </>}
        {error && <p className="ai-error" role="alert">{error}</p>}
      </div>
      {s && <footer>
        {busy ? <button className="btn" data-testid="agent-stop" onClick={() => abort.current?.abort()}><Square size={12} /> Stop</button> : <>
          <textarea className="agent-more" aria-label="Ask for more changes" rows={2} maxLength={MAX_PROMPT_CHARS} placeholder="Ask for more changes to this draft…" value={more} onChange={(e) => setMore(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void run(more, false); } }} />
          <div className="agent-actions">
            <button className="btn" disabled={!more.trim()} onClick={() => void run(more, false)}>Send</button>
            <button className="btn" onClick={discard}>Discard</button>
            <button className="btn primary" data-testid="agent-apply" disabled={!s.session.changes || !changes.length} onClick={apply}>Apply</button>
          </div>
        </>}
      </footer>}
    </section>
  );
}
