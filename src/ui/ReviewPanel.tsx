// Review panel (View ▸ Review diagram): the page's lint issues, kept up to date as you edit. Clicking an issue
// selects its items and brings them into view; issues with a one-click remedy show a button for it; any issue can be
// hidden for the session.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, EyeOff, FileDown, Info, Lightbulb, Sparkles, Undo2, X, XCircle } from 'lucide-react';
import { useDoc } from '../store/docStore';
import { useUI } from '../store/uiStore';
import { lintPage, type LintIssue, type LintSeverity } from '../lint/lint';
import * as cmd from '../store/commands';
import { AI_MODELS } from '../ai/describe';
import { estimateCost, type AiReview, type FindingSeverity } from '../ai/review';
import { money } from './dialogs/AiReviewDialog';
import { useRememberedSize } from './panelSize';

const ICON: Record<LintSeverity, JSX.Element> = {
  error: <XCircle size={15} aria-hidden />,
  warning: <AlertTriangle size={15} aria-hidden />,
  info: <Info size={15} aria-hidden />,
};
const WORD: Record<LintSeverity, string> = { error: 'Problem', warning: 'Warning', info: 'Note' };

/** The issues for this document, worked out a moment after editing stops (so dragging stays smooth). */
function useLint(): LintIssue[] {
  const doc = useDoc((s) => s.doc);
  const [issues, setIssues] = useState<LintIssue[]>(() => lintPage(doc));
  useEffect(() => {
    const t = window.setTimeout(() => setIssues(lintPage(doc)), 250);
    return () => window.clearTimeout(t);
  }, [doc]);
  return issues;
}

export function ReviewPanel() {
  const open = useUI((s) => s.review);
  if (!open) return null;
  return <ReviewBody />;
}

