import { describe, expect, it } from 'vitest';
import { addFrameBehind, addMessage, addParticipant, addSelfMessage, columnAt, extendLifelines, makeFrame, participantsOf, SEQ_BOX } from '../src/store/sequence';
import { isLifeline } from '../src/editor/hitTest';
import { defaultToolStyle, newDocument, seqStyleKey, styleKey } from '../src/model/defaults';
import type { BoxElement, ConnectorElement, FlowDocument } from '../src/model/types';

const box = defaultToolStyle('shape:rectangle'), pill = defaultToolStyle('shape:pill'), line = defaultToolStyle('line');
const arrow = defaultToolStyle('arrow'), reply = defaultToolStyle('seq:reply');
const get = (d: FlowDocument, id: string) => d.elements.find((e) => e.id === id)!;
const lifelineEnd = (d: FlowDocument, b: BoxElement) => {
  const l = d.elements.find((e): e is ConnectorElement => isLifeline(e) && e.start.elementId === b.id)!;
  return b.y + l.end.anchor!.y * b.h;
};

function three() {
  let d = newDocument();
  const ids: string[] = [];
  for (const [x, actor] of [[100, true], [400, false], [700, false]] as const) {
    const r = addParticipant(d, { x, y: 300 + x / 10 }, actor, actor ? pill : box, line);
    d = r.doc; ids.push(r.id);
  }
  return { d, boxes: ids.map((id) => get(d, id) as BoxElement) };
}

describe('drawing sequence diagrams by hand', () => {
  it('each participant gets a dashed lifeline; later ones line up with the first', () => {
    const { d, boxes } = three();
    expect(participantsOf(d)).toHaveLength(3);
    expect(boxes.map((b) => (b as { shape: string }).shape)).toEqual(['pill', 'rectangle', 'rectangle']);
    expect(new Set(boxes.map((b) => b.y)).size).toBe(1); // same top, although clicked at different heights
    expect(new Set(boxes.map((b) => lifelineEnd(d, b))).size).toBe(1); // same lifeline length
    expect(boxes.every((b) => b.anim?.mode === 'off' && b.w === SEQ_BOX.w)).toBe(true);
    const l = d.elements.find(isLifeline)!;
    expect(l.style.strokeStyle).toBe('dashed');
    expect(d.elements.indexOf(l)).toBeLessThan(d.elements.indexOf(boxes[0])); // behind its box
  });

  it('a participant placed on top of another steps aside', () => {
    let { d, boxes } = three();
    const r = addParticipant(d, { x: boxes[1].x + 10, y: 0 }, false, box, line);
    d = r.doc;
    const nb = get(d, r.id) as BoxElement;
    for (const b of boxes) expect(nb.x >= b.x + b.w + 20 || nb.x + nb.w + 20 <= b.x).toBe(true);
  });

  it('a message is level, attached to both lifelines, and lifelines grow to reach it', () => {
    const { d, boxes } = three();
    const y = lifelineEnd(d, boxes[0]) + 200; // below the lifelines' ends
    const r = addMessage(d, boxes[0], boxes[2], y, arrow);
    const m = get(r.doc, r.id) as ConnectorElement;
    expect([m.start.elementId, m.end.elementId]).toEqual([boxes[0].id, boxes[2].id]);
    expect(m.start.anchor!.y).toBeCloseTo(m.end.anchor!.y, 9);
    expect(m.routing).toBe('straight');
    expect(lifelineEnd(r.doc, boxes[0])).toBeGreaterThan(y);
    expect(lifelineEnd(r.doc, boxes[2])).toBeGreaterThan(y);
    expect(lifelineEnd(r.doc, boxes[1])).toBeLessThan(y); // the one in between is untouched
  });

  it('replies are dashed; a message to itself loops out to the right', () => {
    const { d, boxes } = three();
    const rr = addMessage(d, boxes[1], boxes[0], 500, reply);
    const rep = get(rr.doc, rr.id);
    expect(rep.style.strokeStyle).toBe('dashed');
    const s = addSelfMessage(d, boxes[1], 450, arrow);
    const m = get(s.doc, s.id) as ConnectorElement;
    expect(m.start.elementId).toBe(m.end.elementId);
    expect(m.routing).toBe('curved');
    expect(m.end.anchor!.y).toBeGreaterThan(m.start.anchor!.y);
    expect(isLifeline(m)).toBe(false);
  });

  it('finds the lifeline column under the pointer, also below the lifeline end', () => {
    const { d, boxes } = three();
    const cx = boxes[1].x + boxes[1].w / 2;
    expect(columnAt(d, { x: cx + 5, y: 2000 }, 1)?.box.id).toBe(boxes[1].id);
    expect(columnAt(d, { x: cx + 40, y: 500 }, 1)).toBeNull();
    expect(columnAt(d, { x: cx, y: boxes[1].y + 10 }, 1)).toBeNull(); // on the box itself, not its lifeline
    expect(columnAt(d, { x: cx, y: 500 }, 1, boxes[1].id)).toBeNull();
  });

  it('frames are see-through, titled, and go to the back', () => {
    const { d } = three();
    const f = makeFrame(50, 400, 300, 150, defaultToolStyle('seq:frame'));
    const out = addFrameBehind({ ...d, elements: [...d.elements, f] }, f);
    expect(out.elements[0].id).toBe(f.id);
    expect(f.text).toBe('loop');
    expect(f.style.fill).toBe('transparent');
  });

  it('extending never shortens a lifeline', () => {
    const { d, boxes } = three();
    const before = lifelineEnd(d, boxes[0]);
    expect(lifelineEnd(extendLifelines(d, [boxes[0].id], 10), boxes[0])).toBe(before);
  });

  it('each tool remembers its own style', () => {
    expect(styleKey('seq', 'rectangle', 'actor')).toBe('shape:pill');
    expect(seqStyleKey('reply')).toBe('seq:reply');
    expect(seqStyleKey('message')).toBe('arrow');
    expect(defaultToolStyle('seq:reply').style.strokeStyle).toBe('dashed');
  });
});
