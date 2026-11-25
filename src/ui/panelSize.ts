// Floating panels (Review, Edit with Claude) can be resized by dragging their bottom-right corner (CSS `resize`) and
// moved by dragging their title bar. Size and place are remembered per panel in localStorage
// (`flowsketch:panelSize:<key>`, `flowsketch:panelPos:<key>`, type-checked and clamped on read); double-clicking the
// title bar puts the panel back where it started, at its natural size.
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

const KEY = (k: string) => `flowsketch:panelSize:${k}`;
const POS = (k: string) => `flowsketch:panelPos:${k}`;
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

/** A remembered place (px from the stage's top-left), or null. */
export function loadPanelPos(key: string): { x: number; y: number } | null {
  try {
    const o = JSON.parse(localStorage.getItem(POS(key)) ?? 'null') as unknown;
    if (!o || typeof o !== 'object') return null;
    const { x, y } = o as Record<string, unknown>;
    return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(Math.min(MAX, Math.max(0, x))), y: Math.round(Math.min(MAX, Math.max(0, y))) } : null;
  } catch { return null; }
}

/** Keep a panel's title bar on screen inside its stage. */
function clampPlace(el: HTMLElement, x: number, y: number) {
  const host = el.offsetParent as HTMLElement | null;
  const W = host?.clientWidth ?? window.innerWidth, H = host?.clientHeight ?? window.innerHeight;
  return { x: Math.round(Math.min(Math.max(0, x), Math.max(0, W - 80))), y: Math.round(Math.min(Math.max(0, y), Math.max(0, H - 40))) };
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
    const p = loadPanelPos(key);
    if (p) { const c = clampPlace(el, p.x, p.y); el.style.left = `${c.x}px`; el.style.top = `${c.y}px`; }
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
    if (el) { el.style.width = ''; el.style.height = ''; el.style.left = ''; el.style.top = ''; }
    savePanelSize(key, null);
    try { localStorage.removeItem(POS(key)); } catch { /* storage may be blocked */ }
  }, [key]);
  /** Title bar pointer-down: drag the panel (not when pressing a button or field in the title bar). */
  const startMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el || e.button !== 0 || (e.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    e.preventDefault();
    const x0 = el.offsetLeft, y0 = el.offsetTop, px = e.clientX, py = e.clientY;
    const bar = e.currentTarget;
    bar.setPointerCapture?.(e.pointerId);
    el.classList.add('moving');
    const move = (ev: PointerEvent) => { const c = clampPlace(el, x0 + ev.clientX - px, y0 + ev.clientY - py); el.style.left = `${c.x}px`; el.style.top = `${c.y}px`; };
    const up = () => {
      bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up);
      el.classList.remove('moving');
      if (el.offsetLeft !== x0 || el.offsetTop !== y0) try { localStorage.setItem(POS(key), JSON.stringify({ x: el.offsetLeft, y: el.offsetTop })); } catch { /* storage may be blocked */ }
    };
    bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
  }, [key]);
  return { ref, reset, startMove };
}
