// renderDocumentAtTime(document, t) -> Frame
// The single source of truth for what a diagram looks like at time t. Pure with respect to the
// document: it never mutates it. The live canvas, PNG/GIF/video export and SVG export all consume
// the returned Frame, so preview and exports match exactly.
import type { BoxElement, ConnectorElement, ContainerElement, DiagramElement, FlowDocument, FreehandElement, HeadKind, IconElement, IconGradient, IconPaint, Style, Point, ShapeElement, TextElement, TextStyle } from '../model/types';
import type { Motion, PreviewFlags } from './animation';
import { STILL, resolveConnectorAnim, shapeMotion } from './animation';
import { connectorPath, endTangent, pointAt, slice, type ConnectorPath, type Lookup } from './connectors';
import { displace, easeInOut, fract, hash01, snapFreq, type DeformField } from './noise';
import { roughSets, type OpSet } from './rough';
import { geometryFor } from './shapes';
import { cssFont, layoutText } from './text';

/** A colour, or a gradient with the bounding box of the path it fills (for bounding-box gradients). */
export type PartPaint = string | (IconGradient & { box?: [number, number, number, number] }) | null;

/** 2-D affine matrix (a b c d e f), as in SVG/canvas transforms. */
export type Matrix = [number, number, number, number, number, number];

export type Part =
  | { k: 'sets'; sets: OpSet[]; stroke: string; fill: string; sw: number; fillWeight: number; dash: number[] | null; shadow: boolean; m?: Matrix }
  | { k: 'path'; d: string; fill: PartPaint; stroke: PartPaint; width: number; cap: 'butt' | 'round' | 'square'; join: 'miter' | 'round' | 'bevel'; evenodd: boolean; alpha: number; m: Matrix }
  | { k: 'line'; pts: number[]; color: string; width: number; alpha: number; cap: 'round' | 'butt'; dash: number[] | null; dashOffset?: number; glow?: string; closed?: boolean; fill?: string }
  | { k: 'text'; lines: { t: string; x: number; y: number }[]; font: string; color: string; align: 'left' | 'center' | 'right' }
  | { k: 'image'; assetId: string; x: number; y: number; w: number; h: number };

export interface Transform { x: number; y: number; w: number; h: number; rot: number }
export interface Item { id: string; opacity: number; tf: Transform | null; parts: Part[] }
export interface Frame { items: Item[]; time: number; background: string }

export interface RenderOptions {
  flags?: PreviewFlags;
  hide?: Set<string>; // e.g. element being text-edited (label hidden)
  only?: Set<string>; // export selection only
  cull?: Rect; // live view: skip elements entirely outside this world rect
}

const dashFor = (style: string, sw: number): number[] | null =>
  style === 'dashed' ? [sw * 4 + 4, sw * 3 + 4] : style === 'dotted' ? [0.1, sw * 2.5 + 2] : null;

function warpSets(sets: OpSet[], f: DeformField): OpSet[] {
  if (f.amp === 0) return sets;
  return sets.map((s) => ({
    ...s,
    ops: s.ops.map((o) => {
      const d = o.data.slice();
      for (let i = 0; i + 1 < d.length; i += 2) {
        const [dx, dy] = displace(f, d[i], d[i + 1]);
        d[i] += dx; d[i + 1] += dy;
      }
      return { op: o.op, data: d };
    }),
  }));
}

function field(el: DiagramElement, m: Motion, loopLen: number | null): DeformField {
  return { amp: m.deform, seed: el.seed, t: m.tt, hz: m.deformHz, wavelength: m.wavelength, loopLen };
}

