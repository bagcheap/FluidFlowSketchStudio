// Editor commands shared by menus, keyboard shortcuts, toolbar and inspector.
import type { BoxElement, ConnectorAnim, DiagramElement, FlowDocument, ShapeAnim, ShapeElement, ShapeKind, ToolStyle } from '../model/types';
import { DEFAULT_ANIMATION, makeShape, newDocument, newSeed, SHAPE_DEFAULT_SIZE, uid, styleKey } from '../model/defaults';
import { deleteElements, getElement, mapElements, selectionBounds, useDoc } from './docStore';
import { useUI } from './uiStore';
import { contentBounds } from '../engine/render';
import { fileToAsset } from '../engine/images';
import { openDocumentFile, pickFile, resetFileHandle, saveDocumentFile } from '../persistence/files';
import { DocumentError, parseDocument, serializeDocument } from '../model/schema';
import { layoutText } from '../engine/text';
import { geometryFor } from '../engine/shapes';

const D = () => useDoc.getState();
const U = () => useUI.getState();

// ---- stage geometry (set by the canvas component) ---------------------------
export const stage = { w: 1200, h: 800 };

export function screenToWorld(sx: number, sy: number) {
  const v = U().view;
  return { x: v.x + sx / v.zoom, y: v.y + sy / v.zoom };
}

export function zoomAt(factor: number, sx = stage.w / 2, sy = stage.h / 2) {
  const v = U().view;
  const z = Math.min(8, Math.max(0.1, v.zoom * factor));
  const wx = v.x + sx / v.zoom, wy = v.y + sy / v.zoom;
  U().setView({ zoom: z, x: wx - sx / z, y: wy - sy / z });
}

export function fitRect(r: { x: number; y: number; w: number; h: number } | null, pad = 60, maxZoom = 2) {
  if (!r) { U().setView({ x: -stage.w / 2 + 300, y: -stage.h / 2 + 200, zoom: 1 }); return; }
  // leave room for the floating toolbar and inspector so content isn't hidden under them
  const u = U();
  pad = Math.min(pad, stage.w * 0.05 + 8);
  const right = !u.presentation && u.prefs.showInspector && stage.w > 720 ? 310 : 0;
  const top = u.presentation ? 0 : 64;
  const aw = stage.w - right, ah = stage.h - top;
  const z = Math.min(maxZoom, Math.max(0.1, Math.min((aw - pad * 2) / Math.max(1, r.w), (ah - pad * 2) / Math.max(1, r.h))));
  U().setView({ zoom: z, x: r.x + r.w / 2 - aw / 2 / z, y: r.y + r.h / 2 - (top + ah / 2) / z });
}
export const zoomToFit = () => fitRect(contentBounds(D().doc));
export const zoomToSelection = () => fitRect(selectionBounds(D().doc, U().selection), 80, 4);
export const resetZoom = () => zoomAt(1 / U().view.zoom);

// ---- selection ---------------------------------------------------------------
export function expandGroups(doc: FlowDocument, ids: string[]): string[] {
  const out = new Set(ids);
  for (const id of ids) {
    const e = getElement(doc, id);
    const g = e?.groupIds[e.groupIds.length - 1];
    if (g) for (const o of doc.elements) if (o.groupIds.includes(g)) out.add(o.id);
  }
  return [...out];
}

export const selectAll = () => { U().setTool('select'); U().select(D().doc.elements.map((e) => e.id)); };
export const deselect = () => U().select([]);
const selected = () => new Set(U().selection);

export function deleteSelection() {
  const ids = selected();
  if (!ids.size) return;
  const locked = D().doc.elements.filter((e) => ids.has(e.id) && e.locked).map((e) => e.id);
  locked.forEach((id) => ids.delete(id));
  D().commit((d) => deleteElements(d, ids));
  U().select(locked);
}

// ---- clipboard -----------------------------------------------------------------
const CLIP_MIME = 'flowsketch/elements';
let internalClip: string | null = null;

