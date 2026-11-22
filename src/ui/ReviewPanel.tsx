// Review panel (View ▸ Review diagram): the page's lint issues, kept up to date as you edit. Clicking an issue
// selects its items and brings them into view; issues with a one-click remedy show a button for it; any issue can be
// hidden for the session.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, EyeOff, Info, X, XCircle } from 'lucide-react';
import { useDoc } from '../store/docStore';
import { useUI } from '../store/uiStore';
import { lintPage, type LintIssue, type LintSeverity } from '../lint/lint';
import * as cmd from '../store/commands';

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
  const current = (i: LintIssue) => i.ids.length === selection.length && i.ids.every((id) => selection.includes(id));
  return (
    <section className="review-panel no-canvas" aria-label="Review">
      <header>
        <strong>Review</strong>
        <span className="review-sum" aria-live="polite">{summary}</span>
        <button className="icon-btn sm" aria-label="Close review" title="Close" onClick={() => cmd.toggleReview(false)}><X size={14} /></button>
      </header>
      {shown.length ? (
        <ul className="review-list">
          {shown.map((i) => (
            <li key={i.key} className={`review-item ${i.severity} ${current(i) ? 'current' : ''}`}>
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
      <footer>
        <span>Checks this page as you edit. No AI, nothing leaves your computer.</span>
        {hiddenHere > 0 && <button className="link-btn" onClick={cmd.showHiddenIssues}>Show {hiddenHere} hidden</button>}
      </footer>
    </section>
  );
}