function labelParts(el: BoxElement | ConnectorElement, box: { x: number; y: number; w: number; h: number }, wrap: boolean): Part[] {
  if (!el.text) return [];
  const ts = el.textStyle;
  const pad = ts.padding;
  const lay = layoutText(el.text, ts, wrap ? Math.max(8, box.w - pad * 2) + 1 : null);
  const y0 = ts.vAlign === 'top' ? box.y + pad : ts.vAlign === 'bottom' ? box.y + box.h - pad - lay.height : box.y + (box.h - lay.height) / 2;
  const x = ts.align === 'left' ? box.x + pad : ts.align === 'right' ? box.x + box.w - pad : box.x + box.w / 2;
  return [{
    k: 'text', font: cssFont(ts), color: ts.color, align: ts.align,
    lines: lay.lines.map((l, i) => ({ t: l.text, x, y: y0 + i * lay.lineHeight + lay.lineHeight / 2 })),
  }];
}

function shapeItems(el: ShapeElement, m: Motion, loopLen: number | null, hideLabel: boolean): Item[] {
  const g = geometryFor(el);
  const f = field(el, m, loopLen);
  const seed = el.seed + m.boil * 7919;
  const sets = warpSets(roughSets(`s${el.shape}${el.w.toFixed(1)}x${el.h.toFixed(1)}`, g.d, el.style, seed, true), f);
  const parts: Part[] = [{ k: 'sets', sets, stroke: el.style.stroke, fill: el.style.fill, sw: el.style.strokeWidth, fillWeight: Math.max(0.6, el.style.strokeWidth / 2), dash: dashFor(el.style.strokeStyle, el.style.strokeWidth), shadow: el.style.shadow }];
  for (const d of g.details) {
    parts.push({ k: 'sets', sets: warpSets(roughSets('d' + d, d, el.style, seed + 1, false), f), stroke: el.style.stroke, fill: 'none', sw: el.style.strokeWidth, fillWeight: 1, dash: dashFor(el.style.strokeStyle, el.style.strokeWidth), shadow: false });
  }
  const items: Item[] = [{ id: el.id, opacity: el.style.opacity, tf: { x: el.x + m.tx, y: el.y + m.ty, w: el.w, h: el.h, rot: el.rotation + m.rot }, parts }];
  if (el.text && !hideLabel) {
    items.push({ id: el.id + ':label', opacity: el.style.opacity, tf: { x: el.x + m.text.tx, y: el.y + m.text.ty, w: el.w, h: el.h, rot: el.rotation + m.text.rot }, parts: labelParts(el, g.textBox, true) });
  }
  return items;
}

function textItems(el: TextElement, m: Motion, hide: boolean): Item[] {
  if (hide) return [];
  return [{ id: el.id, opacity: el.style.opacity, tf: { x: el.x + m.text.tx, y: el.y + m.text.ty, w: el.w, h: el.h, rot: el.rotation + m.text.rot }, parts: labelParts(el, { x: 0, y: 0, w: el.w, h: el.h }, true) }];
}

