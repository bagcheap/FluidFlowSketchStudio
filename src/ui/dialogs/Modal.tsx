import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useUI } from '../../store/uiStore';

export function Modal({ title, children, footer, wide, onClose }: { title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = onClose ?? (() => useUI.getState().openDialog(null));
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, button:not(.modal-x), textarea, [tabindex="0"]');
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex="0"]')].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn modal-x" aria-label="Close" onClick={close}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