function ReviewBody() {
  const issues = useLint();
  const hidden = useUI((s) => s.reviewHidden);
  const selection = useUI((s) => s.selection);
  const shown = useMemo(() => issues.filter((i) => !hidden.includes(i.key)), [issues, hidden]);
  const hiddenHere = issues.length - shown.length;
  const count = (sev: LintSeverity) => shown.filter((i) => i.severity === sev).length;
  const summary = shown.length
    ? (['error', 'warning', 'info'] as const).filter((s) => count(s)).map((s) => `${count(s)} ${WORD[s].toLowerCase()}${count(s) === 1 ? '' : 's'}`).join(' · ')
    : 'No problems found';
  const size = useRememberedSize('review');
  const current = (i: LintIssue) => i.ids.length === selection.length && i.ids.every((id) => selection.includes(id));
  return (
    <section className="review-panel no-canvas" aria-label="Review" ref={size.ref}>
      <header title="Drag the bottom-right corner to resize this panel; double-click here for its usual size" onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button')) size.reset(); }}>
        <strong>Review</strong>
        <span className="review-sum" aria-live="polite">{summary}</span>
        <button className="icon-btn sm" aria-label="Close review" title="Close" onClick={() => cmd.toggleReview(false)}><X size={14} /></button>
      </header>
      <div className="review-scroll">
      <AiSection />
      {shown.length ? (
        <ul className="review-list">
          {shown.map((i) => (
            <li key={i.key} className={`review-item sev-${i.severity} ${current(i) ? 'current' : ''}`}>
              <button className="review-msg" onClick={() => cmd.focusIssue(i)} title="Select and show on the canvas">
                <span className="review-icon" aria-label={WORD[i.severity]}>{ICON[i.severity]}</span>
                <span>{i.message}</span>
              </button>
              <div className="review-actions">
                {i.fix && <button className="btn small" onClick={() => cmd.fixLintIssue(i)}>{i.fix.label}</button>}
                <button className="icon-btn sm" aria-label={`Hide: ${i.message}`} title="Hide this one" onClick={() => cmd.hideIssue(i.key)}><EyeOff size={13} /></button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="review-empty"><CheckCircle2 size={16} aria-hidden /> Nothing to fix on this page.</p>
      )}
      </div>
      <footer>
        <span>Checks above update as you edit, on your computer.</span>
        {hiddenHere > 0 && <button className="link-btn" onClick={cmd.showHiddenIssues}>Show {hiddenHere} hidden</button>}
        <button className="link-btn" onClick={() => useUI.getState().openDialog('aiReview')}>Review with Claude…</button>
      </footer>
    </section>
  );
}

const AI_ICON: Record<FindingSeverity, JSX.Element> = {
  error: <XCircle size={15} aria-hidden />,
  warning: <AlertTriangle size={15} aria-hidden />,
  suggestion: <Lightbulb size={15} aria-hidden />,
};
const AI_WORD: Record<FindingSeverity, string> = { error: 'Error', warning: 'Warning', suggestion: 'Suggestion' };

/** Claude's last review of this page (made with Review with Claude…), above the automatic checks. */
function AiSection() {
  const r = useUI((s) => s.aiReview);
  const doc = useDoc((s) => s.doc);
  if (!r || r.docId !== doc.id || r.pageId !== doc.activePage) return null;
  return <AiReviewView r={r} />;
}

function AiReviewView({ r }: { r: AiReview }) {
  // findings ticked for "Fix chosen with Claude" (this panel only; starts empty each time the panel opens)
  const [chosen, setChosen] = useState<number[]>([]);
  const fixed = new Set(r.fixed ?? []);
  const open = r.findings.map((_, i) => i).filter((i) => !fixed.has(i));
  const pick = (i: number, on: boolean) => setChosen((c) => (on ? [...c, i].sort((a, b) => a - b) : c.filter((x) => x !== i)));
  const model = AI_MODELS.find((m) => m.id === r.model)?.label.replace(/ \(.*\)$/, '') ?? r.model;
  const time = new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <section className="ai-review" aria-label="Claude’s review">
      <div className="ai-review-head">
        <Sparkles size={14} aria-hidden />
        <strong>Claude’s review</strong>
        <span className={`ai-verdict ${r.verdict.replace(' ', '-')}`}>{r.verdict}</span>
        <button className="icon-btn sm" aria-label="Save review notes" title="Save as notes (Markdown)…" onClick={() => void cmd.saveAiReview()}><FileDown size={13} /></button>
        <button className="icon-btn sm" aria-label="Clear Claude’s review" title="Clear" onClick={() => useUI.getState().setAiReview(null)}><X size={13} /></button>
      </div>
      {r.summary && <p className="ai-summary">{r.summary}</p>}
      {r.findings.length > 1 && <div className="ai-choose">
        <span>{fixed.size ? `${fixed.size} of ${r.findings.length} fixed` : `${r.findings.length} findings`}</span>
        {open.length > 0 && <button className="link-btn" onClick={() => setChosen(chosen.length === open.length && open.every((i) => chosen.includes(i)) ? [] : open)}>
          {chosen.length === open.length && open.every((i) => chosen.includes(i)) ? 'Choose none' : `Choose all ${fixed.size ? 'open' : ''}`.trim()}</button>}
        <button className="btn small primary" data-testid="ai-fix-chosen" disabled={!chosen.length} title="Open Edit with Claude with the ticked findings as one request"
          onClick={() => cmd.fixFindings(chosen)}>Fix {chosen.length || ''} with Claude…</button>
      </div>}
      {r.findings.length > 0 && <ul className="review-list">
        {r.findings.map((f, i) => (
          <li key={i} className={`review-item ai-finding sev-${f.severity === 'suggestion' ? 'info' : f.severity}${fixed.has(i) ? ' fixed' : ''}`}>
            {r.findings.length > 1 && <input type="checkbox" className="ai-pick" aria-label={`Choose: ${f.title}`} checked={chosen.includes(i)} onChange={(e) => pick(i, e.target.checked)} />}
            <button className="review-msg" onClick={() => cmd.focusItems(f.ids)} disabled={!f.ids.length} title={f.ids.length ? 'Select and show on the canvas' : 'About something missing from the page'}>
              <span className="review-icon" aria-label={AI_WORD[f.severity]}>{AI_ICON[f.severity]}</span>
              <span><b>{f.title}</b> <span className="ai-cat">{f.category}</span>{f.explanation && <span className="ai-expl">{f.explanation}</span>}{f.suggestion && <span className="ai-sugg">Suggested: {f.suggestion}</span>}</span>
            </button>
            <div className="review-actions">
              {fixed.has(i)
                ? <><span className="ai-fixed"><Check size={13} aria-hidden /> Fixed</span>
                  <button className="icon-btn sm" aria-label={`Mark as not fixed: ${f.title}`} title="Mark as not fixed" onClick={() => cmd.markFindings([i], false)}><Undo2 size={13} /></button></>
                : <>
                  <button className="icon-btn sm" aria-label={`Mark as fixed: ${f.title}`} title="Mark as fixed (dealt with another way)" onClick={() => { cmd.markFindings([i], true); pick(i, false); }}><Check size={13} /></button>
                  <button className="btn small" title="Open Edit with Claude with this finding as the request" onClick={() => cmd.fixFindings([i])}>Fix with Claude…</button></>}
            </div>
          </li>
        ))}
      </ul>}
      {r.questions.length > 0 && <div className="ai-questions"><b>Questions for you</b><ul>{r.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>}
      {r.sources.length > 0 && <div className="ai-sources"><b>Sources</b><ul>{r.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || new URL(s.url).host}</a></li>)}</ul></div>}
      <p className="ai-meta">{model} · {r.effort === 'high' ? 'High' : 'Medium'} effort · {time} · {money(estimateCost(r.model, r.usage))}{r.usage.webSearches ? ` + ${r.usage.webSearches} web search${r.usage.webSearches === 1 ? '' : 'es'}` : ''}{r.dropped ? ` · ${r.dropped} unusable finding${r.dropped === 1 ? '' : 's'} left out` : ''}. Based on the page as it was then; checks may be wrong, so judge them yourself.</p>
    </section>
  );
}