function smoothPoints(pts: Point[]): Point[] {
  if (pts.length < 3) return pts;
  // Chaikin smoothing once for pleasant freehand strokes
  const out: Point[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function freehandItems(el: FreehandElement, m: Motion, loopLen: number | null): Item[] {
  const f = field(el, m, loopLen);
  const pts = smoothPoints(el.points.map(([x, y]) => ({ x: x * el.w, y: y * el.h })));
  const flat: number[] = [];
  for (const p of pts) {
    const [dx, dy] = displace(f, p.x, p.y);
    flat.push(p.x + dx, p.y + dy);
  }
  if (flat.length === 2) flat.push(flat[0] + 0.01, flat[1]);
  return [{
    id: el.id, opacity: el.style.opacity, tf: { x: el.x + m.tx, y: el.y + m.ty, w: el.w, h: el.h, rot: el.rotation + m.rot },
    parts: [{ k: 'line', pts: flat, color: el.style.stroke, width: el.style.strokeWidth, alpha: 1, cap: el.highlighter ? 'butt' : 'round', dash: dashFor(el.style.strokeStyle, el.style.strokeWidth) }],
  }];
}

// ---- icons -----------------------------------------------------------------

const mulM = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];

/** Where an icon's label sits, in the icon's local coordinates (below or to the right of the icon). */
export function iconLabelLayout(el: IconElement, text = el.text): { box: Rect; ts: TextStyle } {
  const ts: TextStyle = { ...el.textStyle, align: el.labelPos === 'right' ? 'left' : 'center', vAlign: 'middle' };
  const lay = layoutText(text || ' ', ts, null);
  const w = lay.width + ts.padding * 2 + 4, h = lay.height + ts.padding * 2;
  if (el.labelPos === 'right') return { box: { x: el.w + 6, y: el.h / 2 - h / 2, w, h }, ts };
  return { box: { x: el.w / 2 - w / 2, y: el.h + 4, w, h }, ts };
}

const ellipseD = (w: number, h: number) => `M0 ${h / 2}a${w / 2} ${h / 2} 0 1 0 ${w} 0a${w / 2} ${h / 2} 0 1 0 ${-w} 0Z`;
const roundRectD = (w: number, h: number, r: number) =>
  `M${r} 0H${w - r}Q${w} 0 ${w} ${r}V${h - r}Q${w} ${h} ${w - r} ${h}H${r}Q0 ${h} 0 ${h - r}V${r}Q0 0 ${r} 0Z`;

function iconItems(doc: FlowDocument, el: IconElement, m: Motion, loopLen: number | null, hideLabel: boolean): Item[] {
  const icon = doc.icons[el.iconId];
  const f = field(el, m, loopLen);
  const seed = el.seed + m.boil * 7919;
  const parts: Part[] = [];
  if (el.frame !== 'none') {
    const d = el.frame === 'circle' ? ellipseD(el.w, el.h) : roundRectD(el.w, el.h, Math.min(el.w, el.h) * 0.2);
    parts.push({ k: 'sets', sets: warpSets(roughSets(`if${el.frame}${el.w.toFixed(1)}x${el.h.toFixed(1)}`, d, el.style, seed, true), f), stroke: el.style.stroke, fill: el.style.fill, sw: el.style.strokeWidth, fillWeight: Math.max(0.6, el.style.strokeWidth / 2), dash: dashFor(el.style.strokeStyle, el.style.strokeWidth), shadow: el.style.shadow });
  }
  if (icon) {
    // the glyph fills the box, or the middle 60% of it inside a background frame
    const inset = el.frame === 'none' ? 0 : 0.2;
    const bw = el.w * (1 - 2 * inset), bh = el.h * (1 - 2 * inset);
    const s = Math.min(bw / icon.w, bh / icon.h);
    const base: Matrix = [s, 0, 0, s, el.w * inset + (bw - icon.w * s) / 2, el.h * inset + (bh - icon.h * s) / 2];
    icon.parts.forEach((p, i) => {
      const paint = (c: IconPaint): PartPaint => (c === 'currentColor' ? el.style.stroke : typeof c === 'object' && c ? { ...c, box: p.bbox } : c);
      const mm = p.m ? mulM(base, p.m) : base;
      const fill = paint(p.fill), stroke = paint(p.stroke);
      if (el.sketch && icon.mono && (fill === null || typeof fill === 'string') && (stroke === null || typeof stroke === 'string')) {
        // hand-drawn (one-colour icons only, so both paints are plain colours): cached Rough.js geometry in icon units; wobble scaled into those units
        const style: Style = { ...el.style, stroke: stroke ?? 'transparent', fill: fill ?? 'transparent', fillStyle: fill ? 'solid' as const : 'none' as const, strokeWidth: p.strokeWidth, strokeStyle: 'solid' as const, roughness: 0.45 };
        const k = Math.max(1e-6, s * Math.hypot(p.m?.[0] ?? 1, p.m?.[1] ?? 0));
        const sets = warpSets(roughSets(`ic${el.iconId}#${i}`, p.d, style, seed + i, !!fill), { ...f, amp: f.amp / k, wavelength: f.wavelength / k });
        parts.push({ k: 'sets', sets, stroke: stroke ?? 'none', fill: fill ?? 'none', sw: stroke ? p.strokeWidth : 0, fillWeight: Math.max(0.5, p.strokeWidth / 2), dash: null, shadow: false, m: mm });
      } else {
        parts.push({ k: 'path', d: p.d, fill, stroke, width: p.strokeWidth, cap: p.linecap, join: p.linejoin, evenodd: p.evenodd, alpha: p.opacity, m: mm });
      }
    });
  } else {
    parts.push({ k: 'line', pts: [0, 0, el.w, 0, el.w, el.h, 0, el.h], color: '#999999', width: 1, alpha: 1, cap: 'butt', dash: [4, 4], closed: true });
  }
  const tf = { x: el.x + m.tx, y: el.y + m.ty, w: el.w, h: el.h, rot: el.rotation + m.rot };
  const items: Item[] = [{ id: el.id, opacity: el.style.opacity, tf, parts }];
  if (el.text && el.labelPos !== 'none' && !hideLabel) {
    const { box, ts } = iconLabelLayout(el);
    items.push({ id: el.id + ':label', opacity: el.style.opacity, tf: { x: el.x + m.text.tx, y: el.y + m.text.ty, w: el.w, h: el.h, rot: el.rotation + m.text.rot }, parts: labelParts({ ...el, textStyle: ts }, box, false) });
  }
  return items;
}

// ---- containers --------------------------------------------------------------

/** Height of a container's title bar. */
export const containerHeader = (el: { textStyle: TextStyle }) => Math.round(el.textStyle.fontSize * el.textStyle.lineHeight + 16);

function containerItems(el: ContainerElement, m: Motion, loopLen: number | null, hideLabel: boolean): Item[] {
  const f = field(el, m, loopLen);
  const seed = el.seed + m.boil * 7919;
  const r = Math.max(0, Math.min(el.style.cornerRadius, el.w / 2, el.h / 2));
  const d = r > 0 ? roundRectD(el.w, el.h, r) : `M0 0H${el.w}V${el.h}H0Z`;
  const head = Math.min(containerHeader(el), el.h);
  const sw = el.style.strokeWidth;
  const parts: Part[] = [
    { k: 'sets', sets: warpSets(roughSets(`ct${el.w.toFixed(1)}x${el.h.toFixed(1)}r${r}`, d, el.style, seed, true), f), stroke: el.style.stroke, fill: el.style.fill, sw, fillWeight: Math.max(0.6, sw / 2), dash: dashFor(el.style.strokeStyle, sw), shadow: el.style.shadow },
    // the line under the title bar
    { k: 'sets', sets: warpSets(roughSets(`cth${el.w.toFixed(1)}`, `M0 ${head}H${el.w}`, el.style, seed + 1, false), f), stroke: el.style.stroke, fill: 'none', sw, fillWeight: 1, dash: dashFor(el.style.strokeStyle, sw), shadow: false },
  ];
  const tf = { x: el.x + m.tx, y: el.y + m.ty, w: el.w, h: el.h, rot: m.rot };
  const items: Item[] = [{ id: el.id, opacity: el.style.opacity, tf, parts }];
  if (el.text && !hideLabel) {
    items.push({ id: el.id + ':label', opacity: el.style.opacity, tf: { x: el.x + m.text.tx, y: el.y + m.text.ty, w: el.w, h: el.h, rot: m.text.rot }, parts: labelParts({ ...el, textStyle: { ...el.textStyle, vAlign: 'middle' } }, { x: 0, y: 0, w: el.w, h: head }, true) });
  }
  return items;
}

// ---- connectors ------------------------------------------------------------

/** Hand-drawn wobble along the path, a function of arc length only (so trimming is stable). */
function wiggled(p: ConnectorPath, s0: number, s1: number, rough: number, seed: number): number[] {
  const pts = slice(p, s0, s1);
  if (pts.length < 2) return [];
  if (rough <= 0.01) return pts.flatMap((q) => [q.x, q.y]);
  const out: number[] = [];
  let s = s0;
  const ph1 = hash01(seed, 1) * 6.28, ph2 = hash01(seed, 2) * 6.28;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const { tan } = pointAt(p, s);
    const taper = Math.min(1, s / 14, (p.length - s) / 14);
    const off = rough * 1.1 * taper * (Math.sin(s / 37 + ph1) * 0.7 + Math.sin(s / 13 + ph2) * 0.3);
    out.push(pts[i].x - tan.y * off, pts[i].y + tan.x * off);
  }
  return out;
}