function cloneElements(doc: FlowDocument, els: DiagramElement[], dx: number, dy: number): DiagramElement[] {
  const idMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  for (const e of els) idMap.set(e.id, uid());
  return els.map((e) => {
    const n = structuredClone(e) as DiagramElement;
    n.id = idMap.get(e.id)!;
    n.seed = newSeed();
    n.groupIds = n.groupIds.map((g) => { if (!groupMap.has(g)) groupMap.set(g, uid('grp')); return groupMap.get(g)!; });
    n.locked = false;
    if (n.type === 'connector') {
      for (const k of ['start', 'end'] as const) {
        const end = n[k];
        end.x += dx; end.y += dy;
        if (end.elementId) end.elementId = idMap.get(end.elementId) ?? (getElement(doc, end.elementId) ? end.elementId : null);
      }
      n.bends = n.bends.map((b) => ({ x: b.x + dx, y: b.y + dy }));
    } else { n.x += dx; n.y += dy; }
    return n;
  });
}

export function copySelection() {
  const doc = D().doc;
  const ids = selected();
  const els = doc.elements.filter((e) => ids.has(e.id));
  if (!els.length) return false;
  const assets = Object.fromEntries(els.filter((e) => e.type === 'image').map((e) => [(e as { assetId: string }).assetId, doc.assets[(e as { assetId: string }).assetId]]));
  internalClip = JSON.stringify({ type: CLIP_MIME, elements: els, assets });
  navigator.clipboard?.writeText(internalClip).catch(() => undefined);
  return true;
}

export function cutSelection() { if (copySelection()) deleteSelection(); }

export async function paste(text?: string) {
  let raw = text ?? internalClip;
  if (!text) {
    try { const t = await navigator.clipboard?.readText(); if (t && t.includes(CLIP_MIME)) raw = t; else if (t && !internalClip) return pastePlainText(t); } catch { /* permission denied: use internal */ }
  }
  if (!raw) return;
  let data: { type?: string; elements?: unknown[]; assets?: Record<string, unknown> };
  try { data = JSON.parse(raw); } catch { return pastePlainText(raw); }
  if (data.type !== CLIP_MIME || !Array.isArray(data.elements)) return pastePlainText(raw);
  // run through the same sanitiser as files
  const { doc: parsed } = parseDocument({ format: 'flowsketch', schemaVersion: 1, elements: data.elements, assets: data.assets ?? {} });
  const doc = D().doc;
  const clones = cloneElements(doc, parsed.elements, 24, 24);
  D().commit((d) => ({ ...d, assets: { ...d.assets, ...parsed.assets }, elements: [...d.elements, ...clones] }));
  U().setTool('select');
  U().select(clones.map((c) => c.id));
}

function pastePlainText(t: string) {
  const c = screenToWorld(stage.w / 2, stage.h / 2);
  const ts = U().toolStyle('text');
  const lay = layoutText(t.slice(0, 2000), ts.textStyle, null);
  const el: DiagramElement = { id: uid(), type: 'text', x: c.x - lay.width / 2, y: c.y, w: lay.width + 8, h: lay.height + 4, rotation: 0, locked: false, groupIds: [], seed: newSeed(), style: { ...ts.style }, text: t.slice(0, 2000), textStyle: { ...ts.textStyle, padding: 2 } };
  D().commit((d) => ({ ...d, elements: [...d.elements, el] }));
  U().select([el.id]);
}

export function duplicateSelection() {
  const doc = D().doc;
  const ids = selected();
  const els = doc.elements.filter((e) => ids.has(e.id));
  if (!els.length) return;
  const clones = cloneElements(doc, els, 20, 20);
  D().commit((d) => ({ ...d, elements: [...d.elements, ...clones] }));
  U().select(clones.map((c) => c.id));
}

