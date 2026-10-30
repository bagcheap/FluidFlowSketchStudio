// Bounding box of SVG path data, from its points and control points (a slight overestimate for curves,
// which is all bounding-box gradients need). Used when converting icons; never sees anything but path data.

const CMD = /[MmLlHhVvCcSsQqTtAaZz]/;

/** [x, y, w, h], or null if the path has no points. */
export function pathBBox(d: string): [number, number, number, number] | null {
  let i = 0;
  const skip = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  const number = (): number | null => {
    skip();
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(i, i + 40));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const flag = (): number | null => { skip(); const c = d[i]; if (c === '0' || c === '1') { i++; return +c; } return null; };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  let cx = 0, cy = 0, sx = 0, sy = 0, cmd = '';
  for (let guard = 0; guard < 100000; guard++) {
    skip();
    if (i >= d.length) break;
    if (CMD.test(d[i])) cmd = d[i++];
    else if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') { cx = sx; cy = sy; cmd = ''; continue; }
    const nums = (n: number) => { const out: number[] = []; for (let k = 0; k < n; k++) { const v = number(); if (v === null) return null; out.push(v); } return out; };
    const pt = (x: number, y: number) => (rel ? [cx + x, cy + y] : [x, y]);
    if (C === 'H' || C === 'V') {
      const v = number(); if (v === null) break;
      if (C === 'H') cx = rel ? cx + v : v; else cy = rel ? cy + v : v;
      add(cx, cy); continue;
    }
    if (C === 'A') {
      const a = nums(3); const f1 = flag(), f2 = flag(); const e = nums(2);
      if (!a || f1 === null || f2 === null || !e) break;
      const [x, y] = pt(e[0], e[1]);
      add(cx, cy); add(x, y);
      for (const [px, py] of arcPoints(cx, cy, a[0], a[1], a[2], f1, f2, x, y)) add(px, py);
      cx = x; cy = y; continue;
    }
    const n = C === 'C' ? 6 : C === 'S' || C === 'Q' ? 4 : 2; // M, L, T take one point
    const v = nums(n); if (!v) break;
    const pts: number[][] = [];
    for (let k = 0; k < n; k += 2) pts.push(pt(v[k], v[k + 1]));
    for (const [x, y] of pts) add(x, y);
    [cx, cy] = pts[pts.length - 1];
    if (C === 'M') { sx = cx; sy = cy; cmd = rel ? 'l' : 'L'; } // extra pairs after M are lines
  }
  return Number.isFinite(x0) ? [x0, y0, x1 - x0, y1 - y0] : null;
}

/** Points along an SVG elliptical arc (endpoint form → centre form, SVG spec F.6.5), for bounds. */
function arcPoints(x1: number, y1: number, rx: number, ry: number, rotDeg: number, large: number, sweep: number, x2: number, y2: number): number[][] {
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return [];
  const phi = (rotDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; } // radii too small: scale up, as SVG does
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * yp) / ry, cyp = (-k * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const out: number[][] = [];
  for (let s = 1; s < 24; s++) {
    const t = t1 + (dt * s) / 24;
    out.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
  }
  return out;
}
