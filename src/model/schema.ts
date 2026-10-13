// Validation, sanitisation and migration for .flowsketch files.
// Every imported value is coerced into a known-safe shape; nothing is executed.
import type {
  Asset, ConnectorAnim, DiagramElement, Endpoint, FlowDocument, ShapeAnim, ShapeKind, Style, TextStyle,
} from './types';
import { SCHEMA_VERSION } from './types';
import { DEFAULT_ANIMATION, DEFAULT_CONNECTOR_ANIM, DEFAULT_SHAPE_ANIM, DEFAULT_STYLE, DEFAULT_TEXT, newDocument, newSeed, uid } from './defaults';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ELEMENTS = 5000;
export const MAX_TEXT = 5000;
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;

export class DocumentError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number, min = -1e6, max = 1e6) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const str = (v: unknown, d: string, max = 200) => (typeof v === 'string' ? v.slice(0, max) : d);
function oneOf<T extends string>(v: unknown, opts: readonly T[], d: T): T {
  return typeof v === 'string' && (opts as readonly string[]).includes(v) ? (v as T) : d;
}
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|transparent|rgba?\([\d\s.,%]+\))$/;
const color = (v: unknown, d: string) => (typeof v === 'string' && COLOR_RE.test(v.trim()) ? v.trim() : d);

export const SHAPE_KINDS: readonly ShapeKind[] = [
  'rectangle', 'roundRect', 'ellipse', 'diamond', 'parallelogram', 'hexagon', 'triangle', 'pill', 'cloud',
  'cylinder', 'document', 'speech', 'sticky', 'trapezoid', 'octagon', 'star',
];

function style(v: unknown): Style {
  const o = isObj(v) ? v : {};
  const d = DEFAULT_STYLE;
  return {
    stroke: color(o.stroke, d.stroke),
    fill: color(o.fill, d.fill),
    fillStyle: oneOf(o.fillStyle, ['none', 'solid', 'hachure', 'cross-hatch'] as const, d.fillStyle),
    strokeWidth: num(o.strokeWidth, d.strokeWidth, 0, 40),
    strokeStyle: oneOf(o.strokeStyle, ['solid', 'dashed', 'dotted'] as const, d.strokeStyle),
    opacity: num(o.opacity, 1, 0, 1),
    roughness: num(o.roughness, d.roughness, 0, 3),
    cornerRadius: num(o.cornerRadius, d.cornerRadius, 0, 500),
    shadow: bool(o.shadow, false),
  };
}

function textStyle(v: unknown): TextStyle {
  const o = isObj(v) ? v : {};
  const d = DEFAULT_TEXT;
  return {
    fontFamily: oneOf(o.fontFamily, ['hand', 'sans', 'serif', 'mono'] as const, d.fontFamily),
    fontSize: num(o.fontSize, d.fontSize, 6, 200),
    bold: bool(o.bold, false),
    italic: bool(o.italic, false),
    color: color(o.color, d.color),
    align: oneOf(o.align, ['left', 'center', 'right'] as const, d.align),
    vAlign: oneOf(o.vAlign, ['top', 'middle', 'bottom'] as const, d.vAlign),
    padding: num(o.padding, d.padding, 0, 200),
    lineHeight: num(o.lineHeight, d.lineHeight, 0.8, 3),
  };
}

export function sanitizeShapeAnim(v: unknown, partial: true): Partial<ShapeAnim>;
export function sanitizeShapeAnim(v: unknown, partial: false): ShapeAnim;
export function sanitizeShapeAnim(v: unknown, partial: boolean): Partial<ShapeAnim> | ShapeAnim {
  const o = isObj(v) ? v : {};
  const d = DEFAULT_SHAPE_ANIM;
  const full: ShapeAnim = {
    mode: oneOf(o.mode, ['off', 'float', 'wobble', 'boil', 'sway', 'combined'] as const, d.mode),
    intensity: num(o.intensity, d.intensity, 0, 10),
    amplitude: num(o.amplitude, d.amplitude, 0, 50),
    speed: num(o.speed, d.speed, 0, 5),
    rotation: num(o.rotation, d.rotation, 0, 30),
    deform: num(o.deform, d.deform, 0, 30),
    smoothness: num(o.smoothness, d.smoothness, 0, 1),
    phase: num(o.phase, d.phase, 0, 1),
    delay: num(o.delay, d.delay, 0, 600),
    textMotion: oneOf(o.textMotion, ['follow', 'stable', 'independent'] as const, d.textMotion),
  };
  if (!partial) return full;
  const out: Partial<ShapeAnim> = {};
  for (const k of Object.keys(full) as (keyof ShapeAnim)[]) if (k in o) (out as Obj)[k] = full[k];
  return out;
}