// ---- style --------------------------------------------------------------------
export function styleOf(e: DiagramElement): ToolStyle {
  const s: ToolStyle = { style: { ...e.style }, textStyle: { ...e.textStyle } };
  if (e.type === 'connector') { s.routing = e.routing; s.startHead = e.startHead; s.endHead = e.endHead; if (e.anim) s.connectorAnim = { ...e.anim }; }
  else if (e.anim) s.shapeAnim = { ...e.anim };
  return s;
}

export function copyStyle() {
  const e = getElement(D().doc, U().selection[0]);
  if (e) { U().setCopiedStyle(styleOf(e)); U().toast('Style copied'); }
}

export function applyStyle(ids: string[], s: ToolStyle) {
  D().commit((d) => mapElements(d, ids, (e) => {
    if (e.type === 'connector') return { ...e, style: { ...s.style, fillStyle: 'none' }, textStyle: { ...s.textStyle }, ...(s.routing ? { routing: s.routing } : {}), ...(s.endHead ? { endHead: s.endHead, startHead: s.startHead ?? 'none' } : {}), ...(s.connectorAnim ? { anim: { ...s.connectorAnim } } : {}) };
    return { ...e, style: { ...s.style }, textStyle: { ...s.textStyle, ...(e.type === 'text' ? { padding: e.textStyle.padding } : {}) }, ...(s.shapeAnim ? { anim: { ...s.shapeAnim } } : {}) } as DiagramElement;
  }));
}

export function pasteStyle() {
  const s = U().copiedStyle;
  if (!s) { U().toast('Copy a style first (Edit ▸ Copy style)'); return; }
  applyStyle(U().selection, s);
}

/** Make the selected object's look the default for its tool. */
/** The remembered-style key of the tool that draws this kind of element. */
export function toolKeyFor(e: DiagramElement): string | null {
  return e.type === 'shape' ? styleKey('shape', e.shape) : e.type === 'connector' ? (e.endHead === 'none' && e.startHead === 'none' ? 'line' : 'arrow') : e.type === 'freehand' ? (e.highlighter ? 'highlighter' : 'freehand') : e.type === 'text' ? 'text' : null;
}

/** Copy style changes made on selected objects into their tools' defaults (Excalidraw-like "current item style"). */
export function rememberSelectionStyle(ids: string[]) {
  if (!U().prefs.selectionUpdatesDefaults) return;
  const doc = D().doc;
  const done = new Set<string>();
  for (const id of ids) {
    const e = getElement(doc, id);
    const key = e && toolKeyFor(e);
    if (!e || !key || done.has(key)) continue;
    done.add(key);
    const cur = U().toolStyle(key);
    U().setToolStyle(key, { ...cur, style: { ...e.style }, textStyle: { ...e.textStyle, ...(e.type === 'connector' ? {} : { padding: cur.textStyle.padding }) } });
  }
}

export function applySelectionStyleToDefaults() {
  const e = getElement(D().doc, U().selection[0]);
  if (!e) return;
  const key = toolKeyFor(e);
  if (!key) return;
  U().setToolStyle(key, styleOf(e));
  U().toast(`Saved as the default style for new ${key.replace('shape:', '')} drawings`, 'success');
}

// ---- arrange ------------------------------------------------------------------
export function groupSelection() {
  const ids = selected();
  if (ids.size < 2) return;
  const g = uid('grp');
  D().commit((d) => mapElements(d, ids, (e) => ({ ...e, groupIds: [...e.groupIds, g] })));
}
export function ungroupSelection() {
  const ids = selected();
  D().commit((d) => mapElements(d, ids, (e) => (e.groupIds.length ? { ...e, groupIds: e.groupIds.slice(0, -1) } : e)));
}
export function toggleLock() {
  const ids = selected();
  const doc = D().doc;
  const anyUnlocked = doc.elements.some((e) => ids.has(e.id) && !e.locked);
  D().commit((d) => mapElements(d, ids, (e) => ({ ...e, locked: anyUnlocked })));
}
export function unlockAll() { D().commit((d) => ({ ...d, elements: d.elements.map((e) => (e.locked ? { ...e, locked: false } : e)) })); }

