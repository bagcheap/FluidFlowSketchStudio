// Deterministic, continuous, loop-aware noise.
// All temporal frequencies are snapped to integer cycles per loop when a loop length is given,
// so position AND velocity are identical at t=0 and t=L (seamless loops).

/** Hash (seed, i) -> [0,1). Pure, no state. */
export function hash01(seed: number, i: number): number {
  let h = (seed ^ Math.imul(i + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

const TAU = Math.PI * 2;

/** Snap a frequency (Hz) so that an integer number of cycles fits in loopLen seconds. */
export function snapFreq(hz: number, loopLen: number | null): number {
  if (!loopLen || hz <= 0) return hz;
  return Math.max(1, Math.round(hz * loopLen)) / loopLen;
}

/**
 * Smooth 1-D noise in roughly [-1, 1]. Layered harmonics with seeded phases.
 * smoothness 1 = a single pure wave; 0 = richer, more organic.
 */
export function loopNoise(seed: number, channel: number, t: number, hz: number, smoothness: number, loopLen: number | null): number {
  if (hz <= 0) return 0;
  const f = snapFreq(hz, loopLen);
  const rough = 1 - Math.min(1, Math.max(0, smoothness));
  const amps = [1, 0.55 * rough, 0.3 * rough];
  let sum = 0;
  let norm = 0;
  for (let m = 0; m < 3; m++) {
    const a = amps[m];
    if (a === 0) continue;
    const ph = hash01(seed, channel * 13 + m) * TAU;
    // harmonics are integer multiples of f, so periodicity is preserved
    sum += a * Math.sin(TAU * f * (m + 1) * t + ph);
    norm += a;
  }
  return norm ? sum / norm : 0;
}

export interface DeformField {
  amp: number;
  seed: number;
  t: number;
  hz: number;
  wavelength: number; // px
  loopLen: number | null;
}

/** Smooth 2-D displacement field, periodic in time. Returns [dx, dy]. */
export function displace(f: DeformField, x: number, y: number): [number, number] {
  if (f.amp === 0) return [0, 0];
  const k = TAU / f.wavelength;
  const base = snapFreq(f.hz, f.loopLen);
  let dx = 0;
  let dy = 0;
  for (let j = 0; j < 3; j++) {
    const th = hash01(f.seed, 100 + j) * TAU;
    const th2 = hash01(f.seed, 200 + j) * TAU;
    const ph = hash01(f.seed, 300 + j) * TAU;
    const ph2 = hash01(f.seed, 400 + j) * TAU;
    const w = TAU * base * (j === 2 ? 2 : 1) * f.t;
    const kj = k * (1 + j * 0.6);
    dx += Math.sin(kj * (Math.cos(th) * x + Math.sin(th) * y) + w + ph);
    dy += Math.sin(kj * (Math.cos(th2) * x + Math.sin(th2) * y) - w + ph2);
  }
  return [(dx / 3) * f.amp, (dy / 3) * f.amp];
}

/** Hermite smoothstep */
export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

export const fract = (x: number) => x - Math.floor(x);
