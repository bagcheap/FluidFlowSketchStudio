// Text measurement + wrapping shared by the live canvas, SVG export and GIF export.
import type { FontFamily, TextStyle } from '../model/types';

export const FONT_STACKS: Record<FontFamily, string> = {
  hand: '"Kalam", "Comic Sans MS", "Chalkboard SE", cursive',
  sans: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

export const FONT_LABELS: Record<FontFamily, string> = { hand: 'Hand-drawn', sans: 'Sans', serif: 'Serif', mono: 'Mono' };

export function cssFont(ts: TextStyle): string {
  return `${ts.italic ? 'italic ' : ''}${ts.bold ? 700 : 400} ${ts.fontSize}px ${FONT_STACKS[ts.fontFamily]}`;
}

let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
function measureCtx() {
  if (ctx !== undefined) return ctx;
  try {
    if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(4, 4).getContext('2d');
    else if (typeof document !== 'undefined') ctx = document.createElement('canvas').getContext('2d');
    else ctx = null;
  } catch { ctx = null; }
  return ctx;
}

const widthCache = new Map<string, number>();
export function measure(text: string, font: string, size: number): number {
  const key = font + '|' + text;
  const c = widthCache.get(key);
  if (c !== undefined) return c;
  const m = measureCtx();
  let w: number;
  if (m) { m.font = font; w = m.measureText(text).width; } else w = text.length * size * 0.55;
  if (!Number.isFinite(w) || w === 0 && text.length) w = text.length * size * 0.55;
  if (widthCache.size > 5000) widthCache.clear();
  widthCache.set(key, w);
  return w;
}

/** Clear cached widths (call once webfonts finish loading). */
export function resetTextMetrics() { widthCache.clear(); }

export interface TextLayout {
  lines: { text: string; width: number }[];
  width: number;
  height: number;
  lineHeight: number;
}

export function layoutText(text: string, ts: TextStyle, maxWidth: number | null): TextLayout {
  const font = cssFont(ts);
  const lh = ts.fontSize * ts.lineHeight;
  const out: { text: string; width: number }[] = [];
  for (const para of text.split('\n')) {
    if (maxWidth === null || maxWidth <= 0) { out.push({ text: para, width: measure(para, font, ts.fontSize) }); continue; }
    const words = para.split(/(\s+)/).filter((s) => s.length);
    let line = '';
    for (const w of words) {
      const cand = line + w;
      if (measure(cand.trimEnd(), font, ts.fontSize) <= maxWidth || line.trim() === '') {
        if (line.trim() === '' && measure(w, font, ts.fontSize) > maxWidth && !/^\s+$/.test(w)) {
          // break a very long word by characters
          let chunk = line;
          for (const ch of w) {
            if (measure(chunk + ch, font, ts.fontSize) > maxWidth && chunk) { out.push({ text: chunk, width: measure(chunk, font, ts.fontSize) }); chunk = ''; }
            chunk += ch;
          }
          line = chunk;
        } else line = cand;
      } else {
        const t = line.trimEnd();
        out.push({ text: t, width: measure(t, font, ts.fontSize) });
        line = /^\s+$/.test(w) ? '' : w;
      }
    }
    const t = line.trimEnd();
    out.push({ text: t, width: measure(t, font, ts.fontSize) });
  }
  const width = Math.max(0, ...out.map((l) => l.width));
  return { lines: out, width, height: out.length * lh, lineHeight: lh };
}