/** Soft glow drawn as wide translucent strokes (cheap everywhere, identical in canvas and SVG). */
function halo(pts: number[], color: string, sw: number, alpha: number): Part[] {
  return [
    { k: 'line', pts, color, width: sw + 9, alpha: alpha * 0.12, cap: 'round', dash: null },
    { k: 'line', pts, color, width: sw + 5, alpha: alpha * 0.2, cap: 'round', dash: null },
  ];
}

function headParts(kind: HeadKind, tip: Point, dir: Point, color: string, sw: number, scale = 1): Part[] {
  if (kind === 'none') return [];
  const size = Math.min(34, 9 + sw * 3) * scale;
  const rot = (v: Point, a: number) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
  const back = { x: -dir.x, y: -dir.y };
  if (kind === 'arrow' || kind === 'triangle') {
    const a = rot(back, 0.45), b = rot(back, -0.45);
    const p1 = { x: tip.x + a.x * size, y: tip.y + a.y * size }, p2 = { x: tip.x + b.x * size, y: tip.y + b.y * size };
    if (kind === 'arrow') return [{ k: 'line', pts: [p1.x, p1.y, tip.x, tip.y, p2.x, p2.y], color, width: sw, alpha: 1, cap: 'round', dash: null }];
    return [{ k: 'line', pts: [p1.x, p1.y, tip.x, tip.y, p2.x, p2.y], color, width: Math.max(1, sw * 0.8), alpha: 1, cap: 'round', dash: null, closed: true, fill: color }];
  }
  if (kind === 'dot') {
    const r = size * 0.32, pts: number[] = [];
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; pts.push(tip.x + back.x * r + Math.cos(a) * r, tip.y + back.y * r + Math.sin(a) * r); }
    return [{ k: 'line', pts, color, width: 1, alpha: 1, cap: 'round', dash: null, closed: true, fill: color }];
  }
  const n = { x: -dir.y * size * 0.45, y: dir.x * size * 0.45 };
  return [{ k: 'line', pts: [tip.x + n.x, tip.y + n.y, tip.x - n.x, tip.y - n.y], color, width: sw, alpha: 1, cap: 'round', dash: null }];
}

