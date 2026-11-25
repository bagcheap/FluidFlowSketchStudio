// The diagram tool kit (pure): the operations Claude may use on the current page, as typed tools with JSON-schema
// inputs (ready for the Messages API `tools` parameter, strict). Three kinds:
//   read   – look at the page (describe it, one item, search, pages, play order)
//   change – edit it (add, connect, remove, relabel, restyle, containers, step numbers, layout, routing, theme)
//   check  – lint the page, or a snapshot picture of it
// A session works on a DRAFT copy of the document (`session.doc`); nothing reaches the editor until the caller
// commits the draft (one undo step). Short ids (s1, a1, c1, t1) stay the same for the whole session.
// Tool inputs are UNTRUSTED (they come from the model): edits go through `parseEdits` (the same checks as the
// one-shot AI edits), everything else is checked here, and nothing is ever executed or rendered as HTML.
import type { ConnectorElement, DiagramElement, FlowDocument } from '../model/types';
import { allPages } from '../model/schema';
import { autoLayout } from '../layout/autoLayout';
import type { LayoutDir } from '../layout/layered';
import { routeArrowsAround } from '../layout/routeArrows';
import { isLifeline } from '../editor/hitTest';
import { lintPage } from '../lint/lint';
import { applyPlaySteps, fitLoopToPlay, labelStep, labelSteps, numberedSteps, playStepLabels, readPlaySteps, renumberSteps } from '../store/sequence';
import { applyThemeToDoc, THEMES } from '../store/themes';
import { alignBoxes, distributeBoxes, matchSizes, moveBoxes, movableBoxes } from '../layout/arrange';
import { layoutScore } from '../lint/score';
import { applyEdits, cleanText, describePage, EDIT_SCHEMA, parseEdits, type EditTools, type PageView } from './edits';

export type ToolKind = 'read' | 'change' | 'check';
export interface ToolImage { mediaType: 'image/png'; data: string } // base64
export interface ToolResult { ok: boolean; content: string; image?: ToolImage }
export interface ToolContext {
  styles: EditTools; // the tools' default styles for new items
  /** A PNG of the page (the editor provides it; absent in tests and where pictures can't be made). */
  snapshot?: (doc: FlowDocument) => Promise<ToolImage | null>;
}
export interface ToolSession {
  doc: FlowDocument; // the draft
  readonly original: FlowDocument;
  view: PageView; // short ids, kept stable
  ctx: ToolContext;
  calls: number;
  changes: number; // change-tool calls that changed something
  log: { tool: string; ok: boolean; summary: string }[];
}
export interface DiagramTool {
  name: string;
  kind: ToolKind;
  description: string;
  input_schema: Record<string, unknown>;
  run: (s: ToolSession, input: Record<string, unknown>) => ToolResult | Promise<ToolResult>;
}

/** Run a layout change on the movable boxes among the given short ids (at least `min` of them). */
function layoutChange(s: ToolSession, raw: unknown, min: number, change: (ids: string[]) => FlowDocument): ToolResult {
  const ids = movableBoxes(s.doc, (Array.isArray(raw) ? raw : []).slice(0, 200).map((x) => realOf(s, x)).filter((x): x is string => !!x)).map((e) => e.id);
  if (ids.length < min) return fail(`Name at least ${min} unlocked shape${min === 1 ? '' : 's'} on the page.`);
  const next = change(ids);
  if (next === s.doc) return ok({ done: true, changed: false });
  commitDraft(s, next);
  return ok({ done: true, items: ids.length });
}

/** The largest single move (px). */
export const MAX_MOVE = 5000;

/** Limits for one session. */
export const MAX_TOOL_CALLS = 80;
export const MAX_RESULT_CHARS = 60_000;

export function startSession(doc: FlowDocument, ctx: ToolContext): ToolSession {
  return { doc, original: doc, view: describePage(doc), ctx, calls: 0, changes: 0, log: [] };
}

// ---- helpers --------------------------------------------------------------------------------------------------------

