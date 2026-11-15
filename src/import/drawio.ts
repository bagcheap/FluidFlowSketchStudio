// draw.io / diagrams.net import (.drawio, .xml): mxGraph XML → a FlowSketch document. Untrusted input: the result is
// only ever used after passing through parseDocument (see formats.ts), text is plain text, and only raster images
// embedded as data: URLs are kept. Covers the common cases: boxes of the usual shapes, text, containers (swimlanes and
// container=1), groups, arrows with waypoints, labels, colours, dashes and arrowheads, and several pages.
import { inflateSync } from 'fflate';
import type { ConnectorElement, ContainerElement, DiagramElement, Endpoint, FlowDocument, HeadKind, Page, Point, ShapeElement, ShapeKind, Style, TextStyle } from '../model/types';
import { baseFields, defaultToolStyle, makeConnector, makeShape, makeText, newDocument, uid } from '../model/defaults';

export interface ImportResult { doc: FlowDocument; warnings: string[] }

const LIMIT_CELLS = 20_000;

/** True when the text looks like a draw.io file. */
export const looksLikeDrawio = (text: string) => /^\s*(<\?xml[^>]*>\s*)?<(mxfile|mxGraphModel)\b/.test(text.slice(0, 2000));

/** draw.io's compressed diagram: base64 → raw deflate → URI-encoded XML. */
function inflateDiagram(data: string): string {
  const bin = atob(data.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const xml = new TextDecoder().decode(inflateSync(bytes));
  try { return decodeURIComponent(xml); } catch { return xml; }
}

/** "rounded=1;fillColor=#fff;ellipse" → { rounded: '1', fillColor: '#fff', ellipse: '' } (keys as written). */
export function parseStyle(s: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (s ?? '').split(';')) {
    if (!part) continue;
    const i = part.indexOf('=');
    if (i < 0) out[part.trim()] = '';
    else out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** A label that may be HTML (html=1): line breaks kept, tags dropped, entities decoded. Never rendered as HTML. */
export function htmlToText(s: string): string {
  return s
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 5000);
}

const color = (v: string | undefined, fallback: string): string => {
  if (v === undefined || v === '' || v === 'default') return fallback;
  if (v === 'none') return 'transparent';
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) ? v.toLowerCase() : fallback;
};
const num = (v: string | null | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/** Which FlowSketch shape a draw.io vertex style is closest to. */
function shapeOf(st: Record<string, string>): ShapeKind {
  const name = (st.shape ?? '').toLowerCase();
  const bare = (k: string) => st[k] === ''; // a style that starts with a shape name: "ellipse;whiteSpace=wrap;…"
  if (name === 'cloud' || bare('cloud')) return 'cloud';
  if (name === 'ellipse' || bare('ellipse') || bare('doubleEllipse')) return 'ellipse';
  if (name === 'rhombus' || bare('rhombus')) return 'diamond';
  if (name.startsWith('cylinder') || name === 'datastore') return 'cylinder';
  if (name === 'hexagon' || bare('hexagon')) return 'hexagon';
  if (name === 'parallelogram') return 'parallelogram';
  if (name === 'trapezoid') return 'trapezoid';
  if (name === 'triangle' || bare('triangle')) return 'triangle';
  if (name === 'document') return 'document';
  if (name === 'note' || name === 'card') return 'sticky';
  if (name === 'callout') return 'speech';
  if (name === 'star') return 'star';
  if (st.rounded === '1') return num(st.arcSize, 0) >= 45 ? 'pill' : 'roundRect';
  return 'rectangle';
}

function head(v: string | undefined, fallback: HeadKind): HeadKind {
  if (v === undefined) return fallback;
  if (v === 'none' || v === '') return 'none';
  if (v === 'oval' || v === 'dot') return 'dot';
  if (v === 'dash' || v === 'ERmandOne' || v === 'ERone') return 'bar';
  if (v === 'block' || v === 'blockThin') return 'triangle';
  return 'arrow';
}

function styleFrom(st: Record<string, string>, base: Style): Style {
  const fill = color(st.fillColor, st.fillColor === undefined ? base.fill : 'transparent');
  return {
    ...base,
    stroke: color(st.strokeColor, base.stroke),
    fill,
    fillStyle: fill === 'transparent' ? 'none' : st.fillStyle === 'hachure' ? 'hachure' : st.fillStyle === 'cross-hatch' ? 'cross-hatch' : 'solid',
    strokeWidth: Math.min(20, Math.max(0.5, num(st.strokeWidth, 1.5))),
    strokeStyle: st.dashed === '1' ? (st.dashPattern && /^1 /.test(st.dashPattern) ? 'dotted' : 'dashed') : 'solid',
    opacity: Math.min(1, Math.max(0, num(st.opacity, 100) / 100)),
    roughness: st.sketch === '1' ? 1.2 : 0.4,
    shadow: st.shadow === '1',
  };
}

function textFrom(st: Record<string, string>, base: TextStyle): TextStyle {
  const fs = num(st.fontStyle, 0);
  const fam = (st.fontFamily ?? '').toLowerCase();
  return {
    ...base,
    fontFamily: /mono|courier|consol/.test(fam) ? 'mono' : /serif|times|georgia/.test(fam) && !/sans/.test(fam) ? 'serif' : st.sketch === '1' || /architects|comic|xkcd/.test(fam) ? 'hand' : 'sans',
    fontSize: Math.min(200, Math.max(6, num(st.fontSize, 12) * 1.2)),
    bold: (fs & 1) === 1, italic: (fs & 2) === 2,
    color: color(st.fontColor, base.color),
    align: st.align === 'left' ? 'left' : st.align === 'right' ? 'right' : 'center',
    vAlign: st.verticalAlign === 'top' ? 'top' : st.verticalAlign === 'bottom' ? 'bottom' : 'middle',
  };
}

interface Cell { id: string; parent: string; value: string; style: Record<string, string>; vertex: boolean; edge: boolean; source?: string; target?: string; geo: Element | null; hidden: boolean }

function cellsOf(model: Element, warn: (m: string) => void): Cell[] {
  const out: Cell[] = [];
  const root = model.getElementsByTagName('root')[0];
  if (!root) return out;
  for (const node of Array.from(root.children).slice(0, LIMIT_CELLS)) {
    // <UserObject label=…> / <object label=…> wrap an mxCell and carry its id and label
    const wrapper = node.tagName === 'mxCell' ? null : node;
    const cell = wrapper ? wrapper.getElementsByTagName('mxCell')[0] : node;
    if (!cell) continue;
    const id = (wrapper ?? cell).getAttribute('id') ?? uid('c');
    out.push({
      id, parent: cell.getAttribute('parent') ?? '',
      value: wrapper ? wrapper.getAttribute('label') ?? '' : cell.getAttribute('value') ?? '',
      style: parseStyle(cell.getAttribute('style')),
      vertex: cell.getAttribute('vertex') === '1', edge: cell.getAttribute('edge') === '1',
      source: cell.getAttribute('source') ?? undefined, target: cell.getAttribute('target') ?? undefined,
      geo: Array.from(cell.children).find((c) => c.tagName === 'mxGeometry') ?? null,
      hidden: cell.getAttribute('visible') === '0',
    });
  }
  if (root.children.length > LIMIT_CELLS) warn(`Only the first ${LIMIT_CELLS} items of a page were read.`);
  return out;
}

/** One draw.io page (an mxGraphModel) → elements. */
function pageElements(model: Element, doc: FlowDocument, warn: (m: string) => void): DiagramElement[] {
  const cells = cellsOf(model, warn);
  const byId = new Map(cells.map((c) => [c.id, c]));
  const layerIds = new Set(cells.filter((c) => c.parent === (cells[0]?.id ?? '0') || !c.parent).map((c) => c.id));
  const hiddenLayer = new Set(cells.filter((c) => layerIds.has(c.id) && c.hidden).map((c) => c.id));
  // absolute top-left of a vertex: its geometry plus every vertex parent's
  const absCache = new Map<string, Point>();
  const abs = (id: string, depth = 0): Point => {
    const hit = absCache.get(id);
    if (hit) return hit;
    const c = byId.get(id);
    if (!c || !c.vertex || depth > 50) return { x: 0, y: 0 };
    const p = c.parent && byId.get(c.parent)?.vertex ? abs(c.parent, depth + 1) : { x: 0, y: 0 };
    const r = { x: p.x + num(c.geo?.getAttribute('x'), 0), y: p.y + num(c.geo?.getAttribute('y'), 0) };
    absCache.set(id, r);
    return r;
  };
  const isHidden = (c: Cell) => c.hidden || hiddenLayer.has(c.parent);
  const out: DiagramElement[] = [];
  const idOf = new Map<string, string>(); // draw.io id → element id
  const groupOf = new Map<string, string>(); // invisible group cell → group id
  const containers = new Map<string, ContainerElement>();
  const shapeTool = (k: ShapeKind) => defaultToolStyle(`shape:${k}`);
  // vertices first
  for (const c of cells) {
    if (!c.vertex || isHidden(c) || layerIds.has(c.id)) continue;
    const st = c.style, g = c.geo;
    if (!g || g.getAttribute('relative') === '1') continue; // edge labels: handled with their edge
    const p = abs(c.id), w = Math.max(1, num(g.getAttribute('width'), 80)), h = Math.max(1, num(g.getAttribute('height'), 40));
    const text = htmlToText(c.value);
    if ('group' in st && st.group === '') { groupOf.set(c.id, uid('g')); continue; } // an invisible group: its children share a group
    if ('swimlane' in st || st.container === '1' || 'table' in st) {
      const t = defaultToolStyle('container');
      const ct: ContainerElement = {
        ...baseFields(t), type: 'container', x: p.x, y: p.y, w, h, text, members: [], anim: { mode: 'off' },
        style: { ...styleFrom(st, t.style), fill: color(st.swimlaneFillColor ?? st.fillColor, 'transparent'), fillStyle: 'none' },
        textStyle: { ...textFrom(st, t.textStyle), align: 'left', vAlign: 'top' },
      };
      if (ct.style.fill !== 'transparent') ct.style.fillStyle = 'solid';
      containers.set(c.id, ct); idOf.set(c.id, ct.id); out.push(ct);
      continue;
    }
    if (st.shape === 'image' || 'image' in st && st.image) {
      const src = st.image ?? '';
      const m = /^data:(image\/(?:png|jpeg|gif|webp))[,;]/.exec(src.replace(/^data:image\/(png|jpeg|gif|webp),/, 'data:image/$1;base64,'));
      if (!m) { warn('Skipped a picture that is not an embedded PNG, JPEG, GIF or WebP.'); continue; }
      const assetId = uid('asset');
      const dataUrl = src.startsWith(`data:${m[1]};base64,`) ? src : src.replace(/^data:image\/(png|jpeg|gif|webp),/, 'data:image/$1;base64,');
      doc.assets[assetId] = { id: assetId, mime: m[1] as 'image/png', dataUrl, width: w, height: h };
      const t = defaultToolStyle('image');
      const img: DiagramElement = { ...baseFields(t), type: 'image', assetId, x: p.x, y: p.y, w, h, text };
      idOf.set(c.id, img.id); out.push(img);
      continue;
    }
    const plainText = 'text' in st || (st.strokeColor === 'none' && (st.fillColor === 'none' || st.fillColor === undefined) && !!text);
    if (plainText) {
      const t = defaultToolStyle('text');
      const el = makeText(p.x, p.y, text, t);
      Object.assign(el, { w, h, textStyle: { ...textFrom(st, t.textStyle), padding: 2 } });
      idOf.set(c.id, el.id); out.push(el);
      continue;
    }
    const kind = shapeOf(st);
    const t = shapeTool(kind);
    const el: ShapeElement = makeShape(kind, p.x, p.y, w, h, t);
    el.text = text; el.style = styleFrom(st, t.style); el.textStyle = textFrom(st, t.textStyle);
    el.rotation = num(st.rotation, 0);
    if (st.flipH === '1') el.flipX = true;
    if (st.flipV === '1') el.flipY = true;
    idOf.set(c.id, el.id); out.push(el);
  }
  // group and container membership
  for (const c of cells) {
    const el = out.find((e) => e.id === idOf.get(c.id));
    if (!el) continue;
    let p = c.parent;
    for (let guard = 0; p && guard < 50; guard++, p = byId.get(p)?.parent ?? '') {
      const gid = groupOf.get(p);
      if (gid) el.groupIds = [...el.groupIds, gid];
      const ct = containers.get(p);
      if (ct) { if (!ct.members.includes(el.id)) ct.members.push(el.id); break; }
    }
  }
  // edges
  for (const c of cells) {
    if (!c.edge || isHidden(c)) continue;
    const st = c.style, g = c.geo;
    const origin = c.parent && byId.get(c.parent)?.vertex ? abs(c.parent) : { x: 0, y: 0 };
    const pt = (as: string): Point | null => {
      const e = g ? Array.from(g.children).find((n) => n.tagName === 'mxPoint' && n.getAttribute('as') === as) : null;
      return e ? { x: origin.x + num(e.getAttribute('x'), 0), y: origin.y + num(e.getAttribute('y'), 0) } : null;
    };
    const anchor = (x?: string, y?: string) => (x !== undefined && y !== undefined && Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? { x: Math.min(1, Math.max(0, Number(x))), y: Math.min(1, Math.max(0, Number(y))) } : null);
    const end = (ref: string | undefined, as: string, ax?: string, ay?: string): Endpoint | null => {
      const id = ref ? idOf.get(ref) : undefined;
      if (id) return { x: 0, y: 0, elementId: id, anchor: anchor(ax, ay) };
      const q = pt(as);
      return q ? { x: q.x, y: q.y, elementId: null, anchor: null } : null;
    };
    const s = end(c.source, 'sourcePoint', st.exitX, st.exitY), e = end(c.target, 'targetPoint', st.entryX, st.entryY);
    if (!s || !e) { warn('Skipped an arrow with a loose end that has no position.'); continue; }
    const t = defaultToolStyle('arrow');
    const elbow = /orthogonal|elbow|entityRelation/i.test(st.edgeStyle ?? '');
    const con: ConnectorElement = makeConnector(s, e, { ...t, routing: elbow ? 'elbow' : st.curved === '1' ? 'curved' : 'straight', curvature: 0, elbowRadius: st.rounded === '1' ? 10 : 0 });
    const arr = g ? Array.from(g.children).find((n) => n.tagName === 'Array' && n.getAttribute('as') === 'points') : null;
    con.bends = arr ? Array.from(arr.children).filter((n) => n.tagName === 'mxPoint').slice(0, 200).map((n) => ({ x: origin.x + num(n.getAttribute('x'), 0), y: origin.y + num(n.getAttribute('y'), 0) })) : [];
    if (con.routing === 'curved' && !con.bends.length) con.curvature = 0.3;
    con.style = { ...styleFrom({ ...st, fillColor: 'none' }, { ...t.style, fillStyle: 'none' }), fill: 'transparent', fillStyle: 'none' };
    con.startHead = head(st.startArrow, 'none');
    con.endHead = head(st.endArrow, 'arrow');
    // the label: the edge's own value plus any label cells attached to it
    const labels = [htmlToText(c.value), ...cells.filter((l) => l.parent === c.id && l.vertex).map((l) => htmlToText(l.value))].filter(Boolean);
    con.text = labels.join('\n');
    con.textStyle = { ...textFrom(st, con.textStyle), fontSize: Math.max(10, num(st.fontSize, 11) * 1.2) };
    out.push(con);
  }
  return out;
}

/** A draw.io file → a FlowSketch document (one page per diagram). Throws if it isn't one. */
export function importDrawio(text: string, title = 'Imported from draw.io'): ImportResult {
  const warnings: string[] = [];
  const warn = (m: string) => { if (!warnings.includes(m)) warnings.push(m); };
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('That draw.io file could not be read.');
  const doc = newDocument(title);
  // models: <mxfile><diagram>…</diagram></mxfile> (inline or compressed), or a bare <mxGraphModel>
  const models: { name: string; model: Element }[] = [];
  const top = xml.documentElement;
  if (top.tagName === 'mxGraphModel') models.push({ name: 'Page 1', model: top });
  else for (const d of Array.from(top.getElementsByTagName('diagram')).slice(0, 50)) {
    const name = (d.getAttribute('name') ?? '').slice(0, 60) || `Page ${models.length + 1}`;
    const inner = d.getElementsByTagName('mxGraphModel')[0];
    if (inner) { models.push({ name, model: inner }); continue; }
    const data = d.textContent?.trim();
    if (!data) continue;
    try {
      const m = new DOMParser().parseFromString(inflateDiagram(data), 'application/xml').documentElement;
      if (m.tagName === 'mxGraphModel') models.push({ name, model: m }); else warn(`Page "${name}" could not be read.`);
    } catch { warn(`Page "${name}" could not be read.`); }
  }
  if (!models.length) throw new Error('No diagrams found in that draw.io file.');
  const pages: Page[] = models.map(({ name, model }) => ({ id: uid('page'), name, elements: pageElements(model, doc, warn) }));
  const bg = models[0].model.getAttribute('background');
  if (bg && /^#[0-9a-f]{6}$/i.test(bg)) doc.canvas = { ...doc.canvas, background: bg.toLowerCase() };
  doc.pages = pages.map((p, i) => (i === 0 ? { ...p, elements: [] } : p));
  doc.activePage = pages[0].id;
  doc.elements = pages[0].elements;
  return { doc, warnings };
}