/**
 * Where a travelling highlight is within its cycle u (0..1): f = progress along its leg (0..1), back = on the
 * return leg. One-way (pause null): always outward. Round trip: out during the first (1 - pause) / 2, waits at
 * the far end for `pause`, then comes back; null while waiting.
 */
export function roundTripLeg(u: number, pause: number | null): { f: number; back: boolean } | null {
  if (pause === null) return { f: u, back: false };
  const legLen = (1 - pause) / 2;
  if (u < legLen) return { f: u / legLen, back: false };
  if (u < legLen + pause) return null;
  return { f: (u - legLen - pause) / legLen, back: true };
}

function connectorItems(doc: FlowDocument, c: ConnectorElement, t: number, lookup: Lookup, flags: PreviewFlags | undefined, background: string, hideLabel: boolean, cull?: Rect): Item[] {
  const path = connectorPath(c, lookup);
  if (path.length < 1) return [];
  if (cull) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of path.control) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    const m = 60;
    if (x1 + m < cull.x || x0 - m > cull.x + cull.w || y1 + m < cull.y || y0 - m > cull.y + cull.h) return [];
  }
  const st = c.style;
  const sw = st.strokeWidth;
  const anim = flags?.still ? { ...resolveConnectorAnim(doc.animation, c), mode: 'none' as const } : resolveConnectorAnim(doc.animation, c);
  const settings = doc.animation;
  const L = settings.seamless && settings.loop ? settings.duration : null;
  const tt = t; // connectors share the document clock so flow reads consistently
  const active = t >= anim.delay;
  const speed = anim.speed * settings.arrowSpeedScale;
  const trip = (hz: number) => (L ? snapFreq(hz, L) : hz);
  const parts: Part[] = [];
  const len = path.length;
  const range = (a: number, b: number) => (anim.direction === 'reverse' ? [len - b, len - a] : [a, b]);
  const shorten = (k: HeadKind) => (k === 'triangle' || k === 'dot' ? Math.min(34, 9 + sw * 3) * 0.55 : 0);
  let visible: [number, number] = [0, len];
  let pulse = 1;

  if (anim.mode === 'drawOn' && speed > 0) {
    const u = active ? fract((tt - anim.delay) * trip(speed)) : 0;
    const df = anim.drawFraction, pf = anim.pauseFraction;
    let a = 0, b = 0;
    if (u < df) b = easeInOut(u / df) * len;
    else if (u < 1 - pf) b = len;
    else if (anim.erase) { a = easeInOut((u - (1 - pf)) / Math.max(1e-6, pf)) * len; b = len; }
    else { a = 0; b = 0; }
    const r = range(a, b);
    visible = [r[0], r[1]];
  }
  const [va, vb] = visible;
  const startCut = va <= 0.001 ? shorten(c.startHead) : 0;
  const endCut = vb >= len - 0.001 ? shorten(c.endHead) : 0;
  const base = wiggled(path, va + startCut, vb - endCut, st.roughness, c.seed);

  const dash = dashFor(st.strokeStyle, sw);
  if (anim.mode === 'dash' && speed > 0) {
    const pat = dash ?? [sw * 4 + 6, sw * 3 + 6];
    const period = pat[0] + pat[1];
    const cycles = L ? Math.max(1, Math.round(speed * L * (len / period) * 0.25)) / L : speed * (len / period) * 0.25;
    const off = fract(tt * cycles) * period * (anim.direction === 'reverse' ? 1 : -1);
    if (base.length) parts.push({ k: 'line', pts: base, color: st.stroke, width: sw, alpha: 1, cap: 'round', dash: pat, dashOffset: off });
  } else if (base.length) {
    parts.push({ k: 'line', pts: base, color: st.stroke, width: sw, alpha: 1, cap: 'round', dash });
    if (st.roughness >= 2) parts.push({ k: 'line', pts: wiggled(path, va + startCut, vb - endCut, st.roughness * 0.6, c.seed + 99), color: st.stroke, width: Math.max(0.6, sw * 0.55), alpha: 0.7, cap: 'round', dash });
  }

  if (anim.mode === 'travel' && speed > 0 && active) {
    const hl = Math.min(anim.highlightLength, len);
    const n = Math.max(1, anim.segments);
    const roundTrip = anim.direction === 'roundTrip';
    // a round trip is one cycle (out, wait at the far end, back), so each leg moves at the one-way speed
    const u = fract((tt - anim.delay) * trip(roundTrip ? speed / 2 : speed));
    for (let i = 0; i < n; i++) {
      const leg = roundTripLeg(fract(u + i / n), roundTrip ? anim.turnPause : null);
      if (!leg) continue; // waiting at the far end
      const head = leg.f * (len + hl);
      const [a, b] = leg.back ? [len - head, len - head + hl] : range(head - hl, head);
      const pts = wiggled(path, Math.max(shorten(c.startHead) * 0.6, a), Math.min(len - shorten(c.endHead) * 0.6, b), st.roughness, c.seed);
      const color = leg.back ? anim.returnColor : anim.highlightColor;
      if (pts.length >= 4) {
        if (anim.glow) parts.push(...halo(pts, color, sw, anim.highlightOpacity));
        parts.push({ k: 'line', pts, color, width: sw + 1.5, alpha: anim.highlightOpacity, cap: anim.roundCaps ? 'round' : 'butt', dash: null });
      }
    }
  }
  if (anim.mode === 'pulse' && speed > 0) {
    const k = trip(speed);
    pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * k * tt);
    if (base.length) {
      if (anim.glow) parts.push(...halo(base, anim.highlightColor, sw, anim.highlightOpacity * pulse));
      parts.push({ k: 'line', pts: base, color: anim.highlightColor, width: sw + 1.5, alpha: anim.highlightOpacity * pulse, cap: 'round', dash: null });
    }
  }
  const headScale = anim.arrowPulse && anim.mode !== 'none' ? 1 + 0.18 * Math.sin(2 * Math.PI * trip(speed || 0.5) * tt) : 1;
  // heads: during draw-on the end head rides the leading edge
  if (vb - va > 0.5) {
    if (anim.mode === 'drawOn') {
      const leadS = anim.direction === 'reverse' ? va : vb;
      const atEnd = anim.direction === 'reverse' ? va <= 0.5 : vb >= len - 0.5;
      const lead = pointAt(path, leadS);
      const forward = anim.direction === 'reverse' ? { x: -lead.tan.x, y: -lead.tan.y } : lead.tan;
      const head = anim.direction === 'reverse' ? c.startHead : c.endHead;
      parts.push(...headParts(head, atEnd ? (anim.direction === 'reverse' ? path.pts[0] : path.pts[path.pts.length - 1]) : lead.pt, atEnd ? endTangent(path, anim.direction === 'reverse') : forward, st.stroke, sw, headScale));
      const tailHead = anim.direction === 'reverse' ? c.endHead : c.startHead;
      const tailVisible = anim.direction === 'reverse' ? vb >= len - 0.5 : va <= 0.5;
      if (tailVisible) parts.push(...headParts(tailHead, anim.direction === 'reverse' ? path.pts[path.pts.length - 1] : path.pts[0], endTangent(path, anim.direction !== 'reverse'), st.stroke, sw));
    } else {
      parts.push(...headParts(c.endHead, path.pts[path.pts.length - 1], endTangent(path, false), st.stroke, sw, headScale));
      parts.push(...headParts(c.startHead, path.pts[0], endTangent(path, true), st.stroke, sw, headScale));
    }
  }
  const items: Item[] = [{ id: c.id, opacity: st.opacity, tf: null, parts }];
  if (c.text && !hideLabel) {
    const { pt, tan } = pointAt(path, c.labelPos * len);
    const center = { x: pt.x - tan.y * c.labelOffset, y: pt.y + tan.x * c.labelOffset };
    const ts = c.textStyle;
    const lay = layoutText(c.text, ts, null);
    const w = lay.width + ts.padding * 2 + 4, h = lay.height + ts.padding * 2;
    const box = { x: center.x - w / 2, y: center.y - h / 2, w, h };
    const r = 6;
    const bg: Part = {
      k: 'line', color: background, width: 1, alpha: 0.92, cap: 'round', dash: null, closed: true, fill: background,
      pts: [box.x + r, box.y, box.x + w - r, box.y, box.x + w, box.y + r, box.x + w, box.y + h - r, box.x + w - r, box.y + h, box.x + r, box.y + h, box.x, box.y + h - r, box.x, box.y + r],
    };
    items.push({ id: c.id + ':label', opacity: st.opacity, tf: null, parts: [bg, ...labelParts(c, box, false)] });
  }
  return items;
}

