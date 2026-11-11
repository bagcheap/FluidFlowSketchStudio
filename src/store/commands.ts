// Editor commands shared by menus, keyboard shortcuts, toolbar and inspector.
import type { Asset, BoxElement, ConnectorAnim, ContainerElement, DiagramElement, FlowDocument, IconAsset, ShapeAnim, ShapeElement, ShapeKind, ToolStyle } from '../model/types';
import { SCHEMA_VERSION } from '../model/types';
import { cycleFill, DEFAULT_ANIMATION, makeIcon, makeShape, newDocument, newSeed, SHAPE_DEFAULT_SIZE, uid, styleKey } from '../model/defaults';
import { deleteElements, getElement, mapElements, selectionBounds, useDoc } from './docStore';
import { useUI } from './uiStore';
import { contentBounds } from '../engine/render';
import { fileToAsset } from '../engine/images';
import { openDocumentFile, pickFile, resetFileHandle, saveDocumentFile } from '../persistence/files';
import { DocumentError, MAX_PAGES, parseDocument, serializeDocument, SHAPE_KINDS } from '../model/schema';
import { layoutText } from '../engine/text';
import { geometryFor, SHAPE_LABELS } from '../engine/shapes';
import { loadIconSet } from '../icons/sets';
import { fitToContents, isContainer, moveElements, removeContainer, updateMembership, withMembers, wrapInContainer } from './containers';
import { importFiles, slugName, useLibraries } from '../icons/libraries';
import { addConnectedCopy, canQuickConnect, type Side } from './quickConnect';
import { cycleKeyHeld } from '../ui/modifiers';
import * as pages from './pages';
import { looksLikeMermaid, parseMermaid } from '../import/mermaid';
import { buildMermaid } from '../import/mermaidBuild';
import { isSequence, parseSequence } from '../import/mermaidSequence';
import { buildSequence } from '../import/sequenceBuild';
import { autoLayout as layoutDoc } from '../layout/autoLayout';
import type { LayoutDir } from '../layout/layered';
import { colorLabel } from '../ui/colorNames';
import { svgToIcon } from '../icons/svgToIcon';

const D = () => useDoc.getState();
const U = () => useUI.getState();

// ---- stage geometry (set by the canvas component) ---------------------------
export const stage = { w: 1200, h: 800 };
/** Width of the Icons panel docked on the left (CSS uses the same value). */
export const ICON_PANEL_WIDTH = 290;

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
  const doc = D().doc;
  const locked = doc.elements.filter((e) => selected().has(e.id) && e.locked).map((e) => e.id);
  // deleting a container deletes what is inside it too (Remove container keeps the contents)
  const ids = new Set(withMembers(doc, [...selected()].filter((id) => !locked.includes(id))));
  if (!ids.size) return;
  D().commit((d) => deleteElements(d, ids));
  U().select(locked);
}

// ---- clipboard -----------------------------------------------------------------
const CLIP_MIME = 'flowsketch/elements';
let internalClip: string | null = null;
// true once internalClip also reached the system clipboard; then any different system text was copied later
let internalClipShared = false;

