// FlowSketch document model. Everything here is plain JSON-serialisable data.
// Animation NEVER mutates these values; see engine/render.ts.

export type Point = { x: number; y: number };

export type ShapeKind =
  | 'rectangle' | 'roundRect' | 'ellipse' | 'diamond' | 'parallelogram' | 'hexagon'
  | 'triangle' | 'pill' | 'cloud' | 'cylinder' | 'document' | 'speech' | 'sticky'
  | 'trapezoid' | 'octagon' | 'star';

export type FillStyle = 'none' | 'solid' | 'hachure' | 'cross-hatch';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type FontFamily = 'hand' | 'sans' | 'serif' | 'mono';

export interface Style {
  stroke: string;
  fill: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  opacity: number; // 0..1
  roughness: number; // 0 precise .. 3 very sketchy (static, NOT animated)
  cornerRadius: number;
  shadow: boolean;
}

export interface TextStyle {
  fontFamily: FontFamily;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  vAlign: 'top' | 'middle' | 'bottom';
  padding: number;
  lineHeight: number;
}

export type ShapeAnimMode = 'off' | 'float' | 'wobble' | 'boil' | 'sway' | 'combined';
export type TextMotion = 'follow' | 'stable' | 'independent';

export interface ShapeAnim {
  mode: ShapeAnimMode;
  intensity: number; // squiggle 0..10 (master multiplier; 0 = perfectly still)
  amplitude: number; // px translation at intensity 2
  speed: number; // cycles per second (approx; snapped to loop for seamlessness)
  rotation: number; // degrees at intensity 2
  deform: number; // px outline deformation at intensity 2
  smoothness: number; // 0..1 (higher = fewer, broader waves)
  phase: number; // 0..1 offset
  delay: number; // seconds before motion fades in
  textMotion: TextMotion;
}

export type FlowMode = 'none' | 'drawOn' | 'travel' | 'dash' | 'pulse';

export interface ConnectorAnim {
  mode: FlowMode;
  speed: number; // trips per second (snapped to loop when seamless)
  direction: 'forward' | 'reverse';
  highlightColor: string;
  highlightLength: number; // px
  highlightOpacity: number;
  segments: number; // simultaneous travelling segments
  roundCaps: boolean;
  glow: boolean;
  drawFraction: number; // drawOn: fraction of cycle spent drawing
  pauseFraction: number; // drawOn: fraction of cycle paused between loops
  erase: boolean; // drawOn: erase from tail instead of vanishing
  delay: number; // seconds
  arrowPulse: boolean;
}

export interface AnimationSettings {
  enabled: boolean;
  animateShapes: boolean;
  animateConnectors: boolean;
  duration: number; // seconds per loop
  loop: boolean;
  seamless: boolean; // snap all frequencies to integer cycles per loop
  playbackSpeed: number;
  synchronize: boolean; // all objects share phase
  randomizePhases: boolean;
  reducedMotion: boolean;
  intensityScale: number; // global squiggle multiplier 0..2
  speedScale: number; // global shape speed multiplier
  arrowSpeedScale: number;
  shape: ShapeAnim; // document defaults
  connector: ConnectorAnim;
}

export type HeadKind = 'none' | 'arrow' | 'triangle' | 'dot' | 'bar';
export type Routing = 'straight' | 'curved' | 'elbow';

export interface Endpoint {
  x: number; // world position used when unattached
  y: number;
  elementId?: string | null;
  // normalised local anchor (0..1) in the target's box; null = auto (aim at the other end)
  anchor?: Point | null;
}

interface ElementBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number; // degrees
  locked: boolean;
  groupIds: string[];
  seed: number; // stable seed for sketch + motion
  style: Style;
  text: string;
  textStyle: TextStyle;
}

export interface ShapeElement extends ElementBase {
  type: 'shape';
  shape: ShapeKind;
  flipX: boolean;
  flipY: boolean;
  anim?: Partial<ShapeAnim>;
}

export interface TextElement extends ElementBase {
  type: 'text';
  anim?: Partial<ShapeAnim>;
}

export interface FreehandElement extends ElementBase {
  type: 'freehand';
  points: [number, number][]; // normalised 0..1 within box
  highlighter: boolean;
  anim?: Partial<ShapeAnim>;
}

