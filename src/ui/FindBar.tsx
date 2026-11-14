// Find and replace bar (⌘F / ⌥⌘F), floating at the top of the canvas.
import { ChevronDown, ChevronRight, ChevronUp, X } from 'lucide-react';
import { useDoc } from '../store/docStore';
import { useUI } from '../store/uiStore';
import { findMatches } from '../store/find';
import * as cmd from '../store/commands';

export function FindBar() {
  const f = useUI((s) => s.find);
  const doc = useDoc((s) => s.doc);
  if (!f) return null;
  const ms = findMatches(doc, f.query, f);
  const set = useUI.getState().setFind;
  const onPage = ms.filter((m) => m.pageId === doc.activePage).length;
  const status = !f.query ? '' : !ms.length ? 'No matches'
    : `${f.index < 0 ? `${ms.length} match${ms.length === 1 ? '' : 'es'}` : `${Math.min(f.index, ms.length - 1) + 1} of ${ms.length}`}${f.allPages && onPage < ms.length ? ` · ${onPage} on this page` : ''}`;
  const keys = (e: React.KeyboardEvent, field: 'find' | 'replace') => {
    if (e.key === 'Escape') { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); cmd.closeFind(); return; }
    if (e.key === 'Enter') {
      e.preventDefault(); e.nativeEvent.stopImmediatePropagation();
      if (field === 'replace') { if (e.metaKey || e.ctrlKey) cmd.replaceAllMatches(); else cmd.replaceCurrent(); }
      else cmd.findNext(e.shiftKey ? -1 : 1);
    }
  };
  return (
    <div className="find-bar no-canvas" role="search" aria-label="Find and replace">
      <div className="find-row">
        <button className="icon-btn sm" aria-label={f.showReplace ? 'Hide replace' : 'Show replace'} aria-expanded={f.showReplace} title="Replace" onClick={() => set({ showReplace: !f.showReplace })}>
          {f.showReplace ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <input aria-label="Find" placeholder="Find" value={f.query} autoFocus spellCheck={false}
          onChange={(e) => set({ query: e.target.value, index: -1 })} onKeyDown={(e) => keys(e, 'find')} />
        <span className="find-count" aria-live="polite">{status}</span>
        <button className="icon-btn sm" aria-label="Previous match" title="Previous (⇧Enter)" disabled={!ms.length} onClick={() => cmd.findNext(-1)}><ChevronUp size={15} /></button>
        <button className="icon-btn sm" aria-label="Next match" title="Next (Enter)" disabled={!ms.length} onClick={() => cmd.findNext(1)}><ChevronDown size={15} /></button>
        <button className={`btn small ${f.matchCase ? 'on' : ''}`} aria-pressed={f.matchCase} title="Match upper and lower case" onClick={() => set({ matchCase: !f.matchCase, index: -1 })}>Aa</button>
        <button className={`btn small ${f.allPages ? 'on' : ''}`} aria-pressed={f.allPages} title="Search every page, not just this one" onClick={() => set({ allPages: !f.allPages, index: -1 })}>All pages</button>
        <button className="icon-btn sm" aria-label="Close find" title="Close (Esc)" onClick={cmd.closeFind}><X size={15} /></button>
      </div>
      {f.showReplace && (
        <div className="find-row">
          <span className="find-indent" />
          <input aria-label="Replace with" placeholder="Replace with" value={f.replace} spellCheck={false}
            onChange={(e) => set({ replace: e.target.value })} onKeyDown={(e) => keys(e, 'replace')} />
          <button className="btn small" disabled={!ms.length} title="Replace this match and go to the next (Enter)" onClick={cmd.replaceCurrent}>Replace</button>
          <button className="btn small" disabled={!ms.length} title={`Replace every match${f.allPages ? ' on every page' : ' on this page'} (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}Enter)`} onClick={cmd.replaceAllMatches}>Replace all</button>
        </div>
      )}
    </div>
  );
}
