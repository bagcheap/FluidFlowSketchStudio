// Layout score (pure, local, no AI): how tidy the current page looks, from 0 to 100, with what costs points. Used by
// "Improve the look" so Claude's changes are judged by numbers worked out here, not by its own opinion: the agent
// reads it with the `layout_score` tool, and the panel shows the score before and after. STATIC geometry.
import type { BoxElement, ConnectorElement, ContainerElement, FlowDocument } from '../model/types';
import { connectorPath, type ConnectorPath } from '../engine/connectors';
import { crossings } from '../engine/jumps';
import { elementBounds, makeLookup } from '../engine/render';
import { connectorLabelBox, isLifeline } from '../editor/hitTest';
import { segmentHitsRect } from './lint';

type Rect = { x: number; y: number; w: number; h: number };

/** Points taken off for each problem. */
export const PENALTY = { crossing: 3, overlap: 8, throughShape: 5, labelClash: 3, misaligned: 1, outside: 4, cramped: 1, longLabel: 1 } as const;
/** An arrow label longer than this (characters) is hard to place and covers the diagram: shorten it (a callout can hold the rest). */
export const LONG_LABEL = 48;
/** Centres this close (px) but not lined up look like a mistake; closer than 1 px counts as lined up. */
const MISALIGN = 10;
/** Boxes closer than this (px) look cramped: there is no room for arrows and their labels between them. */
const CRAMPED = 30;
const INSET = 6;
const MAX_ITEMS = 400;

export interface LayoutScore {
  score: number; // 0–100, higher is tidier
  crossings: number; // arrow crossings
  overlaps: number; // shapes on top of each other
  throughShapes: number; // arrows passing through a shape
  labelClashes: number; // arrow labels over shapes, other labels or other arrows' lines
  misaligned: number; // pairs of shapes almost, but not quite, lined up
  outside: number; // container members sticking out of their container
  cramped: number; // pairs of shapes closer than 30 px
  longLabels: number; // arrow labels longer than LONG_LABEL characters
}

const ov = (a: Rect, b: Rect, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
const within = (a: Rect, b: Rect) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;

export function layoutScore(doc: FlowDocument): LayoutScore {
  const boxes = doc.elements.filter((e): e is BoxElement => (e.type === 'shape' || e.type === 'icon' || e.type === 'image') && !(e.type === 'shape' && e.style.stroke === 'transparent')).slice(0, MAX_ITEMS);
  const arrows = doc.elements.filter((e): e is ConnectorElement => e.type === 'connector' && !e.bar && !isLifeline(e)).slice(0, MAX_ITEMS);
  const bounds = new Map<string, Rect>(boxes.map((b) => [b.id, elementBounds(doc, b)]));
  const lookup = makeLookup(doc, null);
  const paths = new Map<string, ConnectorPath>(arrows.map((c) => [c.id, connectorPath(c, lookup)]));
  const r: Omit<LayoutScore, 'score'> = { crossings: 0, overlaps: 0, throughShapes: 0, labelClashes: 0, misaligned: 0, outside: 0, cramped: 0, longLabels: 0 };

  for (let i = 0; i < arrows.length; i++)
    for (let j = i + 1; j < arrows.length; j++) r.crossings += crossings(paths.get(arrows[i].id)!, paths.get(arrows[j].id)!).length;

  for (let i = 0; i < boxes.length; i++) {
    const a = bounds.get(boxes[i].id)!, ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    for (let j = i + 1; j < boxes.length; j++) {
      const b = bounds.get(boxes[j].id)!, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      if (ov(a, b)) { if (!within(a, b) && !within(b, a)) r.overlaps++; continue; }
      if (ov(a, b, CRAMPED)) r.cramped++;
      const dx = Math.abs(ac.x - bc.x), dy = Math.abs(ac.y - bc.y);
      if (dx >= 1 && dx < MISALIGN && dy > 0) r.misaligned++; // one above the other, nearly in line
      else if (dy >= 1 && dy < MISALIGN && dx > 0) r.misaligned++; // side by side, nearly in line
    }
  }

  const labels: Rect[] = [];
  for (const c of arrows) {
    const pts = paths.get(c.id)!.pts, ends = new Set([c.start.elementId, c.end.elementId]);
    for (const b of boxes) {
      if (ends.has(b.id)) continue;
      const box = bounds.get(b.id)!;
      const s = { x: box.x + INSET, y: box.y + INSET, w: box.w - 2 * INSET, h: box.h - 2 * INSET };
      if ([...ends].some((id) => id && bounds.has(id) && within(bounds.get(id)!, box))) continue;
      for (let i = 0; i + 1 < pts.length; i++) if (segmentHitsRect(pts[i], pts[i + 1], s)) { r.throughShapes++; break; }
    }
    if (c.text.trim().length > LONG_LABEL) r.longLabels++;
    const lb = connectorLabelBox(doc, c);
    if (!lb) continue;
    const overLine = arrows.some((o) => o.id !== c.id && paths.get(o.id)!.pts.some((p, i, pts) => i > 0 && segmentHitsRect(pts[i - 1], p, lb)));
    if (overLine || boxes.some((b) => !ends.has(b.id) && ov(lb, bounds.get(b.id)!)) || labels.some((o) => ov(lb, o))) r.labelClashes++;
    labels.push(lb);
  }

  for (const k of doc.elements.filter((e): e is ContainerElement => e.type === 'container')) {
    const kb = elementBounds(doc, k);
    for (const id of k.members) { const m = bounds.get(id); if (m && !within(m, kb)) r.outside++; }
  }

  const lost = r.crossings * PENALTY.crossing + r.overlaps * PENALTY.overlap + r.throughShapes * PENALTY.throughShape + r.labelClashes * PENALTY.labelClash
    + r.misaligned * PENALTY.misaligned + r.outside * PENALTY.outside + r.cramped * PENALTY.cramped + r.longLabels * PENALTY.longLabel;
  return { score: Math.max(0, Math.round(100 - lost)), ...r };
}

/** The score as one plain line, e.g. "82/100: 2 crossings, 1 label over a shape". */
export function scoreLine(s: LayoutScore): string {
  const parts: [number, string, string][] = [
    [s.overlaps, 'overlapping shape pair', 'overlapping shape pairs'], [s.throughShapes, 'arrow through a shape', 'arrows through shapes'],
    [s.crossings, 'arrow crossing', 'arrow crossings'], [s.labelClashes, 'label in the way', 'labels in the way'],
    [s.outside, 'item outside its container', 'items outside their containers'], [s.misaligned, 'near-miss alignment', 'near-miss alignments'],
    [s.cramped, 'cramped pair', 'cramped pairs'], [s.longLabels, 'long arrow label', 'long arrow labels'],
  ];
  const left = parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  return `${s.score}/100${left.length ? `: ${left.join(', ')}` : ''}`;
}