export function sanitizeConnectorAnim(v: unknown, partial: true): Partial<ConnectorAnim>;
export function sanitizeConnectorAnim(v: unknown, partial: false): ConnectorAnim;
export function sanitizeConnectorAnim(v: unknown, partial: boolean): Partial<ConnectorAnim> | ConnectorAnim {
  const o = isObj(v) ? v : {};
  const d = DEFAULT_CONNECTOR_ANIM;
  const full: ConnectorAnim = {
    mode: oneOf(o.mode, ['none', 'drawOn', 'travel', 'dash', 'pulse'] as const, d.mode),
    speed: num(o.speed, d.speed, 0, 10),
    direction: oneOf(o.direction, ['forward', 'reverse'] as const, d.direction),
    highlightColor: color(o.highlightColor, d.highlightColor),
    highlightLength: num(o.highlightLength, d.highlightLength, 2, 2000),
    highlightOpacity: num(o.highlightOpacity, d.highlightOpacity, 0, 1),
    segments: Math.round(num(o.segments, d.segments, 1, 12)),
    roundCaps: bool(o.roundCaps, d.roundCaps),
    glow: bool(o.glow, d.glow),
    drawFraction: num(o.drawFraction, d.drawFraction, 0.05, 1),
    pauseFraction: num(o.pauseFraction, d.pauseFraction, 0, 0.9),
    erase: bool(o.erase, d.erase),
    delay: num(o.delay, d.delay, 0, 600),
    arrowPulse: bool(o.arrowPulse, d.arrowPulse),
  };
  if (!partial) return full;
  const out: Partial<ConnectorAnim> = {};
  for (const k of Object.keys(full) as (keyof ConnectorAnim)[]) if (k in o) (out as Obj)[k] = full[k];
  return out;
}

function endpoint(v: unknown): Endpoint {
  const o = isObj(v) ? v : {};
  const a = isObj(o.anchor) ? { x: num(o.anchor.x, 0.5, 0, 1), y: num(o.anchor.y, 0.5, 0, 1) } : null;
  return {
    x: num(o.x, 0), y: num(o.y, 0),
    elementId: typeof o.elementId === 'string' ? o.elementId.slice(0, 100) : null,
    anchor: a,
  };
}

