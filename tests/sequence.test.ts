import { describe, expect, it } from 'vitest';
import { isSequence, parseSequence, MAX_PARTICIPANTS } from '../src/import/mermaidSequence';
import { buildSequence, rectColor } from '../src/import/sequenceBuild';
import { isLifeline, lifelineAt } from '../src/editor/hitTest';
import { looksLikeMermaid } from '../src/import/mermaid';
import { connectorPath } from '../src/engine/connectors';
import { makeLookup, renderDocumentAtTime } from '../src/engine/render';
import { defaultToolStyle, newDocument } from '../src/model/defaults';
import { parseDocument, serializeDocument } from '../src/model/schema';
import { fitShapeToText } from '../src/store/commands';
import { moveElements } from '../src/store/containers';
import type { ConnectorElement, ContainerElement, FlowDocument, ShapeElement } from '../src/model/types';

const tools = {
  shape: (k: string) => defaultToolStyle(`shape:${k}`), arrow: defaultToolStyle('arrow'), line: defaultToolStyle('line'),
  container: defaultToolStyle('container'), bar: defaultToolStyle('seq:bar'), fit: fitShapeToText,
};
const TEXT = `sequenceDiagram
  autonumber
  actor U as User
  participant GE
  participant M as MCP Server
  U->>GE: Ask a question
  GE->>+M: query
  loop Every row
    M->>M: scan
  end
  alt found
    M-->>GE: rows
  else none
    M--xGE: empty
  end
  Note right of M: cached
  GE-)U: answer`;

describe('Mermaid sequence reader', () => {
  it('is recognised, also when pasted', () => {
    expect(isSequence(TEXT)).toBe(true);
    expect(isSequence('flowchart LR\n a --> b')).toBe(false);
    expect(looksLikeMermaid(TEXT)).toBe(true);
  });

  it('reads participants (aliases, actors), messages, notes and blocks', () => {
    const g = parseSequence(TEXT);
    expect(g.participants.map((p) => [p.id, p.label, p.actor])).toEqual([['U', 'User', true], ['GE', 'GE', false], ['M', 'MCP Server', false]]);
    expect(g.autonumber).toBe(true);
    const msgs = g.steps.filter((s) => s.k === 'msg');
    expect(msgs.map((m) => m.k === 'msg' && [m.from, m.to, m.text, m.endHead, m.dashed])).toEqual([
      ['U', 'GE', 'Ask a question', 'arrow', false],
      ['GE', 'M', 'query', 'arrow', false],
      ['M', 'M', 'scan', 'arrow', false],
      ['M', 'GE', 'rows', 'arrow', true],
      ['M', 'GE', 'empty', 'bar', true],
      ['GE', 'U', 'answer', 'arrow', false],
    ]);
    expect(g.steps.map((s) => s.k).join(' ')).toBe('msg msg act open msg close open msg else msg close note msg'); // ->>+ activates M
    expect(g.warnings).toEqual([]);
  });

  it('keeps labels plain and caps sizes', () => {
    const g = parseSequence('sequenceDiagram\nA->>B: <b>hi</b>‮\nlink A: Docs @ https://x\nclick A call()');
    expect((g.steps[0] as { text: string }).text).toBe('hi');
    expect(g.warnings).toEqual([]);
    const many = parseSequence('sequenceDiagram\n' + Array.from({ length: 150 }, (_, i) => `participant P${i}`).join('\n'));
    expect(many.participants.length).toBe(MAX_PARTICIPANTS);
  });
});

