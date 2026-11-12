// Hit testing on STATIC geometry: animation never affects what the pointer grabs.
import type { BoxElement, ConnectorElement, DiagramElement, Endpoint, FlowDocument, Point } from '../model/types';
import { STILL } from '../engine/animation';
import { connectorPath, pointAt, toLocal, toWorld } from '../engine/connectors';
import { containerHeader, iconLabelLayout, connectorLabelSize, makeLookup } from '../engine/render';
import { distToPolyline, geometryFor, pointInPolygon, rayPolygon } from '../engine/shapes';

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
  if (el.type === 'container') {
    // a container is picked by its title bar or border; its empty inside acts like canvas (so you can
    // drag a selection box around shapes inside it)
    if (l.x < -tol || l.y < -tol || l.x > el.w + tol || l.y > el.h + tol) return false;
    return l.y <= containerHeader(el) || Math.min(l.x, l.y, el.w - l.x, el.h - l.y) < tol + 4;
  }
  if (el.type === 'icon' && el.text && el.labelPos !== 'none') {
    // an icon's label sits outside its box and counts as part of it
    const b = iconLabelLayout(el).box;
    if (l.x >= b.x - tol && l.y >= b.y - tol && l.x <= b.x + b.w + tol && l.y <= b.y + b.h + tol) return true;
  }
  return l.x >= -tol && l.y >= -tol && l.x <= el.w + tol && l.y <= el.h + tol;
}

export function connectorLabelBox(doc: FlowDocument, c: ConnectorElement) {
  if (!c.text) return null;
  const path = connectorPath(c, makeLookup(doc, null));
  const { pt: a, tan } = pointAt(path, c.labelPos * path.length);
  const { w, h } = connectorLabelSize(c);
  const cx = a.x - tan.y * c.labelOffset, cy = a.y + tan.x * c.labelOffset;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function hitConnector(doc: FlowDocument, c: ConnectorElement, p: Point, tol: number): boolean {
  const path = connectorPath(c, makeLookup(doc, null));
  if (distToPolyline(p, path.pts) < tol + (c.bar ? 6 : c.style.strokeWidth / 2) + 2) return true; // a bar is 12 px wide
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

/** Snap points: three on each side (a quarter, half and three quarters along it), clockwise from the top left. */
export const PORTS: Point[] = [
  { x: 0.25, y: 0 }, { x: 0.5, y: 0 }, { x: 0.75, y: 0 },
  { x: 1, y: 0.25 }, { x: 1, y: 0.5 }, { x: 1, y: 0.75 },
  { x: 0.75, y: 1 }, { x: 0.5, y: 1 }, { x: 0.25, y: 1 },
  { x: 0, y: 0.75 }, { x: 0, y: 0.5 }, { x: 0, y: 0.25 },
];

export function portPositions(el: BoxElement): Point[] {
  if (el.type === 'shape') {
    // on the actual outline: straight out from the middle line towards that side (an ellipse's or diamond's edge)
    const poly = geometryFor(el).poly;
    return PORTS.map((pt) => {
      const vertical = pt.y === 0 || pt.y === 1; // a top or bottom port moves up/down to the outline
      const from = vertical ? { x: pt.x * el.w, y: el.h / 2 } : { x: el.w / 2, y: pt.y * el.h };
      const dir = vertical ? { x: 0, y: pt.y === 0 ? -1 : 1 } : { x: pt.x === 0 ? -1 : 1, y: 0 };
      const t = rayPolygon(from, dir, poly);
      const local = t === null ? { x: pt.x * el.w, y: pt.y * el.h } : { x: from.x + dir.x * t, y: from.y + dir.y * t };
      return toWorld(el, STILL, local);
    });
  }
  return PORTS.map((pt) => toWorld(el, STILL, { x: pt.x * el.w, y: pt.y * el.h }));
}

/** The port nearest to p, if within r: its index. */
export function nearestPort(ports: Point[], p: Point, r: number): number | null {
  let best: number | null = null, bd = r;
  ports.forEach((q, i) => { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = i; } });
  return best;
}

/** Port anchors in normalised coords matching portPositions */
export function portAnchors(el: BoxElement): Point[] {
  return portPositions(el).map((w) => { const l = toLocal(el, STILL, w); return { x: l.x / Math.max(1, el.w), y: l.y / Math.max(1, el.h) }; });
}

/** Is this connector a sequence-diagram lifeline (from the bottom of a participant straight down, both ends on it)? */
export function isLifeline(c: DiagramElement): c is ConnectorElement {
  return c.type === 'connector' && !c.bar && !!c.start.elementId && c.start.elementId === c.end.elementId
    && Math.abs((c.start.anchor?.x ?? -1) - 0.5) < 0.001 && Math.abs((c.end.anchor?.x ?? -1) - 0.5) < 0.001
    && Math.abs((c.start.anchor?.y ?? 0) - 1) < 0.001 // starts at the box's bottom edge (a message to itself starts lower)
    && (c.end.anchor?.y ?? 0) > 1;
}

/**
 * A lifeline under the pointer: the endpoint that attaches to its participant at the pointer's height
 * (static geometry). Used when an arrow end is dropped on a lifeline.
 */
export function lifelineAt(doc: FlowDocument, p: Point, zoom: number, excludeParticipant?: string): Endpoint | null {
  const tol = 8 / zoom;
  for (let i = doc.elements.length - 1; i >= 0; i--) {
    const c = doc.elements[i];
    if (!isLifeline(c) || c.start.elementId === excludeParticipant) continue;
    const box = doc.elements.find((e) => e.id === c.start.elementId);
    if (!box || box.type === 'connector' || box.rotation) continue;
    const x = box.x + box.w / 2, y0 = box.y + box.h, y1 = box.y + (c.end.anchor?.y ?? 1) * box.h;
    if (Math.abs(p.x - x) <= tol && p.y >= y0 && p.y <= y1 + tol) {
      return { x: p.x, y: p.y, elementId: box.id, anchor: { x: 0.5, y: (Math.min(p.y, y1) - box.y) / Math.max(1, box.h) } };
    }
  }
  return null;
}
