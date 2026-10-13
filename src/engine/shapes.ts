// Shape outlines in local coordinates (0..w, 0..h). Each outline is produced as an
// SVG path (fed to Rough.js) and a sampled polygon (hit-testing, connector attachment).
import type { Point, ShapeElement, ShapeKind } from '../model/types';

type Map = (x: number, y: number) => [number, number];

class PathBuilder {
  d: string[] = [];
  poly: Point[] = [];
  private cur: [number, number] = [0, 0];
  constructor(private map: Map, private samplePoly = true) {}
  private fmt(n: number) { return Math.round(n * 100) / 100; }
  moveTo(x: number, y: number) {
    const [a, b] = this.map(x, y);
    this.d.push(`M${this.fmt(a)} ${this.fmt(b)}`);
    this.cur = [x, y];
    if (this.samplePoly) this.poly.push({ x: a, y: b });
    return this;
  }
  lineTo(x: number, y: number) {
    const [a, b] = this.map(x, y);
    this.d.push(`L${this.fmt(a)} ${this.fmt(b)}`);
    this.cur = [x, y];
    if (this.samplePoly) this.poly.push({ x: a, y: b });
    return this;
  }
  cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    const [a1, b1] = this.map(x1, y1);
    const [a2, b2] = this.map(x2, y2);
    const [a, b] = this.map(x, y);
    this.d.push(`C${this.fmt(a1)} ${this.fmt(b1)} ${this.fmt(a2)} ${this.fmt(b2)} ${this.fmt(a)} ${this.fmt(b)}`);
    if (this.samplePoly) {
      const [x0, y0] = this.cur;
      for (let i = 1; i <= 8; i++) {
        const t = i / 8, u = 1 - t;
        const px = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x;
        const py = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y;
        const [mx, my] = this.map(px, py);
        this.poly.push({ x: mx, y: my });
      }
    }
    this.cur = [x, y];
    return this;
  }
  /** Elliptical arc from angle a0 to a1 (radians, can be negative sweep), as cubic beziers. */
  arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number) {
    const segs = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
    const step = (a1 - a0) / segs;
    const k = (4 / 3) * Math.tan(step / 4);
    for (let i = 0; i < segs; i++) {
      const s = a0 + i * step, e = s + step;
      const x0 = cx + rx * Math.cos(s), y0 = cy + ry * Math.sin(s);
      const x3 = cx + rx * Math.cos(e), y3 = cy + ry * Math.sin(e);
      this.cubicTo(
        x0 - k * rx * Math.sin(s), y0 + k * ry * Math.cos(s),
        x3 + k * rx * Math.sin(e), y3 - k * ry * Math.cos(e),
        x3, y3,
      );
    }
    return this;
  }
  close() { this.d.push('Z'); return this; }
  str() { return this.d.join(' '); }
}

export interface ShapeGeometry {
  d: string; // closed outline
  poly: Point[]; // sampled outline (local)
  details: string[]; // stroke-only detail paths
  textBox: { x: number; y: number; w: number; h: number };
}

function roundRect(b: PathBuilder, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r < 0.5) return b.moveTo(0, 0).lineTo(w, 0).lineTo(w, h).lineTo(0, h).close();
  const H = Math.PI / 2;
  b.moveTo(r, 0).lineTo(w - r, 0).arc(w - r, r, r, r, -H, 0)
    .lineTo(w, h - r).arc(w - r, h - r, r, r, 0, H)
    .lineTo(r, h).arc(r, h - r, r, r, H, 2 * H)
    .lineTo(0, r).arc(r, r, r, r, 2 * H, 3 * H).close();
  return b;
}

function polygon(b: PathBuilder, pts: [number, number][]) {
  pts.forEach(([x, y], i) => (i === 0 ? b.moveTo(x, y) : b.lineTo(x, y)));
  return b.close();
}

const cache = new Map<string, ShapeGeometry>();

