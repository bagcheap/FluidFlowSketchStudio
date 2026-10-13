import type { ShapeKind } from '../model/types';
import { shapeGeometry } from '../engine/shapes';

/** Tiny vector icon generated from the real shape geometry. */
export function ShapeIcon({ kind, size = 20 }: { kind: ShapeKind; size?: number }) {
  const w = 22, h = kind === 'ellipse' || kind === 'diamond' || kind === 'star' || kind === 'octagon' || kind === 'sticky' || kind === 'cylinder' ? 18 : 15;
  const g = shapeGeometry(kind, w, h, kind === 'roundRect' || kind === 'speech' ? 5 : 0);
  return (
    <svg width={size} height={size} viewBox={`-2 ${-(22 - h) / 2 - 1} 26 24`} aria-hidden fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round">
      <path d={g.d} />
      {g.details.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
