// Frame -> standalone SVG string (true vector output: paths + text, no bitmaps except raster images).
import type { Asset } from '../model/types';
import type { Frame, Part, PartPaint, Rect } from './render';
import { opsToD } from './rough';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => Math.round(v * 100) / 100;

function fontAttrs(font: string): string {
  // font: "[italic ]<weight> <size>px <family>"
  const m = /^(italic )?(\d+) ([\d.]+)px (.+)$/.exec(font);
  if (!m) return `font-family="sans-serif"`;
  return `font-family="${esc(m[4])}" font-size="${m[3]}" font-weight="${m[2]}"${m[1] ? ' font-style="italic"' : ''}`;
}

const mtx = (m: number[]) => `matrix(${m.map(n).join(' ')})`;

/** An SVG paint attribute value; gradients are written into `grads` (as <defs> content) and referenced by id. */
function paintSvg(c: PartPaint, grads: string[]): string {
  if (!c) return 'none';
  if (typeof c === 'string') return esc(c);
  const id = `fsg${grads.length + 1}`;
  const stops = c.stops.map((s) => `<stop offset="${n(s.offset)}" stop-color="${esc(s.color)}"${s.opacity < 1 ? ` stop-opacity="${n(s.opacity)}"` : ''}/>`).join('');
  const units = c.bbox ? 'objectBoundingBox' : 'userSpaceOnUse';
  const tf = c.m ? ` gradientTransform="${mtx(c.m)}"` : '';
  grads.push(c.type === 'linear'
    ? `<linearGradient id="${id}" gradientUnits="${units}" x1="${n(c.x1)}" y1="${n(c.y1)}" x2="${n(c.x2)}" y2="${n(c.y2)}"${tf}>${stops}</linearGradient>`
    : `<radialGradient id="${id}" gradientUnits="${units}" cx="${n(c.cx)}" cy="${n(c.cy)}" r="${n(c.r)}" fx="${n(c.fx)}" fy="${n(c.fy)}"${tf}>${stops}</radialGradient>`);
  return `url(#${id})`;
}

function partSvg(p: Part, assets: Record<string, Asset>, defs: Set<string>, grads: string[]): string {
  if (p.k === 'sets' && p.m) { const inner = partSvg({ ...p, m: undefined }, assets, defs, grads); return inner ? `<g transform="${mtx(p.m)}">${inner}</g>` : ''; }
  switch (p.k) {
    case 'path': {
      if (!p.fill && !(p.stroke && p.width > 0)) return '';
      return `<path d="${esc(p.d)}" transform="${mtx(p.m)}" fill="${paintSvg(p.fill, grads)}"${p.evenodd ? ' fill-rule="evenodd"' : ''}${p.stroke && p.width > 0 ? ` stroke="${paintSvg(p.stroke, grads)}" stroke-width="${n(p.width)}" stroke-linecap="${p.cap}" stroke-linejoin="${p.join}"` : ''}${p.alpha < 1 ? ` opacity="${n(p.alpha)}"` : ''}/>`;
    }
    case 'sets': {
      let s = '';
      for (const set of p.sets) {
        const d = opsToD(set.ops);
        if (set.type === 'fillPath') {
          if (p.fill === 'none' || p.fill === 'transparent') continue;
          if (p.shadow) defs.add('shadow');
          s += `<path d="${d}" fill="${esc(p.fill)}" fill-rule="evenodd" stroke="none"${p.shadow ? ' filter="url(#fs-shadow)"' : ''}/>`;
        } else if (set.type === 'fillSketch') {
          if (p.fill === 'none' || p.fill === 'transparent') continue;
          s += `<path d="${d}" fill="none" stroke="${esc(p.fill)}" stroke-width="${n(p.fillWeight)}" stroke-linecap="round"/>`;
        } else if (p.sw > 0) {
          s += `<path d="${d}" fill="none" stroke="${esc(p.stroke)}" stroke-width="${n(p.sw)}" stroke-linecap="round" stroke-linejoin="round"${p.dash ? ` stroke-dasharray="${p.dash.map(n).join(' ')}"` : ''}/>`;
        }
      }
      return s;
    }
    case 'line': {
      if (p.pts.length < 4) return '';
      let d = `M${n(p.pts[0])} ${n(p.pts[1])}`;
      for (let i = 2; i < p.pts.length; i += 2) d += `L${n(p.pts[i])} ${n(p.pts[i + 1])}`;
      if (p.closed) d += 'Z';
      return `<path d="${d}" fill="${p.fill ? esc(p.fill) : 'none'}" stroke="${esc(p.color)}" stroke-width="${n(p.width)}" stroke-linecap="${p.cap}" stroke-linejoin="round"${p.alpha < 1 ? ` opacity="${n(p.alpha)}"` : ''}${p.dash ? ` stroke-dasharray="${p.dash.map(n).join(' ')}" stroke-dashoffset="${n(p.dashOffset ?? 0)}"` : ''}/>`;
    }
    case 'text': {
      const anchor = p.align === 'left' ? 'start' : p.align === 'right' ? 'end' : 'middle';
      return p.lines.map((l) => `<text x="${n(l.x)}" y="${n(l.y)}" ${fontAttrs(p.font)} fill="${esc(p.color)}" text-anchor="${anchor}" dominant-baseline="central" xml:space="preserve">${esc(l.t)}</text>`).join('');
    }
    case 'image': {
      const a = assets[p.assetId];
      if (!a) return '';
      return `<image href="${a.dataUrl}" x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="none"/>`;
    }
  }
}

export interface SvgOptions {
  rect: Rect;
  background: string | null;
  assets: Record<string, Asset>;
  fontCss?: string; // optional embedded @font-face rules
  title?: string;
}

export function frameToSvg(frame: Frame, o: SvgOptions): string {
  const defs = new Set<string>();
  const grads: string[] = [];
  const body = frame.items.map((it) => {
    const inner = it.parts.map((p) => partSvg(p, o.assets, defs, grads)).join('');
    if (!inner) return '';
    const op = it.opacity < 1 ? ` opacity="${n(it.opacity)}"` : '';
    if (!it.tf) return `<g${op}>${inner}</g>`;
    const { x, y, w, h, rot } = it.tf;
    const tr = `translate(${n(x)} ${n(y)})${rot ? ` rotate(${n(rot)} ${n(w / 2)} ${n(h / 2)})` : ''}`;
    return `<g transform="${tr}"${op}>${inner}</g>`;
  }).join('\n');
  const { x, y, w, h } = o.rect;
  let defsStr = '';
  if (defs.has('shadow')) defsStr += '<filter id="fs-shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#0f172a" flood-opacity="0.18"/></filter>';
  defsStr += grads.join('');
  if (o.fontCss) defsStr += `<style>${o.fontCss}</style>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}" width="${Math.round(w)}" height="${Math.round(h)}">
${o.title ? `<title>${esc(o.title)}</title>` : ''}${defsStr ? `<defs>${defsStr}</defs>` : ''}
${o.background ? `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${esc(o.background)}"/>` : ''}
${body}
</svg>`;
}
