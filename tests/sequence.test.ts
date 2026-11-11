import { describe, expect, it } from 'vitest';
import { isSequence, parseSequence, MAX_PARTICIPANTS } from '../src/import/mermaidSequence';
import { buildSequence } from '../src/import/sequenceBuild';
import { isLifeline, lifelineAt } from '../src/editor/hitTest';
import { looksLikeMermaid } from '../src/import/mermaid';
import { connectorPath } from '../src/engine/connectors';
import { makeLookup } from '../src/engine/render';
import { defaultToolStyle, newDocument } from '../src/model/defaults';
import { parseDocument, serializeDocument } from '../src/model/schema';
import { fitShapeToText } from '../src/store/commands';
import { moveElements } from '../src/store/containers';
import type { ConnectorElement, ContainerElement, FlowDocument, ShapeElement } from '../src/model/types';

const tools = {
  shape: (k: string) => defaultToolStyle(`shape:${k}`), arrow: defaultToolStyle('arrow'), line: defaultToolStyle('line'),
  container: defaultToolStyle('container'), fit: fitShapeToText,
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
      ['U', 'GE', 'Ask a question', 'triangle', false],
      ['GE', 'M', 'query', 'triangle', false],
      ['M', 'M', 'scan', 'triangle', false],
      ['M', 'GE', 'rows', 'triangle', true],
      ['M', 'GE', 'empty', 'bar', true],
      ['GE', 'U', 'answer', 'arrow', false],
    ]);
    expect(g.steps.map((s) => s.k).join(' ')).toBe('msg msg open msg close open msg else msg close note msg');
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
    const messages = els.filter((e): e is ConnectorElement => e.type === 'connector' && !isLifeline(e));
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
      expect(path.pts[0].x).toBeCloseTo(a.x + a.w / 2, 0);
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
    expect(connectorPath(m, look).pts.at(-1)!.x).toBeCloseTo(boxes[2].x + boxes[2].w / 2 + 200, 0);
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
});