export function computeMotions(doc: FlowDocument, t: number, flags?: PreviewFlags): Map<string, Motion> {
  const out = new Map<string, Motion>();
  for (const el of doc.elements) if (el.type !== 'connector') out.set(el.id, shapeMotion(doc.animation, el, t, flags));
  return out;
}

export function makeLookup(doc: FlowDocument, motions: Map<string, Motion> | null): Lookup {
  const byId = new Map<string, BoxElement>();
  for (const el of doc.elements) if (el.type !== 'connector') byId.set(el.id, el);
  return (id) => {
    const el = byId.get(id);
    return el ? { el, m: motions?.get(id) ?? STILL } : null;
  };
}

export function renderDocumentAtTime(doc: FlowDocument, t: number, opts: RenderOptions = {}): Frame {
  const motions = computeMotions(doc, t, opts.flags);
  const lookup = makeLookup(doc, motions);
  const loopLen = doc.animation.seamless && doc.animation.loop ? doc.animation.duration : null;
  const items: Item[] = [];
  for (const el of doc.elements) {
    if (opts.only && !opts.only.has(el.id)) continue;
    const hide = !!opts.hide?.has(el.id);
    const m = motions.get(el.id) ?? STILL;
    if (opts.cull && el.type !== 'connector') {
      const r = Math.hypot(el.w, el.h) / 2 + el.style.strokeWidth + 40;
      const cx = el.x + el.w / 2, cy = el.y + el.h / 2, c = opts.cull;
      if (cx + r < c.x || cx - r > c.x + c.w || cy + r < c.y || cy - r > c.y + c.h) continue;
    }
    switch (el.type) {
      case 'shape': items.push(...shapeItems(el, m, loopLen, hide)); break;
      case 'text': items.push(...textItems(el, m, hide)); break;
      case 'icon': items.push(...iconItems(doc, el, m, loopLen, hide)); break;
      case 'container': items.push(...containerItems(el, m, loopLen, hide)); break;
      case 'freehand': items.push(...freehandItems(el, m, loopLen)); break;
      case 'image':
        items.push({ id: el.id, opacity: el.style.opacity, tf: { x: el.x + m.tx, y: el.y + m.ty, w: el.w, h: el.h, rot: el.rotation + m.rot }, parts: [{ k: 'image', assetId: el.assetId, x: 0, y: 0, w: el.w, h: el.h }] });
        break;
      case 'connector': items.push(...connectorItems(doc, el, t, lookup, opts.flags, doc.canvas.background, hide, opts.cull)); break;
    }
  }
  return { items, time: t, background: doc.canvas.background };
}

