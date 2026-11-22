// Diagram lint (pure, local, no AI): checks the current page for things that are usually mistakes, for the Review
// panel and for the AI tool kit (`lint` tool). Works on STATIC geometry. Each issue names the items it concerns
// and, where the editor has a one-click remedy, a fix kind (carried out by cmd.fixLintIssue).
import type { BoxElement, ConnectorElement, ContainerElement, DiagramElement, FlowDocument, Point } from '../model/types';
import { connectorPath } from '../engine/connectors';
import { elementBounds, makeLookup } from '../engine/render';
import { SHAPE_LABELS } from '../engine/shapes';
import { isLifeline } from '../editor/hitTest';
import { labelStep, numberedSteps, orderFollowsLabels, readPlaySteps } from '../store/sequence';

export type LintSeverity = 'error' | 'warning' | 'info';
export type LintRule =
  | 'loose-end' | 'through-shape' | 'overlap' | 'duplicate-step' | 'step-gap' | 'order-mismatch' | 'not-in-order'
  | 'no-order' | 'unlabelled' | 'unconnected' | 'empty-container';
/** One-click remedies the editor offers (cmd.fixLintIssue). */
export type LintFix = 'renumber' | 'labelOrder' | 'routeArrows' | 'delete' | 'separate';

export interface LintIssue {
  key: string; // stable while the issue stays the same (rule + items), for hiding it
  rule: LintRule;
  severity: LintSeverity;
  message: string;
  ids: string[]; // the items it concerns (selected when the issue is clicked)
  fix?: { kind: LintFix; label: string };
}

/** Limits that keep lint quick on very large pages. */
const MAX_BOXES = 600;
const MAX_ARROWS = 600;
/** How far inside a shape an arrow must pass to count as cutting through it (px). */
const INSET = 6;
/** Shapes that are usually left without a label. */
const NO_LABEL_NEEDED = new Set(['bpmnStart', 'bpmnEnd', 'bpmnIntermediate', 'bpmnGateway', 'bpmnParallel']);
const SEVERITY_ORDER: Record<LintSeverity, number> = { error: 0, warning: 1, info: 2 };

type Rect = { x: number; y: number; w: number; h: number };
type Box = BoxElement & { type: 'shape' | 'icon' | 'image' };

/** A short, readable name for an item in a message: its label, else its kind. */
export function itemName(doc: FlowDocument, e: DiagramElement | undefined): string {
  if (!e) return 'an item';
  const text = e.text.split('\n')[0].trim();
  const q = (s: string) => `“${s.length > 40 ? `${s.slice(0, 39)}…` : s}”`;
  if (e.type === 'connector') {
    if (text) return `arrow ${q(text)}`;
    const end = (id: string | null | undefined) => { const x = id ? doc.elements.find((o) => o.id === id) : undefined; return x?.text.split('\n')[0].trim() || null; };
    const a = end(e.start.elementId), b = end(e.end.elementId);
    return a && b ? `the arrow from ${q(a)} to ${q(b)}` : 'an arrow';
  }
  if (text) return q(text);
  if (e.type === 'shape') return `a ${(SHAPE_LABELS[e.shape] ?? e.shape).toLowerCase()}`;
  return e.type === 'container' ? 'a container' : e.type === 'icon' ? 'an icon' : e.type === 'image' ? 'a picture' : e.type === 'text' ? 'a text' : 'an item';
}

/** Shapes, icons and pictures that take part in layout checks (not see-through bands, which sit behind on purpose). */
function layoutBoxes(doc: FlowDocument): Box[] {
  return doc.elements.filter((e): e is Box => (e.type === 'shape' || e.type === 'icon' || e.type === 'image') && !(e.type === 'shape' && e.style.stroke === 'transparent')).slice(0, MAX_BOXES);
}

/** Arrows that can be checked (not lifelines or activation bars). */
function steppable(doc: FlowDocument): ConnectorElement[] {
  return doc.elements.filter((e): e is ConnectorElement => e.type === 'connector' && !e.bar && !isLifeline(e as DiagramElement));
}

