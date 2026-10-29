// Hit testing on STATIC geometry: animation never affects what the pointer grabs.
import type { BoxElement, ConnectorElement, DiagramElement, FlowDocument, Point } from '../model/types';
import { STILL } from '../engine/animation';
import { connectorPath, pairGap, pairPaths, toLocal, toWorld } from '../engine/connectors';
import { connectorLabelRect, makeLookup, type LabelPart, type Rect } from '../engine/render';
import { distToPolyline, geometryFor, pointInPolygon } from '../engine/shapes';

export function hitBox(el: BoxElement, p: Point, tol: number): boolean {
  const l = toLocal(el, STILL, p);
  if (el.type === 'shape') {
    const poly = geometryFor(el).poly;
    return pointInPolygon(l, poly) || distToPolyline(l, poly, true) < tol + el.style.strokeWidth / 2;
  }
  if (el.type === 'freehand') {
    const pts = el.points.map(([x, y]) => ({ x: x * el.w, y: y * el.h }));
    return distToPolyline(l, pts) < tol + el.style.strokeWidth / 2;
  }
  return l.x >= -tol && l.y >= -tol && l.x <= el.w + tol && l.y <= el.h + tol;
}

/** Label boxes of a connector that has label text (a pair can have two). */
export function connectorLabelBoxes(doc: FlowDocument, c: ConnectorElement): { part: LabelPart; box: Rect }[] {
  const lookup = makeLookup(doc, null);
  const out: { part: LabelPart; box: Rect }[] = [];
  if (c.text) out.push({ part: 'main', box: connectorLabelRect(c, 'main', lookup) });
  if (c.pair?.text) out.push({ part: 'response', box: connectorLabelRect(c, 'response', lookup) });
  return out;
}

const inRect = (p: Point, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export function hitConnector(doc: FlowDocument, c: ConnectorElement, p: Point, tol: number): boolean {
  const lookup = makeLookup(doc, null);
  const near = tol + c.style.strokeWidth / 2 + 2;
  if (c.pair) {
    // anywhere on either arrow or in the gap between them
    const center = connectorPath(c, lookup);
    if (distToPolyline(p, center.pts) < near + pairGap(c) / 2) return true;
  } else if (distToPolyline(p, connectorPath(c, lookup).pts) < near) return true;
  return connectorLabelBoxes(doc, c).some((l) => inRect(p, l.box));
}

/** Which label of a connector a point refers to: a label box under it, else the nearer arrow of a pair. */
export function connectorPartAt(doc: FlowDocument, c: ConnectorElement, p: Point): LabelPart {
  if (!c.pair) return 'main';
  const hit = connectorLabelBoxes(doc, c).find((l) => inRect(p, l.box));
  if (hit) return hit.part;
  const pp = pairPaths(c, makeLookup(doc, null));
  return distToPolyline(p, pp.res.pts) < distToPolyline(p, pp.req.pts) ? 'response' : 'main';
}

export function hitTest(doc: FlowDocument, p: Point, zoom: number, filter?: (e: DiagramElement) => boolean): DiagramElement | null {
  const tol = 6 / zoom;
  // connectors first among equals: they are thin, so give them priority when close
  for (let i = doc.elements.length - 1; i >= 0; i--) {
    const e = doc.elements[i];
    if (filter && !filter(e)) continue;
    if (e.type === 'connector' && hitConnector(doc, e, p, tol)) return e;
  }
  for (let i = doc.elements.length - 1; i >= 0; i--) {
    const e = doc.elements[i];
    if (filter && !filter(e)) continue;
    if (e.type !== 'connector' && hitBox(e, p, tol)) return e;
  }
  return null;
}

/** Topmost box (shape/text/image) under p for connector attachment. */
export function boxAt(doc: FlowDocument, p: Point, zoom: number, exclude?: string): BoxElement | null {
  for (let i = doc.elements.length - 1; i >= 0; i--) {
    const e = doc.elements[i];
    if (e.type === 'connector' || e.id === exclude || e.type === 'freehand') continue;
    if (hitBox(e, p, 10 / zoom)) return e;
  }
  return null;
}

export const PORTS: Point[] = [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }];

export function portPositions(el: BoxElement): Point[] {
  if (el.type === 'shape') {
    // put ports on the actual outline, along the axis from the centre
    const poly = geometryFor(el).poly;
    return PORTS.map((pt) => {
      const target = { x: pt.x * el.w, y: pt.y * el.h };
      let best = target, bd = Infinity;
      for (const q of poly) { const d = Math.hypot(q.x - target.x, q.y - target.y); if (d < bd) { bd = d; best = q; } }
      const onAxis = pt.x === 0.5 ? { x: el.w / 2, y: best.y } : { x: best.x, y: el.h / 2 };
      return toWorld(el, STILL, onAxis);
    });
  }
  return PORTS.map((pt) => toWorld(el, STILL, { x: pt.x * el.w, y: pt.y * el.h }));
}

/** Port anchors in normalised coords matching portPositions */
export function portAnchors(el: BoxElement): Point[] {
  return portPositions(el).map((w) => { const l = toLocal(el, STILL, w); return { x: l.x / Math.max(1, el.w), y: l.y / Math.max(1, el.h) }; });
}