export function reorder(kind: 'front' | 'back' | 'forward' | 'backward') {
  const ids = selected();
  if (!ids.size) return;
  D().commit((d) => {
    const els = [...d.elements];
    if (kind === 'front') return { ...d, elements: [...els.filter((e) => !ids.has(e.id)), ...els.filter((e) => ids.has(e.id))] };
    if (kind === 'back') return { ...d, elements: [...els.filter((e) => ids.has(e.id)), ...els.filter((e) => !ids.has(e.id))] };
    if (kind === 'forward') {
      for (let i = els.length - 2; i >= 0; i--) if (ids.has(els[i].id) && !ids.has(els[i + 1].id)) [els[i], els[i + 1]] = [els[i + 1], els[i]];
    } else {
      for (let i = 1; i < els.length; i++) if (ids.has(els[i].id) && !ids.has(els[i - 1].id)) [els[i], els[i - 1]] = [els[i - 1], els[i]];
    }
    return { ...d, elements: els };
  });
}

const boxesSel = () => D().doc.elements.filter((e): e is BoxElement => selected().has(e.id) && e.type !== 'connector' && !e.locked);

export function align(kind: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') {
  const els = boxesSel();
  if (els.length < 2) return;
  const x0 = Math.min(...els.map((e) => e.x)), x1 = Math.max(...els.map((e) => e.x + e.w));
  const y0 = Math.min(...els.map((e) => e.y)), y1 = Math.max(...els.map((e) => e.y + e.h));
  D().commit((d) => mapElements(d, els.map((e) => e.id), (e) => {
    const b = e as BoxElement;
    switch (kind) {
      case 'left': return { ...b, x: x0 };
      case 'right': return { ...b, x: x1 - b.w };
      case 'hcenter': return { ...b, x: (x0 + x1) / 2 - b.w / 2 };
      case 'top': return { ...b, y: y0 };
      case 'bottom': return { ...b, y: y1 - b.h };
      case 'vcenter': return { ...b, y: (y0 + y1) / 2 - b.h / 2 };
    }
  }));
}

export function distribute(axis: 'h' | 'v') {
  const els = boxesSel().sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y));
  if (els.length < 3) return;
  const total = els.reduce((s, e) => s + (axis === 'h' ? e.w : e.h), 0);
  const first = els[0], last = els[els.length - 1];
  const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
  const gap = (span - total) / (els.length - 1);
  let cur = axis === 'h' ? first.x : first.y;
  const pos = new Map<string, number>();
  for (const e of els) { pos.set(e.id, cur); cur += (axis === 'h' ? e.w : e.h) + gap; }
  D().commit((d) => mapElements(d, [...pos.keys()], (e) => ({ ...e, ...(axis === 'h' ? { x: pos.get(e.id)! } : { y: pos.get(e.id)! }) })));
}

export function flip(axis: 'h' | 'v') {
  D().commit((d) => mapElements(d, selected(), (e) => {
    if (e.type === 'shape') return axis === 'h' ? { ...e, flipX: !e.flipX } : { ...e, flipY: !e.flipY };
    if (e.type === 'freehand') return { ...e, points: e.points.map(([x, y]) => (axis === 'h' ? [1 - x, y] : [x, 1 - y]) as [number, number]) };
    return e;
  }));
}

export function nudge(dx: number, dy: number) {
  const ids = selected();
  if (!ids.size) return;
  D().commit((d) => mapElements(d, ids, (e) => {
    if (e.locked) return e;
    if (e.type === 'connector') {
      const mv = (p: typeof e.start) => (p.elementId && ids.has(p.elementId) ? p : p.elementId ? p : { ...p, x: p.x + dx, y: p.y + dy });
      return { ...e, start: mv(e.start), end: mv(e.end), bends: e.bends.map((b) => ({ x: b.x + dx, y: b.y + dy })) };
    }
    return { ...e, x: e.x + dx, y: e.y + dy };
  }), 'nudge');
}

