// Page tabs along the bottom: click to switch, double-click to rename, right-click for more, + to add a page.
import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useDoc } from '../store/docStore';
import { useUI } from '../store/uiStore';
import * as cmd from '../store/commands';

export function PageTabs() {
  const pages = useDoc((s) => s.doc.pages);
  const active = useDoc((s) => s.doc.activePage);
  const [renaming, setRenaming] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // "Rename" from the tab menu
  useEffect(() => {
    const on = (e: Event) => setRenaming((e as CustomEvent<string>).detail);
    window.addEventListener('flowsketch:renamepage', on);
    return () => window.removeEventListener('flowsketch:renamepage', on);
  }, []);
  // keep the current tab in view
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active, pages.length]);

  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const p = pages[(i + (e.key === 'ArrowRight' ? 1 : -1) + pages.length) % pages.length];
      cmd.goToPage(p.id);
      (listRef.current?.querySelectorAll<HTMLElement>('[role=tab]')[pages.indexOf(p)])?.focus();
    } else if (e.key === 'F2' || e.key === 'Enter') { e.preventDefault(); setRenaming(pages[i].id); }
  };

  return (
    <div className="page-tabs no-canvas">
      <div className="page-tablist" role="tablist" aria-label="Pages" ref={listRef}>
        {pages.map((p, i) => (renaming === p.id ? (
          <input key={p.id} className="page-tab renaming" aria-label="Page name" defaultValue={p.name} maxLength={60} autoFocus
            onFocus={(e) => e.target.select()}
            onBlur={(e) => { cmd.renamePage(p.id, e.target.value); setRenaming(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setRenaming(null); }
            }} />
        ) : (
          <button key={p.id} role="tab" aria-selected={p.id === active} tabIndex={p.id === active ? 0 : -1}
            className={`page-tab ${p.id === active ? 'on' : ''}`} title={`${p.name} · double-click to rename, right-click for more`}
            onClick={() => cmd.goToPage(p.id)}
            onDoubleClick={() => setRenaming(p.id)}
            onKeyDown={(e) => onKey(e, i)}
            onContextMenu={(e) => { e.preventDefault(); useUI.getState().setContextMenu({ x: e.clientX, y: e.clientY, pageId: p.id }); }}>
            {p.name}
          </button>
        )))}
      </div>
      <button className="icon-btn sm page-add" aria-label="Add page" title="Add a page" onClick={cmd.newPage}><Plus size={15} /></button>
    </div>
  );
}
