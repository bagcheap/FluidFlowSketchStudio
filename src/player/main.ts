// Standalone player embedded in exported HTML files. Same engine as the editor.
import { parseDocument } from '../model/schema';
import { contentBounds, renderDocumentAtTime } from '../engine/render';
import { drawFrame } from '../engine/canvasRenderer';
import { imageMap, onImageLoaded } from '../engine/images';
import { resetTextMetrics } from '../engine/text';

const src = document.getElementById('fs-doc')?.textContent ?? '';
const { doc } = parseDocument(src);
const canvas = document.getElementById('fs-player') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let playing = !reduce;
let t = 0;
let last = performance.now();
let dirty = true;
onImageLoaded(() => { dirty = true; });
document.fonts?.ready.then(() => { resetTextMetrics(); dirty = true; });
canvas.addEventListener('click', () => { playing = !playing; last = performance.now(); });
addEventListener('resize', () => { dirty = true; });

function frame(now: number) {
  requestAnimationFrame(frame);
  const a = doc.animation;
  if (playing) {
    t += ((now - last) / 1000) * a.playbackSpeed;
    if (t >= a.duration) t = a.loop ? t % a.duration : a.duration;
    dirty = true;
  }
  last = now;
  if (!dirty) return;
  dirty = false;
  const dpr = Math.min(3, devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const b = contentBounds(doc) ?? { x: 0, y: 0, w: 100, h: 100 };
  const pad = 32;
  const z = Math.min((W - pad * 2) / b.w, (H - pad * 2) / b.h, 3);
  const ox = b.x + b.w / 2 - W / 2 / z, oy = b.y + b.h / 2 - H / 2 / z;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = doc.canvas.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawFrame(ctx, renderDocumentAtTime(doc, t), { images: imageMap(doc.assets), originX: ox, originY: oy, scale: z * dpr });
}
requestAnimationFrame(frame);