export function shapeGeometry(kind: ShapeKind, w: number, h: number, radius: number, flipX = false, flipY = false): ShapeGeometry {
  const key = `${kind}|${w.toFixed(2)}|${h.toFixed(2)}|${radius}|${flipX}|${flipY}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const map: Map = (x, y) => [flipX ? w - x : x, flipY ? h - y : y];
  const b = new PathBuilder(map);
  const details: string[] = [];
  let tb = { x: 0, y: 0, w, h };
  const m = Math.min(w, h);
  switch (kind) {
    case 'rectangle':
    case 'roundRect':
      roundRect(b, w, h, radius);
      break;
    case 'sticky': {
      const f = Math.min(m * 0.18, 26);
      polygon(b, [[0, 0], [w, 0], [w, h - f], [w - f, h], [0, h]]);
      const db = new PathBuilder(map, false);
      db.moveTo(w, h - f).lineTo(w - f, h - f).lineTo(w - f, h);
      details.push(db.str());
      tb = { x: 0, y: 0, w, h: h - f * 0.5 };
      break;
    }
    case 'pill':
      roundRect(b, w, h, m / 2);
      tb = { x: m * 0.2, y: 0, w: w - m * 0.4, h };
      break;
    case 'ellipse':
      b.moveTo(w, h / 2).arc(w / 2, h / 2, w / 2, h / 2, 0, Math.PI * 2).close();
      tb = { x: w * 0.15, y: h * 0.15, w: w * 0.7, h: h * 0.7 };
      break;
    case 'diamond':
      polygon(b, [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
      tb = { x: w * 0.22, y: h * 0.22, w: w * 0.56, h: h * 0.56 };
      break;
    case 'parallelogram': {
      const s = Math.min(w * 0.22, h * 0.6);
      polygon(b, [[s, 0], [w, 0], [w - s, h], [0, h]]);
      tb = { x: s * 0.7, y: 0, w: w - s * 1.4, h };
      break;
    }
    case 'trapezoid': {
      const s = Math.min(w * 0.2, h * 0.6);
      polygon(b, [[s, 0], [w - s, 0], [w, h], [0, h]]);
      tb = { x: s * 0.6, y: 0, w: w - s * 1.2, h };
      break;
    }
    case 'hexagon': {
      const s = Math.min(w * 0.25, h * 0.5);
      polygon(b, [[s, 0], [w - s, 0], [w, h / 2], [w - s, h], [s, h], [0, h / 2]]);
      tb = { x: s * 0.6, y: 0, w: w - s * 1.2, h };
      break;
    }
    case 'octagon': {
      const s = m * 0.29;
      polygon(b, [[s, 0], [w - s, 0], [w, s], [w, h - s], [w - s, h], [s, h], [0, h - s], [0, s]]);
      break;
    }
    case 'triangle':
      polygon(b, [[w / 2, 0], [w, h], [0, h]]);
      tb = { x: w * 0.22, y: h * 0.42, w: w * 0.56, h: h * 0.55 };
      break;
    case 'star': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 0.5 : 0.22;
        pts.push([w / 2 + Math.cos(a) * r * w, h * 0.53 + Math.sin(a) * r * h * 1.05]);
      }
      polygon(b, pts);
      tb = { x: w * 0.25, y: h * 0.3, w: w * 0.5, h: h * 0.45 };
      break;
    }
    case 'cloud': {
      const n = 9;
      const cx = w / 2, cy = h / 2, rx = w * 0.4, ry = h * 0.36;
      const P: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.3;
        P.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
      }
      b.moveTo(P[0][0], P[0][1]);
      for (let i = 0; i < n; i++) {
        const [x0, y0] = P[i];
        const [x1, y1] = P[(i + 1) % n];
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const ox = mx - cx, oy = my - cy;
        const len = Math.hypot(ox, oy) || 1;
        const bulge = Math.hypot(x1 - x0, y1 - y0) * 0.75;
        const nx = (ox / len) * bulge, ny = (oy / len) * bulge;
        b.cubicTo(x0 + nx * 0.9 + (x1 - x0) * 0.05, y0 + ny * 0.9 + (y1 - y0) * 0.05, x1 + nx * 0.9 - (x1 - x0) * 0.05, y1 + ny * 0.9 - (y1 - y0) * 0.05, x1, y1);
      }
      b.close();
      tb = { x: w * 0.2, y: h * 0.2, w: w * 0.6, h: h * 0.6 };
      break;
    }
    case 'cylinder': {
      const ry = Math.min(h * 0.14, 22);
      b.moveTo(0, ry).arc(w / 2, ry, w / 2, ry, Math.PI, Math.PI * 2)
        .lineTo(w, h - ry).arc(w / 2, h - ry, w / 2, ry, 0, Math.PI).close();
      const db = new PathBuilder(map, false);
      db.moveTo(0, ry).arc(w / 2, ry, w / 2, ry, Math.PI, 0);
      details.push(db.str());
      tb = { x: 0, y: ry * 2, w, h: h - ry * 3 };
      break;
    }
    case 'document': {
      const a = Math.min(h * 0.09, 14);
      b.moveTo(0, 0).lineTo(w, 0).lineTo(w, h - a)
        .cubicTo(w * 0.68, h - a * 3.2, w * 0.36, h + a * 1.4, 0, h - a * 0.6).close();
      tb = { x: 0, y: 0, w, h: h - a * 1.5 };
      break;
    }
    case 'speech': {
      const bh = h * 0.8;
      const r = Math.min(radius || 14, w / 2, bh / 2);
      const H = Math.PI / 2;
      b.moveTo(r, 0).lineTo(w - r, 0).arc(w - r, r, r, r, -H, 0)
        .lineTo(w, bh - r).arc(w - r, bh - r, r, r, 0, H)
        .lineTo(w * 0.36, bh).lineTo(w * 0.14, h).lineTo(w * 0.22, bh)
        .lineTo(r, bh).arc(r, bh - r, r, r, H, 2 * H)
        .lineTo(0, r).arc(r, r, r, r, 2 * H, 3 * H).close();
      tb = { x: 0, y: 0, w, h: bh };
      break;
    }
  }
  const g: ShapeGeometry = { d: b.str(), poly: b.poly, details, textBox: tb };
  if (cache.size > 2000) cache.clear();
  cache.set(key, g);
  return g;
}

export function geometryFor(el: ShapeElement): ShapeGeometry {
  const r = el.shape === 'roundRect' || el.shape === 'rectangle' || el.shape === 'speech' ? el.style.cornerRadius : 0;
  return shapeGeometry(el.shape, Math.max(1, el.w), Math.max(1, el.h), r, el.flipX, el.flipY);
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToPolyline(p: Point, pts: Point[], closed = false): number {
  let best = Infinity;
  const n = pts.length;
  for (let i = 0; i < n - 1 + (closed ? 1 : 0); i++) best = Math.min(best, distToSegment(p, pts[i], pts[(i + 1) % n]));
  return best;
}

/** Ray from origin o in direction dir; first intersection distance with polygon edges. */
export function rayPolygon(o: Point, dir: Point, poly: Point[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const den = dir.x * ey - dir.y * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den;
    const u = ((a.x - o.x) * dir.y - (a.y - o.y) * dir.x) / den;
    if (t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 && (best === null || t > best)) best = t; // farthest = outer boundary
  }
  return best;
}

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rectangle: 'Rectangle', roundRect: 'Rounded rectangle', ellipse: 'Ellipse / circle', diamond: 'Diamond (decision)',
  parallelogram: 'Parallelogram (I/O)', hexagon: 'Hexagon (preparation)', triangle: 'Triangle', pill: 'Pill (terminator)',
  cloud: 'Cloud', cylinder: 'Cylinder (database)', document: 'Document', speech: 'Speech bubble', sticky: 'Sticky note',
  trapezoid: 'Trapezoid (manual op)', octagon: 'Octagon (stop)', star: 'Star',
};
