// Local persistence: IndexedDB (via idb-keyval) for autosave, recent documents and custom templates.
// Nothing ever leaves the browser.
import { createStore, del, get, set, keys } from 'idb-keyval';
import type { FlowDocument } from '../model/types';
import { parseDocument, serializeDocument } from '../model/schema';

const store = typeof indexedDB !== 'undefined' ? createStore('flowsketch', 'kv') : undefined;

export interface RecentEntry { id: string; title: string; updatedAt: string; elements: number }

const AUTOSAVE_KEY = 'autosave:current';

export async function autosave(doc: FlowDocument): Promise<void> {
  if (!store) return;
  const json = serializeDocument(doc);
  await set(AUTOSAVE_KEY, json, store);
  await set(`doc:${doc.id}`, json, store);
  const recents = ((await get<RecentEntry[]>('recents', store)) ?? []).filter((r) => r.id !== doc.id);
  recents.unshift({ id: doc.id, title: doc.title, updatedAt: new Date().toISOString(), elements: doc.elements.length });
  const keep = recents.slice(0, 12);
  for (const r of recents.slice(12)) await del(`doc:${r.id}`, store);
  await set('recents', keep, store);
}

export async function loadAutosave(): Promise<FlowDocument | null> {
  if (!store) return null;
  const raw = await get<string>(AUTOSAVE_KEY, store);
  if (!raw) return null;
  try { return parseDocument(raw).doc; } catch { return null; }
}

export async function listRecents(): Promise<RecentEntry[]> {
  if (!store) return [];
  return (await get<RecentEntry[]>('recents', store)) ?? [];
}

export async function loadRecent(id: string): Promise<FlowDocument | null> {
  if (!store) return null;
  const raw = await get<string>(`doc:${id}`, store);
  return raw ? parseDocument(raw).doc : null;
}

export async function removeRecent(id: string): Promise<void> {
  if (!store) return;
  await del(`doc:${id}`, store);
  await set('recents', ((await get<RecentEntry[]>('recents', store)) ?? []).filter((r) => r.id !== id), store);
}

// ---- custom templates ----
export interface CustomTemplate { id: string; title: string; json: string; createdAt: string }

export async function listCustomTemplates(): Promise<CustomTemplate[]> {
  if (!store) return [];
  const ks = (await keys(store)).filter((k): k is string => typeof k === 'string' && k.startsWith('tpl:'));
  const out: CustomTemplate[] = [];
  for (const k of ks) { const t = await get<CustomTemplate>(k, store); if (t) out.push(t); }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveCustomTemplate(doc: FlowDocument): Promise<void> {
  if (!store) throw new Error('Browser storage is unavailable.');
  const id = `${Date.now()}`;
  await set(`tpl:${id}`, { id, title: doc.title, json: serializeDocument(doc), createdAt: new Date().toISOString() }, store);
}

export async function deleteCustomTemplate(id: string): Promise<void> {
  if (store) await del(`tpl:${id}`, store);
}

// The last text inserted with Diagram from text (or pasted as a diagram), shown again next time the dialog opens.
// localStorage: a convenience for this browser only. Read back as plain text and capped; it is parsed like any
// other untrusted Mermaid input when inserted.
const LAST_MERMAID = 'flowsketch:lastMermaid';
const MAX_MERMAID_CHARS = 100_000;

export function rememberMermaid(text: string): void {
  try { if (text.trim() && text.length <= MAX_MERMAID_CHARS) localStorage.setItem(LAST_MERMAID, text); } catch { /* storage unavailable: nothing to remember */ }
}

export function lastMermaid(): string | null {
  try {
    const t = localStorage.getItem(LAST_MERMAID);
    return typeof t === 'string' && t.trim() && t.length <= MAX_MERMAID_CHARS ? t : null;
  } catch { return null; }
}

// Claude's last review of each diagram page (AI ▸ Review this page ▸ Show last review), with the findings marked
// fixed. IndexedDB holds the reviews; a small index in localStorage (key + time, newest first, ≤ MAX_REVIEWS) says at
// once whether a page has one (for the menu) and which old ones to drop. What is read back is checked again by
// `cleanStoredReview` before it is shown.
const REVIEW_INDEX = 'flowsketch:aiReviewIndex';
const MAX_REVIEWS = 30;
const reviewKey = (docId: string, pageId: string) => `aiReview:${docId}:${pageId}`;
const memReviews = new Map<string, unknown>(); // when IndexedDB isn't there (tests, some private windows)

function reviewIndex(): { key: string; at: number }[] {
  try {
    const o = JSON.parse(localStorage.getItem(REVIEW_INDEX) ?? '[]') as unknown;
    return Array.isArray(o) ? o.filter((e): e is { key: string; at: number } => !!e && typeof e.key === 'string' && e.key.startsWith('aiReview:') && e.key.length < 300 && typeof e.at === 'number').slice(0, MAX_REVIEWS) : [];
  } catch { return []; }
}

/** Whether this page has a saved review (synchronous, for menus). */
export function hasSavedReview(docId: string, pageId: string): boolean {
  const k = reviewKey(docId, pageId);
  return reviewIndex().some((e) => e.key === k);
}

export async function saveReview(review: { docId: string; pageId: string; at: number }): Promise<void> {
  const k = reviewKey(review.docId, review.pageId);
  const index = [{ key: k, at: Date.now() }, ...reviewIndex().filter((e) => e.key !== k)];
  const keep = index.slice(0, MAX_REVIEWS), gone = index.slice(MAX_REVIEWS);
  try { localStorage.setItem(REVIEW_INDEX, JSON.stringify(keep)); } catch { /* storage unavailable */ }
  if (!store) { memReviews.set(k, structuredClone(review)); gone.forEach((e) => memReviews.delete(e.key)); return; }
  await set(k, review, store);
  await Promise.all(gone.map((e) => del(e.key, store)));
}

/** The saved review of this page, unchecked (the caller runs it through cleanStoredReview). */
export async function loadReview(docId: string, pageId: string): Promise<unknown> {
  const k = reviewKey(docId, pageId);
  if (!hasSavedReview(docId, pageId)) return null;
  if (!store) return memReviews.get(k) ?? null;
  return (await get(k, store)) ?? null;
}
