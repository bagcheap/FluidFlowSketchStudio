// A parsed sequence diagram → FlowSketch elements.
// Participants are boxes along the top. Each has a dashed lifeline: a line attached to the participant at its
// bottom and at a point below it (anchors beyond the box). Messages are arrows attached to the two participants at
// the same height, so moving a participant moves its lifeline and every message end with it. Notes are sticky
// shapes; loop/alt/opt/… blocks are titled frames (containers) behind the messages.
import type { BoxElement, ConnectorElement, ContainerElement, DiagramElement, Endpoint, FlowDocument, Point, ShapeKind, ToolStyle } from '../model/types';
import { baseFields, makeConnector, makeShape } from '../model/defaults';
import { moveElements } from '../store/containers';
import { activeLevel, lifelineFor, makeBar, messageEnd, MIN_BAR, oneWay, SELF_H } from '../store/sequence';
import type { SGraph } from './mermaidSequence';

export interface SeqTools {
  shape: (kind: ShapeKind) => ToolStyle;
  arrow: ToolStyle;
  line: ToolStyle;
  container: ToolStyle;
  bar: ToolStyle; // activation bars
  fit: (e: DiagramElement) => DiagramElement;
}

const BOX_H = 50;
const GAP_X = 70; // between participant boxes
const FIRST_ROW = 44; // first message below the boxes
const ROW = 52; // between messages
const FRAME_MIN_W = 180;

/** The colour of a Mermaid "rect" block (rgb(), rgba() or #hex) as #rrggbb; a translucent colour is mixed with white. */
export function rectColor(text: string): string | null {
  const t = text.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return '#' + h.toLowerCase();
  }
  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(t);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : Math.min(1, Math.max(0, Number(m[4]) || 0));
  const ch = (v: string) => Math.round(255 - (255 - Math.min(255, Number(v))) * a).toString(16).padStart(2, '0');
  return '#' + ch(m[1]) + ch(m[2]) + ch(m[3]);
}

