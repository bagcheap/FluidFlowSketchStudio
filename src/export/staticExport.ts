// PNG / JPEG / SVG / clipboard / standalone HTML player exports.
import kalamUrl from '@fontsource/kalam/files/kalam-latin-400-normal.woff2?url';
import kalamBoldUrl from '@fontsource/kalam/files/kalam-latin-700-normal.woff2?url';
import interUrl from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import interBoldUrl from '@fontsource/inter/files/inter-latin-700-normal.woff2?url';
import playerSource from '../player/player.bundle.js?raw';
import { useDoc } from '../store/docStore';
import { useUI } from '../store/uiStore';
import { exportRect, fitAspect, frameRenderer, MAX_PIXELS, type Framing } from './raster';
import { renderDocumentAtTime } from '../engine/render';
import { frameToSvg } from '../engine/svgExport';
import { downloadBlob, safeFileName } from '../persistence/files';
import { serializeDocument } from '../model/schema';

export interface ImageExportOptions extends Partial<Framing> {
  scale?: number;
  width?: number;
  height?: number;
  format?: 'png' | 'jpeg';
  quality?: number;
  transparent?: boolean;
  background?: string;
  time?: number;
  download?: boolean;
}

function selOnly(onlySel?: boolean) {
  const sel = useUI.getState().selection;
  return onlySel && sel.length ? new Set(sel) : undefined;
}

export async function renderImageBlob(o: ImageExportOptions): Promise<Blob> {
  const doc = useDoc.getState().doc;
  const framing: Framing = { fit: o.fit ?? 'content', padding: o.padding ?? doc.exportPrefs.padding, onlyIds: o.onlyIds };
  let rect = exportRect(doc, framing);
  const scale = o.scale ?? 2;
  let W = o.width ?? rect.w * scale, H = o.height ?? (o.width ? (rect.h / rect.w) * o.width : rect.h * scale);
  if (W * H > MAX_PIXELS) { const k = Math.sqrt(MAX_PIXELS / (W * H)); W *= k; H *= k; }
  rect = fitAspect(rect, W, H);
  const fmt = o.format ?? 'png';
  const bg = fmt === 'jpeg' ? (o.background ?? doc.canvas.background) : o.transparent ? null : (o.background ?? doc.canvas.background);
  const r = await frameRenderer(doc, rect, W, H, bg, framing.onlyIds);
  r.render(o.time ?? useUI.getState().time);
  const blob = await new Promise<Blob | null>((res) => r.canvas.toBlob(res, fmt === 'jpeg' ? 'image/jpeg' : 'image/png', o.quality ?? 0.92));
  r.canvas.width = r.canvas.height = 0;
  if (!blob) throw new Error('The browser could not encode the image (it may be too large).');
  return blob;
}

export async function exportPng(o: ImageExportOptions & { onlySelected?: boolean }) {
  const blob = await renderImageBlob({ ...o, onlyIds: o.onlyIds ?? selOnly(o.onlySelected) });
  downloadBlob(blob, safeFileName(useDoc.getState().doc.title, o.format === 'jpeg' ? 'jpg' : 'png'));
}

export async function copyPngToClipboard() {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('Copying images is not supported in this browser.');
  const blob = renderImageBlob({ scale: 2 });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

async function toBase64(url: string): Promise<string> {
  const buf = await (await fetch(url)).arrayBuffer();
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function fontFaceCss(): Promise<string> {
  try {
    const [k4, k7, i4, i7] = await Promise.all([kalamUrl, kalamBoldUrl, interUrl, interBoldUrl].map(toBase64));
    const ff = (fam: string, w: number, d: string) => `@font-face{font-family:"${fam}";font-weight:${w};src:url(data:font/woff2;base64,${d}) format("woff2");}`;
    return ff('Kalam', 400, k4) + ff('Kalam', 700, k7) + ff('Inter', 400, i4) + ff('Inter', 700, i7);
  } catch { return ''; }
}

export async function svgString(o: { fit?: Framing['fit']; padding?: number; transparent?: boolean; time?: number; onlySelected?: boolean; embedFonts?: boolean }) {
  const doc = useDoc.getState().doc;
  const onlyIds = selOnly(o.onlySelected);
  const rect = exportRect(doc, { fit: o.fit ?? 'content', padding: o.padding ?? doc.exportPrefs.padding, onlyIds });
  const frame = renderDocumentAtTime(doc, o.time ?? useUI.getState().time, { only: onlyIds });
  return frameToSvg(frame, { rect, background: o.transparent ? null : doc.canvas.background, assets: doc.assets, fontCss: o.embedFonts === false ? '' : await fontFaceCss(), title: doc.title });
}

export async function exportSvg(o: Parameters<typeof svgString>[0]) {
  const svg = await svgString(o);
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), safeFileName(useDoc.getState().doc.title, 'svg'));
}

/** Self-contained HTML file: embedded document JSON + the FlowSketch player engine + fonts. No network needed. */
export async function exportHtmlPlayer() {
  const doc = useDoc.getState().doc;
  const json = serializeDocument(doc).replace(/</g, '\\u003c');
  const fonts = await fontFaceCss();
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(doc.title)}</title>
<style>${fonts}
html,body{margin:0;height:100%;background:${esc(doc.canvas.background)};font-family:system-ui,sans-serif}
#fs-player{position:fixed;inset:0;display:block;width:100%;height:100%;cursor:pointer}
#fs-hint{position:fixed;bottom:12px;right:14px;font:12px system-ui;color:#888;opacity:.8}
</style></head><body>
<canvas id="fs-player" aria-label="${esc(doc.title)} (animated diagram)"></canvas>
<div id="fs-hint">Click to pause · made with FlowSketch Studio</div>
<script type="application/json" id="fs-doc">${json}</script>
<script>${playerSource.replace(/<\/script/gi, '<\\/script')}</script>
</body></html>`;
  downloadBlob(new Blob([html], { type: 'text/html' }), safeFileName(doc.title, 'html'));
}
