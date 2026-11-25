import { describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { routeArrowsAround } from '../src/layout/routeArrows';
import { placeLabels } from '../src/layout/labels';
import { countCrossings, segsOf } from '../src/layout/orthoRoute';
import { connectorPath } from '../src/engine/connectors';
import { makeLookup } from '../src/engine/render';
import { connectorLabelBox } from '../src/editor/hitTest';
import { segmentHitsRect } from '../src/lint/lint';
import { layoutScore } from '../src/lint/score';
import type { ConnectorElement, FlowDocument, ShapeElement } from '../src/model/types';

const box = (x: number, y: number, text: string): ShapeElement => ({ ...makeShape('rectangle', x, y, 160, 80, defaultToolStyle('shape:rectangle')), text });
const arrow = (a: ShapeElement, b: ShapeElement, text = '', routing: 'elbow' | 'straight' = 'elbow'): ConnectorElement =>
  ({ ...makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 0, y: 0, elementId: b.id }, { ...defaultToolStyle('arrow'), routing }), text });
const doc = (...elements: FlowDocument['elements']): FlowDocument => ({ ...newDocument(), elements });
const routesOf = (d: FlowDocument) => { const l = makeLookup(d, null); return d.elements.filter((e): e is ConnectorElement => e.type === 'connector').map((c) => connectorPath(c, l).control); };
const totalCrossings = (d: FlowDocument) => { const r = routesOf(d).map(segsOf); let n = 0; for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) n += countCrossings(r[i], r[j]); return n; };

describe('routing arrows without crossings', () => {
  it('several arrows between the same two shapes run side by side, both directions', () => {
    for (const [ax, ay, bx, by] of [[0, 0, 500, 0], [0, 0, 0, 400], [0, 0, 500, 300]]) {
      const a = box(ax, ay, 'A'), b = box(bx, by, 'B');
      const cs = [arrow(a, b, '1'), arrow(b, a, '2'), arrow(a, b, '3')];
      const r = routeArrowsAround(doc(a, b, ...cs), cs.map((c) => c.id));
      expect(r.routed).toBe(3);
      expect(totalCrossings(r.doc)).toBe(0);
    }
  });

  it('a new route keeps clear of arrows that are not being routed when it can', () => {
    // A → B along the top row; C → D below it could cut up through A → B, or go round
    const a = box(0, 0, 'A'), b = box(600, 0, 'B'), c = box(0, 300, 'C'), d = box(600, 300, 'D');
    const ab = arrow(a, b), cd = arrow(c, d);
    const once = routeArrowsAround(doc(a, b, c, d, ab, cd), [ab.id]).doc;
    const both = routeArrowsAround(once, [cd.id]).doc;
    expect(totalCrossings(both)).toBe(0);
  });
});

describe('short arrows between facing shapes', () => {
  it('go straight across, even when the shapes differ in size and an end shares its side', () => {
    const a = box(0, 0, 'A'), b = { ...box(220, 10, 'B'), h: 50 }, c = box(0, 300, 'C');
    const ab = arrow(a, b), ac = arrow(a, c);
    const r = routeArrowsAround(doc(a, b, c, ab, ac), [ab.id, ac.id]);
    const got = r.doc.elements.find((e) => e.id === ab.id) as ConnectorElement;
    expect(got.bends).toEqual([]);
    const pts = connectorPath(got, makeLookup(r.doc, null)).pts;
    expect(new Set(pts.map((p) => Math.round(p.y))).size).toBe(1); // one level line
  });
});

describe('placing arrow labels', () => {
  it('moves a label off another arrow’s line and beside its own arrow', () => {
    const a = box(0, 200, 'A'), b = box(600, 200, 'B'), c = box(300, 0, 'C'), d = box(300, 400, 'D');
    const ab = { ...arrow(a, b, '3. request token', 'straight') }, cd = arrow(c, d, '', 'straight');
    const before = doc(a, b, c, d, ab, cd);
    const lb0 = connectorLabelBox(before, ab)!;
    const cdPts = connectorPath(cd, makeLookup(before, null)).pts;
    expect(cdPts.some((p, i) => i > 0 && segmentHitsRect(cdPts[i - 1], p, lb0))).toBe(true); // starts on top of the other arrow
    expect(layoutScore(before).labelClashes).toBe(1);
    const r = placeLabels(before, []);
    expect(r.moved).toBe(1);
    const moved = r.doc.elements.find((e) => e.id === ab.id) as ConnectorElement;
    const lb = connectorLabelBox(r.doc, moved)!;
    expect(cdPts.some((p, i) => i > 0 && segmentHitsRect(cdPts[i - 1], p, lb))).toBe(false);
    expect(moved.labelOffset).not.toBe(0); // beside its line, not on it
    expect(layoutScore(r.doc).labelClashes).toBe(0);
    // a second pass leaves it where it is
    expect(placeLabels(r.doc, []).moved).toBe(0);
  });

  it('leaves locked arrows, lifelines and unlabelled arrows alone', () => {
    const a = box(0, 0, 'A'), b = box(500, 0, 'B');
    const locked = { ...arrow(a, b, 'x', 'straight'), locked: true };
    expect(placeLabels(doc(a, b, locked, arrow(a, b, '', 'straight')), []).moved).toBe(0);
  });
});