function element(v: unknown, warn: (m: string) => void): DiagramElement | null {
  if (!isObj(v)) return null;
  const type = oneOf(v.type, ['shape', 'text', 'freehand', 'image', 'connector'] as const, 'shape');
  if (typeof v.type !== 'string' || v.type !== type) { warn(`Skipped element of unknown type "${String(v.type)}"`); return null; }
  const base = {
    id: str(v.id, uid(), 100) || uid(),
    x: num(v.x, 0), y: num(v.y, 0),
    w: num(v.w, 100, 0, 1e5), h: num(v.h, 60, 0, 1e5),
    rotation: num(v.rotation, 0, -3600, 3600),
    locked: bool(v.locked, false),
    groupIds: Array.isArray(v.groupIds) ? v.groupIds.filter((g): g is string => typeof g === 'string').slice(0, 20) : [],
    seed: Math.round(num(v.seed, newSeed(), 1, 2 ** 31)),
    style: style(v.style),
    text: str(v.text, '', MAX_TEXT),
    textStyle: textStyle(v.textStyle),
  };
  const sAnim = isObj(v.anim) ? { anim: sanitizeShapeAnim(v.anim, true) } : {};
  switch (type) {
    case 'shape':
      return { ...base, ...sAnim, type, shape: oneOf(v.shape, SHAPE_KINDS, 'roundRect'), flipX: bool(v.flipX, false), flipY: bool(v.flipY, false) };
    case 'text':
      return { ...base, ...sAnim, type };
    case 'freehand': {
      const pts = Array.isArray(v.points) ? v.points : [];
      const points: [number, number][] = [];
      for (const p of pts.slice(0, 20000)) {
        if (Array.isArray(p) && p.length >= 2) points.push([num(p[0], 0, -1, 2), num(p[1], 0, -1, 2)]);
      }
      if (points.length < 1) return null;
      return { ...base, ...sAnim, type, points, highlighter: bool(v.highlighter, false) };
    }
    case 'image':
      return { ...base, ...sAnim, type, assetId: str(v.assetId, '', 100) };
    case 'connector': {
      const bends = Array.isArray(v.bends)
        ? v.bends.filter(isObj).slice(0, 50).map((b) => ({ x: num(b.x, 0), y: num(b.y, 0) }))
        : [];
      const heads = ['none', 'arrow', 'triangle', 'dot', 'bar'] as const;
      return {
        ...base, type,
        start: endpoint(v.start), end: endpoint(v.end), bends,
        routing: oneOf(v.routing, ['straight', 'curved', 'elbow'] as const, 'curved'),
        curvature: num(v.curvature, 0, -1, 1),
        startHead: oneOf(v.startHead, heads, 'none'),
        endHead: oneOf(v.endHead, heads, 'arrow'),
        labelPos: num(v.labelPos, 0.5, 0, 1),
        labelOffset: num(v.labelOffset, 0, -500, 500),
        ...(isObj(v.anim) ? { anim: sanitizeConnectorAnim(v.anim, true) } : {}),
      };
    }
  }
}

const DATA_URL_RE = /^data:(image\/(png|jpeg|gif|webp));base64,[A-Za-z0-9+/=]+$/;

function asset(v: unknown): Asset | null {
  if (!isObj(v) || typeof v.dataUrl !== 'string') return null;
  const m = DATA_URL_RE.exec(v.dataUrl);
  if (!m || v.dataUrl.length > MAX_ASSET_BYTES * 1.4) return null;
  return {
    id: str(v.id, uid('asset'), 100),
    mime: m[1] as Asset['mime'],
    dataUrl: v.dataUrl,
    width: num(v.width, 100, 1, 20000),
    height: num(v.height, 100, 1, 20000),
  };
}

/** Upgrade older schema versions in place. Add a case per future version bump. */
export function migrate(raw: Obj): Obj {
  let version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (version > SCHEMA_VERSION) {
    throw new DocumentError(`This file was made by a newer FlowSketch (schema ${version}); this version supports up to ${SCHEMA_VERSION}.`);
  }
  if (version === 0) {
    // v0 (pre-release): "shapes" + "connectors" arrays
    if (Array.isArray(raw.shapes) || Array.isArray(raw.connectors)) {
      raw.elements = [...((raw.shapes as unknown[]) ?? []), ...((raw.connectors as unknown[]) ?? [])];
    }
    version = 1;
  }
  raw.schemaVersion = version;
  return raw;
}

export interface ParseResult { doc: FlowDocument; warnings: string[] }