const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const area = (r: Rect) => Math.max(0, r.w) * Math.max(0, r.h);
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Does the segment p→q pass through the rectangle (Liang–Barsky)? */
export function segmentHitsRect(p: Point, q: Point, r: Rect): boolean {
  if (r.w <= 0 || r.h <= 0) return false;
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  const edges: [number, number][] = [[-dx, p.x - r.x], [dx, r.x + r.w - p.x], [-dy, p.y - r.y], [dy, r.y + r.h - p.y]];
  for (const [pp, qq] of edges) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 < t1;
}

/** Every lint issue on the current page, most serious first (then in reading order of their first item). */
export function lintPage(doc: FlowDocument): LintIssue[] {
  const out: LintIssue[] = [];
  const add = (rule: LintRule, severity: LintSeverity, message: string, ids: string[], fix?: LintIssue['fix']) =>
    out.push({ key: `${rule}:${[...ids].sort().join(',')}`, rule, severity, message, ids, ...(fix ? { fix } : {}) });
  const byId = new Map(doc.elements.map((e) => [e.id, e]));
  const name = (id: string | null | undefined) => itemName(doc, id ? byId.get(id) : undefined);
  const arrows = steppable(doc).slice(0, MAX_ARROWS);
  const boxes = layoutBoxes(doc);
  const bounds = new Map<string, Rect>(boxes.map((b) => [b.id, elementBounds(doc, b)]));

  // ---- connections ----
  for (const c of arrows) {
    const loose = [c.start.elementId, c.end.elementId].filter((x) => !x || !byId.has(x)).length;
    if (loose) add('loose-end', 'warning', `${cap(name(c.id))} ${loose === 2 ? 'isn’t attached to anything at either end' : 'has an end that isn’t attached to anything'}`, [c.id]);
  }

  // ---- arrows cutting through shapes ----
  const lookup = makeLookup(doc, null);
  for (const c of arrows) {
    if (!c.start.elementId || !c.end.elementId || c.start.elementId === c.end.elementId) continue;
    const ends = [c.start.elementId, c.end.elementId].map((id) => bounds.get(id) ?? (byId.get(id) ? elementBounds(doc, byId.get(id)!) : null)).filter((r): r is Rect => !!r);
    const pts = connectorPath(c, lookup).pts;
    const hit: string[] = [];
    for (const b of boxes) {
      if (b.id === c.start.elementId || b.id === c.end.elementId) continue;
      const r = bounds.get(b.id)!;
      if (ends.some((e) => inside(e, r))) continue; // an end sits on top of this shape: the arrow starts or ends inside it
      const s: Rect = { x: r.x + INSET, y: r.y + INSET, w: r.w - 2 * INSET, h: r.h - 2 * INSET };
      for (let i = 0; i + 1 < pts.length; i++) if (segmentHitsRect(pts[i], pts[i + 1], s)) { hit.push(b.id); break; }
    }
    if (hit.length) add('through-shape', 'warning', `${cap(name(c.id))} passes through ${hit.length === 1 ? name(hit[0]) : `${hit.length} shapes`}`, [c.id, ...hit], { kind: 'routeArrows', label: 'Route around shapes' });
  }

  // ---- shapes on top of each other ----
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = bounds.get(boxes[i].id)!, b = bounds.get(boxes[j].id)!;
      const o = overlapArea(a, b);
      if (!o || inside(a, b) || inside(b, a)) continue; // one placed inside the other is usually on purpose
      if (o < 0.15 * Math.min(area(a), area(b))) continue; // touching edges
      add('overlap', 'warning', `${cap(name(boxes[i].id))} and ${name(boxes[j].id)} overlap`, [boxes[i].id, boxes[j].id], boxes[i].locked && boxes[j].locked ? undefined : { kind: 'separate', label: 'Move apart' });
    }
  }

  // ---- step numbers and the play order ----
  const numbered = arrows.map((c) => ({ c, s: labelStep(c.text) })).filter((x): x is { c: ConnectorElement; s: NonNullable<ReturnType<typeof labelStep>> } => !!x.s);
  const same = new Map<string, string[]>();
  for (const { c, s } of numbered) { const k = `${s.n}${s.sub}${s.path}`; same.set(k, [...(same.get(k) ?? []), c.id]); }
  for (const [k, ids] of same) if (ids.length > 1) add('duplicate-step', 'warning', `${ids.length} arrows are numbered ${k}: they play together. If that’s intended, number them ${k}a, ${k}b…; otherwise give each its own number`, ids);
  const tops = [...new Set(numbered.map((x) => x.s.n))].sort((a, b) => a - b);
  if (tops.length) {
    const missing: number[] = [];
    for (let n = 1; n < tops[tops.length - 1] && missing.length < 20; n++) if (!tops.includes(n)) missing.push(n);
    if (missing.length) {
      add('step-gap', 'warning', missing.length === 1 ? `There is no step ${missing[0]}` : `Steps ${listNumbers(missing)} are missing`, numbered.map((x) => x.c.id), { kind: 'renumber', label: 'Renumber steps' });
    }
  }
  const played = readPlaySteps(doc);
  if (numbered.length >= 2 && !played.length) {
    add('no-order', 'info', 'The arrows have step numbers but all play at the same time', numbered.map((x) => x.c.id), { kind: 'labelOrder', label: 'Play in label order' });
  } else if (played.length && numberedSteps(doc).length && !orderFollowsLabels(doc)) {
    add('order-mismatch', 'warning', 'The play order doesn’t follow the step numbers in the labels', numbered.map((x) => x.c.id), { kind: 'labelOrder', label: 'Play in label order' });
  }
  if (numbered.length) {
    const inOrder = new Set(played.flat());
    const after = arrows.filter((c) => !labelStep(c.text) && !inOrder.has(c.id) && !c.locked && c.anim?.mode !== 'none');
    if (after.length) add('not-in-order', 'info', `${after.length === 1 ? `${cap(name(after[0].id))} has` : `${after.length} arrows have`} no step number, so ${after.length === 1 ? 'it plays' : 'they play'} after the numbered steps`, after.map((c) => c.id));
  }

  // ---- labels and loose shapes ----
  const unlabelled = boxes.filter((b) => b.type === 'shape' && !b.text.trim() && !NO_LABEL_NEEDED.has(b.shape));
  if (unlabelled.length) add('unlabelled', 'info', `${unlabelled.length === 1 ? 'A shape has' : `${unlabelled.length} shapes have`} no label`, unlabelled.map((b) => b.id));
  if (arrows.length) {
    const attached = new Set(doc.elements.flatMap((e) => (e.type === 'connector' ? [e.start.elementId, e.end.elementId] : [])).filter((x): x is string => !!x));
    const alone = boxes.filter((b) => !attached.has(b.id) && !(b.type === 'shape' && (b.shape === 'sticky' || b.shape === 'note')) && b.type !== 'image');
    if (alone.length) add('unconnected', 'info', `${alone.length === 1 ? `${cap(name(alone[0].id))} isn’t` : `${alone.length} shapes aren’t`} connected to anything`, alone.map((b) => b.id));
  }
  for (const k of doc.elements.filter((e): e is ContainerElement => e.type === 'container' && !e.members.length)) {
    add('empty-container', 'info', `Container ${k.text.trim() ? `“${k.text.trim().slice(0, 40)}”` : '(untitled)'} is empty`, [k.id], { kind: 'delete', label: 'Delete it' });
  }

  // most serious first, then top to bottom, left to right by the first item
  const pos = (id: string) => { const e = byId.get(id); if (!e) return [0, 0]; if (e.type === 'connector') return [Math.min(e.start.y, e.end.y), Math.min(e.start.x, e.end.x)]; const b = elementBounds(doc, e); return [b.y, b.x]; };
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (() => { const [ay, ax] = pos(a.ids[0]), [by, bx] = pos(b.ids[0]); return ay - by || ax - bx; })());
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** 2, 4 and 7 · 3–6 for a run. */
function listNumbers(ns: number[]): string {
  const runs: string[] = [];
  for (let i = 0; i < ns.length;) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    runs.push(j - i >= 2 ? `${ns[i]}–${ns[j]}` : j > i ? `${ns[i]}, ${ns[j]}` : `${ns[i]}`);
    i = j + 1;
  }
  return runs.length > 1 ? `${runs.slice(0, -1).join(', ')} and ${runs[runs.length - 1]}` : runs[0];
}
