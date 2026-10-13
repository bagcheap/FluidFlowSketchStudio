// Web Worker: colour quantisation + GIF encoding (keeps the UI responsive).
/// <reference lib="webworker" />
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

type Palette = number[][];

interface StartMsg { type: 'start'; width: number; height: number; colors: number; dither: boolean; transparent: boolean; repeat: number; globalPalette: boolean }
interface SampleMsg { type: 'sample'; rgba: ArrayBuffer }
interface FrameMsg { type: 'frame'; rgba: ArrayBuffer; delayMs: number }
interface FinishMsg { type: 'finish' }
type Msg = StartMsg | SampleMsg | FrameMsg | FinishMsg;

let enc: ReturnType<typeof GIFEncoder> | null = null;
let opts: StartMsg | null = null;
let samples: Uint8Array[] = [];
let palette: Palette | null = null;
let frameNo = 0;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function prep(rgba: Uint8Array) {
  if (!opts) return;
  const { width, transparent, dither, colors } = opts;
  const strength = dither ? Math.max(4, 160 / colors) : 0;
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    if (transparent) {
      if (rgba[i + 3] < 128) { rgba[i] = rgba[i + 1] = rgba[i + 2] = 0; rgba[i + 3] = 0; continue; }
      rgba[i + 3] = 255;
    }
    if (strength) {
      const x = p % width, y = (p / width) | 0;
      const d = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.47) * strength;
      rgba[i] = Math.max(0, Math.min(255, rgba[i] + d));
      rgba[i + 1] = Math.max(0, Math.min(255, rgba[i + 1] + d));
      rgba[i + 2] = Math.max(0, Math.min(255, rgba[i + 2] + d));
    }
  }
}

function makePalette(data: Uint8Array): Palette {
  if (!opts) throw new Error('not started');
  if (opts.transparent) {
    const p = quantize(data, opts.colors, { format: 'rgba4444', oneBitAlpha: true, clearAlpha: true });
    return p;
  }
  return quantize(data, opts.colors, { format: 'rgb565' });
}

self.onmessage = (ev: MessageEvent<Msg>) => {
  const m = ev.data;
  try {
    if (m.type === 'start') {
      opts = m; samples = []; palette = null; frameNo = 0;
      enc = GIFEncoder();
    } else if (m.type === 'sample') {
      samples.push(new Uint8Array(m.rgba));
    } else if (m.type === 'frame') {
      if (!enc || !opts) throw new Error('Encoder not started');
      const rgba = new Uint8Array(m.rgba);
      prep(rgba);
      if (opts.globalPalette && !palette) {
        if (samples.length) {
          const total = samples.reduce((s, a) => s + a.length, 0);
          const all = new Uint8Array(total);
          let o = 0;
          for (const s of samples) { prep(s); all.set(s, o); o += s.length; }
          palette = makePalette(all);
          samples = [];
        } else palette = makePalette(rgba);
      }
      const pal = opts.globalPalette ? palette! : makePalette(rgba);
      const format = opts.transparent ? 'rgba4444' : 'rgb565';
      const index = applyPalette(rgba, pal, format);
      const tIndex = opts.transparent ? pal.findIndex((c) => c[3] === 0) : -1;
      enc.writeFrame(index, opts.width, opts.height, {
        palette: frameNo === 0 || !opts.globalPalette ? pal : undefined,
        delay: m.delayMs,
        repeat: opts.repeat,
        transparent: tIndex >= 0,
        transparentIndex: Math.max(0, tIndex),
        dispose: opts.transparent ? 2 : -1,
      });
      frameNo++;
      (self as unknown as Worker).postMessage({ type: 'progress', frames: frameNo });
    } else if (m.type === 'finish') {
      if (!enc) throw new Error('Encoder not started');
      enc.finish();
      const bytes = enc.bytes();
      (self as unknown as Worker).postMessage({ type: 'done', bytes }, [bytes.buffer]);
      enc = null; opts = null;
    }
  } catch (e) {
    (self as unknown as Worker).postMessage({ type: 'error', message: (e as Error).message || String(e) });
  }
};
