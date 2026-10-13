import { describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { renderDocumentAtTime } from '../src/engine/render';
import { connectorPath } from '../src/engine/connectors';
import { makeLookup } from '../src/engine/render';
import { loopNoise } from '../src/engine/noise';
import type { FlowDocument, ShapeElement } from '../src/model/types';

function sampleDoc(): FlowDocument {
  const doc = newDocument('t');
  const a = makeShape('roundRect', 0, 0, 160, 80, defaultToolStyle('shape:roundRect'));
  const b = makeShape('diamond', 400, 40, 150, 110, defaultToolStyle('shape:diamond'));
  a.seed = 11; b.seed = 22;
  a.text = 'Start';
  const c = makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 0, y: 0, elementId: b.id }, defaultToolStyle('arrow'));
  c.seed = 33;
  doc.elements = [a, b, c];
  return doc;
}

const shapeTf = (doc: FlowDocument, t: number, id: string) => renderDocumentAtTime(doc, t).items.find((i) => i.id === id)!.tf!;

describe('renderDocumentAtTime', () => {
  it('is deterministic: same document + same time = identical frame', () => {
    const doc = sampleDoc();
    for (const t of [0, 0.37, 1.5, 3.99]) {
      expect(JSON.stringify(renderDocumentAtTime(doc, t))).toEqual(JSON.stringify(renderDocumentAtTime(structuredClone(doc), t)));
    }
  });

  it('never mutates the document', () => {
    const doc = sampleDoc();
    const before = JSON.stringify(doc);
    for (let t = 0; t < 4; t += 0.1) renderDocumentAtTime(doc, t);
    expect(JSON.stringify(doc)).toEqual(before);
  });

  it('squiggle intensity 0 is perfectly still', () => {
    const doc = sampleDoc();
    doc.animation.shape = { ...doc.animation.shape, intensity: 0 };
    const f0 = renderDocumentAtTime(doc, 0).items.filter((i) => i.tf);
    for (const t of [0.5, 1.3, 2.9]) {
      expect(JSON.stringify(renderDocumentAtTime(doc, t).items.filter((i) => i.tf))).toEqual(JSON.stringify(f0));
    }
    const a = doc.elements[0] as ShapeElement;
    expect(shapeTf(doc, 1.7, a.id)).toEqual({ x: a.x, y: a.y, w: a.w, h: a.h, rot: 0 });
  });

  it('moves subtly at low intensity and more at high intensity', () => {
    const doc = sampleDoc();
    const a = doc.elements[0];
    const maxDev = (intensity: number) => {
      doc.animation.shape = { ...doc.animation.shape, intensity, mode: 'float' };
      let m = 0;
      for (let t = 0; t < 4; t += 0.05) { const tf = shapeTf(doc, t, a.id); m = Math.max(m, Math.hypot(tf.x - a.x, tf.y - a.y)); }
      return m;
    };
    const low = maxDev(2), high = maxDev(8);
    expect(low).toBeGreaterThan(0.3);
    expect(low).toBeLessThan(3.5);
    expect(high).toBeGreaterThan(low * 2);
  });

  it('motion is continuous (no frame-to-frame jumps) and loops seamlessly', () => {
    const doc = sampleDoc();
    const id = doc.elements[0].id;
    const L = doc.animation.duration;
    let prev = shapeTf(doc, 0, id);
    for (let t = 1 / 60; t <= L + 1e-9; t += 1 / 60) {
      const cur = shapeTf(doc, t, id);
      expect(Math.hypot(cur.x - prev.x, cur.y - prev.y)).toBeLessThan(0.5);
      prev = cur;
    }
    const s = shapeTf(doc, 0, id), e = shapeTf(doc, L, id);
    expect(Math.abs(s.x - e.x)).toBeLessThan(1e-6);
    expect(Math.abs(s.rot - e.rot)).toBeLessThan(1e-6);
  });

  it('loopNoise is periodic in position and velocity when snapped', () => {
    const L = 3;
    const v = (t: number) => loopNoise(5, 1, t, 0.4, 0.2, L);
    expect(v(0)).toBeCloseTo(v(L), 9);
    expect((v(0.001) - v(0)) / 0.001).toBeCloseTo((v(L + 0.001) - v(L)) / 0.001, 5);
  });
});

describe('connectors', () => {
  it('stay attached when the target moves or is resized', () => {
    const doc = sampleDoc();
    const [a, b, c] = doc.elements as [ShapeElement, ShapeElement, any];
    const end = () => { const p = connectorPath(c, makeLookup(doc, null)); return { s: p.pts[0], e: p.pts[p.pts.length - 1] }; };
    const before = end();
    a.x += 50; a.y += 120;
    b.w = 260; b.h = 200;
    const after = end();
    // start point must lie on the boundary of a (within the gap), end on b
    expect(after.s.x).not.toEqual(before.s.x);
    const inflate = (el: ShapeElement, p: { x: number; y: number }) => p.x >= el.x - 8 && p.x <= el.x + el.w + 8 && p.y >= el.y - 8 && p.y <= el.y + el.h + 8;
    expect(inflate(a, after.s)).toBe(true);
    expect(inflate(b, after.e)).toBe(true);
  });

  it('follow animated shapes without gaps', () => {
    const doc = sampleDoc();
    const c = doc.elements[2];
    for (const t of [0.3, 1.1, 2.4]) {
      const frame = renderDocumentAtTime(doc, t);
      const line = frame.items.find((i) => i.id === c.id)!.parts[0] as any;
      const a = frame.items.find((i) => i.id === doc.elements[0].id)!.tf!;
      const sx = line.pts[0], sy = line.pts[1];
      const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
      // start of line is just outside the animated box's edge
      expect(Math.abs(sx - cx)).toBeLessThan(a.w / 2 + 10);
      expect(Math.abs(sy - cy)).toBeLessThan(a.h / 2 + 10);
    }
  });

  it('travelling highlight moves along the path; draw-on grows from start', () => {
    const doc = sampleDoc();
    const c = doc.elements[2] as any;
    const hl = (t: number) => renderDocumentAtTime(doc, t).items.find((i) => i.id === c.id)!.parts.find((p: any) => p.k === 'line' && p.color === '#3b82f6') as any;
    const h1 = hl(0.5), h2 = hl(1.0);
    expect(h1).toBeTruthy();
    expect(h2.pts[0]).toBeGreaterThan(h1.pts[0]);
    c.anim = { mode: 'drawOn' };
    const len = (t: number) => { const p = renderDocumentAtTime(doc, t).items.find((i) => i.id === c.id)!.parts[0] as any; return p.pts.length; };
    expect(len(0.2)).toBeLessThan(len(0.8));
  });
});