/** Copies with fresh ids/seeds, their own groups (never the originals'), unlocked, internal connections remapped. */
export function cloneElements(doc: FlowDocument, els: DiagramElement[], dx: number, dy: number): DiagramElement[] {
  const idMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  for (const e of els) idMap.set(e.id, uid());
  return els.map((e) => {
    const n = structuredClone(e) as DiagramElement;
    n.id = idMap.get(e.id)!;
    n.seed = newSeed();
    n.groupIds = n.groupIds.map((g) => { if (!groupMap.has(g)) groupMap.set(g, uid('grp')); return groupMap.get(g)!; });
    n.locked = false;
    if (n.type === 'container') n.members = n.members.flatMap((m) => (idMap.has(m) ? [idMap.get(m)!] : [])); // only members copied along
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
  const ids = new Set(withMembers(doc, selected())); // a container is copied with its contents
  const els = doc.elements.filter((e) => ids.has(e.id));
  if (!els.length) return false;
  const assets = Object.fromEntries(els.filter((e) => e.type === 'image').map((e) => [(e as { assetId: string }).assetId, doc.assets[(e as { assetId: string }).assetId]]));
  const icons = Object.fromEntries(els.flatMap((e) => (e.type === 'icon' && doc.icons[e.iconId] ? [[e.iconId, doc.icons[e.iconId]]] : [])));
  internalClip = JSON.stringify({ type: CLIP_MIME, elements: els, assets, icons });
  internalClipShared = false;
  navigator.clipboard?.writeText(internalClip).then(() => { internalClipShared = true; }, () => undefined);
  return true;
}

export function cutSelection() { if (copySelection()) deleteSelection(); }

export async function paste(text?: string) {
  let raw = text ?? internalClip;
  if (!text) {
    try { const t = await navigator.clipboard?.readText(); if (t && t.includes(CLIP_MIME)) raw = t; else if (t && (!internalClip || internalClipShared)) return pastePlainText(t); } catch { /* permission denied: use internal */ }
  }
  if (!raw) return;
  let data: { type?: string; elements?: unknown[]; assets?: Record<string, unknown>; icons?: Record<string, unknown> };
  try { data = JSON.parse(raw); } catch { return pastePlainText(raw); }
  if (data.type !== CLIP_MIME || !Array.isArray(data.elements)) return pastePlainText(raw);
  // run through the same sanitiser as files
  const { doc: parsed } = parseDocument({ format: 'flowsketch', schemaVersion: SCHEMA_VERSION, elements: data.elements, assets: data.assets ?? {}, icons: data.icons ?? {} });
  const doc = D().doc;
  const clones = cloneElements(doc, parsed.elements, 24, 24);
  const top = topLevel(clones);
  D().commit((d) => updateMembership({ ...d, assets: { ...d.assets, ...parsed.assets }, icons: { ...parsed.icons, ...d.icons }, elements: [...d.elements, ...clones] }, top));
  U().setTool('select');
  U().select(top);
}

function pastePlainText(t: string) {
  if (looksLikeMermaid(t) && importMermaid(t)) return; // flowchart text becomes a diagram
  const c = screenToWorld(stage.w / 2, stage.h / 2);
  const ts = U().toolStyle('text');
  const lay = layoutText(t.slice(0, 2000), ts.textStyle, null);
  const el: DiagramElement = { id: uid(), type: 'text', x: c.x - lay.width / 2, y: c.y, w: lay.width + 8, h: lay.height + 4, rotation: 0, locked: false, groupIds: [], seed: newSeed(), style: { ...ts.style }, text: t.slice(0, 2000), textStyle: { ...ts.textStyle, padding: 2 } };
  D().commit((d) => ({ ...d, elements: [...d.elements, el] }));
  U().select([el.id]);
}

export function duplicateSelection() {
  const doc = D().doc;
  const ids = new Set(withMembers(doc, selected()));
  const els = doc.elements.filter((e) => ids.has(e.id));
  if (!els.length) return;
  const clones = cloneElements(doc, els, 20, 20);
  const top = topLevel(clones);
  D().commit((d) => updateMembership({ ...d, elements: [...d.elements, ...clones] }, top));
  U().select(top);
}

/** The elements of a set that are not inside a container of the same set (what to select after a paste). */
function topLevel(els: DiagramElement[]): string[] {
  const inside = new Set(els.flatMap((e) => (e.type === 'container' ? e.members : [])));
  return els.filter((e) => !inside.has(e.id)).map((e) => e.id);
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
    if (e.locked) return e;
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
  return e.type === 'icon' ? 'icon' : e.type === 'container' ? 'container' : e.type === 'shape' ? styleKey('shape', e.shape) : e.type === 'connector' ? (e.endHead === 'none' && e.startHead === 'none' ? 'line' : 'arrow') : e.type === 'freehand' ? (e.highlighter ? 'highlighter' : 'freehand') : e.type === 'text' ? 'text' : null;
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
  U().toast(`Saved as the default style for new ${toolName(key)} drawings`, 'success');
}

/** "shape:roundRect" → "rounded rectangle", "arrow" → "arrow" */
export const toolName = (key: string) => (key.startsWith('shape:') ? (SHAPE_LABELS[key.slice(6) as ShapeKind] ?? key.slice(6)).toLowerCase() : key);

/** Forget a tool's remembered style, so new drawings use the original style again. */
export function resetToolStyle(key: string) {
  const { [key]: _gone, ...rest } = U().prefs.toolStyles;
  U().updatePrefs({ toolStyles: rest });
  U().toast(`New ${toolName(key)} drawings use the original style again`, 'success');
}

/** Reset the default style of the tool that draws the selected object. */
export function resetSelectionToolStyle() {
  const e = getElement(D().doc, U().selection[0]);
  const key = e && toolKeyFor(e);
  if (key) resetToolStyle(key);
}

/** Forget every tool's remembered style (objects already drawn don't change). */
export async function resetAllToolStyles() {
  if (!(await U().ask('Reset the default style of every tool to the original? Objects you already drew keep their style.', 'Reset all'))) return;
  U().updatePrefs({ toolStyles: {}, sharedStyle: null });
  U().toast('All tools use their original styles again', 'success');
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
  const target = (b: BoxElement) => {
    switch (kind) {
      case 'left': return { x: x0, y: b.y };
      case 'right': return { x: x1 - b.w, y: b.y };
      case 'hcenter': return { x: (x0 + x1) / 2 - b.w / 2, y: b.y };
      case 'top': return { x: b.x, y: y0 };
      case 'bottom': return { x: b.x, y: y1 - b.h };
      case 'vcenter': return { x: b.x, y: (y0 + y1) / 2 - b.h / 2 };
    }
  };
  D().commit((d) => moveBoxes(d, els.map((b) => { const t = target(b); return [b.id, t.x - b.x, t.y - b.y] as const; })));
}

export type MatchSizeMode = 'width' | 'height' | 'both';

/** Elements Match size resizes: shapes, icons, pictures and pen drawings (not text, arrows, containers or locked items). */
const canMatchSize = (e: DiagramElement): e is BoxElement =>
  !e.locked && (e.type === 'shape' || e.type === 'icon' || e.type === 'image' || e.type === 'freehand');

/**
 * Resize `ids` to the size of `refId`, each keeping its centre. Width or height changes only that side, unless
 * `keepProportions` (the other side then scales with it); both sets width and height exactly.
 */
export function matchSizes(doc: FlowDocument, refId: string, ids: string[], mode: MatchSizeMode, keepProportions = false): FlowDocument {
  const ref = getElement(doc, refId);
  if (!ref || ref.type === 'connector') return doc;
  const targets = new Set(ids.filter((id) => id !== refId));
  const out = mapElements(doc, [...targets], (e) => {
    if (!canMatchSize(e) || e.w <= 0 || e.h <= 0) return e;
    const k = mode === 'width' ? ref.w / e.w : ref.h / e.h;
    const w = mode === 'both' || mode === 'width' ? ref.w : keepProportions ? e.w * k : e.w;
    const h = mode === 'both' || mode === 'height' ? ref.h : keepProportions ? e.h * k : e.h;
    return { ...e, x: e.x + e.w / 2 - w / 2, y: e.y + e.h / 2 - h / 2, w, h };
  });
  return updateMembership(out, [...targets]); // containers grow to fit bigger members
}

/** Match size: the selection takes the size of the first selected shape (the reference). One undo step. */
export function matchSize(mode: MatchSizeMode) {
  const doc = D().doc;
  const sel = U().selection.map((id) => getElement(doc, id)).filter((e): e is DiagramElement => !!e && e.type !== 'connector');
  const ref = sel[0];
  const rest = sel.slice(1).filter(canMatchSize);
  if (!ref || !rest.length) { U().toast('Select the shape to match first, then the shapes to resize'); return; }
  D().commit((d) => matchSizes(d, ref.id, rest.map((e) => e.id), mode, U().prefs.matchSizeKeepsProportions));
}

/**
 * Text to diagram: read a Mermaid flowchart and add it, laid out (in `dir`, else the text's own direction) and
 * centred in the view, as one undo step. Returns false if nothing could be read.
 */
export function importMermaid(text: string, dir?: LayoutDir): boolean {
  if (isSequence(text)) return importSequence(text);
  const g = parseMermaid(text.slice(0, 200_000));
  if (!g.nodes.length) { U().toast('No flowchart found in that text', 'error'); return false; }
  const u = U();
  const r = buildMermaid(D().doc, g, {
    shape: (k) => u.toolStyle(styleKey('shape', k)), arrow: u.toolStyle('arrow'), line: u.toolStyle('line'),
    container: u.toolStyle('container'), fit: fitShapeToText,
  }, dir ?? g.dir, screenToWorld(stage.w / 2, stage.h / 2));
  D().commit(() => r.doc);
  u.setTool('select');
  u.select(r.ids);
  // a diagram bigger than the view: zoom out (never in) so all of it shows
  const b = selectionBounds(D().doc, r.ids);
  if (b && (b.w * u.view.zoom > stage.w - 380 || b.h * u.view.zoom > stage.h - 160)) fitRect(b, 60, u.view.zoom);
  const what = `Added ${r.shapes} shape${r.shapes === 1 ? '' : 's'} and ${r.arrows} arrow${r.arrows === 1 ? '' : 's'}`;
  u.toast(g.warnings.length ? `${what}. Skipped: ${g.warnings.slice(0, 2).join('; ')}${g.warnings.length > 2 ? ' …' : ''}` : what);
  return true;
}

/** A Mermaid sequence diagram: participants with lifelines, messages, notes and block frames. One undo step. */
function importSequence(text: string): boolean {
  const g = parseSequence(text.slice(0, 200_000));
  if (!g.participants.length) { U().toast('No participants found in that sequence diagram', 'error'); return false; }
  const u = U();
  const r = buildSequence(D().doc, g, {
    shape: (k) => u.toolStyle(styleKey('shape', k)), arrow: u.toolStyle('arrow'), line: u.toolStyle('line'),
    container: u.toolStyle('container'), fit: fitShapeToText,
  }, screenToWorld(stage.w / 2, stage.h / 2));
  D().commit(() => r.doc);
  u.setTool('select');
  u.select(r.ids);
  const b = selectionBounds(D().doc, r.ids);
  if (b && (b.w * u.view.zoom > stage.w - 380 || b.h * u.view.zoom > stage.h - 160)) fitRect(b, 60, u.view.zoom);
  const what = `Added ${r.participants} participant${r.participants === 1 ? '' : 's'} and ${r.messages} message${r.messages === 1 ? '' : 's'}`;
  u.toast(g.warnings.length ? `${what}. Skipped: ${g.warnings.slice(0, 2).join('; ')}${g.warnings.length > 2 ? ' …' : ''}` : what);
  return true;
}

/** Auto-layout the selection (2+ items), or the whole diagram, in one direction. One undo step. */
export function autoLayout(dir: LayoutDir) {
  const doc = D().doc;
  const sel = U().selection.filter((id) => getElement(doc, id)?.type !== 'connector');
  const ids = sel.length >= 2 ? withMembers(doc, sel) : undefined;
  const next = layoutDoc(doc, dir, ids);
  if (next === doc) { U().toast('Nothing to lay out: add some shapes first'); return; }
  D().commit(() => next);
}

/** Move boxes by their own offsets; a container brings its contents. Then re-check container membership. */
function moveBoxes(doc: FlowDocument, moves: (readonly [string, number, number])[]): FlowDocument {
  let out = doc;
  for (const [id, dx, dy] of moves) out = moveElements(out, new Set(withMembers(out, [id])), dx, dy);
  return updateMembership(out, moves.map((m) => m[0]));
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
  D().commit((d) => moveBoxes(d, els.map((e) => [e.id, axis === 'h' ? pos.get(e.id)! - e.x : 0, axis === 'v' ? pos.get(e.id)! - e.y : 0] as const)));
}

export function flip(axis: 'h' | 'v') {
  D().commit((d) => mapElements(d, selected(), (e) => {
    if (e.locked) return e;
    if (e.type === 'shape') return axis === 'h' ? { ...e, flipX: !e.flipX } : { ...e, flipY: !e.flipY };
    if (e.type === 'freehand') return { ...e, points: e.points.map(([x, y]) => (axis === 'h' ? [1 - x, y] : [x, 1 - y]) as [number, number]) };
    return e;
  }));
}

export function nudge(dx: number, dy: number) {
  const top = [...selected()];
  if (!top.length) return;
  D().commit((d) => updateMembership(moveElements(d, new Set(withMembers(d, top)), dx, dy), top), 'nudge');
}

// ---- containers ----------------------------------------------------------------------
/** Wrap the selection in a container and start editing its title. */
export function addContainer() {
  const doc = D().doc;
  const ids = U().selection.filter((id) => !getElement(doc, id)?.locked);
  if (!ids.length) { U().toast('Select the shapes to put in a container first'); return; }
  // Cmd (Ctrl on Windows/Linux) held while choosing Add container: the next fill colour, remembered
  const ts = cycleKeyHeld() ? cycleFill(U().toolStyle('container')) : U().toolStyle('container');
  const r = wrapInContainer(doc, ids, ts);
  if (!r) return;
  if (cycleKeyHeld()) { U().setToolStyle('container', ts); U().toast(`Fill: ${colorLabel(ts.style.fill)}`); }
  D().commit(() => r.doc);
  U().setTool('select');
  U().select([r.id]);
  U().setEditing(r.id); // type the title straight away
}

/**
 * Quick-connect from the selected shape: add a connected copy of it on `side` (Cmd/Ctrl+Arrow, or a click on a
 * quick-connect handle) and select the copy, so typing (Enter) labels it. One undo step.
 */
export function quickConnect(side: Side, srcId?: string, kind?: ShapeKind) {
  const u = U();
  const id = srcId ?? (u.selection.length === 1 ? u.selection[0] : undefined);
  const doc = D().doc;
  if (!id || !canQuickConnect(getElement(doc, id))) return;
  const make = kind ? { kind, tool: u.toolStyle(styleKey('shape', kind)) } : null;
  const r = addConnectedCopy(doc, id, u.toolStyle('arrow'), { side, make });
  if (kind) u.updatePrefs({ recentQuickShapes: [kind, ...u.prefs.recentQuickShapes.filter((k) => k !== kind && SHAPE_KINDS.includes(k))].slice(0, 4) });
  if (!r) return;
  D().commit(() => r.doc);
  u.setTool('select');
  u.select([r.id]);
  revealElement(r.id);
}

/** Pan (without zooming) just enough to bring an element on screen. */
export function revealElement(id: string) {
  const el = getElement(D().doc, id);
  if (!el || el.type === 'connector') return;
  const v = U().view, m = 40 / v.zoom;
  const vw = stage.w / v.zoom, vh = stage.h / v.zoom;
  let x = v.x, y = v.y;
  if (el.x - m < x) x = el.x - m; else if (el.x + el.w + m > x + vw) x = el.x + el.w + m - vw;
  if (el.y - m < y) y = el.y - m; else if (el.y + el.h + m > y + vh) y = el.y + el.h + m - vh;
  if (x !== v.x || y !== v.y) U().setView({ x, y });
}

/** Remove the selected containers, keeping what was inside them. */
export function removeSelectedContainers() {
  const cs = U().selection.filter((id) => isContainer(getElement(D().doc, id)));
  if (!cs.length) return;
  const members = cs.flatMap((id) => (getElement(D().doc, id) as ContainerElement).members);
  D().commit((d) => cs.reduce((acc, id) => removeContainer(acc, id), d));
  U().select(members);
}

/** Resize the selected containers to fit their contents exactly. */
export function fitSelectedContainers() {
  const cs = U().selection.filter((id) => isContainer(getElement(D().doc, id)));
  if (cs.length) D().commit((d) => cs.reduce((acc, id) => fitToContents(acc, id), d));
}

// ---- connectors -------------------------------------------------------------------
/** Reverse arrows: start and end trade places (heads stay at the ends, so each arrow now points the other way). */
export function swapDirection(ids: string[] = U().selection) {
  D().commit((d) => mapElements(d, ids, (e) => (e.type !== 'connector' || e.locked ? e : {
    // same route and label spot, travelled the other way; `|| 0` keeps a flipped 0 from becoming -0
    ...e, start: e.end, end: e.start, bends: [...e.bends].reverse(),
    curvature: -e.curvature || 0, labelPos: 1 - e.labelPos, labelOffset: -e.labelOffset || 0,
  })));
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
    placeImageAsset(await fileToAsset(f), at);
  } catch (e) { U().toast((e as Error).message || 'Could not insert the image.', 'error'); }
}

/** Add a raster picture to the document as an image element, at `at` or in the middle of the view. */
function placeImageAsset(asset: Asset, at?: { x: number; y: number }, maxSize = 480) {
  const scale = Math.min(1, maxSize / Math.max(asset.width, asset.height));
  const w = asset.width * scale, h = asset.height * scale;
  const c = at ?? screenToWorld(stage.w / 2, stage.h / 2);
  const ts = U().toolStyle('image');
  const el: DiagramElement = { id: uid(), type: 'image', assetId: asset.id, x: c.x - w / 2, y: c.y - h / 2, w, h, rotation: 0, locked: false, groupIds: [], seed: newSeed(), style: { ...ts.style }, text: '', textStyle: { ...ts.textStyle }, anim: { mode: 'float' } };
  D().commit((d) => ({ ...d, assets: { ...d.assets, [asset.id]: asset }, elements: [...d.elements, el] }));
  U().setTool('select');
  U().select([el.id]);
}

/** Open the right-click menu from the keyboard: at the selection, or in the middle of the canvas. */
export function openContextMenuAtSelection() {
  const r = document.querySelector('[data-testid=stage]')?.getBoundingClientRect();
  if (!r) return;
  const b = selectionBounds(D().doc, U().selection);
  const v = U().view;
  const x = b ? (b.x + b.w / 2 - v.x) * v.zoom : stage.w / 2, y = b ? (b.y + b.h / 2 - v.y) * v.zoom : stage.h / 2;
  U().setContextMenu({ x: r.left + Math.max(0, Math.min(stage.w, x)), y: r.top + Math.max(0, Math.min(stage.h, y)) });
}

export const toggleIconPanel = () => U().updatePrefs({ showIconPanel: !U().prefs.showIconPanel });

/** Size of a newly placed icon (world units). */
export const ICON_SIZE = 56;

/** Place an icon from a set or library: at `at` (a drop point) or in the middle of the visible canvas. */
export async function insertIcon(setId: string, name: string, at?: { x: number; y: number }) {
  try {
    const set = await loadIconSet(setId);
    // keep clear of the Icons panel on the left when placing in the middle
    const c = at ?? screenToWorld((stage.w + (U().prefs.showIconPanel ? ICON_PANEL_WIDTH : 0)) / 2, stage.h / 2);
    const picture = set.picture?.(name);
    if (picture) {
      // pictures in your libraries become images; a fresh asset id keeps documents independent of the library
      placeImageAsset({ ...picture, id: uid('asset') }, c, 160);
    } else {
      const icon = set.icon(name);
      if (!icon) { U().toast(`The icon “${name}” could not be loaded.`, 'error'); return; }
      placeIcon(icon, c);
    }
    U().pushRecentIcon(`${setId}:${name}`);
  } catch (e) { U().toast((e as Error).message || 'Could not load the icon.', 'error'); }
}

/** SVG files dropped on the canvas become icons in this diagram (converted to plain shapes; not added to a library). */
export async function dropSvgIcons(files: File[], at: { x: number; y: number }) {
  const failed: string[] = [];
  let placed = 0;
  for (const f of files) {
    try {
      const name = slugName(f.name);
      placeIcon(svgToIcon(await f.text(), { id: `file:${name}-${uid('')}`, name, set: 'Imported SVG', license: '' }), { x: at.x + placed * (ICON_SIZE + 24), y: at.y });
      placed++;
    } catch (e) { failed.push(`${f.name}: ${(e as Error).message}`); }
  }
  if (failed.length) U().toast(failed.length === 1 ? failed[0] : `${failed.length} SVG files could not be used as icons.`, 'error');
}

/** A .flowsketchlib (or other icon files) dropped on the canvas: add as a new library and show it. */
export async function importIconLibraryFiles(files: File[]) {
  const r = await importFiles(files);
  if (!r.items.length) { U().toast(r.skipped[0] ? `No icons added: ${r.skipped[0]}` : 'No icons found in those files.', 'error'); return; }
  const lib = await useLibraries.getState().add(r.items, { name: r.libraryName ?? 'My icons', vendor: r.vendor });
  U().updatePrefs({ showIconPanel: true });
  U().toast(`Added ${r.items.length.toLocaleString()} icons to the library “${lib.name}”.`, 'success');
}

/** Add an icon (already converted and validated) to the document, centred on `c`. */
export function placeIcon(icon: IconAsset, c: { x: number; y: number }) {
  const el = makeIcon(icon.id, c.x - ICON_SIZE / 2, c.y - ICON_SIZE / 2, ICON_SIZE, U().toolStyle('icon'));
  D().commit((d) => updateMembership({ ...d, icons: { ...d.icons, [icon.id]: d.icons[icon.id] ?? icon }, elements: [...d.elements, el] }, [el.id]));
  U().setTool('select');
  U().select([el.id]);
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
    if (e.locked) return e;
    if (e.type === 'connector') return conn ? { ...e, anim: { ...e.anim, ...conn } } : e;
    return shape ? { ...e, anim: { ...e.anim, ...shape } } : e;
  }));
}

