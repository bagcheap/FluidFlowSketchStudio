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

/** Request ⇄ response: a second arrow running back from end to start, parallel to the first. */
export interface ConnectorPair {
  text: string; // response label (the request label is the connector's own text)
  strokeStyle: StrokeStyle; // response line pattern (dashed by default, the UML reply convention)
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
  pair?: ConnectorPair; // present = request ⇄ response pair (start→end request, end→start response)
}

export type BoxElement = ShapeElement | TextElement | FreehandElement | ImageElement;
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

export const SCHEMA_VERSION = 2; // v2: ConnectorElement.pair

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
  pair?: ConnectorPair; // pair tool: response line defaults (text unused)
}
