// Accessible application menubar (WAI-ARIA menubar pattern, keyboard navigable).
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { useUI } from '../store/uiStore';

export type MenuItem =
  | { sep: true }
  | { label: string; shortcut?: string; run?: () => void; disabled?: boolean; checked?: boolean; sub?: MenuItem[]; note?: string };

export interface MenuDef { id: string; label: string; items: MenuItem[] }

export function ItemList({ items, onClose, depth = 0 }: { items: MenuItem[]; onClose: () => void; depth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [openSub, setOpenSub] = useState<number | null>(null);
  useEffect(() => { if (depth === 0) (ref.current?.querySelector('[role^="menuitem"]:not([aria-disabled="true"])') as HTMLElement)?.focus(); }, [depth]);
  const focusables = () => [...(ref.current?.querySelectorAll(':scope > [role^="menuitem"]') ?? [])] as HTMLElement[];
  const onKey = (e: React.KeyboardEvent) => {
    const f = focusables();
    const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); f[(i + 1) % f.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); f[(i - 1 + f.length) % f.length]?.focus(); }
    else if (e.key === 'ArrowLeft' && depth > 0) { e.preventDefault(); e.stopPropagation(); onClose(); }
  };
  return (
    <div ref={ref} role="menu" className={`menu-pop ${depth ? 'sub' : ''}`} onKeyDown={onKey}>
      {items.map((it, i) => {
        if ('sep' in it) return <div key={i} className="menu-sep" role="separator" />;
        const hasSub = !!it.sub;
        return (
          <div
            key={i}
            role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={it.checked}
            aria-disabled={it.disabled || undefined}
            aria-haspopup={hasSub || undefined}
            tabIndex={-1}
            className="menu-item"
            onMouseEnter={() => setOpenSub(hasSub ? i : null)}
            onClick={() => { if (it.disabled) return; if (hasSub) { setOpenSub(i); return; } onClose(); it.run?.(); }}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !it.disabled) { e.preventDefault(); if (hasSub) setOpenSub(i); else { onClose(); it.run?.(); } }
              if (e.key === 'ArrowRight' && hasSub) { e.preventDefault(); e.stopPropagation(); setOpenSub(i); setTimeout(() => (document.querySelector('.menu-pop.sub [role^="menuitem"]') as HTMLElement)?.focus()); }
            }}
          >
            <span className="menu-check">{it.checked ? <Check size={14} /> : null}</span>
            <span className="menu-label">{it.label}{it.note && <span className="menu-note">{it.note}</span>}</span>
            {it.shortcut && <span className="menu-kbd">{it.shortcut}</span>}
            {hasSub && <ChevronRight size={14} className="menu-chev" />}
            {hasSub && openSub === i && <ItemList items={it.sub!} onClose={onClose} depth={depth + 1} />}
          </div>
        );
      })}
    </div>
  );
}

export function MenuBar({ menus }: { menus: MenuDef[] }) {
  const open = useUI((s) => s.menuOpen);
  const setOpen = useUI((s) => s.setMenuOpen);
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!barRef.current?.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(null); (barRef.current?.querySelector(`[data-menu="${open}"]`) as HTMLElement)?.focus(); } };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [open, setOpen]);
  const move = (dir: number) => {
    const i = menus.findIndex((m) => m.id === open);
    const next = menus[(i + dir + menus.length) % menus.length];
    setOpen(next.id);
  };
  return (
    <div ref={barRef} role="menubar" aria-label="Application menu" className="menubar" onKeyDown={(e) => {
      if (e.key === 'ArrowRight' && open) { e.preventDefault(); move(1); }
      if (e.key === 'ArrowLeft' && open) { e.preventDefault(); move(-1); }
    }}>
      {menus.map((m) => (
        <div key={m.id} className="menubar-entry">
          <button
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={open === m.id}
            data-menu={m.id}
            className={`menubar-btn ${open === m.id ? 'open' : ''}`}
            onClick={() => setOpen(open === m.id ? null : m.id)}
            onMouseEnter={() => open && open !== m.id && setOpen(m.id)}
            onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(m.id); } }}
          >{m.label}</button>
          {open === m.id && <ItemList items={m.items} onClose={() => setOpen(null)} />}
        </div>
      ))}
    </div>
  );
}
