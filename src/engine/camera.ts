// Camera moves (pure): while arrows play in order, the view zooms to each step (or group of nearby steps) and pulls
// back to the whole picture at the end of the loop. playSchedule (render.ts) decides when the camera moves; this file
// has the geometry: which steps share a shot, and where the camera is at a given moment.
import { easeInOut } from './noise';

export interface CamRect { x: number; y: number; w: number; h: number }
/** A camera keyframe: at loop phase `p` the camera shows `shot` (null = the whole picture). */
export interface CamKey { p: number; shot: CamRect | null }

/** Space kept round what a shot shows (px). */
export const SHOT_PAD = 70;
/** A shot never zooms in further than this: it shows at least this much of the diagram across (px, about five boxes). */
export const MIN_SHOT = 640;
/** Seconds the camera takes to move from one shot to the next. */
export const CAM_MOVE = 0.9;
/** Seconds on the whole picture at the start of the loop, before the camera moves in. */
export const CAM_OPEN = 1.0;
/** Seconds on the whole picture at the end of the loop, after pulling back. */
export const CAM_CLOSE = 0.4;

const union = (a: CamRect, b: CamRect): CamRect => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
const inside = (a: CamRect, b: CamRect) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;

/**
 * Which consecutive steps share a shot: a step whose area fits in the current shot, or grows it by at most 30 % each
 * way (or stays within the smallest view the camera shows, MIN_SHOT across, since moving there would hardly change the
 * view), joins it; otherwise a new shot starts. Returns the shot index of each step and each shot's area (padded).
 */
export function groupShots(areas: CamRect[]): { of: number[]; shots: CamRect[] } {
  const of: number[] = [], shots: CamRect[] = [];
  for (const a0 of areas) {
    const a = { x: a0.x - SHOT_PAD, y: a0.y - SHOT_PAD, w: a0.w + 2 * SHOT_PAD, h: a0.h + 2 * SHOT_PAD };
    const cur = shots[shots.length - 1];
    if (cur) {
      const u = union(cur, a);
      // the smallest view the camera shows (for a landscape output, about 16:9): growing within it changes nothing
      const maxW = Math.max(cur.w * 1.3, MIN_SHOT), maxH = Math.max(cur.h * 1.3, (MIN_SHOT * 9) / 16);
      if (inside(a, cur) || (u.w <= maxW && u.h <= maxH)) { shots[shots.length - 1] = u; of.push(shots.length - 1); continue; }
    }
    shots.push(a);
    of.push(shots.length - 1);
  }
  return { of, shots };
}

/** Grow `r` round its centre to the aspect ratio `aspect` (w / h). */
export function toAspect(r: CamRect, aspect: number): CamRect {
  if (r.w / r.h > aspect) { const h = r.w / aspect; return { x: r.x, y: r.y + r.h / 2 - h / 2, w: r.w, h }; }
  const w = r.h * aspect;
  return { x: r.x + r.w / 2 - w / 2, y: r.y, w, h: r.h };
}

/**
 * What a shot shows in an output of the given aspect ratio, within the whole picture `base` (already that aspect):
 * the shot's area at that aspect, at least MIN_SHOT across, no bigger than the whole picture, and kept inside
 * it where it fits, so the camera never shows empty space beside the diagram that the whole picture doesn't.
 */
export function frameShot(shot: CamRect | null, base: CamRect, aspect: number): CamRect {
  if (!shot) return base;
  let r = toAspect(shot, aspect);
  const min = MIN_SHOT;
  if (r.w < min) r = toAspect({ x: r.x + r.w / 2 - min / 2, y: r.y + r.h / 2, w: min, h: 0.0001 }, aspect);
  if (r.w >= base.w || r.h >= base.h) return base;
  const x = Math.min(Math.max(r.x, base.x), base.x + base.w - r.w), y = Math.min(Math.max(r.y, base.y), base.y + base.h - r.h);
  return { x, y, w: r.w, h: r.h };
}

/**
 * Where the camera is at loop phase p (0..1): between two keyframes it eases from one shot to the next, moving the
 * centre smoothly and changing the zoom evenly (in log scale, so zooming in and out feel the same speed).
 */
export function cameraAt(keys: CamKey[], p: number, base: CamRect, aspect: number): CamRect {
  if (!keys.length) return base;
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1].p <= p) i++;
  const a = frameShot(keys[i].shot, base, aspect);
  const next = keys[i + 1];
  if (!next || next.shot === keys[i].shot) return a;
  const b = frameShot(next.shot, base, aspect);
  const f = easeInOut(Math.min(1, Math.max(0, (p - keys[i].p) / Math.max(1e-9, next.p - keys[i].p))));
  const w = Math.exp(Math.log(a.w) + (Math.log(b.w) - Math.log(a.w)) * f), h = w / aspect;
  const cx = a.x + a.w / 2 + (b.x + b.w / 2 - (a.x + a.w / 2)) * f, cy = a.y + a.h / 2 + (b.y + b.h / 2 - (a.y + a.h / 2)) * f;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
