// What a draft changed compared with the page it started from (pure): items added, removed and changed on the current
// page, what kind of change each was, and plain lines for the agent panel. Used to preview an AI agent's draft.
import type { DiagramElement, FlowDocument } from '../model/types';
import { elementBounds } from '../engine/render';
import { itemName, lintPage } from '../lint/lint';

type Rect = { x: number; y: number; w: number; h: number };
export interface PageDiff {
  added: string[];
  removed: { id: string; bounds: Rect | null; name: string }[];
  changed: { id: string; what: string[] }[];
  /** Document-wide settings changed (background, theme colours, animation, loop length…). */
  settings: string[];
  lines: string[];
}

/** Which aspects of an item differ, in words. */
function aspects(a: DiagramElement, b: DiagramElement): string[] {
  const out = new Set<string>();
  const ra = a as unknown as Record<string, unknown>, rb = b as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    if (k === 'seed' || JSON.stringify(ra[k]) === JSON.stringify(rb[k])) continue;
    if (k === 'text') out.add('label');
    else if (k === 'style' || k === 'textStyle') out.add('style');
    else if (k === 'x' || k === 'y' || k === 'w' || k === 'h' || k === 'rotation' || k === 'bends' || k === 'routing' || k === 'labelPos' || k === 'labelOffset') out.add('position');
    else if (k === 'shape') out.add('shape');
    else if (k === 'start' || k === 'end') out.add('ends');
    else if (k === 'startHead' || k === 'endHead') out.add('arrowheads');
    else if (k === 'anim') out.add(JSON.stringify((ra.anim as { window?: unknown } | undefined)?.window) !== JSON.stringify((rb.anim as { window?: unknown } | undefined)?.window) ? 'play order' : 'animation');
    else if (k === 'members') out.add('contents');
    else out.add(k);
  }
  return [...out].sort();
}

export function diffPage(before: FlowDocument, after: FlowDocument): PageDiff {
  const was = new Map(before.elements.map((e) => [e.id, e]));
  const now = new Map(after.elements.map((e) => [e.id, e]));
  const added = after.elements.filter((e) => !was.has(e.id)).map((e) => e.id);
  const removed = before.elements.filter((e) => !now.has(e.id)).map((e) => ({ id: e.id, bounds: e.type === 'connector' ? null : elementBounds(before, e), name: itemName(before, e) }));
  const changed: PageDiff['changed'] = [];
  for (const e of after.elements) {
    const o = was.get(e.id);
    if (o && o !== e && JSON.stringify(o) !== JSON.stringify(e)) changed.push({ id: e.id, what: aspects(o, e) });
  }
  const settings: string[] = [];
  if (JSON.stringify(before.canvas) !== JSON.stringify(after.canvas)) settings.push('canvas');
  if (JSON.stringify(before.animation) !== JSON.stringify(after.animation)) settings.push('animation settings');
  const otherPages = (d: FlowDocument) => JSON.stringify(d.pages.filter((p) => p.id !== d.activePage));
  if (otherPages(before) !== otherPages(after)) settings.push('other pages');
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const lines = [
    ...added.map((id) => `Added ${itemName(after, now.get(id))}`),
    ...removed.map((r) => `Removed ${r.name}`),
    ...changed.filter((c) => !(c.what.length === 1 && c.what[0] === 'position' && now.get(c.id)?.type === 'connector')).map((c) => `Changed ${itemName(after, now.get(c.id))}: ${c.what.join(', ')}`),
    ...settings.map((s) => `${cap(s)} changed`),
  ];
  return { added, removed, changed, settings, lines };
}

/**
 * Problems the draft brings in that the page didn't have (the Review panel's checks; notes left out), for judging an
 * agent's result alongside its own confidence.
 */
export function newProblems(before: FlowDocument, after: FlowDocument): string[] {
  const had = new Set(lintPage(before).map((i) => `${i.rule}|${i.message}`));
  return lintPage(after).filter((i) => i.severity !== 'info' && !had.has(`${i.rule}|${i.message}`)).map((i) => i.message).slice(0, 20);
}