// ---- bounds ----------------------------------------------------------------

export interface Rect { x: number; y: number; w: number; h: number }

export function boxCorners(el: BoxElement): Point[] {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2, a = (el.rotation * Math.PI) / 180;
  return [[0, 0], [el.w, 0], [el.w, el.h], [0, el.h]].map(([x, y]) => {
    const dx = x - el.w / 2, dy = y - el.h / 2;
    return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
  });
}

export function elementBounds(doc: FlowDocument, el: DiagramElement): Rect {
  let pts: Point[];
  if (el.type === 'connector') {
    const p = connectorPath(el, makeLookup(doc, null));
    pts = p.pts.length ? p.pts : [{ x: el.start.x, y: el.start.y }];
    const pad = Math.min(34, 9 + el.style.strokeWidth * 3);
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  }
  pts = boxCorners(el);
  if (el.type === 'icon' && el.text && el.labelPos !== 'none') {
    // include the label, which sits outside the icon's box
    const { box } = iconLabelLayout(el);
    pts = pts.concat(boxCorners({ ...el, x: el.x + box.x, y: el.y + box.y, w: box.w, h: box.h, rotation: 0 } as BoxElement));
  }
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  const pad = el.style.strokeWidth;
  return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
}

/** Static content bounds plus a safety margin for the maximum animated excursion. */
export function contentBounds(doc: FlowDocument, ids?: Set<string>): Rect | null {
  const els = doc.elements.filter((e) => !ids || ids.has(e.id));
  if (!els.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of els) {
    const b = elementBounds(doc, el);
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  const a = doc.animation.shape;
  const m = doc.animation.enabled ? (a.amplitude + a.deform) * (a.intensity / 2) * doc.animation.intensityScale + 4 : 2;
  return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
}