describe('building a sequence diagram', () => {
  function build() {
    const r = buildSequence(newDocument(), parseSequence(TEXT), tools, { x: 0, y: 0 });
    const els = r.doc.elements;
    const boxes = els.filter((e): e is ShapeElement => e.type === 'shape' && e.shape !== 'sticky');
    const lifelines = els.filter(isLifeline);
    const messages = els.filter((e): e is ConnectorElement => e.type === 'connector' && !isLifeline(e) && !(e as ConnectorElement).bar);
    const frames = els.filter((e): e is ContainerElement => e.type === 'container');
    return { r, doc: r.doc, boxes, lifelines, messages, frames };
  }

  it('lines up participants with a lifeline each, messages top to bottom, attached to lifelines', () => {
    const { r, doc, boxes, lifelines, messages, frames } = build();
    expect(r.participants).toBe(3);
    expect(boxes.map((b) => b.text)).toEqual(['User', 'GE', 'MCP Server']);
    expect(boxes[0].shape).toBe('pill');
    expect(boxes[0].x + boxes[0].w).toBeLessThan(boxes[1].x);
    expect(lifelines).toHaveLength(3);
    expect(messages).toHaveLength(6);
    expect(messages[0].text).toBe('1. Ask a question');
    const ys = messages.map((m) => m.start.anchor!.y * boxes[0].h);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    // every message end sits on its participant's lifeline
    const look = makeLookup(doc, null);
    for (const m of messages) {
      const path = connectorPath(m, look);
      const a = boxes.find((b) => b.id === m.start.elementId)!;
      expect(Math.abs(path.pts[0].x - (a.x + a.w / 2))).toBeLessThanOrEqual(6.01); // on the lifeline, or on an activation bar's edge
    }
    expect(messages[3].style.strokeStyle).toBe('dashed');
    expect(frames.map((f) => f.text).sort()).toEqual(['alt · found / else · none', 'loop · Every row']);
    expect(doc.elements.indexOf(frames[0])).toBeLessThan(doc.elements.indexOf(boxes[0])); // frames behind
  });

  it('moving a participant moves its lifeline and message ends', () => {
    const { doc, boxes, messages } = build();
    const moved = moveElements(doc, new Set([boxes[2].id]), 200, 0);
    const look = makeLookup(moved, null);
    const m = messages[1]; // GE -> M
    expect(Math.abs(connectorPath(m, look).pts.at(-1)!.x - (boxes[2].x + boxes[2].w / 2 + 200))).toBeLessThanOrEqual(6.01); // M is active: the bar's edge
  });

  it('an arrow end dropped on a lifeline attaches there, at that height', () => {
    const { doc, boxes, lifelines } = build();
    const b = boxes[1], y = b.y + b.h + 100;
    const ep = lifelineAt(doc, { x: b.x + b.w / 2 + 3, y }, 1)!;
    expect(ep.elementId).toBe(b.id);
    expect(ep.anchor!.y * b.h + b.y).toBeCloseTo(y, 5);
    expect(lifelineAt(doc, { x: b.x + b.w / 2 + 40, y }, 1)).toBeNull();
    expect(lifelines.every((l) => l.anim?.mode === 'none')).toBe(true);
  });

  it('survives save and load (anchors below the box are kept)', () => {
    const { doc, messages } = build();
    const again = parseDocument(serializeDocument(doc)).doc as FlowDocument;
    const m = again.elements.find((e) => e.id === messages[5].id) as ConnectorElement;
    expect(m.start.anchor!.y).toBeCloseTo(messages[5].start.anchor!.y, 6);
    expect(again.elements.filter(isLifeline)).toHaveLength(3);
  });

  it('activation bars: activate / deactivate and the +/- shorthands, nested to the right; messages touch their edges', () => {
    const g = parseSequence(`sequenceDiagram
      participant A
      participant B
      A->>+B: start
      B->>A: ping
      activate B
      B->>A: nested
      deactivate B
      B-->>-A: done
      A->>B: after`);
    expect(g.steps.map((s) => s.k).join(' ')).toBe('msg act msg act msg act msg act msg');
    const r = buildSequence(newDocument(), g, tools, { x: 0, y: 0 });
    const bars = r.doc.elements.filter((e): e is ConnectorElement => e.type === 'connector' && !!e.bar);
    expect(bars).toHaveLength(2);
    const [b] = r.doc.elements.filter((e): e is ShapeElement => e.type === 'shape' && e.text === 'B');
    const top = (c: ConnectorElement) => b.y + c.start.anchor!.y * b.h, bottom = (c: ConnectorElement) => b.y + c.end.anchor!.y * b.h;
    const outer = bars.find((c) => c.start.anchor!.x === 0.5)!, inner = bars.find((c) => c.start.anchor!.x > 0.5)!;
    expect(top(inner)).toBeGreaterThan(top(outer)); // `activate B` right after "ping" starts at it, as in Mermaid
    expect(bottom(inner)).toBeLessThan(bottom(outer));
    expect(bars.every((c) => c.start.elementId === b.id && c.end.elementId === b.id && !isLifeline(c))).toBe(true);
    // "start" ends on the left edge of B's bar; "after" (no bar any more) on the lifeline
    const msgs = r.doc.elements.filter((e): e is ConnectorElement => e.type === 'connector' && !e.bar && !isLifeline(e));
    const look = makeLookup(r.doc, null);
    const cx = b.x + b.w / 2;
    expect(connectorPath(msgs[0], look).pts.at(-1)!.x).toBeCloseTo(cx - 6, 0);
    expect(connectorPath(msgs[4], look).pts.at(-1)!.x).toBeCloseTo(cx, 0);
    // bars move with their participant, and are drawn as an outlined bar
    const moved = moveElements(r.doc, new Set([b.id]), 100, 0);
    expect(connectorPath(outer, makeLookup(moved, null)).pts[0].x).toBeCloseTo(cx + 100, 0);
    const item = renderDocumentAtTime(r.doc, 0).items.find((i) => i.id === outer.id)!;
    expect(item.parts).toHaveLength(1);
    expect(item.parts[0]).toMatchObject({ k: 'line', closed: true, fill: '#ffffff' });
  });

  it('keeps bars through save and load', () => {
    const r = buildSequence(newDocument(), parseSequence('sequenceDiagram\nA->>+B: x\nB-->>-A: y'), tools, { x: 0, y: 0 });
    const again = parseDocument(serializeDocument(r.doc)).doc;
    expect(again.elements.filter((e) => e.type === 'connector' && e.bar)).toHaveLength(1);
  });

  it('keeps angle-bracket placeholders in labels but drops HTML tags', () => {
    const g = parseSequence('sequenceDiagram\nA->>B: Bearer <Entra_Token><br/>Body: <b>x</b> <span style="color:red">y</span>');
    expect((g.steps[0] as { text: string }).text).toBe('Bearer <Entra_Token>\nBody: x y');
  });

  it('rect rgb(...) is a tinted band with no title or border', () => {
    expect(rectColor('rgb(240, 248, 255)')).toBe('#f0f8ff');
    expect(rectColor('#abc')).toBe('#aabbcc');
    expect(rectColor('rgba(0, 0, 0, 0.5)')).toBe('#808080');
    expect(rectColor('Highlight')).toBeNull();
    const r = buildSequence(newDocument(), parseSequence('sequenceDiagram\nrect rgb(255, 240, 245)\nA->>B: x\nend\nrect Plain\nA->>B: y\nend'), tools, { x: 0, y: 0 });
    const [band, plain] = r.doc.elements.filter((e): e is ContainerElement => e.type === 'container').sort((a, b) => a.y - b.y);
    expect(band.text).toBe('');
    expect(band.style.fill).toBe('#fff0f5');
    expect(band.style.stroke).toBe('transparent');
    expect(plain.text).toBe('rect · Plain');
    expect(parseDocument(serializeDocument(r.doc)).doc.elements.find((e) => e.id === band.id)!.style.fill).toBe('#fff0f5');
  });
});