// ---- insertion ------------------------------------------------------------------
export function insertShapeAtCenter(kind: ShapeKind) {
  const c = screenToWorld(stage.w / 2, stage.h / 2);
  const ts = U().toolStyle(styleKey('shape', kind));
  const [w, h] = SHAPE_DEFAULT_SIZE[kind] ?? [160, 80];
  const el = makeShape(kind, c.x - w / 2, c.y - h / 2, w, h, ts);
  D().commit((d) => ({ ...d, elements: [...d.elements, el] }));
  U().setTool('select', kind);
  U().select([el.id]);
}

export async function insertImage(file?: File, at?: { x: number; y: number }) {
  const f = file ?? (await pickFile('image/png,image/jpeg,image/gif,image/webp'));
  if (!f) return;
  try {
    const asset = await fileToAsset(f);
    const scale = Math.min(1, 480 / Math.max(asset.width, asset.height));
    const w = asset.width * scale, h = asset.height * scale;
    const c = at ?? screenToWorld(stage.w / 2, stage.h / 2);
    const ts = U().toolStyle('image');
    const el: DiagramElement = { id: uid(), type: 'image', assetId: asset.id, x: c.x - w / 2, y: c.y - h / 2, w, h, rotation: 0, locked: false, groupIds: [], seed: newSeed(), style: { ...ts.style }, text: '', textStyle: { ...ts.textStyle }, anim: { mode: 'float' } };
    D().commit((d) => ({ ...d, assets: { ...d.assets, [asset.id]: asset }, elements: [...d.elements, el] }));
    U().setTool('select');
    U().select([el.id]);
  } catch (e) { U().toast((e as Error).message || 'Could not insert the image.', 'error'); }
}

/** Grow a shape so its label fits (auto expansion). */
export function fitShapeToText(e: DiagramElement): DiagramElement {
  if (e.type === 'text') {
    const lay = layoutText(e.text || ' ', e.textStyle, null);
    return { ...e, w: Math.max(10, lay.width + e.textStyle.padding * 2 + 4), h: lay.height + e.textStyle.padding * 2 };
  }
  if (e.type !== 'shape' || !e.text) return e;
  let out: ShapeElement = e;
  const pad = e.textStyle.padding;
  // widen first if a single word can't fit (avoid breaking words mid-way)
  const longest = Math.max(0, ...e.text.split(/\s+/).map((w) => layoutText(w, e.textStyle, null).width));
  let g = geometryFor(out);
  if (longest > g.textBox.w - pad * 2) {
    const wr = e.w / Math.max(1, g.textBox.w);
    const nw = Math.ceil((longest + pad * 2 + 2) * wr);
    out = { ...out, w: nw, x: out.x - (nw - out.w) / 2 };
    g = geometryFor(out);
  }
  const lay = layoutText(e.text, e.textStyle, Math.max(8, g.textBox.w - pad * 2) + 1);
  const need = lay.height + pad * 2;
  if (need <= g.textBox.h + 0.5) return out;
  const ratio = out.h / Math.max(1, g.textBox.h);
  return { ...out, h: Math.ceil(need * ratio) };
}

// ---- animation commands -------------------------------------------------------------
export const SHAPE_PRESETS: Record<string, Partial<ShapeAnim>> = {
  'Calm (barely alive)': { mode: 'combined', intensity: 1 },
  'Gentle float': { mode: 'float', intensity: 2 },
  'Organic wobble': { mode: 'wobble', intensity: 3 },
  'Sketch boil': { mode: 'boil', intensity: 2 },
  'Soft sway': { mode: 'sway', intensity: 3 },
  'Lively': { mode: 'combined', intensity: 5, speed: 0.6 },
  'Still': { mode: 'off' },
};
export const ARROW_PRESETS: Record<string, Partial<ConnectorAnim>> = {
  'Travelling highlight': { mode: 'travel' },
  'Draw on': { mode: 'drawOn' },
  'Marching dashes': { mode: 'dash' },
  'Pulse': { mode: 'pulse' },
  'Static': { mode: 'none' },
};

