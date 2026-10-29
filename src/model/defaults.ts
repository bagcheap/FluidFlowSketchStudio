import type {
  AnimationSettings, ConnectorAnim, ConnectorElement, DiagramElement, FlowDocument, ShapeAnim,
  ShapeElement, ShapeKind, Style, TextElement, TextStyle, ToolStyle, Endpoint,
} from './types';
import { SCHEMA_VERSION } from './types';

export function uid(prefix = 'el'): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${r}`;
}

export function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 31) + 1;
}

export const DEFAULT_STYLE: Style = {
  stroke: '#1e1e2e',
  fill: '#e7e3ff',
  fillStyle: 'solid',
  strokeWidth: 2,
  strokeStyle: 'solid',
  opacity: 1,
  roughness: 1,
  cornerRadius: 14,
  shadow: false,
};

export const DEFAULT_TEXT: TextStyle = {
  fontFamily: 'hand',
  fontSize: 20,
  bold: false,
  italic: false,
  color: '#1e1e2e',
  align: 'center',
  vAlign: 'middle',
  padding: 10,
  lineHeight: 1.25,
};

export const DEFAULT_SHAPE_ANIM: ShapeAnim = {
  mode: 'combined',
  intensity: 2,
  amplitude: 1.6,
  speed: 0.35,
  rotation: 0.5,
  deform: 1.4,
  smoothness: 0.6,
  phase: 0,
  delay: 0,
  textMotion: 'follow',
};

export const DEFAULT_CONNECTOR_ANIM: ConnectorAnim = {
  mode: 'travel',
  speed: 0.5,
  direction: 'forward',
  highlightColor: '#3b82f6',
  highlightLength: 36,
  highlightOpacity: 1,
  segments: 1,
  roundCaps: true,
  glow: true,
  drawFraction: 0.55,
  pauseFraction: 0.2,
  erase: false,
  delay: 0,
  arrowPulse: false,
};

export const DEFAULT_ANIMATION: AnimationSettings = {
  enabled: true,
  animateShapes: true,
  animateConnectors: true,
  duration: 4,
  loop: true,
  seamless: true,
  playbackSpeed: 1,
  synchronize: false,
  randomizePhases: true,
  reducedMotion: false,
  intensityScale: 1,
  speedScale: 1,
  arrowSpeedScale: 1,
  shape: DEFAULT_SHAPE_ANIM,
  connector: DEFAULT_CONNECTOR_ANIM,
};

export const SHAPE_DEFAULT_SIZE: Partial<Record<ShapeKind, [number, number]>> = {
  ellipse: [140, 90],
  diamond: [150, 110],
  triangle: [130, 110],
  hexagon: [150, 96],
  cloud: [170, 110],
  cylinder: [110, 130],
  sticky: [150, 150],
  star: [120, 120],
  octagon: [120, 120],
  pill: [170, 64],
};

export function newDocument(title = 'Untitled diagram'): FlowDocument {
  const now = new Date().toISOString();
  return {
    format: 'flowsketch',
    schemaVersion: SCHEMA_VERSION,
    id: uid('doc'),
    title,
    createdAt: now,
    updatedAt: now,
    canvas: { background: '#fbfaf7', grid: 'dots', gridSize: 20 },
    animation: structuredClone(DEFAULT_ANIMATION),
    elements: [],
    assets: {},
    exportPrefs: { gifWidth: 1280, gifFps: 15, padding: 40 },
  };
}

export function baseFields(tool: ToolStyle) {
  return {
    id: uid(),
    rotation: 0,
    locked: false,
    groupIds: [] as string[],
    seed: newSeed(),
    style: { ...tool.style },
    text: '',
    textStyle: { ...tool.textStyle },
  };
}

export function makeShape(kind: ShapeKind, x: number, y: number, w: number, h: number, tool: ToolStyle): ShapeElement {
  return {
    ...baseFields(tool), type: 'shape', shape: kind, x, y, w, h, flipX: false, flipY: false,
    ...(tool.shapeAnim && Object.keys(tool.shapeAnim).length ? { anim: { ...tool.shapeAnim } } : {}),
  };
}

export function makeText(x: number, y: number, text: string, tool: ToolStyle): TextElement {
  return {
    ...baseFields(tool), type: 'text', x, y, w: 40, h: tool.textStyle.fontSize * 1.4, text,
    textStyle: { ...tool.textStyle, padding: 2 },
  };
}

export function makeConnector(start: Endpoint, end: Endpoint, tool: ToolStyle): ConnectorElement {
  return {
    ...baseFields(tool), type: 'connector', x: 0, y: 0, w: 0, h: 0,
    style: { ...tool.style, fillStyle: 'none' },
    start, end, bends: [], routing: tool.routing ?? 'curved', curvature: 0,
    startHead: tool.startHead ?? 'none', endHead: tool.endHead ?? 'arrow',
    labelPos: 0.5, labelOffset: 0,
    textStyle: { ...tool.textStyle, fontSize: Math.max(12, tool.textStyle.fontSize - 4), padding: 4 },
    ...(tool.connectorAnim && Object.keys(tool.connectorAnim).length ? { anim: { ...tool.connectorAnim } } : {}),
  };
}

export const isConnector = (e: DiagramElement): e is ConnectorElement => e.type === 'connector';

// ---- Tool defaults ---------------------------------------------------------

export type ToolId =
  | 'select' | 'hand' | 'shape' | 'arrow' | 'line' | 'freehand' | 'highlighter'
  | 'text' | 'image' | 'eraser' | 'painter';

/** Key under which a tool's style is remembered (shape tools remember per shape kind). */
export function styleKey(tool: ToolId, shape: ShapeKind): string {
  return tool === 'shape' ? `shape:${shape}` : tool;
}

export function defaultToolStyle(key: string): ToolStyle {
  const s: ToolStyle = { style: { ...DEFAULT_STYLE }, textStyle: { ...DEFAULT_TEXT } };
  if (key === 'arrow') {
    s.style = { ...s.style, fill: 'transparent', fillStyle: 'none', stroke: '#4b5563' };
    s.routing = 'curved'; s.endHead = 'arrow'; s.startHead = 'none';
  } else if (key === 'line') {
    s.style = { ...s.style, fill: 'transparent', fillStyle: 'none' };
    s.routing = 'straight'; s.endHead = 'none'; s.startHead = 'none';
    s.connectorAnim = { mode: 'none' };
  } else if (key === 'freehand') {
    s.style = { ...s.style, fillStyle: 'none', strokeWidth: 3 };
  } else if (key === 'highlighter') {
    s.style = { ...s.style, fillStyle: 'none', stroke: '#facc15', strokeWidth: 18, opacity: 0.45 };
    s.shapeAnim = { mode: 'off' };
  } else if (key === 'text') {
    s.style = { ...s.style, fillStyle: 'none' };
    s.textStyle = { ...s.textStyle, align: 'left', vAlign: 'top' };
  } else if (key === 'shape:diamond') {
    s.style = { ...s.style, fill: '#fff4c2', cornerRadius: 6 };
  } else if (key === 'shape:ellipse') {
    s.style = { ...s.style, fill: '#d9ecff' };
  } else if (key === 'shape:sticky') {
    s.style = { ...s.style, fill: '#fde68a', cornerRadius: 2, shadow: true };
  } else if (key === 'shape:rectangle') {
    s.style = { ...s.style, cornerRadius: 0, fill: '#ffffff' };
  } else if (key === 'shape:cylinder') {
    s.style = { ...s.style, fill: '#d6f5df' };
  }
  return s;
}

// Colour grids: 10 hues (red → pink) in rows of increasing strength, plus neutrals.
const HUES = {
  tint: ['#ffe3e3', '#ffe8cc', '#fff3bf', '#d3f9d8', '#c3fae8', '#c5f6fa', '#d0ebff', '#dbe4ff', '#e5dbff', '#ffdeeb'],
  light: ['#ffa8a8', '#ffc078', '#ffe066', '#8ce99a', '#63e6be', '#66d9e8', '#74c0fc', '#91a7ff', '#b197fc', '#faa2c1'],
  bold: ['#fa5252', '#fd7e14', '#fab005', '#40c057', '#12b886', '#15aabf', '#228be6', '#4c6ef5', '#7950f2', '#e64980'],
  deep: ['#c92a2a', '#d9480f', '#e67700', '#2b8a3e', '#087f5b', '#0b7285', '#1864ab', '#364fc7', '#5f3dc4', '#a61e4d'],
};
export const PALETTE_STROKE = ['#1e1e2e', '#343a40', '#495057', '#868e96', '#adb5bd', '#dee2e6', '#ffffff', '#4b5563', '#7048e8', '#c2255c', ...HUES.deep, ...HUES.bold, ...HUES.light];
export const PALETTE_FILL = ['transparent', '#ffffff', '#f8f9fa', '#e9ecef', '#ced4da', '#868e96', '#495057', '#1e1e2e', '#e7e3ff', '#fde68a', ...HUES.tint, ...HUES.light, ...HUES.bold, ...HUES.deep];
export const HIGHLIGHT_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#06b6d4'];

// Human-readable names for palette colours (swatch tooltips).
const HUE_NAMES = ['red', 'orange', 'yellow', 'green', 'teal', 'cyan', 'blue', 'indigo', 'violet', 'pink'];
const STRENGTH_NAMES: Record<keyof typeof HUES, string> = { tint: 'Pale ', light: 'Light ', bold: '', deep: 'Dark ' };
const COLOR_NAMES = new Map<string, string>([
  ['#1e1e2e', 'Ink'], ['#343a40', 'Charcoal'], ['#495057', 'Dark grey'], ['#4b5563', 'Slate'], ['#868e96', 'Grey'],
  ['#adb5bd', 'Silver'], ['#ced4da', 'Light grey'], ['#dee2e6', 'Pale grey'], ['#e9ecef', 'Mist'], ['#f8f9fa', 'Off-white'], ['#ffffff', 'White'],
  ['#7048e8', 'Purple'], ['#c2255c', 'Raspberry'], ['#e7e3ff', 'Lavender'], ['#fde68a', 'Butter'],
  ['#3b82f6', 'Blue'], ['#22c55e', 'Green'], ['#f59e0b', 'Amber'], ['#ec4899', 'Pink'], ['#8b5cf6', 'Violet'], ['#ef4444', 'Red'], ['#06b6d4', 'Cyan'],
]);
for (const [strength, colors] of Object.entries(HUES) as [keyof typeof HUES, string[]][]) {
  colors.forEach((c, i) => { const n = STRENGTH_NAMES[strength] + HUE_NAMES[i]; COLOR_NAMES.set(c, n[0].toUpperCase() + n.slice(1)); });
}

/** Tooltip text for a colour: "Dark blue · #1864ab", or just the code for custom colours. */
export function colorLabel(c: string): string {
  if (c === 'transparent') return 'No fill (transparent)';
  const name = COLOR_NAMES.get(c.toLowerCase());
  return name ? `${name} · ${c}` : c;
}
