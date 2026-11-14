import { describe, expect, it } from 'vitest';
import { cameraView, contentBounds, makeLookup, playSchedule } from '../src/engine/render';
import { CAM_CLOSE, CAM_MOVE, CAM_OPEN, groupShots, MIN_SHOT, toAspect } from '../src/engine/camera';
import { connectorPath } from '../src/engine/connectors';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { parseDocument, serializeDocument } from '../src/model/schema';
import { setAnimation } from '../src/store/commands';
import { useDoc } from '../src/store/docStore';
import { applyPlaySteps } from '../src/store/sequence';
import type { ConnectorElement, FlowDocument } from '../src/model/types';

/** Five shapes in a long row, far apart, with arrows 1→2→3→4→5 playing in order. */
function row(camera: boolean, gap = 600) {
  const t = defaultToolStyle('shape:rectangle');
  const shapes = [0, 1, 2, 3, 4].map((i) => makeShape('rectangle', i * gap, 0, 120, 60, t));
  const arrows = [0, 1, 2, 3].map((i) => ({ ...makeConnector({ x: 0, y: 0, elementId: shapes[i].id }, { x: 0, y: 0, elementId: shapes[i + 1].id }, { ...defaultToolStyle('arrow'), routing: 'straight' as const }), text: `${i + 1}. step` }));
  let doc: FlowDocument = { ...newDocument(), elements: [...shapes, ...arrows] };
  doc = applyPlaySteps(doc, arrows.map((a) => [a.id]));
  doc = { ...doc, animation: { ...doc.animation, camera, loop: true, seamless: true } };
  doc = { ...doc, animation: { ...doc.animation, duration: Math.ceil(playSchedule(doc).seconds * 10) / 10 } };
  return { doc, shapes, arrows };
}
const ASPECT = 16 / 9;
const baseOf = (doc: FlowDocument) => { const b = contentBounds(doc)!; return toAspect({ x: b.x - 40, y: b.y - 40, w: b.w + 80, h: b.h + 80 }, ASPECT); };
const close = (a: { x: number; y: number; w: number; h: number }, b: typeof a, tol = 1e-6) =>
  Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol && Math.abs(a.w - b.w) < tol && Math.abs(a.h - b.h) < tol;

