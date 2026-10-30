// Persistent document state + undo/redo history.
// History entries are whole immutable document snapshots (structural sharing keeps them cheap).
import { create } from 'zustand';
import type { BoxElement, ConnectorElement, DiagramElement, FlowDocument } from '../model/types';
import { newDocument } from '../model/defaults';
import { elementBounds } from '../engine/render';

const HISTORY_LIMIT = 200;

interface DocState {
  doc: FlowDocument;
  past: FlowDocument[];
  future: FlowDocument[];
  dirty: boolean; // unsaved to a file
  revision: number; // bumps on every change (render invalidation, autosave)
  fileName: string | null;
  lastSavedAt: number | null;
  autosavedAt: number | null;
}

interface DocActions {
  load(doc: FlowDocument, opts?: { fileName?: string | null; dirty?: boolean }): void;
  commit(update: (d: FlowDocument) => FlowDocument, coalesceKey?: string): void;
  begin(): void;
  live(update: (d: FlowDocument) => FlowDocument): void;
  end(): void;
  cancel(): void;
  undo(): void;
  redo(): void;
  /** Drop the most recent history entry, restoring the document before it (no redo entry). */
  revertLast(): void;
  markSaved(fileName?: string | null): void;
  markAutosaved(): void;
}

let txBase: FlowDocument | null = null;
let lastKey: string | undefined;
let lastTime = 0;

export const useDoc = create<DocState & DocActions>((set, get) => ({
  doc: newDocument(),
  past: [],
  future: [],
  dirty: false,
  revision: 0,
  fileName: null,
  lastSavedAt: null,
  autosavedAt: null,

  load(doc, opts) {
    txBase = null; lastKey = undefined;
    set((s) => ({ doc, past: [], future: [], dirty: opts?.dirty ?? false, revision: s.revision + 1, fileName: opts?.fileName ?? null, lastSavedAt: null }));
  },

  commit(update, coalesceKey) {
    const prev = get().doc;
    const next = update(prev);
    if (next === prev) return;
    const now = Date.now();
    const coalesce = !!coalesceKey && coalesceKey === lastKey && now - lastTime < 1200;
    lastKey = coalesceKey; lastTime = now;
    set((s) => ({
      doc: next,
      past: coalesce ? s.past : [...s.past, prev].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
      revision: s.revision + 1,
    }));
  },

  begin() { txBase = get().doc; lastKey = undefined; },
  live(update) {
    const next = update(get().doc);
    if (next !== get().doc) set((s) => ({ doc: next, revision: s.revision + 1 }));
  },
  end() {
    const base = txBase;
    txBase = null;
    if (!base || base === get().doc) return;
    set((s) => ({ past: [...s.past, base].slice(-HISTORY_LIMIT), future: [], dirty: true }));
  },
  cancel() {
    const base = txBase;
    txBase = null;
    if (base) set((s) => ({ doc: base, revision: s.revision + 1 }));
  },

  undo() {
    const { past, doc } = get();
    if (!past.length) return;
    lastKey = undefined;
    set((s) => ({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...s.future], dirty: true, revision: s.revision + 1 }));
  },
  redo() {
    const { future, doc } = get();
    if (!future.length) return;
    lastKey = undefined;
    set((s) => ({ doc: future[0], future: future.slice(1), past: [...s.past, doc], dirty: true, revision: s.revision + 1 }));
  },
  revertLast() {
    const { past } = get();
    if (!past.length) return;
    lastKey = undefined;
    set((s) => ({ doc: past[past.length - 1], past: past.slice(0, -1), revision: s.revision + 1 }));
  },
  markSaved(fileName) { set((s) => ({ dirty: false, lastSavedAt: Date.now(), fileName: fileName ?? s.fileName })); },
  markAutosaved() { set({ autosavedAt: Date.now() }); },
}));

// ---- pure document helpers ---------------------------------------------------

export function mapElements(doc: FlowDocument, ids: Set<string> | string[], fn: (e: DiagramElement) => DiagramElement): FlowDocument {
  const set = ids instanceof Set ? ids : new Set(ids);
  let changed = false;
  const elements = doc.elements.map((e) => {
    if (!set.has(e.id)) return e;
    const n = fn(e);
    if (n !== e) changed = true;
    return n;
  });
  return changed ? { ...doc, elements } : doc;
}

export function getElement(doc: FlowDocument, id: string | null | undefined): DiagramElement | undefined {
  return id ? doc.elements.find((e) => e.id === id) : undefined;
}

/** Delete elements; connectors attached to deleted shapes are detached at their current position. */
export function deleteElements(doc: FlowDocument, ids: Set<string>): FlowDocument {
  if (!ids.size) return doc;
  const removed = doc.elements.filter((e) => ids.has(e.id));
  const removedBoxes = new Map(removed.filter((e): e is BoxElement => e.type !== 'connector').map((e) => [e.id, e]));
  const elements = doc.elements.filter((e) => !ids.has(e.id)).map((e) => {
    if (e.type !== 'connector') return e;
    let c: ConnectorElement = e;
    for (const k of ['start', 'end'] as const) {
      const end = c[k];
      const box = end.elementId ? removedBoxes.get(end.elementId) : undefined;
      if (box) c = { ...c, [k]: { x: box.x + box.w / 2, y: box.y + box.h / 2, elementId: null, anchor: null } };
    }
    return c;
  });
  // drop image and icon data no longer referenced
  const used = new Set(elements.filter((e) => e.type === 'image').map((e) => (e as { assetId: string }).assetId));
  const assets = Object.fromEntries(Object.entries(doc.assets).filter(([k]) => used.has(k)));
  const usedIcons = new Set(elements.flatMap((e) => (e.type === 'icon' ? [e.iconId] : [])));
  const icons = Object.fromEntries(Object.entries(doc.icons).filter(([k]) => usedIcons.has(k)));
  return { ...doc, elements, assets, icons };
}

/** Union of the static bounds of the given elements. */
export function selectionBounds(doc: FlowDocument, ids: string[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const e = getElement(doc, id);
    if (!e) continue;
    const b = elementBounds(doc, e);
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
