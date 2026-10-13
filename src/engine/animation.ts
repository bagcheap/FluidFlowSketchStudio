// Animation model: resolves the inheritance chain (document defaults -> per-object overrides
// -> playback preview flags) and computes per-element motion at a timestamp. Pure functions.
import type { AnimationSettings, ConnectorAnim, ConnectorElement, DiagramElement, ShapeAnim } from '../model/types';
import { hash01, loopNoise, smoothstep } from './noise';

export interface PreviewFlags {
  /** Freeze all motion (e.g. reduced motion, or "animation off" preview). */
  still?: boolean;
  /** Element ids whose motion is suspended (being dragged/resized). */
  suspended?: Set<string>;
}

export function resolveShapeAnim(settings: AnimationSettings, el: DiagramElement): ShapeAnim {
  const base = settings.shape;
  const ov = el.type !== 'connector' ? el.anim : undefined;
  const a: ShapeAnim = ov ? { ...base, ...ov } : { ...base };
  if (!settings.enabled || !settings.animateShapes || settings.reducedMotion) a.mode = 'off';
  return a;
}

export function resolveConnectorAnim(settings: AnimationSettings, el: ConnectorElement): ConnectorAnim {
  const a: ConnectorAnim = el.anim ? { ...settings.connector, ...el.anim } : { ...settings.connector };
  if (!settings.enabled || !settings.animateConnectors || settings.reducedMotion) a.mode = 'none';
  return a;
}

/** Phase offset (fraction of loop) for an element. */
export function phaseOf(settings: AnimationSettings, el: DiagramElement, explicit: number): number {
  if (settings.synchronize) return explicit;
  return explicit + (settings.randomizePhases ? hash01(el.seed, 7) : 0);
}

export interface Motion {
  tx: number;
  ty: number;
  rot: number; // degrees
  deform: number; // px amplitude of outline displacement field
  deformHz: number;
  wavelength: number;
  boil: number; // seed variant index
  tt: number; // phased time
  text: { tx: number; ty: number; rot: number };
}

export const STILL: Motion = { tx: 0, ty: 0, rot: 0, deform: 0, deformHz: 0, wavelength: 100, boil: 0, tt: 0, text: { tx: 0, ty: 0, rot: 0 } };

export function shapeMotion(settings: AnimationSettings, el: DiagramElement, t: number, flags?: PreviewFlags): Motion {
  if (flags?.still || flags?.suspended?.has(el.id)) return STILL;
  const a = resolveShapeAnim(settings, el);
  if (a.mode === 'off') return STILL;
  const scale = (a.intensity / 2) * settings.intensityScale;
  if (scale <= 0) return STILL;
  const L = settings.seamless && settings.loop ? settings.duration : null;
  const tt = t + phaseOf(settings, el, a.phase) * settings.duration;
  const ramp = a.delay > 0 ? smoothstep(a.delay, a.delay + 0.6, t) : 1;
  const hz = a.speed * settings.speedScale;
  const s = el.seed;
  const sm = a.smoothness;
  const float = a.mode === 'float' || a.mode === 'combined';
  const sway = a.mode === 'sway' || a.mode === 'combined';
  const wob = a.mode === 'wobble' || a.mode === 'combined';
  const amp = a.amplitude * scale * ramp;
  const tx = float ? loopNoise(s, 1, tt, hz, sm, L) * amp : 0;
  const ty = float ? loopNoise(s, 2, tt, hz * 0.83, sm, L) * amp : 0;
  const rot = sway ? loopNoise(s, 3, tt, hz * 0.7, sm, L) * a.rotation * scale * ramp : 0;
  let deform = wob ? a.deform * scale * ramp : 0;
  let boil = 0;
  if (a.mode === 'boil') {
    const rate = Math.max(0.5, hz * 22);
    const r = L ? Math.max(1, Math.round(rate * L)) / L : rate;
    boil = Math.floor(tt * r) % 3;
    deform = a.deform * scale * 0.25 * ramp;
  }
  let text = { tx, ty, rot };
  if (a.textMotion === 'stable') text = { tx: 0, ty: 0, rot: 0 };
  else if (a.textMotion === 'independent') {
    text = { tx: loopNoise(s, 11, tt, hz, 1, L) * amp * 0.6, ty: loopNoise(s, 12, tt, hz, 1, L) * amp * 0.6, rot: 0 };
  }
  return { tx, ty, rot, deform, deformHz: hz * 0.9, wavelength: 70 + sm * 150, boil, tt, text };
}