export function applyAnimToSelection(shape?: Partial<ShapeAnim>, conn?: Partial<ConnectorAnim>) {
  const ids = U().selection;
  if (!ids.length) { U().toast('Select objects first'); return; }
  D().commit((d) => mapElements(d, ids, (e) => {
    if (e.type === 'connector') return conn ? { ...e, anim: { ...e.anim, ...conn } } : e;
    return shape ? { ...e, anim: { ...e.anim, ...shape } } : e;
  }));
}

export function resetAnimSelected() {
  D().commit((d) => mapElements(d, U().selection, (e) => { if (!('anim' in e) || !e.anim) return e; const { anim: _a, ...rest } = e; return rest as DiagramElement; }));
}

export function resetDocAnimation() {
  D().commit((d) => ({ ...d, animation: structuredClone(DEFAULT_ANIMATION) }));
}

export function setAnimation(patch: Partial<FlowDocument['animation']>, key = 'anim-settings') {
  D().commit((d) => ({ ...d, animation: { ...d.animation, ...patch } }), key);
}

// ---- playback --------------------------------------------------------------------
export function togglePlay() {
  const u = U();
  const doc = D().doc;
  if (!u.playing && !doc.animation.loop && u.time >= doc.animation.duration - 1e-3) u.setTime(0);
  u.setPlaying(!u.playing);
}
export const restart = () => { U().setTime(0); U().setPlaying(true); };
export const stop = () => { U().setPlaying(false); U().setTime(0); };

// ---- documents ----------------------------------------------------------------------
export async function confirmDiscard(): Promise<boolean> {
  if (!D().dirty || !D().doc.elements.length) return true;
  return U().ask('This diagram has changes that are not saved to a file (it is autosaved in this browser and stays in Recent documents). Replace it?', 'Replace');
}

export async function newDiagram() {
  if (!(await confirmDiscard())) return;
  resetFileHandle();
  D().load(newDocument());
  useUI.setState({ welcomeDismissed: true }); // the user asked for a blank canvas
  U().select([]);
  U().setTime(0);
  fitRect(null);
}

export function loadDocument(doc: FlowDocument, fileName: string | null = null, dirty = false) {
  D().load(doc, { fileName, dirty });
  U().select([]);
  U().setTime(0);
  requestAnimationFrame(() => zoomToFit());
}

export async function openFile() {
  if (!(await confirmDiscard())) return;
  try {
    const r = await openDocumentFile();
    if (!r) return;
    loadDocument(r.doc, r.name);
    if (r.warnings.length) U().toast(`Opened with ${r.warnings.length} repair(s): ${r.warnings[0]}`, 'info');
    else U().toast(`Opened “${r.doc.title}”`, 'success');
  } catch (e) {
    U().toast(e instanceof DocumentError ? e.message : 'Could not open that file.', 'error', { label: 'Try again', run: () => void openFile() });
  }
}

export async function save(saveAs = false) {
  try {
    const name = await saveDocumentFile(D().doc, saveAs);
    if (name) { D().markSaved(name); U().toast(`Saved ${name}`, 'success'); }
  } catch (e) { U().toast(`Save failed: ${(e as Error).message}`, 'error'); }
}

export function renameDocument(title?: string) {
  if (title === undefined) { (document.querySelector('.doc-title') as HTMLInputElement | null)?.select(); return; }
  const t = title;
  if (t && t.trim()) D().commit((d) => ({ ...d, title: t.trim().slice(0, 200) }), 'title');
}

export function duplicateDocument() {
  const src = D().doc;
  const { doc } = parseDocument(serializeDocument(src));
  const copy = { ...doc, id: uid('doc'), title: `${src.title} (copy)`, createdAt: new Date().toISOString() };
  resetFileHandle();
  D().load(copy, { dirty: true });
  U().toast('Duplicated into a new document');
}
