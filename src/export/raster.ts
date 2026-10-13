// Shared offscreen rendering for every raster export (PNG/JPEG/GIF/video/clipboard).
import type { FlowDocument } from '../model/types';
import { contentBounds, renderDocumentAtTime, type Rect } from '../engine/render';
import { drawFrame } from '../engine/canvasRenderer';
import { preloadImages } from '../engine/images';
import { stage } from '../store/commands';
import { useUI } from '../store/uiStore';

export interface Framing {
  fit: 'content' | 'view';
  padding: number;
  onlyIds?: Set<string>;
}

export function exportRect(doc: FlowDocument, f: Framing): Rect {
  if (f.fit === 'view') {
    const v = useUI.getState().view;
    return { x: v.x, y: v.y, w: stage.w / v.zoom, h: stage.h / v.zoom };
  }
  const b = contentBounds(doc, f.onlyIds) ?? { x: 0, y: 0, w: 400, h: 300 };
  return { x: b.x - f.padding, y: b.y - f.padding, w: b.w + f.padding * 2, h: b.h + f.padding * 2 };
}

/** Expand rect so it has the aspect ratio of W:H (content stays centred). */
export function fitAspect(r: Rect, W: number, H: number): Rect {
  const ar = W / H;
  if (r.w / r.h > ar) { const h = r.w / ar; return { x: r.x, y: r.y - (h - r.h) / 2, w: r.w, h }; }
  const w = r.h * ar;
  return { x: r.x - (w - r.w) / 2, y: r.y, w, h: r.h };
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

export interface FrameRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  render(t: number): void;
}

export async function frameRenderer(doc: FlowDocument, rect: Rect, W: number, H: number, background: string | null, onlyIds?: Set<string>): Promise<FrameRenderer> {
  if (typeof document !== 'undefined' && 'fonts' in document) await document.fonts.ready;
  const images = await preloadImages(doc.assets);
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const scale = canvas.width / rect.w;
  return {
    canvas, ctx,
    render(t: number) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      const frame = renderDocumentAtTime(doc, t, { only: onlyIds });
      drawFrame(ctx, frame, { images, originX: rect.x, originY: rect.y, scale });
    },
  };
}

export const MAX_PIXELS = 4096 * 4096;