export function parseDocument(input: string | unknown): ParseResult {
  let raw: unknown = input;
  if (typeof input === 'string') {
    if (input.length > MAX_FILE_BYTES) throw new DocumentError('File is too large to open (limit 25 MB).');
    try { raw = JSON.parse(input); } catch { throw new DocumentError('This file is not valid JSON, so it is not a FlowSketch document.'); }
  }
  if (!isObj(raw)) throw new DocumentError('The file does not contain a FlowSketch document.');
  if (raw.format !== undefined && raw.format !== 'flowsketch') throw new DocumentError(`Unsupported file format "${String(raw.format)}".`);
  if (!Array.isArray(raw.elements) && !Array.isArray(raw.shapes)) throw new DocumentError('The document has no element list; it may be corrupted.');
  const o = migrate({ ...raw });
  const warnings: string[] = [];
  const warn = (m: string) => { if (warnings.length < 20) warnings.push(m); };
  const base = newDocument();
  const anim = isObj(o.animation) ? o.animation : {};
  const da = DEFAULT_ANIMATION;
  const doc: FlowDocument = {
    ...base,
    id: str(o.id, base.id, 100),
    title: str(o.title, 'Untitled diagram', 200) || 'Untitled diagram',
    createdAt: str(o.createdAt, base.createdAt, 40),
    updatedAt: str(o.updatedAt, base.updatedAt, 40),
    canvas: {
      background: color(isObj(o.canvas) ? o.canvas.background : undefined, base.canvas.background),
      grid: oneOf(isObj(o.canvas) ? o.canvas.grid : undefined, ['none', 'dots', 'lines'] as const, 'dots'),
      gridSize: num(isObj(o.canvas) ? o.canvas.gridSize : undefined, 20, 4, 200),
    },
    animation: {
      enabled: bool(anim.enabled, da.enabled),
      animateShapes: bool(anim.animateShapes, da.animateShapes),
      animateConnectors: bool(anim.animateConnectors, da.animateConnectors),
      duration: num(anim.duration, da.duration, 0.5, 120),
      loop: bool(anim.loop, da.loop),
      seamless: bool(anim.seamless, da.seamless),
      playbackSpeed: num(anim.playbackSpeed, 1, 0.1, 4),
      synchronize: bool(anim.synchronize, da.synchronize),
      randomizePhases: bool(anim.randomizePhases, da.randomizePhases),
      reducedMotion: bool(anim.reducedMotion, false),
      intensityScale: num(anim.intensityScale, 1, 0, 3),
      speedScale: num(anim.speedScale, 1, 0, 5),
      arrowSpeedScale: num(anim.arrowSpeedScale, 1, 0, 5),
      shape: sanitizeShapeAnim(anim.shape, false),
      connector: sanitizeConnectorAnim(anim.connector, false),
    },
    exportPrefs: {
      gifWidth: num(isObj(o.exportPrefs) ? o.exportPrefs.gifWidth : undefined, 1280, 64, 4096),
      gifFps: num(isObj(o.exportPrefs) ? o.exportPrefs.gifFps : undefined, 15, 1, 50),
      padding: num(isObj(o.exportPrefs) ? o.exportPrefs.padding : undefined, 40, 0, 1000),
    },
    elements: [],
    assets: {},
  };
  // assets
  if (isObj(o.assets)) {
    for (const [k, v] of Object.entries(o.assets).slice(0, 500)) {
      const a = asset(v);
      if (a) doc.assets[k] = { ...a, id: k }; else warn(`Dropped an image asset that was not a safe raster image (${k}).`);
    }
  }
  // elements
  const els = (o.elements as unknown[]).slice(0, MAX_ELEMENTS);
  if ((o.elements as unknown[]).length > MAX_ELEMENTS) warn(`Only the first ${MAX_ELEMENTS} elements were loaded.`);
  const seen = new Set<string>();
  for (const raw of els) {
    const e = element(raw, warn);
    if (!e) continue;
    if (seen.has(e.id)) e.id = uid();
    seen.add(e.id);
    if (e.type === 'image' && !doc.assets[e.assetId]) { warn('Removed an image whose data is missing.'); continue; }
    doc.elements.push(e);
  }
  // referential integrity: connectors may only attach to existing non-connector elements
  const boxes = new Set(doc.elements.filter((e) => e.type !== 'connector').map((e) => e.id));
  for (const e of doc.elements) {
    if (e.type !== 'connector') continue;
    for (const end of [e.start, e.end]) {
      if (end.elementId && !boxes.has(end.elementId)) { end.elementId = null; end.anchor = null; warn('Detached a connector from a missing shape.'); }
    }
  }
  return { doc, warnings };
}

export function serializeDocument(doc: FlowDocument): string {
  return JSON.stringify({ ...doc, format: 'flowsketch', schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString() }, null, 1);
}