describe('camera moves', () => {
  it('off by default: the view is always the whole picture and the timing is unchanged', () => {
    const { doc } = row(false);
    const base = baseOf(doc);
    for (let i = 0; i <= 20; i++) expect(cameraView(doc, (doc.animation.duration * i) / 20, base, ASPECT)).toEqual(base);
    expect(playSchedule(doc).camera).toEqual([]);
  });

  it('adds time to open on the whole picture, move between shots and pull back out', () => {
    const off = playSchedule(row(false).doc).seconds;
    const s = playSchedule(row(true).doc);
    const shots = new Set(s.camera.map((k) => k.shot)).size - 1; // distinct shots besides the whole picture
    expect(shots).toBe(4); // far apart: one shot per step
    expect(s.seconds).toBeCloseTo(off + CAM_OPEN + CAM_MOVE * (shots + 1) + CAM_CLOSE, 6);
  });

  it('starts and ends on the whole picture, zooms in on each step, and moves smoothly (seamless loop)', () => {
    const { doc, shapes, arrows } = row(true);
    const base = baseOf(doc), L = doc.animation.duration;
    expect(close(cameraView(doc, 0, base, ASPECT), base)).toBe(true);
    expect(close(cameraView(doc, L - 1e-6, base, ASPECT), base, 1e-3)).toBe(true);
    expect(close(cameraView(doc, L, base, ASPECT), cameraView(doc, 0, base, ASPECT))).toBe(true);
    // mid each step: zoomed in, showing that step's arrow and both its shapes
    const { win } = playSchedule(doc);
    const look = makeLookup(doc, null);
    arrows.forEach((a, i) => {
      const [p0, p1] = win.get(a.id)!;
      const r = cameraView(doc, ((p0 + p1) / 2) * L, base, ASPECT);
      expect(r.w).toBeLessThan(base.w * 0.6);
      expect(r.w / r.h).toBeCloseTo(ASPECT, 6);
      for (const s of [shapes[i], shapes[i + 1]]) {
        expect(s.x).toBeGreaterThanOrEqual(r.x); expect(s.x + s.w).toBeLessThanOrEqual(r.x + r.w);
        expect(s.y).toBeGreaterThanOrEqual(r.y); expect(s.y + s.h).toBeLessThanOrEqual(r.y + r.h);
      }
      for (const q of connectorPath(a as ConnectorElement, look).pts) { expect(q.x).toBeGreaterThanOrEqual(r.x); expect(q.x).toBeLessThanOrEqual(r.x + r.w); }
      // and it holds still while the arrow plays
      expect(close(cameraView(doc, (p0 + 0.001) * L, base, ASPECT), cameraView(doc, (p1 - 0.001) * L, base, ASPECT))).toBe(true);
    });
    // continuous: no jumps between frames at 60 fps
    let prev = cameraView(doc, 0, base, ASPECT);
    for (let t = 1 / 60; t <= L; t += 1 / 60) {
      const r = cameraView(doc, t, base, ASPECT);
      const jump = Math.max(Math.abs(r.x - prev.x), Math.abs(r.y - prev.y), Math.abs(r.w - prev.w));
      expect(jump, `t=${t}`).toBeLessThan(base.w * 0.06);
      prev = r;
    }
  });

  it('steps close together share one shot (no moving back and forth); never zooms in closer than MIN_SHOT across', () => {
    expect(groupShots([{ x: 0, y: 0, w: 200, h: 100 }, { x: 20, y: 10, w: 150, h: 60 }, { x: 2000, y: 0, w: 200, h: 100 }]).of).toEqual([0, 0, 1]);
    // a cluster of three shapes with three arrows between them, and one shape far away
    const t = defaultToolStyle('shape:rectangle');
    const [a, b, c, far] = [[0, 0], [220, 0], [110, 120], [3000, 0]].map(([x, y]) => makeShape('rectangle', x, y, 120, 60, t));
    const ar = (p: typeof a, q: typeof a) => makeConnector({ x: 0, y: 0, elementId: p.id }, { x: 0, y: 0, elementId: q.id }, { ...defaultToolStyle('arrow'), routing: 'straight' as const });
    const arrows = [ar(a, b), ar(b, c), ar(c, a), ar(c, far)];
    let doc: FlowDocument = applyPlaySteps({ ...newDocument(), elements: [a, b, c, far, ...arrows] }, arrows.map((x) => [x.id]));
    doc = { ...doc, animation: { ...doc.animation, camera: true } };
    doc = { ...doc, animation: { ...doc.animation, duration: playSchedule(doc).seconds } };
    const shots = playSchedule(doc).camera.map((k) => k.shot).filter((s, i, all) => s && all.indexOf(s) === i);
    expect(shots.length).toBe(2); // the cluster's three steps, then the step out to the far shape
    const base = baseOf(doc);
    for (let t = 0; t < doc.animation.duration; t += 0.05) expect(cameraView(doc, t, base, ASPECT).w).toBeGreaterThanOrEqual(Math.min(base.w, MIN_SHOT) - 1e-6);
  });

  it('turning it on or off fits the loop to the new timing (one undo step); saved with the file; older files open with it off', () => {
    const { doc } = row(false);
    useDoc.getState().replace(() => doc);
    setAnimation({ camera: true });
    const d = useDoc.getState().doc;
    expect(d.animation.camera).toBe(true);
    expect(d.animation.duration).toBeCloseTo(Math.ceil(playSchedule(d).seconds * 10) / 10, 6);
    expect(d.animation.duration).toBeGreaterThan(doc.animation.duration);
    useDoc.getState().undo();
    expect(useDoc.getState().doc.animation.camera).toBe(false);
    expect(useDoc.getState().doc.animation.duration).toBe(doc.animation.duration);
    expect(parseDocument(serializeDocument(d)).doc.animation.camera).toBe(true);
    const old = JSON.parse(serializeDocument(doc));
    old.schemaVersion = 12; delete old.animation.camera;
    expect(parseDocument(JSON.stringify(old)).doc.animation.camera).toBe(false);
    old.animation.camera = 'yes';
    expect(parseDocument(JSON.stringify(old)).doc.animation.camera).toBe(false);
  });
});
