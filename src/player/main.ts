// Standalone player embedded in exported HTML files. Same engine as the editor.
// Interactive: play/pause, step through a play order (buttons or ← →), pages (a page menu, links on items go to a
// page, Back returns) and notes shown when pointing at an item. Everything from the file is shown as plain text.
import { parseDocument } from '../model/schema';
import type { DiagramElement, FlowDocument } from '../model/types';
import { cameraView, contentBounds, elementBounds, renderDocumentAtTime } from '../engine/render';
import { drawFrame } from '../engine/canvasRenderer';
import { imageMap, onImageLoaded } from '../engine/images';
import { resetTextMetrics } from '../engine/text';
import { switchPage } from '../store/pages';
import { hitTest } from '../editor/hitTest';
import { nextSegment, prevStop, stepAt, stepStarts } from './steps';

const src = document.getElementById('fs-doc')?.textContent ?? '';
const file = parseDocument(src).doc;
const canvas = document.getElementById('fs-player') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

let doc: FlowDocument = file; // the page being shown
const history: string[] = []; // pages visited by following links (Back returns)
let playing = !reduce;
let stopAt: number | null = null; // stepping: pause here
let t = 0;
let last = performance.now();
let dirty = true;
let view = { ox: 0, oy: 0, z: 1 }; // last drawn camera (world → screen: (p - o) * z), for pointing at items
onImageLoaded(() => { dirty = true; });
document.fonts?.ready.then(() => { resetTextMetrics(); dirty = true; });
addEventListener('resize', () => { dirty = true; });

// ---- controls (built here, so the exported file only needs a container) ---------------------------------------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
}
const bar = el('div', { id: 'fs-bar', role: 'toolbar' });
bar.setAttribute('aria-label', 'Player controls');
const btn = (label: string, glyph: string, run: () => void) => {
  const b = el('button', { type: 'button', title: label, 'aria-label': label }, glyph);
  b.addEventListener('click', (e) => { e.stopPropagation(); run(); });
  return b;
};
const back = btn('Back to the previous page (Backspace)', '←', goBack);
back.textContent = '← Back';
const restartBtn = btn('Start again (Home)', '⏮', () => { t = 0; stopAt = null; playing = true; dirty = true; sync(); });
const prevBtn = btn('Previous step (←)', '◀', prev);
const playBtn = btn('Play / pause (Space)', '▶', togglePlay);
const nextBtn = btn('Next step (→)', '▶▶', next);
const stepLabel = el('span', { class: 'fs-step' });
stepLabel.setAttribute('aria-live', 'polite');
const pageSel = el('select', { title: 'Go to page' });
pageSel.setAttribute('aria-label', 'Page');
for (const p of file.pages) pageSel.append(el('option', { value: p.id }, p.name));
pageSel.onchange = () => goTo(pageSel.value, true);
bar.append(back, restartBtn, prevBtn, playBtn, nextBtn, stepLabel, pageSel);
document.body.append(bar);
const tip = el('div', { id: 'fs-tip', role: 'tooltip' });
document.body.append(tip);

function sync() {
  const n = stepStarts(doc).length;
  for (const b of [prevBtn, nextBtn, stepLabel]) b.hidden = n === 0;
  stepLabel.textContent = stepText();
  playBtn.textContent = playing ? '⏸' : '▶';
  back.hidden = history.length === 0;
  pageSel.hidden = file.pages.length < 2;
  pageSel.value = doc.activePage;
}

function togglePlay() {
  playing = !playing; stopAt = null; last = performance.now(); dirty = true; sync();
}
function next() {
  const s = nextSegment(doc, t);
  if (!s) return;
  t = s.from; stopAt = s.to; playing = true; last = performance.now(); dirty = true; sync();
}
function prev() {
  if (!stepStarts(doc).length) return;
  t = prevStop(doc, t); stopAt = null; playing = false; dirty = true; sync();
}
/** Show page `id` from the start; `remember` puts the page we leave on the Back list. */
function goTo(id: string, remember: boolean) {
  if (id === doc.activePage || !file.pages.some((p) => p.id === id)) { sync(); return; }
  if (remember) history.push(doc.activePage);
  doc = switchPage(doc, id);
  t = 0; stopAt = null; playing = !reduce; dirty = true;
  hideTip(); sync();
}
function goBack() {
  const id = history.pop();
  if (id) goTo(id, false);
}

