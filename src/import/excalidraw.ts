// Excalidraw import (.excalidraw JSON) → a FlowSketch document. Untrusted input: only used after passing through
// parseDocument (see formats.ts); text is plain text, only raster pictures are kept. Excalidraw is hand-drawn like
// FlowSketch, so its sketchiness, fill patterns and fonts carry over.
import type { ConnectorElement, ContainerElement, DiagramElement, Endpoint, FillStyle, FontFamily, HeadKind, Point, ShapeKind, Style, TextStyle } from '../model/types';
import { baseFields, defaultToolStyle, makeConnector, makeShape, makeText, newDocument, uid } from '../model/defaults';
import type { ImportResult } from './drawio';

type X = Record<string, unknown>;
const isObj = (v: unknown): v is X => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const LIMIT = 20_000;

/** True when the text looks like an Excalidraw file (or clipboard). */
export function looksLikeExcalidraw(text: string): boolean {
  return /^\s*\{/.test(text) && /"type"\s*:\s*"excalidraw(\/clipboard)?"/.test(text.slice(0, 5000));
}

const color = (v: unknown, fallback: string) => {
  const s = str(v);
  if (s === 'transparent') return 'transparent';
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s) ? s.toLowerCase() : fallback;
};

function styleOf(e: X, base: Style): Style {
  const fill = color(e.backgroundColor, 'transparent');
  const fs = str(e.fillStyle);
  return {
    ...base,
    stroke: color(e.strokeColor, base.stroke),
    fill,
    fillStyle: (fill === 'transparent' ? 'none' : fs === 'solid' ? 'solid' : fs === 'cross-hatch' ? 'cross-hatch' : 'hachure') as FillStyle,
    strokeWidth: Math.min(20, Math.max(0.5, num(e.strokeWidth, 2))),
    strokeStyle: e.strokeStyle === 'dashed' ? 'dashed' : e.strokeStyle === 'dotted' ? 'dotted' : 'solid',
    opacity: Math.min(1, Math.max(0, num(e.opacity, 100) / 100)),
    roughness: [0, 1, 2][Math.min(2, Math.max(0, Math.round(num(e.roughness, 1))))],
    cornerRadius: isObj(e.roundness) ? Math.max(base.cornerRadius, 12) : 0,
  };
}

const family = (f: unknown): FontFamily => (f === 2 || f === 6 || f === 7 ? 'sans' : f === 3 || f === 8 ? 'mono' : 'hand');

function textStyleOf(t: X, base: TextStyle): TextStyle {
  return {
    ...base,
    fontFamily: family(t.fontFamily),
    fontSize: Math.min(200, Math.max(6, num(t.fontSize, 20))),
    color: color(t.strokeColor, base.color),
    align: t.textAlign === 'left' ? 'left' : t.textAlign === 'right' ? 'right' : 'center',
    vAlign: t.verticalAlign === 'top' ? 'top' : t.verticalAlign === 'bottom' ? 'bottom' : 'middle',
  };
}

function head(v: unknown): HeadKind {
  if (v === null || v === undefined || v === 'none') return 'none';
  if (v === 'triangle' || v === 'triangle_outline') return 'triangle';
  if (v === 'dot' || v === 'circle' || v === 'circle_outline') return 'dot';
  if (v === 'bar') return 'bar';
  return 'arrow';
}

const textOf = (t: X) => str(t.originalText, str(t.text)).replace(/\r\n?/g, '\n').slice(0, 5000);

