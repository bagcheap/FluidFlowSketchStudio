import type { ShapeKind } from '../model/types';
import { shapeGeometry } from '../engine/shapes';

/** Tiny vector icon generated from the real shape geometry. */
export function ShapeIcon({ kind, size = 20 }: { kind: ShapeKind; size?: number }) {
  const square = ['ellipse', 'diamond', 'star', 'octagon', 'sticky', 'cylinder', 'bpmnStart', 'bpmnEnd', 'bpmnIntermediate', 'bpmnGateway', 'bpmnParallel', 'umlClass', 'erEntity', 'note', 'umlPackage'];
  const w = kind === 'umlActor' || kind === 'bpmnData' ? 13 : 22, h = kind === 'umlActor' ? 22 : kind === 'bpmnData' ? 17 : square.includes(kind) ? 18 : 15;
  const g = shapeGeometry(kind, w, h, kind === 'roundRect' || kind === 'speech' ? 5 : 0);
  return (
    <svg width={size} height={size} viewBox={`${-2 - (22 - w) / 2} ${-(22 - h) / 2 - 1} 26 24`} aria-hidden fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round">
      <path d={g.d} />
      {g.details.map((d, i) => <path key={i} d={d} />)}
      {(kind === 'umlClass' || kind === 'erEntity') && <path d={`M0 ${h * 0.33} H${w}${kind === 'umlClass' ? ` M0 ${h * 0.66} H${w}` : ''}`} />}
    </svg>
  );
}
