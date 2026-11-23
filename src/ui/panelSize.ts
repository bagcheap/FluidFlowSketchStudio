// Floating panels (Review, Edit with Claude) can be resized by dragging their bottom-right corner (CSS `resize`).
// The size you choose is remembered per panel in localStorage (`flowsketch:panelSize:<key>`, type-checked and
// clamped on read); double-clicking the panel's header puts it back to its natural size.
import { useCallback, useEffect, useRef } from 'react';

const KEY = (k: string) => `flowsketch:panelSize:${k}`;
const MIN_W = 280, MIN_H = 120, MAX = 4000;

export interface PanelSize { w: number; h: number | null }

/** A remembered size, or null when there is none or it isn't a sensible one. */
export function loadPanelSize(key: string): PanelSize | null {
  try {
    const o = JSON.parse(localStorage.getItem(KEY(key)) ?? 'null') as unknown;
    if (!o || typeof o !== 'object') return null;
    const { w, h } = o as Record<string, unknown>;
    if (typeof w !== 'number' || !Number.isFinite(w)) return null;
    const hh = typeof h === 'number' && Number.isFinite(h) ? Math.min(MAX, Math.max(MIN_H, Math.round(h))) : null;
    return { w: Math.min(MAX, Math.max(MIN_W, Math.round(w))), h: hh };
  } catch { return null; }
}

function savePanelSize(key: string, s: PanelSize | null) {
  try { if (s) localStorage.setItem(KEY(key), JSON.stringify(s)); else localStorage.removeItem(KEY(key)); } catch { /* storage may be blocked */ }
}

/**
 * Give a resizable panel its remembered size and remember new sizes. Only a size set by dragging the corner (the
 * browser writes it into the element's inline style) is saved; content growing or shrinking is not. The panel's CSS
 * max-width / max-height keep a remembered size inside a smaller window. Returns a reset function.
 */
export function useRememberedSize(key: string) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const s = loadPanelSize(key);
    if (s) { el.style.width = `${s.w}px`; if (s.h) el.style.height = `${s.h}px`; }
    if (typeof ResizeObserver === 'undefined') return;
    let timer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!el.style.width && !el.style.height) return;
        const r = el.getBoundingClientRect();
        savePanelSize(key, { w: Math.round(r.width), h: el.style.height ? Math.round(r.height) : null });
      }, 200);
    });
    ro.observe(el);
    return () => { ro.disconnect(); window.clearTimeout(timer); };
  }, [key]);
  const reset = useCallback(() => {
    const el = ref.current;
    if (el) { el.style.width = ''; el.style.height = ''; }
    savePanelSize(key, null);
  }, [key]);
  return { ref, reset };
}
