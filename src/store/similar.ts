// Select similar (pure): from the current selection, every item on the page that matches one of the selected items
// by kind, look, fill colour, outline colour or animation. Used to change many items' properties in one go.
import type { DiagramElement } from '../model/types';
import { isLifeline } from '../editor/hitTest';

export type SimilarBy = 'kind' | 'look' | 'fill' | 'stroke' | 'anim';

export const SIMILAR_LABELS: Record<SimilarBy, string> = {
  kind: 'Same kind',
  look: 'Same kind and look',
  fill: 'Same fill colour',
  stroke: 'Same line colour',
  anim: 'Same animation',
};

/** What kind of thing an item is: shapes by their shape, arrows apart from plain lines, lifelines and activation bars. */
export function kindOf(e: DiagramElement): string {
  switch (e.type) {
    case 'shape': return `shape:${e.shape}`;
    case 'connector':
      if (e.bar) return 'connector:bar';
      if (isLifeline(e as DiagramElement)) return 'connector:lifeline';
      return e.startHead === 'none' && e.endHead === 'none' ? 'connector:line' : 'connector:arrow';
    case 'icon': return 'icon';
    default: return e.type;
  }
}

const col = (c: string) => c.trim().toLowerCase();
const stable = (v: unknown) => JSON.stringify(v ?? {}, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

/** The key two items must share to count as similar. */
export function similarKey(e: DiagramElement, by: SimilarBy): string {
  const s = e.style;
  switch (by) {
    case 'kind': return kindOf(e);
    case 'fill': return s.fillStyle === 'none' || col(s.fill) === 'transparent' ? 'none' : col(s.fill);
    case 'stroke': return col(s.stroke);
    case 'anim': return `${e.type === 'connector' ? 'connector' : 'box'}|${stable(e.anim)}`;
    case 'look': {
      const base = [kindOf(e), col(s.stroke), similarKey(e, 'fill'), s.fillStyle, s.strokeWidth, s.strokeStyle].join('|');
      return e.type === 'connector' ? `${base}|${e.startHead}|${e.endHead}` : base;
    }
  }
}

/**
 * Ids of the unlocked items on the page that match any selected item by `by`, in document order. The selected
 * items themselves stay selected (even locked ones).
 */
export function selectSimilar(elements: DiagramElement[], selection: string[], by: SimilarBy): string[] {
  const sel = new Set(selection);
  const keys = new Set(elements.filter((e) => sel.has(e.id)).map((e) => similarKey(e, by)));
  if (!keys.size) return [];
  return elements.filter((e) => sel.has(e.id) || (!e.locked && keys.has(similarKey(e, by)))).map((e) => e.id);
}