export function buildSequence(doc: FlowDocument, g: SGraph, tools: SeqTools, at: Point): { doc: FlowDocument; ids: string[]; participants: number; messages: number; messageIds: string[] } {
  // participants, left to right
  const boxes = new Map<string, BoxElement>();
  let x = 0;
  for (const p of g.participants) {
    const kind: ShapeKind = p.actor ? 'pill' : 'rectangle';
    const el = tools.fit({ ...makeShape(kind, x, 0, 130, BOX_H, tools.shape(kind)), text: p.label }) as BoxElement;
    const box = { ...el, x, y: 0, anim: { ...(el.anim ?? {}), mode: 'off' as const } }; // the timeline stays readable
    boxes.set(p.id, box);
    x += box.w + GAP_X;
  }
  const cx = (id: string) => { const b = boxes.get(id)!; return b.x + b.w / 2; };
  const H = Math.max(BOX_H, ...[...boxes.values()].map((b) => b.h));
  const on = (id: string, y: number): Endpoint => ({ x: 0, y: 0, elementId: boxes.get(id)!.id, anchor: { x: 0.5, y: y / boxes.get(id)!.h } });

  const messages: ConnectorElement[] = [], notes: BoxElement[] = [], frames: ContainerElement[] = [];
  const stack: { titles: string[]; fill: string | null; y0: number; minX: number; maxX: number }[] = [];
  const widen = (a: number, b: number) => { for (const f of stack) { f.minX = Math.min(f.minX, a); f.maxX = Math.max(f.maxX, b); } };
  let y = H + FIRST_ROW, n = 0;
  // activation bars: an open stack per participant (nested bars stack to the right)
  const open = new Map<string, number[]>();
  const bars: ConnectorElement[] = [];
  const msgY = new Map<string, number>();
  let lastMsgY = y, prevMsg = false;

  for (const s of g.steps) {
    if (s.k === 'act') {
      // right after a message (A->>+B, B-->>-A) the bar starts or ends at that message; otherwise just around it
      const box = boxes.get(s.id);
      if (!box) continue;
      const stack = open.get(s.id) ?? [];
      open.set(s.id, stack);
      if (s.on) stack.push(prevMsg ? lastMsgY : y - 10);
      else {
        const y0 = stack.pop();
        if (y0 !== undefined) bars.push(makeBar(box, y0, Math.max(prevMsg ? lastMsgY : lastMsgY + 10, y0 + MIN_BAR), stack.length, tools.bar));
      }
      continue;
    }
    prevMsg = false;
    if (s.k === 'msg') {
      const self = s.from === s.to;
      const start = on(s.from, y), end = on(s.to, self ? y + SELF_H : y);
      const c = makeConnector(start, end, s.endHead === 'none' && s.startHead === 'none' ? tools.line : tools.arrow);
      c.startHead = s.startHead; c.endHead = s.endHead;
      c.anim = oneWay(c.anim); // flows the way the arrow points
      c.text = (g.autonumber ? `${++n}. ` : '') + s.text;
      c.routing = self ? 'curved' : 'straight';
      c.curvature = self ? -1 : 0; // a loop out to the right
      const dx = cx(s.to) - cx(s.from);
      const labelW = c.text.length * c.textStyle.fontSize * 0.55;
      c.labelOffset = self ? -(labelW / 2 + 40) : dx >= 0 ? -14 : 14; // above the arrow; a self-message's label beside its loop
      c.labelPos = 0.5;
      if (s.dashed) c.style = { ...c.style, strokeStyle: 'dashed' };
      messages.push(c);
      widen(Math.min(cx(s.from), cx(s.to)), Math.max(cx(s.from), cx(s.to)) + (self ? labelW + 50 : 0));
      msgY.set(c.id, y);
      lastMsgY = y; prevMsg = true;
      y += self ? SELF_H + ROW : ROW;
    } else if (s.k === 'note') {
      const a = cx(s.at[0]), b = cx(s.at[s.at.length - 1]);
      const t = tools.shape('sticky');
      let w = s.side === 'over' ? Math.max(140, Math.abs(b - a) + 80) : 150;
      let el = tools.fit({ ...makeShape('sticky', 0, 0, w, 44, t), text: s.text }) as BoxElement;
      w = el.w;
      const nx = s.side === 'left' ? Math.min(a, b) - 20 - w : s.side === 'right' ? Math.max(a, b) + 20 : (a + b) / 2 - w / 2;
      el = { ...el, x: nx, y: y - 18, anim: { ...(el.anim ?? {}), mode: 'off' as const } };
      notes.push(el);
      widen(nx, nx + w);
      y += el.h + 22;
    } else if (s.k === 'open') {
      // "rect rgb(…)" is Mermaid's coloured background band: tinted, with no title or border
      const fill = s.kind === 'rect' ? rectColor(s.text) : null;
      const titles = fill ? [] : [s.text ? `${s.kind} · ${s.text}` : s.kind];
      stack.push({ titles, fill, y0: y - 22, minX: Infinity, maxX: -Infinity }); // clear of a frame just above
      y += 30;
    } else if (s.k === 'else') {
      stack[stack.length - 1]?.titles.push(s.text ? `${s.kind} · ${s.text}` : s.kind);
      y += 26;
    } else {
      const f = stack.pop();
      if (!f) continue;
      const all = [...boxes.values()];
      let minX = Number.isFinite(f.minX) ? f.minX : Math.min(...all.map((b) => b.x + b.w / 2));
      let maxX = Number.isFinite(f.maxX) ? f.maxX : Math.max(...all.map((b) => b.x + b.w / 2));
      const short = FRAME_MIN_W - 68 - (maxX - minX); // room for the title
      if (short > 0) { minX -= short / 2; maxX += short / 2; }
      const fr: ContainerElement = {
        ...baseFields(tools.container), type: 'container', x: minX - 34, y: f.y0, w: maxX - minX + 68, h: y - f.y0 - 10,
        text: f.titles.join(' / '), members: [], anim: { mode: 'off' },
        style: f.fill
          ? { ...tools.container.style, fill: f.fill, fillStyle: 'solid', stroke: 'transparent', strokeStyle: 'solid' }
          : { ...tools.container.style, fill: 'transparent', fillStyle: 'none' },
        textStyle: { ...tools.container.textStyle, fontSize: 14 },
      };
      frames.push(fr);
      widen(fr.x, fr.x + fr.w); // an outer block covers the inner one
      y += 16;
    }
  }

  // bars still open at the end run to the last step
  for (const [id, stack] of open) {
    const box = boxes.get(id)!;
    while (stack.length) { const y0 = stack.pop()!; bars.push(makeBar(box, y0, Math.max(y - 16, y0 + MIN_BAR), stack.length, tools.bar)); }
  }
  // messages touch the edge of an active bar instead of the lifeline's centre
  const withBars = { ...doc, elements: bars };
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i], my = msgY.get(m.id)!;
    const from = [...boxes.values()].find((b) => b.id === m.start.elementId)!, to = [...boxes.values()].find((b) => b.id === m.end.elementId)!;
    if (from === to) { // a message to itself leaves and returns on the right-hand edge of any active bar
      const y2 = my + SELF_H;
      messages[i] = { ...m, start: messageEnd(from, my, activeLevel(withBars, from, my), Infinity), end: messageEnd(from, y2, activeLevel(withBars, from, y2), Infinity) };
      continue;
    }
    const fx = from.x + from.w / 2, tx = to.x + to.w / 2;
    messages[i] = { ...m, start: messageEnd(from, my, activeLevel(withBars, from, my), tx), end: messageEnd(to, my, activeLevel(withBars, to, my), fx) };
  }

  // lifelines from each box down past the last step
  const bottom = y + 10;
  const lifelines = [...boxes.values()].map((b) => lifelineFor(b, bottom, tools.line));

  // frames behind everything, then lifelines, participants, notes and messages on top
  const fresh: DiagramElement[] = [...frames.reverse(), ...lifelines, ...bars, ...boxes.values(), ...notes, ...messages];
  let out: FlowDocument = { ...doc, elements: [...doc.elements, ...fresh] };
  const free = [...frames, ...boxes.values(), ...notes];
  if (free.length) {
    const x0 = Math.min(...free.map((e) => e.x)), x1 = Math.max(...free.map((e) => e.x + e.w));
    out = moveElements(out, new Set(free.map((e) => e.id)), at.x - (x0 + x1) / 2, at.y - bottom / 2);
  }
  return { doc: out, ids: free.map((e) => e.id), participants: boxes.size, messages: messages.length, messageIds: messages.map((m) => m.id) };
}