const ok = (v: unknown): ToolResult => ({ ok: true, content: typeof v === 'string' ? v : JSON.stringify(v) });
const fail = (message: string): ToolResult => ({ ok: false, content: JSON.stringify({ error: message }) });
const shortOf = (s: ToolSession, id: string): string | null => { for (const [k, v] of s.view.ids) if (v === id) return k; return null; };
const realOf = (s: ToolSession, short: unknown): string | null => (typeof short === 'string' ? s.view.ids.get(short.trim()) ?? null : null);
const shorts = (s: ToolSession, ids: string[]) => ids.map((id) => shortOf(s, id)).filter((x): x is string => !!x);
const known = (s: ToolSession) => new Set(s.view.ids.keys());
/** The draft changed: keep it and refresh the short ids (old ones keep their meaning). */
function commitDraft(s: ToolSession, doc: FlowDocument) { s.doc = doc; s.view = describePage(doc, s.view); s.changes++; }

const obj = (props: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const NONE = obj({});
/** An edit's input schema, from the one-shot edit format (without `op`, and without `ref`: the tool gives new ids). */
function editSchema(op: string): Record<string, unknown> {
  const all = JSON.parse(JSON.stringify(EDIT_SCHEMA.properties.ops.items.anyOf)) as { properties: Record<string, unknown>; required: string[] }[];
  const s = all.find((x) => (x.properties.op as { enum: string[] }).enum[0] === op)!;
  delete s.properties.op; delete s.properties.ref;
  s.required = s.required.filter((k) => k !== 'op' && k !== 'ref');
  return s;
}

/** Run one checked edit operation on the draft; returns the short ids it created. */
function edit(s: ToolSession, op: Record<string, unknown>): ToolResult {
  const parsed = parseEdits({ ops: [op] }, known(s));
  if (!parsed.ops.length) return fail('That change is not valid: check the ids (they must be on the page) and the values.');
  const before = new Set(s.doc.elements.map((e) => e.id));
  const r = applyEdits(s.doc, s.view, parsed.ops, s.ctx.styles);
  if (r.skipped) return fail('That change could not be made (an item is locked or gone).');
  commitDraft(s, r.doc);
  const added = r.doc.elements.filter((e) => !before.has(e.id)).map((e) => e.id);
  return ok({ done: true, ...(added.length ? { new: shorts(s, added) } : {}), changed: shorts(s, r.touched).slice(0, 50) });
}

/** One item in detail, as the model sees it. */
function itemDetail(s: ToolSession, id: string): Record<string, unknown> | null {
  const e = s.doc.elements.find((x) => x.id === id);
  if (!e) return null;
  const sid = shortOf(s, id);
  const parent = s.doc.elements.find((x) => x.type === 'container' && x.members.includes(id));
  const base: Record<string, unknown> = { id: sid, ...(e.locked ? { locked: true } : {}), ...(parent ? { in: shortOf(s, parent.id) } : {}), ...(e.note ? { note: e.note.slice(0, 500) } : {}) };
  const r = Math.round;
  if (e.type === 'connector') {
    const order = readPlaySteps(s.doc), names = playStepLabels(order), st = labelStep(e.text);
    return { ...base, arrow: true, from: e.start.elementId ? shortOf(s, e.start.elementId) : null, to: e.end.elementId ? shortOf(s, e.end.elementId) : null, label: e.text.slice(0, 500),
      step: st ? `${st.n}${st.sub}${st.path}` : null, plays: names.get(id) ?? (order.length ? 'after the order' : 'with all arrows'),
      heads: e.startHead !== 'none' && e.endHead !== 'none' ? 'both' : e.endHead !== 'none' ? 'end' : e.startHead !== 'none' ? 'start' : 'none',
      line: e.style.strokeStyle, width: e.style.strokeWidth, color: e.style.stroke, routing: e.routing, animation: e.anim?.mode ?? s.doc.animation.connector.mode };
  }
  const box = { x: r(e.x), y: r(e.y), w: r(e.w), h: r(e.h) };
  if (e.type === 'container') return { ...base, container: true, title: e.text.slice(0, 500), ...box, members: shorts(s, e.members) };
  const arrows = s.doc.elements.filter((c): c is ConnectorElement => c.type === 'connector' && (c.start.elementId === id || c.end.elementId === id) && !c.bar && !isLifeline(c));
  return { ...base, kind: e.type === 'shape' ? e.shape : e.type === 'freehand' ? 'drawing' : e.type, label: e.type === 'image' || e.type === 'freehand' ? '' : e.text.slice(0, 500), ...box,
    fill: e.style.fillStyle === 'none' ? 'none' : e.style.fill, line: e.style.stroke, lineStyle: e.style.strokeStyle,
    arrowsOut: shorts(s, arrows.filter((c) => c.start.elementId === id).map((c) => c.id)), arrowsIn: shorts(s, arrows.filter((c) => c.end.elementId === id).map((c) => c.id)) };
}

const KINDS = ['any', 'shape', 'arrow', 'container', 'text', 'icon', 'image', 'drawing'] as const;
/** Sequence-diagram plumbing (lifelines, activation bars): not offered to the model. */
const plumbing = (e: DiagramElement): boolean => e.type === 'connector' && (!!e.bar || isLifeline(e));
const kindOf = (t: string) => (t === 'connector' ? 'arrow' : t === 'freehand' ? 'drawing' : t);
const DIRS: Record<string, LayoutDir> = { 'left-to-right': 'LR', 'top-to-bottom': 'TB', 'right-to-left': 'RL', 'bottom-to-top': 'BT' };

// ---- the tools ------------------------------------------------------------------------------------------------------

export const DIAGRAM_TOOLS: DiagramTool[] = [
  // read
  { name: 'describe_page', kind: 'read', input_schema: NONE,
    description: 'The current page as JSON: shapes and icons (s1…; kind, label, x/y/w/h, fill and line colours), text (t1…), containers (c1…; "in" on an item names its container) and arrows (a1…; from, to, label, heads, dashed). Ids stay the same for the whole conversation.',
    run: (s) => ok(`{"page":${JSON.stringify(allPages(s.doc).find((p) => p.id === s.doc.activePage)?.name ?? '')},"items":${s.view.json}}`) },
  { name: 'get_item', kind: 'read', input_schema: obj({ id: { type: 'string' } }),
    description: 'Everything about one item: label, position and size, colours, container, note; for an arrow its ends, step number and when it plays; for a shape the arrows going in and out; for a container its members.',
    run: (s, i) => { const id = realOf(s, i.id); const d = id && itemDetail(s, id); return d ? ok(d) : fail(`No item ${String(i.id)} on the page.`); } },
  { name: 'find_items', kind: 'read', input_schema: obj({ text: { type: 'string' }, kind: { type: 'string', enum: [...KINDS] } }),
    description: 'Items whose label contains the text (case doesn’t matter; "" = any), optionally only of one kind. Returns ids and labels (at most 100).',
    run: (s, i) => {
      const q = typeof i.text === 'string' ? i.text.trim().toLowerCase() : '', k = KINDS.includes(i.kind as typeof KINDS[number]) ? (i.kind as string) : 'any';
      const hits = s.doc.elements.filter((e) => (k === 'any' || kindOf(e.type) === k) && (!q || e.text.toLowerCase().includes(q)) && !plumbing(e));
      return ok({ count: hits.length, items: hits.slice(0, 100).map((e) => ({ id: shortOf(s, e.id), kind: e.type === 'shape' ? e.shape : kindOf(e.type), label: e.text.slice(0, 120) })) });
    } },
  { name: 'list_pages', kind: 'read', input_schema: NONE,
    description: 'The pages of the document (name, whether it is the current one, how many items). Only the current page can be read or changed.',
    run: (s) => ok(allPages(s.doc).map((p) => ({ name: p.name, current: p.id === s.doc.activePage, items: p.elements.length }))) },
  { name: 'get_play_order', kind: 'read', input_schema: NONE,
    description: 'The order arrows light up in: each step with its arrows (arrows in one step play together), then the arrows that play after the order. Empty when all arrows play at once.',
    run: (s) => {
      const steps = readPlaySteps(s.doc), names = playStepLabels(steps), inOrder = new Set(steps.flat());
      const label = (id: string) => s.doc.elements.find((e) => e.id === id)?.text.slice(0, 120) ?? '';
      const after = steps.length ? s.doc.elements.filter((e) => e.type === 'connector' && !plumbing(e) && !inOrder.has(e.id)).map((e) => e.id) : [];
      return ok({ steps: steps.map((g) => g.map((id) => ({ id: shortOf(s, id), step: names.get(id), label: label(id) }))), afterTheOrder: after.map((id) => ({ id: shortOf(s, id), label: label(id) })) });
    } },

  // change (the same checked operations as the one-shot AI edits, one at a time)
  { name: 'add_shape', kind: 'change', input_schema: editSchema('add_shape'),
    description: 'Add a shape with a label. "near": an existing id to place it next to, with "place" right/left/above/below (or null for a free spot); "container": an id to put it in (or null). Returns the new id.',
    run: (s, i) => edit(s, { ...i, op: 'add_shape', ref: 'new1' }) },
  { name: 'connect', kind: 'change', input_schema: editSchema('connect'),
    description: 'Add an arrow from one item to another, with a short label ("" for none; start it with a step number like "3. " to place it in the play order), style solid/dashed/thick and heads end/both/none. Returns the new id.',
    run: (s, i) => edit(s, { ...i, op: 'connect' }) },
  { name: 'remove', kind: 'change', input_schema: editSchema('remove'),
    description: 'Delete an item. Removing a shape also removes its arrows; removing a container removes what is in it (move the contents out first to keep them).',
    run: (s, i) => edit(s, { ...i, op: 'remove' }) },
  { name: 'set_label', kind: 'change', input_schema: editSchema('set_label'),
    description: 'New text for a shape, arrow, text or container title.',
    run: (s, i) => edit(s, { ...i, op: 'set_label' }) },
  { name: 'set_shape', kind: 'change', input_schema: editSchema('set_shape'),
    description: 'Change a shape’s kind (rectangle, roundRect, ellipse, diamond, cylinder, …).',
    run: (s, i) => edit(s, { ...i, op: 'set_shape' }) },
  { name: 'set_color', kind: 'change', input_schema: editSchema('set_color'),
    description: 'Fill and/or line colour of items as #rrggbb (null = leave as is).',
    run: (s, i) => edit(s, { ...i, op: 'set_color' }) },
  { name: 'set_arrow', kind: 'change', input_schema: editSchema('set_arrow'),
    description: 'An arrow’s line style and heads (null = leave as is); reverse = true swaps its direction.',
    run: (s, i) => edit(s, { ...i, op: 'set_arrow' }) },
  { name: 'add_container', kind: 'change', input_schema: editSchema('add_container'),
    description: 'Put a titled container around the given items. Returns the new id.',
    run: (s, i) => edit(s, { ...i, op: 'add_container', ref: 'new1' }) },
  { name: 'move_into', kind: 'change', input_schema: editSchema('move_into'),
    description: 'Move items into a container, or out of any container (container null).',
    run: (s, i) => edit(s, { ...i, op: 'move_into' }) },
  { name: 'renumber_steps', kind: 'change', input_schema: NONE,
    description: 'Rewrite the step numbers at the start of arrow labels to match the play order: 1, 2, 3…, with 4a, 4b for arrows playing together; closes gaps.',
    run: (s) => {
      if (!numberedSteps(s.doc).length) return fail('No arrow labels start with a step number.');
      const hadOrder = readPlaySteps(s.doc).length > 0, r = renumberSteps(s.doc);
      commitDraft(s, hadOrder ? r.doc : fitLoopToPlay(applyPlaySteps(r.doc, labelSteps(r.doc))));
      return ok({ done: true, relabelled: r.changed });
    } },
  { name: 'play_in_label_order', kind: 'change', input_schema: NONE,
    description: 'Make the arrows light up in the order of the step numbers in their labels (arrows with the same number together).',
    run: (s) => {
      if (!numberedSteps(s.doc).length) return fail('No arrow labels start with a step number.');
      const steps = labelSteps(s.doc);
      commitDraft(s, fitLoopToPlay(applyPlaySteps(s.doc, steps)));
      return ok({ done: true, steps: steps.length });
    } },
  { name: 'auto_layout', kind: 'change', input_schema: obj({ direction: { type: 'string', enum: Object.keys(DIRS) } }),
    description: 'Arrange the whole page along its arrows, in layers in the given direction (containers keep their contents together).',
    run: (s, i) => { const dir = DIRS[String(i.direction)]; if (!dir) return fail('Unknown direction.'); commitDraft(s, autoLayout(s.doc, dir)); return ok({ done: true }); } },
  { name: 'route_arrows', kind: 'change', input_schema: obj({ ids: { type: 'array', items: { type: 'string' } } }),
    description: 'Route arrows around shapes with right-angled paths (ids of arrows; an empty list = every arrow on the page).',
    run: (s, i) => {
      const want = Array.isArray(i.ids) ? i.ids.map((x) => realOf(s, x)).filter((x): x is string => !!x) : [];
      const ids = want.length ? want : s.doc.elements.filter((e) => e.type === 'connector').map((e) => e.id);
      const r = routeArrowsAround(s.doc, ids);
      if (!r.routed) return fail('No arrows between two shapes could be routed.');
      commitDraft(s, r.doc);
      return ok({ done: true, routed: r.routed });
    } },
  { name: 'apply_theme', kind: 'change', input_schema: obj({ theme: { type: 'string', enum: THEMES.map((t) => t.id) } }),
    description: `Recolour the whole document with a theme: ${THEMES.map((t) => `${t.id} (${t.name})`).join(', ')}.`,
    run: (s, i) => { const t = THEMES.find((x) => x.id === i.theme); if (!t) return fail('Unknown theme.'); commitDraft(s, applyThemeToDoc(s.doc, t)); return ok({ done: true }); } },

  { name: 'align', kind: 'change', input_schema: obj({ ids: { type: 'array', items: { type: 'string' } }, edge: { type: 'string', enum: ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] } }),
    description: 'Line up two or more shapes by an edge or their centres (hcenter = same vertical centre line, i.e. a column; vcenter = same horizontal centre line, i.e. a row). Containers bring their contents.',
    run: (s, i) => layoutChange(s, i.ids, 2, (ids) => alignBoxes(s.doc, ids, i.edge as never)) },
  { name: 'distribute', kind: 'change', input_schema: obj({ ids: { type: 'array', items: { type: 'string' } }, axis: { type: 'string', enum: ['across', 'down'] } }),
    description: 'Even out the gaps between three or more shapes, across (left to right) or down (top to bottom); the first and last stay put.',
    run: (s, i) => layoutChange(s, i.ids, 3, (ids) => distributeBoxes(s.doc, ids, i.axis === 'down' ? 'v' : 'h')) },
  { name: 'match_size', kind: 'change', input_schema: obj({ reference: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } }, mode: { type: 'string', enum: ['width', 'height', 'both'] } }),
    description: 'Give shapes the width, height or both of a reference shape (each keeps its centre).',
    run: (s, i) => {
      const ref = realOf(s, i.reference);
      if (!ref) return fail('Unknown reference id.');
      return layoutChange(s, i.ids, 1, (ids) => matchSizes(s.doc, ref, ids, i.mode === 'width' || i.mode === 'height' ? i.mode : 'both'));
    } },
  { name: 'move', kind: 'change', input_schema: obj({ ids: { type: 'array', items: { type: 'string' } }, dx: { type: 'number' }, dy: { type: 'number' } }),
    description: 'Move shapes, containers (with their contents) or text by dx, dy pixels (x grows to the right, y downwards). Attached arrows follow.',
    run: (s, i) => {
      const dx = Number(i.dx), dy = Number(i.dy);
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > MAX_MOVE || Math.abs(dy) > MAX_MOVE) return fail(`dx and dy must be numbers within ±${MAX_MOVE}.`);
      return layoutChange(s, i.ids, 1, (ids) => moveBoxes(s.doc, ids.map((id) => [id, Math.round(dx), Math.round(dy)] as const)));
    } },
  { name: 'layout_score', kind: 'check', input_schema: NONE,
    description: 'How tidy the page looks, 0–100 (higher is better), worked out by the editor: counts of arrow crossings, overlapping shapes, arrows through shapes, labels in the way, items outside their container, near-miss alignments and cramped pairs. Use it before and after layout changes; keep a change only if the score went up.',
    run: (s) => ok(layoutScore(s.doc)) },

  // check
  { name: 'lint', kind: 'check', input_schema: NONE,
    description: 'Check the page for likely mistakes: loose arrow ends, arrows through shapes, overlapping shapes, duplicate or missing step numbers, a play order that doesn’t follow the numbers, unlabelled or unconnected shapes, empty containers.',
    run: (s) => ok({ issues: lintPage(s.doc).map((x) => ({ severity: x.severity, problem: x.message, items: shorts(s, x.ids).slice(0, 30) })) }) },
  { name: 'snapshot', kind: 'check', input_schema: NONE,
    description: 'A picture (PNG) of the page as it looks now, to judge layout, spacing and readability.',
    run: async (s) => {
      const img = s.ctx.snapshot ? await s.ctx.snapshot(s.doc) : null;
      return img ? { ok: true, content: 'Snapshot of the page.', image: img } : fail('A picture of the page is not available here.');
    } },
];