/** An Excalidraw file → a FlowSketch document. Throws if it isn't one. */
export function importExcalidraw(text: string, title = 'Imported from Excalidraw'): ImportResult {
  const warnings: string[] = [];
  const warn = (m: string) => { if (!warnings.includes(m)) warnings.push(m); };
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('That Excalidraw file could not be read.'); }
  if (!isObj(data) || !Array.isArray(data.elements)) throw new Error('That is not an Excalidraw file.');
  const doc = newDocument(title);
  const files = isObj(data.files) ? data.files : {};
  const all = data.elements.filter(isObj).filter((e) => !e.isDeleted).slice(0, LIMIT);
  if (data.elements.length > LIMIT) warn(`Only the first ${LIMIT} items were read.`);
  const idOf = new Map<string, string>();
  const out: DiagramElement[] = [];
  const frames = new Map<string, ContainerElement>();
  const rot = (e: X) => (num(e.angle, 0) * 180) / Math.PI;
  const groups = (e: X) => (Array.isArray(e.groupIds) ? e.groupIds.filter((g): g is string => typeof g === 'string').slice(0, 20).reverse() : []); // outermost last, as FlowSketch expects
  // boxes first, so arrows can attach to them
  for (const e of all) {
    const type = str(e.type), x = num(e.x, 0), y = num(e.y, 0), w = Math.max(1, Math.abs(num(e.width, 1))), h = Math.max(1, Math.abs(num(e.height, 1)));
    if (type === 'rectangle' || type === 'ellipse' || type === 'diamond') {
      const kind: ShapeKind = type === 'ellipse' ? 'ellipse' : type === 'diamond' ? 'diamond' : isObj(e.roundness) ? 'roundRect' : 'rectangle';
      const t = defaultToolStyle(`shape:${kind}`);
      const s = makeShape(kind, x, y, w, h, t);
      s.style = styleOf(e, t.style); s.rotation = rot(e); s.groupIds = groups(e);
      s.textStyle = { ...t.textStyle, fontFamily: 'hand' };
      idOf.set(str(e.id), s.id); out.push(s);
    } else if (type === 'frame' || type === 'magicframe') {
      const t = defaultToolStyle('container');
      const c: ContainerElement = { ...baseFields(t), type: 'container', x, y, w, h, text: str(e.name, 'Frame').slice(0, 200), members: [], anim: { mode: 'off' }, style: { ...t.style }, textStyle: { ...t.textStyle } };
      frames.set(str(e.id), c); idOf.set(str(e.id), c.id); out.push(c);
    } else if (type === 'image') {
      const f = files[str(e.fileId)];
      const url = isObj(f) ? str(f.dataURL) : '';
      const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,/.exec(url);
      if (!m) { warn('Skipped a picture that is missing or not a PNG, JPEG, GIF or WebP.'); continue; }
      const assetId = uid('asset');
      doc.assets[assetId] = { id: assetId, mime: m[1] as 'image/png', dataUrl: url, width: w, height: h };
      const img: DiagramElement = { ...baseFields(defaultToolStyle('image')), type: 'image', assetId, x, y, w, h, rotation: rot(e), groupIds: groups(e) };
      idOf.set(str(e.id), img.id); out.push(img);
    } else if (type === 'freedraw') {
      const pts = (Array.isArray(e.points) ? e.points : []).filter((p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).slice(0, 5000);
      if (pts.length < 2) continue;
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), bw = Math.max(1, Math.max(...xs) - x0), bh = Math.max(1, Math.max(...ys) - y0);
      const t = defaultToolStyle('pen');
      const fh: DiagramElement = {
        ...baseFields(t), type: 'freehand', x: x + x0, y: y + y0, w: bw, h: bh, highlighter: false,
        points: pts.map(([px, py]) => [(px - x0) / bw, (py - y0) / bh] as [number, number]),
        style: { ...styleOf(e, t.style), fill: 'transparent', fillStyle: 'none' }, rotation: rot(e), groupIds: groups(e),
      };
      idOf.set(str(e.id), fh.id); out.push(fh);
    }
  }
  // arrows and lines
  for (const e of all) {
    const type = str(e.type);
    if (type !== 'arrow' && type !== 'line') continue;
    const x = num(e.x, 0), y = num(e.y, 0);
    const pts = (Array.isArray(e.points) ? e.points : []).filter((p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).slice(0, 500).map(([px, py]) => ({ x: x + px, y: y + py }));
    if (pts.length < 2) continue;
    const end = (b: unknown, p: Point): Endpoint => {
      const target = isObj(b) ? idOf.get(str(b.elementId)) : undefined;
      return target ? { x: 0, y: 0, elementId: target, anchor: null } : { x: p.x, y: p.y, elementId: null, anchor: null };
    };
    const t = defaultToolStyle(type === 'arrow' ? 'arrow' : 'line');
    const routing = e.elbowed === true ? 'elbow' : pts.length > 2 && isObj(e.roundness) ? 'curved' : 'straight';
    const c: ConnectorElement = makeConnector(end(e.startBinding, pts[0]), end(e.endBinding, pts[pts.length - 1]), { ...t, routing, curvature: 0, elbowRadius: 0 });
    c.bends = pts.slice(1, -1);
    c.style = { ...styleOf(e, t.style), fill: 'transparent', fillStyle: 'none' };
    c.startHead = head(e.startArrowhead);
    c.endHead = type === 'line' && e.endArrowhead === undefined ? 'none' : head(e.endArrowhead);
    c.groupIds = groups(e);
    idOf.set(str(e.id), c.id); out.push(c);
  }
  // text: on its own, or the label of the shape or arrow it belongs to
  for (const e of all) {
    if (str(e.type) !== 'text') continue;
    const owner = e.containerId ? out.find((o) => o.id === idOf.get(str(e.containerId))) : undefined;
    if (owner) {
      owner.text = owner.text ? `${owner.text}\n${textOf(e)}` : textOf(e);
      owner.textStyle = { ...textStyleOf(e, owner.textStyle), padding: owner.textStyle.padding };
      continue;
    }
    const t = defaultToolStyle('text');
    const el = makeText(num(e.x, 0), num(e.y, 0), textOf(e), t);
    Object.assign(el, { w: Math.max(4, num(e.width, 40)), h: Math.max(4, num(e.height, 24)), rotation: rot(e), groupIds: groups(e), textStyle: { ...textStyleOf(e, t.textStyle), padding: 2 }, style: { ...el.style, opacity: Math.min(1, Math.max(0, num(e.opacity, 100) / 100)) } });
    idOf.set(str(e.id), el.id); out.push(el);
  }
  // frames hold the items that name them; frames sit behind their contents
  for (const e of all) {
    const f = frames.get(str(e.frameId)), id = idOf.get(str(e.id));
    if (f && id && id !== f.id && !f.members.includes(id)) f.members.push(id);
  }
  const ordered = [...out.filter((o) => o.type === 'container'), ...out.filter((o) => o.type !== 'container')];
  const app = isObj(data.appState) ? data.appState : {};
  const bg = color(app.viewBackgroundColor, '');
  if (bg && bg !== 'transparent') doc.canvas = { ...doc.canvas, background: bg };
  doc.elements = ordered;
  return { doc, warnings };
}
