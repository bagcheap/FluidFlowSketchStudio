// Draws a Frame to a 2D canvas. Used by the live editor AND every raster export.
import type { Frame, Item, Part, PartPaint } from './render';
import type { Op } from './rough';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type ImageSource = CanvasImageSource;

export interface DrawOptions {
  images: Map<string, ImageSource>;
  /** world -> device: device = (world - origin) * scale */
  originX: number;
  originY: number;
  scale: number;
}

function tracePath(ctx: Ctx, ops: Op[]) {
  ctx.beginPath();
  for (const o of ops) {
    const d = o.data;
    if (o.op === 'move') ctx.moveTo(d[0], d[1]);
    else if (o.op === 'lineTo') ctx.lineTo(d[0], d[1]);
    else ctx.bezierCurveTo(d[0], d[1], d[2], d[3], d[4], d[5]);
  }
}

const paths = new Map<string, Path2D>();
function path2d(d: string): Path2D {
  let p = paths.get(d);
  if (!p) { p = new Path2D(d); if (paths.size > 3000) paths.clear(); paths.set(d, p); }
  return p;
}

/** A colour with extra opacity, for gradient stops ("#rgb"/"#rrggbb"; other colours keep full opacity). */
function withAlpha(color: string, a: number): string {
  if (a >= 1) return color;
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (!h) return color;
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const v = parseInt(full, 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

/** Fill a path with a colour or a gradient. Gradients are drawn in their own space (bounding box and
 * gradientTransform), with the path mapped into it, which matches SVG exactly. */
function fillPaint(ctx: Ctx, path: Path2D, paint: PartPaint, rule: CanvasFillRule) {
  if (!paint) return;
  if (typeof paint === 'string') { ctx.fillStyle = paint; ctx.fill(path, rule); return; }
  let m = new DOMMatrix();
  if (paint.bbox) {
    const b = paint.box;
    if (!b || b[2] <= 0 || b[3] <= 0) { ctx.fillStyle = paint.stops[0].color; ctx.fill(path, rule); return; }
    m = m.translate(b[0], b[1]).scale(b[2], b[3]);
  }
  if (paint.m) m = m.multiply(new DOMMatrix(paint.m));
  if (Math.abs(m.a * m.d - m.b * m.c) < 1e-12) return; // degenerate: nothing to draw
  const g = paint.type === 'linear' ? ctx.createLinearGradient(paint.x1, paint.y1, paint.x2, paint.y2) : ctx.createRadialGradient(paint.fx, paint.fy, 0, paint.cx, paint.cy, paint.r);
  let last = 0;
  for (const s of paint.stops) { last = Math.max(last, s.offset); g.addColorStop(last, withAlpha(s.color, s.opacity)); }
  ctx.save();
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  const mapped = new Path2D();
  mapped.addPath(path, m.inverse());
  ctx.fillStyle = g;
  ctx.fill(mapped, rule);
  ctx.restore();
}

/** Strokes use a gradient's first colour (gradient strokes are rare in icons). */
const strokeColor = (paint: PartPaint) => (typeof paint === 'object' && paint ? paint.stops[0].color : paint);

function drawPart(ctx: Ctx, p: Part, images: Map<string, ImageSource>) {
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  if ((p.k === 'sets' && p.m) || p.k === 'path') {
    ctx.save();
    ctx.transform(...p.m!);
    if (p.k === 'path') {
      ctx.globalAlpha *= p.alpha;
      const path = path2d(p.d);
      fillPaint(ctx, path, p.fill, p.evenodd ? 'evenodd' : 'nonzero');
      if (p.stroke && p.width > 0) { ctx.strokeStyle = strokeColor(p.stroke)!; ctx.lineWidth = p.width; ctx.lineCap = p.cap; ctx.lineJoin = p.join; ctx.stroke(path); }
    } else drawPart(ctx, { ...p, m: undefined }, images);
    ctx.restore();
    return;
  }
  switch (p.k) {
    case 'sets': {
      for (const s of p.sets) {
        if (s.type === 'fillPath') {
          if (p.fill === 'none' || p.fill === 'transparent') continue;
          tracePath(ctx, s.ops);
          if (p.shadow) { ctx.save(); ctx.shadowColor = 'rgba(15,23,42,0.18)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5; }
          ctx.fillStyle = p.fill;
          ctx.fill('evenodd');
          if (p.shadow) ctx.restore();
        } else if (s.type === 'fillSketch') {
          if (p.fill === 'none' || p.fill === 'transparent') continue;
          tracePath(ctx, s.ops);
          ctx.strokeStyle = p.fill; ctx.lineWidth = p.fillWeight; ctx.lineCap = 'round';
          ctx.stroke();
        } else {
          if (p.sw <= 0) continue;
          tracePath(ctx, s.ops);
          ctx.strokeStyle = p.stroke; ctx.lineWidth = p.sw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          if (p.dash) ctx.setLineDash(p.dash);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      break;
    }
    case 'line': {
      if (p.pts.length < 4) return;
      ctx.beginPath();
      ctx.moveTo(p.pts[0], p.pts[1]);
      for (let i = 2; i < p.pts.length; i += 2) ctx.lineTo(p.pts[i], p.pts[i + 1]);
      if (p.closed) ctx.closePath();
      ctx.save();
      ctx.globalAlpha *= p.alpha;
      if (p.fill) { ctx.fillStyle = p.fill; ctx.fill(); }
      ctx.strokeStyle = p.color; ctx.lineWidth = p.width; ctx.lineCap = p.cap; ctx.lineJoin = 'round';
      if (p.dash) { ctx.setLineDash(p.dash); ctx.lineDashOffset = p.dashOffset ?? 0; }
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'text': {
      ctx.font = p.font;
      ctx.fillStyle = p.color;
      ctx.textAlign = p.align;
      ctx.textBaseline = 'middle';
      for (const l of p.lines) ctx.fillText(l.t, l.x, l.y);
      break;
    }
    case 'image': {
      const img = images.get(p.assetId);
      if (img) ctx.drawImage(img, p.x, p.y, p.w, p.h);
      else { ctx.strokeStyle = '#999'; ctx.setLineDash([4, 4]); ctx.strokeRect(p.x, p.y, p.w, p.h); }
      break;
    }
  }
}

export function drawItem(ctx: Ctx, it: Item, images: Map<string, ImageSource>) {
  ctx.save();
  ctx.globalAlpha = it.opacity;
  if (it.tf) {
    const { x, y, w, h, rot } = it.tf;
    ctx.translate(x + w / 2, y + h / 2);
    if (rot) ctx.rotate((rot * Math.PI) / 180);
    ctx.translate(-w / 2, -h / 2);
  }
  for (const p of it.parts) drawPart(ctx, p, images);
  ctx.restore();
}

export function drawFrame(ctx: Ctx, frame: Frame, o: DrawOptions) {
  ctx.save();
  ctx.setTransform(o.scale, 0, 0, o.scale, -o.originX * o.scale, -o.originY * o.scale);
  for (const it of frame.items) drawItem(ctx, it, o.images);
  ctx.restore();
}
