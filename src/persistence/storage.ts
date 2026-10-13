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
