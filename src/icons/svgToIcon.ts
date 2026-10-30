// SVG → IconAsset: an allowlist projection. The SVG is parsed as XML (DOMParser never runs scripts),
// then only geometry (path, rect, circle, ellipse, line, polyline, polygon inside svg/g) and plain paint
// are read. Everything else (scripts, links, <use>, images, fonts, CSS, event handlers) is never copied.
// The result goes through sanitizeIconAsset, the same check that runs when a file is opened.
import type { IconAsset, IconGradient, IconPaint, IconPart } from '../model/types';
import { pathBBox } from './pathBounds';
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

interface Paint { fill: IconPaint; stroke: IconPaint; strokeWidth: number; linecap: IconPart['linecap']; linejoin: IconPart['linejoin']; evenodd: boolean; opacity: number }
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

const XLINK = 'http://www.w3.org/1999/xlink';
const hrefOf = (el: Element) => el.getAttribute('href') ?? el.getAttributeNS(XLINK, 'href');
const localRef = (h: string | null) => (h && /^#[\w.:-]+$/.test(h) ? h.slice(1) : null); // only references inside the same file

/** A linear or radial gradient, following href chains (common in logo files) for stops and defaults. */
function gradient(doc: Document, id: string, vbW: number, vbH: number): IconGradient | null {
  const chain: Element[] = [];
  for (let g = doc.getElementById(id); g && chain.length < 8 && !chain.includes(g) && (g.localName === 'linearGradient' || g.localName === 'radialGradient');
    g = (() => { const r = localRef(hrefOf(g)); return r ? doc.getElementById(r) : null; })()) chain.push(g);
  if (!chain.length) return null;
  const attr = (n: string) => { for (const e of chain) { const v = e.getAttribute(n); if (v !== null) return v; } return null; };
  const bbox = attr('gradientUnits') !== 'userSpaceOnUse';
  const len = (n: string, d: number, axis: 'x' | 'y' | 'r') => {
    const v = attr(n);
    const f = parseFloat(v ?? '');
    if (v === null || !Number.isFinite(f)) return d;
    if (!v.trim().endsWith('%')) return f;
    const frac = f / 100;
    return bbox ? frac : frac * (axis === 'x' ? vbW : axis === 'y' ? vbH : Math.hypot(vbW, vbH) / Math.SQRT2);
  };
  const full = (axis: 'x' | 'y' | 'r') => (bbox ? 1 : axis === 'x' ? vbW : axis === 'y' ? vbH : Math.hypot(vbW, vbH) / Math.SQRT2);
  const stopsOwner = chain.find((e) => e.getElementsByTagName('stop').length);
  const stops = Array.from(stopsOwner?.getElementsByTagName('stop') ?? []).slice(0, 32).map((st) => {
    const style = st.getAttribute('style') ?? '';
    const prop = (n: string) => st.getAttribute(n) ?? new RegExp(`${n}\\s*:\\s*([^;]+)`).exec(style)?.[1]?.trim() ?? null;
    const off = prop('offset') ?? '0';
    const o = parseFloat(off);
    return { offset: Math.min(1, Math.max(0, off.trim().endsWith('%') ? o / 100 : o || 0)), color: prop('stop-color') ?? '#000000', opacity: num(prop('stop-opacity'), 1) };
  });
  if (!stops.length) return null;
  const radial = chain[0].localName === 'radialGradient';
  const cx = len('cx', 0.5 * full('x'), 'x'), cy = len('cy', 0.5 * full('y'), 'y');
  const gt = parseTransform(attr('gradientTransform'));
  return {
    type: radial ? 'radial' : 'linear', bbox,
    x1: len('x1', 0, 'x'), y1: len('y1', 0, 'y'), x2: len('x2', full('x'), 'x'), y2: len('y2', 0, 'y'),
    cx, cy, r: len('r', 0.5 * full('r'), 'r'), fx: len('fx', cx, 'x'), fy: len('fy', cy, 'y'),
    stops,
    ...(isIdentity(gt) ? {} : { m: gt }),
  };
}

/** A paint from the SVG: none, a colour, or a gradient defined in the same file. */
function paint(v: string | undefined, inherited: IconPaint, doc: Document, vb: [number, number]): IconPaint {
  if (v === undefined || v === 'inherit') return inherited;
  if (v === 'none' || v === 'transparent') return null;
  const ref = /^url\(\s*['"]?#([\w.:-]+)['"]?\s*\)/.exec(v);
  if (ref) return gradient(doc, ref[1], vb[0], vb[1]) ?? inherited;
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
  const walk = (el: Element, inh: Paint, m: M, depth = 0) => {
    if (++visited > 5000 || parts.length >= 500 || depth > 8) return;
    const p = props(el);
    const fill = paint(p.fill, inh.fill, doc, [w, h]), stroke = paint(p.stroke, inh.stroke, doc, [w, h]);
    const op = num(p.opacity, 1);
    const fillOnly = (stroke === null) ? num(p['fill-opacity'], 1) : 1;
    const strokeOnly = (fill === null) ? num(p['stroke-opacity'], 1) : 1;
    const next: Paint = {
      fill, stroke,
      strokeWidth: p['stroke-width'] !== undefined ? num(p['stroke-width'], inh.strokeWidth) : inh.strokeWidth,
      linecap: (['butt', 'round', 'square'] as const).find((v) => v === p['stroke-linecap']) ?? inh.linecap,
      linejoin: (['miter', 'round', 'bevel'] as const).find((v) => v === p['stroke-linejoin']) ?? inh.linejoin,
      evenodd: p['fill-rule'] ? p['fill-rule'] === 'evenodd' : inh.evenodd,
      opacity: inh.opacity * op * fillOnly * strokeOnly,
    };
    const mm = el === root ? m : mul(m, parseTransform(el.getAttribute('transform') ?? p.transform ?? null));
    if (CONTAINERS.has(el.localName)) {
      for (const c of Array.from(el.children)) walk(c, next, mm, depth);
      return;
    }
    if (el.localName === 'use') {
      // <use> repeats a shape or group defined elsewhere in the same file (never an external file)
      const ref = localRef(hrefOf(el));
      const target = ref ? doc.getElementById(ref) : null;
      if (!target) return;
      const at = mul(mm, [1, 0, 0, 1, num(el.getAttribute('x')), num(el.getAttribute('y'))]);
      if (target.localName === 'symbol') for (const c of Array.from(target.children)) walk(c, next, at, depth + 1);
      else walk(target, next, at, depth + 1);
      return;
    }
    if (!SHAPES.has(el.localName)) return; // defs, use, image, text, script, foreignObject, style, a, …: dropped
    const d = geometry(el);
    if (!d || (next.fill === null && next.stroke === null)) return;
    const usesBox = [next.fill, next.stroke].some((c) => typeof c === 'object' && c !== null && c.bbox);
    const bb = usesBox ? pathBBox(d) : null;
    parts.push({ d, ...next, ...(isIdentity(mm) ? {} : { m: mm }), ...(bb ? { bbox: bb } : {}) });
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