const BY_NAME = new Map(DIAGRAM_TOOLS.map((t) => [t.name, t]));

/** Tool definitions for the Messages API (strict schemas), optionally only some kinds. */
/**
 * Messages API tool definitions. Tools that take input are strict (the input is guaranteed to match its schema); tools
 * without input are not, because strict adds nothing there and the API allows at most `MAX_STRICT_TOOLS` strict tools
 * per request (see `strictBudget`).
 */
export function toolDefinitions(kinds: ToolKind[] = ['read', 'change', 'check']) {
  return DIAGRAM_TOOLS.filter((t) => kinds.includes(t.kind)).map((t) => {
    // Not strict: the API compiles every strict schema in a request into one grammar, and ~20 diagram tools (two with
    // the full shape list) made it "too large". Every input is checked here anyway (parseEdits / runTool) and a bad
    // one comes back to Claude as an error, so strict adds little. Only `finish` (agent.ts) stays strict.
    return { name: t.name, description: t.description, input_schema: t.input_schema };
  });
}

/** The API's limits for strict schemas, summed over every strict tool in one request. */
export const MAX_STRICT_TOOLS = 20, MAX_UNION_PARAMS = 16, MAX_OPTIONAL_PARAMS = 24;

/** How much of the per-request strict-schema budget a tool list uses: strict tools, fields with anyOf / type lists, optional fields. */
export function strictBudget(tools: { strict?: boolean; input_schema: unknown }[]) {
  let unions = 0, optional = 0;
  const walk = (n: unknown) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (o.properties && typeof o.properties === 'object') {
      const req = new Set((o.required as string[]) ?? []);
      for (const [k, v] of Object.entries(o.properties as Record<string, Record<string, unknown>>)) {
        if (!req.has(k)) optional++;
        if (v && (v.anyOf || Array.isArray(v.type))) unions++;
      }
    }
    for (const [k, v] of Object.entries(o)) if (k !== 'enum') walk(v);
  };
  const strict = tools.filter((t) => t.strict);
  strict.forEach((t) => walk(t.input_schema));
  return { strict: strict.length, unions, optional };
}

/**
 * Run one tool call against the session (the draft changes in place). Unknown tools, bad input and anything past the
 * session's limits come back as errors for the model to read, never as exceptions.
 */
export async function runTool(s: ToolSession, name: string, input: unknown): Promise<ToolResult> {
  const t = BY_NAME.get(name);
  let r: ToolResult;
  if (!t) r = fail(`There is no tool called ${cleanText(name, 60)}.`);
  else if (s.calls >= MAX_TOOL_CALLS) r = fail('The limit of tool calls for this request has been reached; finish with what has been done.');
  else {
    s.calls++;
    const i = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    try { r = await t.run(s, i); } catch { r = fail('That tool failed.'); }
  }
  if (r.content.length > MAX_RESULT_CHARS) r = { ...r, content: `${r.content.slice(0, MAX_RESULT_CHARS)}… (cut short)` };
  s.log.push({ tool: t ? t.name : 'unknown', ok: r.ok, summary: r.content.slice(0, 200) });
  return r;
}