export interface ImageElement extends ElementBase {
  type: 'image';
  assetId: string;
  anim?: Partial<ShapeAnim>;
}

export interface ConnectorElement extends ElementBase {
  type: 'connector';
  start: Endpoint;
  end: Endpoint;
  bends: Point[]; // world-space user control points
  routing: Routing;
  curvature: number; // for curved routing without bends (-1..1)
  startHead: HeadKind;
  endHead: HeadKind;
  labelPos: number; // 0..1 along path
  labelOffset: number; // px perpendicular
  anim?: Partial<ConnectorAnim>;
}

/** An icon placed on the canvas. Its vector data lives once per document in FlowDocument.icons. */
export interface IconElement extends ElementBase {
  type: 'icon';
  iconId: string; // key into FlowDocument.icons, e.g. "tabler:database"
  sketch: boolean; // draw one-colour icons hand-drawn (Rough.js) instead of crisp
  labelPos: 'below' | 'right' | 'none'; // where the text label sits
  frame: 'none' | 'circle' | 'square'; // optional background drawn behind the icon (style.fill / style.stroke)
  anim?: Partial<ShapeAnim>;
}

export type BoxElement = ShapeElement | TextElement | FreehandElement | ImageElement | IconElement;
export type DiagramElement = BoxElement | ConnectorElement;

export interface Asset {
  id: string;
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  dataUrl: string;
  width: number;
  height: number;
}

export interface CanvasSettings {
  background: string;
  grid: 'none' | 'dots' | 'lines';
  gridSize: number;
}

export interface ExportPrefs {
  gifWidth: number;
  gifFps: number;
  padding: number;
}

export const SCHEMA_VERSION = 3; // v2: icons (IconElement + FlowDocument.icons) · v3: gradient paints and bbox in icon parts

/**
 * One drawable piece of an icon: plain path data plus paint, in the icon's own units (w × h).
 * Icons are converted from SVG to these on import; nothing else from the SVG is kept.
 */
/** A gradient fill (linear or radial), kept as data and drawn by FlowSketch itself. */
export interface IconGradient {
  type: 'linear' | 'radial';
  bbox: boolean; // coordinates are fractions of the part's bounding box (SVG's default "objectBoundingBox")
  x1: number; y1: number; x2: number; y2: number; // linear
  cx: number; cy: number; r: number; fx: number; fy: number; // radial
  stops: { offset: number; color: string; opacity: number }[];
  m?: [number, number, number, number, number, number]; // gradientTransform
}

/** A paint: a colour, 'currentColor' (follows the element's colour), a gradient, or null for none. */
export type IconPaint = string | IconGradient | null;

export interface IconPart {
  d: string;
  fill: IconPaint;
  stroke: IconPaint;
  bbox?: [number, number, number, number]; // x, y, w, h of the path in its own units (for bounding-box gradients)
  strokeWidth: number;
  linecap: 'butt' | 'round' | 'square';
  linejoin: 'miter' | 'round' | 'bevel';
  evenodd: boolean;
  opacity: number;
  m?: [number, number, number, number, number, number]; // SVG transform matrix (a b c d e f)
}

export interface IconAsset {
  id: string; // "<set>:<name>"
  name: string;
  set: string; // human-readable set name, e.g. "Tabler Icons"
  license: string; // SPDX id, e.g. "MIT"
  w: number; // viewBox width
  h: number;
  parts: IconPart[];
  mono: boolean; // every colour is currentColor/none: the icon can be recoloured and sketched
}

export interface FlowDocument {
  format: 'flowsketch';
  schemaVersion: number;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  canvas: CanvasSettings;
  animation: AnimationSettings;
  elements: DiagramElement[]; // array order = z-order (last on top)
  assets: Record<string, Asset>;
  icons: Record<string, IconAsset>; // vector data of the icons used in this document
  toolDefaults?: Record<string, ToolStyle>;
  exportPrefs: ExportPrefs;
}

// Remembered per-tool configuration
export interface ToolStyle {
  style: Style;
  textStyle: TextStyle;
  shapeAnim?: Partial<ShapeAnim>;
  connectorAnim?: Partial<ConnectorAnim>;
  routing?: Routing;
  startHead?: HeadKind;
  endHead?: HeadKind;
}