// ---- pointing at items: notes and links ---------------------------------------------------------------------
const pageName = (id: string) => file.pages.find((p) => p.id === id)?.name ?? '';
const linkOf = (e: DiagramElement | null) => (e?.link && e.link !== doc.activePage && pageName(e.link) ? e.link : null);
/** The item under a point on the screen that has a note or a link (others are ignored, like empty canvas). */
function itemAt(x: number, y: number): DiagramElement | null {
  const r = canvas.getBoundingClientRect();
  const p = { x: view.ox + (x - r.left) / view.z, y: view.oy + (y - r.top) / view.z };
  return hitTest(doc, p, view.z, (e) => !!(e.note || linkOf(e)));
}
function hideTip() { tip.hidden = true; canvas.style.cursor = ''; }
canvas.addEventListener('pointermove', (e) => {
  const it = itemAt(e.clientX, e.clientY);
  if (!it) { hideTip(); return; }
  const link = linkOf(it);
  canvas.style.cursor = link ? 'pointer' : 'help';
  tip.replaceChildren();
  if (it.note) tip.append(el('div', {}, it.note));
  if (link) tip.append(el('div', { class: 'fs-go' }, `Click to open “${pageName(link)}”`));
  tip.hidden = false;
  const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8), y = Math.min(e.clientY + 16, innerHeight - tip.offsetHeight - 8);
  tip.style.left = `${Math.max(8, x)}px`; tip.style.top = `${Math.max(8, y)}px`;
});
canvas.addEventListener('pointerleave', hideTip);
canvas.addEventListener('click', (e) => {
  const link = linkOf(itemAt(e.clientX, e.clientY));
  if (link) goTo(link, true); else togglePlay();
});
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).tagName === 'SELECT') return;
  const k = e.key;
  if (k === ' ' || k === 'k') togglePlay();
  else if (k === 'ArrowRight' || k === 'PageDown') next();
  else if (k === 'ArrowLeft' || k === 'PageUp') prev();
  else if (k === 'Home') { t = 0; stopAt = null; playing = false; dirty = true; sync(); }
  else if (k === 'Backspace' || k === 'Escape') goBack();
  else return;
  e.preventDefault();
});

// ---- drawing ------------------------------------------------------------------------------------------------
/** A small round badge on items that link to a page, so viewers can tell they can be clicked. */
function drawLinkBadges(dpr: number) {
  for (const e of doc.elements) {
    if (!linkOf(e)) continue;
    const b = elementBounds(doc, e);
    const x = (b.x + b.w - view.ox) * view.z * dpr, y = (b.y - view.oy) * view.z * dpr, r = 9 * dpr;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#4361ee'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
    // an arrow pointing up and right
    ctx.beginPath();
    ctx.moveTo(x - r * 0.35, y + r * 0.35); ctx.lineTo(x + r * 0.35, y - r * 0.35);
    ctx.moveTo(x - r * 0.1, y - r * 0.35); ctx.lineTo(x + r * 0.35, y - r * 0.35); ctx.lineTo(x + r * 0.35, y + r * 0.1);
    ctx.lineWidth = 1.6 * dpr; ctx.lineCap = 'round'; ctx.stroke();
    ctx.restore();
  }
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const a = doc.animation;
  if (playing) {
    t += ((now - last) / 1000) * a.playbackSpeed;
    if (stopAt !== null && t >= stopAt) { t = stopAt; stopAt = null; playing = false; sync(); }
    if (t >= a.duration) { t = a.loop ? t % a.duration : a.duration; if (!a.loop) { playing = false; sync(); } }
    dirty = true;
  }
  last = now;
  if (!dirty) return;
  dirty = false;
  const dpr = Math.min(3, devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const b = contentBounds(doc) ?? { x: 0, y: 0, w: 100, h: 100 };
  const pad = 32, top = 56; // room for the controls
  const z0 = Math.min((W - pad * 2) / b.w, (H - top - pad * 2) / b.h, 3);
  // the whole picture at this window's shape; camera moves (if on) zoom within it
  const base = { x: b.x + b.w / 2 - W / 2 / z0, y: b.y + b.h / 2 - (H + top) / 2 / z0, w: W / z0, h: H / z0 };
  const r = cameraView(doc, t, base, W / H);
  view = { ox: r.x, oy: r.y, z: W / r.w };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = doc.canvas.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawFrame(ctx, renderDocumentAtTime(doc, t), { images: imageMap(doc.assets), originX: view.ox, originY: view.oy, scale: view.z * dpr });
  drawLinkBadges(dpr);
  if (playing && stepLabel.textContent !== stepText()) sync();
}
/** The step counter: "Start" at the very beginning (nothing has played yet), else the step playing or just played. */
const stepText = () => { const n = stepStarts(doc).length, k = stepAt(doc, t); return k < 0 || t < 0.001 ? `Start · ${n} steps` : `Step ${k + 1} of ${n}`; };
sync();
requestAnimationFrame(frame);
