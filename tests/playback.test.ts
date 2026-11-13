import { beforeEach, describe, expect, it } from 'vitest';
import { playPhase, playSchedule, renderDocumentAtTime } from '../src/engine/render';
import { parseSequence } from '../src/import/mermaidSequence';
import { buildSequence } from '../src/import/sequenceBuild';
import { defaultToolStyle, newDocument } from '../src/model/defaults';
import { parseDocument, serializeDocument } from '../src/model/schema';
import { fitShapeToText, importMermaid, playArrowsTogether, playMessagesInOrder } from '../src/store/commands';
import { clearPlayOrder, messagesOf, setPlayOrder } from '../src/store/sequence';
import { useDoc } from '../src/store/docStore';
import { useUI } from '../src/store/uiStore';
import type { ConnectorElement, FlowDocument } from '../src/model/types';

const tools = {
  shape: (k: string) => defaultToolStyle(`shape:${k}`), arrow: defaultToolStyle('arrow'), line: defaultToolStyle('line'),
  container: defaultToolStyle('container'), bar: defaultToolStyle('seq:bar'), fit: fitShapeToText,
};
const TEXT = 'sequenceDiagram\nA->>B: one\nB->>C: two\nC-->>B: three\nB-->>A: four';
const HL = '#3b82f6';

function seqDoc() {
  const r = buildSequence(newDocument(), parseSequence(TEXT), tools, { x: 0, y: 0 });
  return { doc: r.doc, msgs: r.messageIds };
}
const lit = (doc: FlowDocument, id: string, t: number) =>
  renderDocumentAtTime(doc, t).items.find((i) => i.id === id)!.parts.some((p) => p.k === 'line' && (p as { color: string }).color === HL);

describe('message-by-message playback', () => {
  it('messages flow one way, even when the arrow tool remembers a round trip', () => {
    const rt = { ...tools.arrow, connectorAnim: { ...(tools.arrow.connectorAnim ?? {}), mode: 'travel' as const, direction: 'roundTrip' as const } };
    const r = buildSequence(newDocument(), parseSequence(TEXT), { ...tools, arrow: rt }, { x: 0, y: 0 });
    const conn = (d: FlowDocument, id: string) => d.elements.find((e) => e.id === id) as ConnectorElement;
    for (const id of r.messageIds) expect(conn(r.doc, id).anim?.direction).toBe('forward');
    // an existing round-trip arrow played in order becomes one-way too
    const id = r.messageIds[0];
    const d = { ...r.doc, elements: r.doc.elements.map((e) => (e.id === id ? { ...e, anim: { ...(e as ConnectorElement).anim, direction: 'roundTrip' as const } } : e)) } as FlowDocument;
    expect(conn(setPlayOrder(d, r.messageIds).doc, id).anim?.direction).toBe('forward');
  });

  it('playPhase: progress inside the window, nothing outside, wrapping with the loop', () => {
    expect(playPhase(1, 4, [0.25, 0.5])).toBeCloseTo(0);
    expect(playPhase(1.5, 4, [0.25, 0.5])).toBeCloseTo(0.5);
    expect(playPhase(0.5, 4, [0.25, 0.5])).toBeNull();
    expect(playPhase(2.5, 4, [0.25, 0.5])).toBeNull();
    expect(playPhase(5.5, 4, [0.25, 0.5])).toBeCloseTo(0.5); // next loop
  });

  it('orders messages top to bottom; each lights up only in its own step', () => {
    const { doc, msgs } = seqDoc();
    const r = setPlayOrder(doc, msgs);
    expect(r.steps).toBe(4);
    const L = r.doc.animation.duration;
    const win = (id: string) => ((r.doc.elements.find((e) => e.id === id) as ConnectorElement).anim!.window!);
    expect(msgs.map((id) => win(id)[0])).toEqual([0, 0.25, 0.5, 0.75]);
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.4) / 4 * L; // inside step i
      msgs.forEach((id, j) => expect(lit(r.doc, id, t)).toBe(i === j));
    }
    // seamless: the end of the loop looks like its start
    expect(JSON.stringify(renderDocumentAtTime(r.doc, 0).items)).toBe(JSON.stringify(renderDocumentAtTime(r.doc, L).items));
  });

  it('back to all together; and the play order survives save and load', () => {
    const { doc, msgs } = seqDoc();
    const r = setPlayOrder(doc, msgs);
    const again = parseDocument(serializeDocument(r.doc)).doc;
    expect((again.elements.find((e) => e.id === msgs[2]) as ConnectorElement).anim!.window).toEqual([0.5, 0.5 + 0.85 / 4]);
    const back = clearPlayOrder(r.doc, msgs);
    expect(msgs.every((id) => !(back.elements.find((e) => e.id === id) as ConnectorElement).anim?.window)).toBe(true);
    const bad = parseDocument({ format: 'flowsketch', schemaVersion: 9, elements: [{ id: 'c', type: 'connector', start: { x: 0, y: 0 }, end: { x: 9, y: 0 }, anim: { window: [0.8, 0.2] } }] }).doc;
    expect((bad.elements[0] as ConnectorElement).anim?.window).toBeUndefined();
  });

  it('finds the messages of a sequence diagram (not lifelines or bars)', () => {
    const r = buildSequence(newDocument(), parseSequence('sequenceDiagram\nA->>+B: x\nB-->>-A: y'), tools, { x: 0, y: 0 });
    expect(messagesOf(r.doc).map((c) => c.id).sort()).toEqual([...r.messageIds].sort());
  });

  describe('commands', () => {
    beforeEach(() => { useDoc.getState().load(newDocument()); useUI.getState().select([]); });
    it('importing a sequence diagram plays it in order, with a loop long enough', () => {
      importMermaid(TEXT);
      const d = useDoc.getState().doc;
      expect(messagesOf(d).every((c) => !!c.anim?.window)).toBe(true);
      expect(d.animation.duration).toBeGreaterThanOrEqual(4 * 0.9);
    });
    it('Play arrows together / Play messages in order, each one undo step', () => {
      importMermaid('sequenceDiagram\n' + Array.from({ length: 8 }, (_, i) => `A->>B: m${i}`).join('\n'));
      playArrowsTogether();
      expect(messagesOf(useDoc.getState().doc).some((c) => c.anim?.window)).toBe(false);
      useDoc.getState().commit((d) => ({ ...d, animation: { ...d.animation, duration: 2 } }));
      playMessagesInOrder();
      const d = useDoc.getState().doc;
      expect(messagesOf(d).every((c) => c.anim?.window)).toBe(true);
      expect(d.animation.duration).toBeCloseTo(Math.ceil(playSchedule(d).seconds * 10) / 10, 5); // set from the arrows at the shared speed
      expect(d.animation.duration).toBeGreaterThan(2);
      useDoc.getState().undo();
      expect(useDoc.getState().doc.animation.duration).toBe(2);
    });
  });
});
