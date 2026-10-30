// SVG → IconAsset: an allowlist projection. The SVG is parsed as XML (DOMParser never runs scripts),
// then only geometry (path, rect, circle, ellipse, line, polyline, polygon inside svg/g) and plain paint
// are read. Everything else (scripts, links, <use>, images, fonts, CSS, event handlers) is never copied.
// The result goes through sanitizeIconAsset, the same check that runs when a file is opened.
import type { IconAsset, IconPart } from '../model/types';
import { sanitizeIconAsset } from '../model/schema';

type M = [number, number, number, number, number, number];
const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const isIdentity = (m: M) => m.every((v, i) => Math.abs(v - ID[i]) < 1e-9);

export function parseTransform(s: string | null): M {
  let m = ID;
  if (!s) return m;
  for (const [, fn, args] of s.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number);
    if (a.some((n) => !Number.isFinite(n))) continue;
    const rad = (deg: number) => (deg * Math.PI) / 180;
    let t: M = ID;
    if (fn === 'matrix' && a.length === 6) t = a as M;
    else if (fn === 'translate') t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === 'scale') t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const r = rad(a[0] ?? 0), c = Math.cos(r), sn = Math.sin(r), cx = a[1] ?? 0, cy = a[2] ?? 0;
      t = mul(mul([1, 0, 0, 1, cx, cy], [c, sn, -sn, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (fn === 'skewX') t = [1, 0, Math.tan(rad(a[0] ?? 0)), 1, 0, 0];
    else if (fn === 'skewY') t = [1, Math.tan(rad(a[0] ?? 0)), 0, 1, 0, 0];
    m = mul(m, t);
  }
  return m;
}

interface Paint { fill: string | null; stroke: string | null; strokeWidth: number; linecap: IconPart['linecap']; linejoin: IconPart['linejoin']; evenodd: boolean; opacity: number }
const PAINT_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform'] as const;

/** Presentation attributes plus the same properties from an inline style="…" (other CSS is ignored). */
function props(el: Element): Partial<Record<(typeof PAINT_PROPS)[number], string>> {
  const out: Partial<Record<(typeof PAINT_PROPS)[number], string>> = {};
  for (const p of PAINT_PROPS) { const v = el.getAttribute(p); if (v !== null) out[p] = v.trim(); }
  for (const decl of (el.getAttribute('style') ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const k = decl.slice(0, i).trim() as (typeof PAINT_PROPS)[number];
    if ((PAINT_PROPS as readonly string[]).includes(k) && k !== 'transform') out[k] = decl.slice(i + 1).trim();
  }
  return out;
}

const num = (v: string | null | undefined, d = 0) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : d; };
const f = (n: number) => +n.toFixed(4);

/** A colour from the SVG; gradients become their first stop colour (good enough for icons). */
function color(v: string | undefined, inherited: string | null, doc: Document): string | null {
  if (v === undefined || v === 'inherit') return inherited;
  if (v === 'none' || v === 'transparent') return null;
  const ref = /^url\(\s*#([\w.-]+)\s*\)/.exec(v);
  if (ref) {
    const stop = doc.getElementById(ref[1])?.querySelector('stop');
    const sc = stop?.getAttribute('stop-color') ?? /stop-color\s*:\s*([^;]+)/.exec(stop?.getAttribute('style') ?? '')?.[1];
    return sc ? sc.trim() : inherited;
  }
  return v;
}

function geometry(el: Element): string | null {
  const a = (n: string) => num(el.getAttribute(n));
  switch (el.localName) {
    case 'path': return el.getAttribute('d');
    case 'rect': {
      const x = a('x'), y = a('y'), w = a('width'), h = a('height');
      if (w <= 0 || h <= 0) return null;
      let rx = el.hasAttribute('rx') ? a('rx') : a('ry'), ry = el.hasAttribute('ry') ? a('ry') : rx;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (rx <= 0 || ry <= 0) return `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}Z`;
      return `M${f(x + rx)} ${f(y)}h${f(w - 2 * rx)}a${f(rx)} ${f(ry)} 0 0 1 ${f(rx)} ${f(ry)}v${f(h - 2 * ry)}a${f(rx)} ${f(ry)} 0 0 1 ${f(-rx)} ${f(ry)}h${f(2 * rx - w)}a${f(rx)} ${f(ry)} 0 0 1 ${f(-rx)} ${f(-ry)}v${f(2 * ry - h)}a${f(rx)} ${f(ry)} 0 0 1 ${f(rx)} ${f(-ry)}Z`;
    }
    case 'circle':
    case 'ellipse': {
      const cx = a('cx'), cy = a('cy');
      const rx = el.localName === 'circle' ? a('r') : a('rx'), ry = el.localName === 'circle' ? a('r') : a('ry');
      if (rx <= 0 || ry <= 0) return null;
      return `M${f(cx - rx)} ${f(cy)}a${f(rx)} ${f(ry)} 0 1 0 ${f(2 * rx)} 0a${f(rx)} ${f(ry)} 0 1 0 ${f(-2 * rx)} 0Z`;
    }
    case 'line': return `M${f(a('x1'))} ${f(a('y1'))}L${f(a('x2'))} ${f(a('y2'))}`;
    case 'polyline':
    case 'polygon': {
      const n = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
      if (n.length < 4) return null;
      let d = `M${f(n[0])} ${f(n[1])}`;
      for (let i = 2; i + 1 < n.length; i += 2) d += `L${f(n[i])} ${f(n[i + 1])}`;
      return el.localName === 'polygon' ? d + 'Z' : d;
    }
    default: return null;
  }
}

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const CONTAINERS = new Set(['svg', 'g']);

/** Convert SVG markup to an icon. Throws if the markup is not an SVG or contains nothing drawable. */
export function svgToIcon(svg: string, meta: { id: string; name: string; set: string; license: string }): IconAsset {
  if (svg.length > 2_000_000) throw new Error('This SVG is too large to use as an icon.');
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error('This file is not a valid SVG.');
  const vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const [minX, minY, w, h] = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0
    ? vb : [0, 0, num(root.getAttribute('width'), 24), num(root.getAttribute('height'), 24)];
  const parts: IconPart[] = [];
  let visited = 0;
  const walk = (el: Element, paint: Paint, m: M) => {
    if (++visited > 5000 || parts.length >= 500) return;
    const p = props(el);
    const fill = color(p.fill, paint.fill, doc), stroke = color(p.stroke, paint.stroke, doc);
    const op = num(p.opacity, 1);
    const fillOnly = (stroke === null) ? num(p['fill-opacity'], 1) : 1;
    const strokeOnly = (fill === null) ? num(p['stroke-opacity'], 1) : 1;
    const next: Paint = {
      fill, stroke,
      strokeWidth: p['stroke-width'] !== undefined ? num(p['stroke-width'], paint.strokeWidth) : paint.strokeWidth,
      linecap: (['butt', 'round', 'square'] as const).find((v) => v === p['stroke-linecap']) ?? paint.linecap,
      linejoin: (['miter', 'round', 'bevel'] as const).find((v) => v === p['stroke-linejoin']) ?? paint.linejoin,
      evenodd: p['fill-rule'] ? p['fill-rule'] === 'evenodd' : paint.evenodd,
      opacity: paint.opacity * op * fillOnly * strokeOnly,
    };
    const mm = el === root ? m : mul(m, parseTransform(el.getAttribute('transform') ?? p.transform ?? null));
    if (CONTAINERS.has(el.localName)) {
      for (const c of Array.from(el.children)) walk(c, next, mm);
      return;
    }
    if (!SHAPES.has(el.localName)) return; // defs, use, image, text, script, foreignObject, style, a, …: dropped
    const d = geometry(el);
    if (!d || (next.fill === null && next.stroke === null)) return;
    parts.push({ d, ...next, ...(isIdentity(mm) ? {} : { m: mm }) });
  };
  const rootPaint: Paint = { fill: '#000000', stroke: null, strokeWidth: 1, linecap: 'butt', linejoin: 'miter', evenodd: false, opacity: 1 };
  walk(root, rootPaint, minX || minY ? [1, 0, 0, 1, -minX, -minY] : ID);
  const icon = sanitizeIconAsset({ ...meta, w, h, parts }, meta.id);
  if (!icon) throw new Error('This SVG has no shapes FlowSketch can use as an icon.');
  return icon;
}

/** Iconify JSON stores each icon as the inside of an <svg>; wrap it to convert. */
export function iconifyToSvg(body: string, w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}
