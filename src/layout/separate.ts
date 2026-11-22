// Move one of two overlapping shapes clear of the other (pure; the Review panel's "Move apart" fix).
// The smaller one moves (the unlocked one if the other is locked), the shortest way out in one of the four
// directions plus a small gap, stepping further past any other shape it would land on. Spots that keep it inside the
// container it is in come first; otherwise the shortest move wins.
import type { DiagramElement, FlowDocument } from '../model/types';
import { elementBounds } from '../engine/render';

type Rect = { x: number; y: number; w: number; h: number };
export const SEPARATE_GAP = 24;

const hits = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
const isBox = (e: DiagramElement) => e.type === 'shape' || e.type === 'icon' || e.type === 'image';

/** Which of the two moves, and by how much. Null when neither can move (both locked, or no free spot nearby). */
export function separation(doc: FlowDocument, aId: string, bId: string): { id: string; dx: number; dy: number } | null {
  const a = doc.elements.find((e) => e.id === aId), b = doc.elements.find((e) => e.id === bId);
  if (!a || !b || !isBox(a) || !isBox(b) || (a.locked && b.locked)) return null;
  const ra = elementBounds(doc, a), rb = elementBounds(doc, b);
  // the smaller one moves, unless it is locked
  const [mover, other] = a.locked ? [b, a] : b.locked ? [a, b] : ra.w * ra.h <= rb.w * rb.h ? [a, b] : [b, a];
  const m = elementBounds(doc, mover), o = elementBounds(doc, other);
  const container = doc.elements.find((e) => e.type === 'container' && e.members.includes(mover.id));
  const cb = container ? elementBounds(doc, container) : null;
  const obstacles = doc.elements.filter((e) => e.id !== mover.id && isBox(e) && !(e.type === 'shape' && e.style.stroke === 'transparent')).map((e) => elementBounds(doc, e));
  const options: { dx: number; dy: number; dist: number; stays: boolean }[] = [];
  const dirs = [
    { dx: o.x + o.w + SEPARATE_GAP - m.x, dy: 0 }, // right of it
    { dx: o.x - SEPARATE_GAP - (m.x + m.w), dy: 0 }, // left
    { dx: 0, dy: o.y + o.h + SEPARATE_GAP - m.y }, // below
    { dx: 0, dy: o.y - SEPARATE_GAP - (m.y + m.h) }, // above
  ];
  for (const d0 of dirs) {
    let { dx, dy } = d0;
    const ux = Math.sign(dx), uy = Math.sign(dy);
    for (let step = 0; step < 30; step++) {
      const r = { x: m.x + dx, y: m.y + dy, w: m.w, h: m.h };
      const block = obstacles.find((q) => hits(r, q, SEPARATE_GAP / 2));
      if (!block) {
        const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
        const stays = !cb || (c.x > cb.x && c.x < cb.x + cb.w && c.y > cb.y && c.y < cb.y + cb.h);
        options.push({ dx, dy, dist: Math.hypot(dx, dy), stays });
        break;
      }
      // past the shape in the way, in the same direction
      if (ux > 0) dx = block.x + block.w + SEPARATE_GAP - m.x;
      else if (ux < 0) dx = block.x - SEPARATE_GAP - (m.x + m.w);
      else if (uy > 0) dy = block.y + block.h + SEPARATE_GAP - m.y;
      else dy = block.y - SEPARATE_GAP - (m.y + m.h);
    }
  }
  options.sort((p, q) => Number(q.stays) - Number(p.stays) || p.dist - q.dist);
  const best = options[0];
  return best ? { id: mover.id, dx: Math.round(best.dx), dy: Math.round(best.dy) } : null;
}

/** Apply `separation`: the moved shape's x/y shift (arrows follow it, being attached). */
export function separateBoxes(doc: FlowDocument, aId: string, bId: string): { doc: FlowDocument; moved: string } | null {
  const s = separation(doc, aId, bId);
  if (!s) return null;
  return { doc: { ...doc, elements: doc.elements.map((e) => (e.id === s.id && e.type !== 'connector' ? { ...e, x: e.x + s.dx, y: e.y + s.dy } : e)) }, moved: s.id };
}
