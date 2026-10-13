// Rough.js geometry cache. Sketch outlines are generated ONCE per (geometry, style, seed)
// and reused every frame; animation only warps the cached coordinates.
import { RoughGenerator } from 'roughjs/bin/generator';
import type { Op, OpSet } from 'roughjs/bin/core';
import type { Style } from '../model/types';

export type { Op, OpSet };

const gen = new RoughGenerator();
const cache = new Map<string, OpSet[]>();

export function roughSets(key: string, d: string, style: Style, seed: number, filled: boolean): OpSet[] {
  const k = `${key}|${d.length}|${style.stroke}|${style.fill}|${style.fillStyle}|${style.strokeWidth}|${style.roughness}|${style.strokeStyle}|${seed}|${filled}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const r = style.roughness;
  const precise = r <= 0.01;
  const sw = Math.max(0.5, style.strokeWidth);
  const fill = filled && style.fillStyle !== 'none' && style.fill !== 'transparent' ? style.fill : undefined;
  const drawable = gen.path(d, {
    seed,
    roughness: precise ? 0 : r,
    bowing: precise ? 0 : r,
    stroke: style.stroke,
    strokeWidth: sw,
    fill,
    fillStyle: style.fillStyle === 'none' ? 'solid' : style.fillStyle === 'cross-hatch' ? 'cross-hatch' : style.fillStyle,
    fillWeight: Math.max(0.6, sw / 2),
    hachureGap: sw * 3 + 4,
    hachureAngle: -41,
    disableMultiStroke: precise || style.strokeStyle !== 'solid',
    disableMultiStrokeFill: precise,
    preserveVertices: precise || r < 1.2,
    maxRandomnessOffset: 2,
    curveStepCount: 9,
  });
  const sets = drawable.sets;
  if (cache.size > 4000) cache.clear();
  cache.set(k, sets);
  return sets;
}

export function opsToD(ops: Op[]): string {
  const f = (n: number) => Math.round(n * 100) / 100;
  let s = '';
  for (const o of ops) {
    const d = o.data;
    if (o.op === 'move') s += `M${f(d[0])} ${f(d[1])}`;
    else if (o.op === 'lineTo') s += `L${f(d[0])} ${f(d[1])}`;
    else s += `C${f(d[0])} ${f(d[1])} ${f(d[2])} ${f(d[3])} ${f(d[4])} ${f(d[5])}`;
  }
  return s;
}
