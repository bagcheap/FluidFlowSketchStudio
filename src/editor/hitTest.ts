// Hit testing on STATIC geometry: animation never affects what the pointer grabs.
import type { BoxElement, ConnectorElement, DiagramElement, FlowDocument, Point } from '../model/types';
import { STILL } from '../engine/animation';
import { connectorPath, pointAt, toLocal, toWorld } from '../engine/connectors';
import { makeLookup } from '../engine/render';
import { distToPolyline, geometryFor, pointInPolygon } from '../engine/shapes';
import { layoutText } from '../engine/text';

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

export function connectorLabelBox(doc: FlowDocument, c: ConnectorElement) {
  if (!c.text) return null;
  const path = connectorPath(c, makeLookup(doc, null));
  const { pt: a, tan } = pointAt(path, c.labelPos * path.length);
  const lay = layoutText(c.text, c.textStyle, null);
  const w = lay.width + c.textStyle.padding * 2 + 4, h = lay.height + c.textStyle.padding * 2;
  const cx = a.x - tan.y * c.labelOffset, cy = a.y + tan.x * c.labelOffset;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function hitConnector(doc: FlowDocument, c: ConnectorElement, p: Point, tol: number): boolean {
  const path = connectorPath(c, makeLookup(doc, null));
  if (distToPolyline(p, path.pts) < tol + c.style.strokeWidth / 2 + 2) return true;
  const lb = connectorLabelBox(doc, c);
  return !!lb && p.x >= lb.x && p.x <= lb.x + lb.w && p.y >= lb.y && p.y <= lb.y + lb.h;
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
