// Draws a Frame to a 2D canvas. Used by the live editor AND every raster export.
import type { Frame, Item, Part } from './render';
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

function drawPart(ctx: Ctx, p: Part, images: Map<string, ImageSource>) {
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
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
