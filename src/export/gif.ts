// Animated GIF export: deterministic frame sampling on the main thread (offscreen canvas,
// timestamp-driven so the tab need not be visible), quantisation + encoding in a Web Worker.
import type { FlowDocument } from '../model/types';
import { exportRect, fitAspect, frameRenderer, MAX_PIXELS, type Framing } from './raster';

export interface GifSettings extends Framing {
  width: number;
  height: number; // 0 = derive from aspect
  fps: number;
  duration: number;
  loopCount: number; // 0 = forever
  background: string | null; // null = transparent
  colors: number;
  dither: boolean;
  globalPalette: boolean;
  seamless: boolean;
}

export interface GifPlan { width: number; height: number; frames: number; times: number[]; delaysCs: number[]; rect: { x: number; y: number; w: number; h: number }; estBytes: number; warnings: string[] }

export function planGif(doc: FlowDocument, s: GifSettings): GifPlan {
  let rect = exportRect(doc, s);
  let W = Math.max(16, Math.round(s.width));
  let H = s.height > 0 ? Math.max(16, Math.round(s.height)) : Math.max(16, Math.round((rect.h / rect.w) * W));
  if (W * H > MAX_PIXELS) { const k = Math.sqrt(MAX_PIXELS / (W * H)); W = Math.floor(W * k); H = Math.floor(H * k); }
  rect = fitAspect(rect, W, H);
  const n = Math.max(1, Math.round(s.duration * s.fps));
  // seamless: n frames spaced so frame n would equal frame 0 (we never render it twice)
  const times = Array.from({ length: n }, (_, i) => (s.seamless ? (i * s.duration) / n : Math.min(s.duration, i / s.fps)));
  // GIF delays are in centiseconds; distribute rounding so total time stays exact
  const delaysCs = times.map((_, i) => Math.round(((i + 1) * 100) / s.fps) - Math.round((i * 100) / s.fps));
  const warnings: string[] = [];
  const px = W * H * n;
  if (delaysCs.some((d) => d < 2)) warnings.push('Most viewers clamp GIF frame delays under 20 ms; frame rates above 50 FPS will play slower than expected.');
  if (px > 120e6) warnings.push('This is a very large GIF (many megapixels across all frames). It may take a while and produce a big file — consider a smaller width, lower FPS, or exporting video instead.');
  if (!doc.animation.loop || !doc.animation.seamless) warnings.push('Document looping/seamless mode is off, so the first and last frames may not match.');
  if (doc.elements.some((e) => e.type !== 'connector' && (e.anim?.delay ?? doc.animation.shape.delay) > 0)) warnings.push('Objects with a start delay ease in, so the loop seam may be visible.');
  const estBytes = Math.round(px * 0.09 + 2000);
  return { width: W, height: H, frames: n, times, delaysCs, rect, estBytes, warnings };
}

export interface GifProgress { phase: 'render' | 'encode' | 'done'; done: number; total: number }

export async function exportGif(doc: FlowDocument, s: GifSettings, onProgress: (p: GifProgress) => void, signal?: AbortSignal): Promise<Blob> {
  const plan = planGif(doc, s);
  const r = await frameRenderer(doc, plan.rect, plan.width, plan.height, s.background, s.onlyIds);
  const worker = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' });
  let pending: { resolve: (v: unknown) => void; reject: (e: Error) => void } | null = null;
  let result: Uint8Array | null = null;
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'error') pending?.reject(new Error(m.message));
    else if (m.type === 'done') { result = m.bytes; pending?.resolve(null); }
    else pending?.resolve(m);
  };
  worker.onerror = (e) => pending?.reject(new Error(e.message || 'GIF encoder crashed (possibly out of memory).'));
  const wait = () => new Promise((resolve, reject) => { pending = { resolve, reject }; });
  const abort = () => { worker.terminate(); r.canvas.width = r.canvas.height = 0; };
  try {
    worker.postMessage({ type: 'start', width: plan.width, height: plan.height, colors: s.colors, dither: s.dither, transparent: !s.background, repeat: s.loopCount === 0 ? 0 : s.loopCount, globalPalette: s.globalPalette });
    if (s.globalPalette) {
      // send a few evenly spaced sample frames so the shared palette covers the whole animation
      const k = Math.min(6, plan.frames);
      for (let j = 0; j < k; j++) {
        r.render(plan.times[Math.floor((j * plan.frames) / k)]);
        const d = r.ctx.getImageData(0, 0, plan.width, plan.height).data;
        // subsample to ~1/4 of pixels to keep the quantiser fast
        const sub = new Uint8Array(Math.ceil(d.length / 16) * 4);
        for (let i = 0, o = 0; i < d.length; i += 16, o += 4) { sub[o] = d[i]; sub[o + 1] = d[i + 1]; sub[o + 2] = d[i + 2]; sub[o + 3] = d[i + 3]; }
        worker.postMessage({ type: 'sample', rgba: sub.buffer }, [sub.buffer]);
      }
    }
    for (let i = 0; i < plan.frames; i++) {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      r.render(plan.times[i]);
      const img = r.ctx.getImageData(0, 0, plan.width, plan.height);
      const buf = img.data.buffer;
      worker.postMessage({ type: 'frame', rgba: buf, delayMs: plan.delaysCs[i] * 10 }, [buf]);
      await wait(); // backpressure: one frame in flight keeps memory flat
      onProgress({ phase: 'render', done: i + 1, total: plan.frames });
    }
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    onProgress({ phase: 'encode', done: plan.frames, total: plan.frames });
    worker.postMessage({ type: 'finish' });
    await wait();
    if (!result) throw new Error('Encoder produced no data.');
    onProgress({ phase: 'done', done: plan.frames, total: plan.frames });
    return new Blob([result as Uint8Array<ArrayBuffer>], { type: 'image/gif' });
  } finally {
    abort();
  }
}