export function resetAnimSelected() {
  D().commit((d) => mapElements(d, U().selection, (e) => { if (e.locked || !('anim' in e) || !e.anim) return e; const { anim: _a, ...rest } = e; return rest as DiagramElement; }));
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

// ---- pages (tabs) ----------------------------------------------------------------------------------------------

/** Each page remembers where you were looking (this session only). */
const pageViews = new Map<string, { x: number; y: number; zoom: number }>();

/** Run a page change: remember this page's view, apply `change` (undoable or not), restore or fit the new page's view. */
function changePage(change: (d: FlowDocument) => FlowDocument, undoable: boolean) {
  const u = U();
  const before = D().doc;
  pageViews.set(before.activePage, { ...u.view });
  if (undoable) D().commit(change); else D().replace(change);
  const after = D().doc;
  if (after.activePage === before.activePage) return;
  u.setEditing(null);
  u.select([]);
  const v = pageViews.get(after.activePage);
  if (v) u.setView(v);
  else if (after.elements.length) zoomToFit();
  else u.setView({ x: -stage.w / 2 + 300, y: -stage.h / 2 + 200, zoom: 1 });
}

export const goToPage = (id: string) => changePage((d) => pages.switchPage(d, id), false);
export const nextPage = (by: 1 | -1) => {
  const d = D().doc, i = d.pages.findIndex((p) => p.id === d.activePage);
  const p = d.pages[(i + by + d.pages.length) % d.pages.length];
  if (p) goToPage(p.id);
};
export function newPage() {
  if (D().doc.pages.length >= MAX_PAGES) { U().toast(`A document can have up to ${MAX_PAGES} pages`); return; }
  changePage((d) => pages.addPage(d), true);
}
export function duplicatePage(id = D().doc.activePage) {
  if (D().doc.pages.length >= MAX_PAGES) { U().toast(`A document can have up to ${MAX_PAGES} pages`); return; }
  changePage((d) => pages.duplicatePage(d, id, (els) => cloneElements(d, els, 0, 0)), true);
}
export async function deletePage(id = D().doc.activePage) {
  const d = D().doc;
  const p = pages.allPages(d).find((x) => x.id === id);
  if (!p || d.pages.length <= 1) return;
  if (p.elements.length && !(await U().ask(`Delete the page "${p.name}" and everything on it?`, 'Delete page'))) return;
  changePage((doc) => pages.deletePage(doc, id), true);
}
export const renamePage = (id: string, name: string) => D().commit((d) => pages.renamePage(d, id, name));
export const movePage = (id: string, by: -1 | 1) => D().commit((d) => pages.movePage(d, id, by));
