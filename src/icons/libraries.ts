// Your own icon libraries: imported from SVG/PNG files, folders, Iconify JSON or shared .flowsketchlib files,
// stored in this browser (IndexedDB). Every item is converted/validated on import and validated again when
// read back, exactly like icons in a .flowsketch file.
import { create } from 'zustand';
import { createStore, del, get, keys, set } from 'idb-keyval';
import type { Asset, IconAsset } from '../model/types';
import { sanitizeAsset, sanitizeIconAsset } from '../model/schema';
import { uid } from '../model/defaults';
import { fileToAsset } from '../engine/images';
import { iconifyToSvg, svgToIcon } from './svgToIcon';

/** One library entry: a vector icon or a raster picture (placed as an image). */
export interface LibraryItem { name: string; icon?: IconAsset; picture?: Asset }
export interface IconLibrary { id: string; name: string; createdAt: string; items: LibraryItem[] }

export const MAX_LIBRARY_ITEMS = 5000;
const MAX_IMPORT_BYTES = 30 * 1024 * 1024;
export const libSetId = (libId: string) => `lib-${libId}`; // the icon-set id a library appears under

const store = typeof indexedDB !== 'undefined' ? createStore('flowsketch', 'kv') : undefined;
const KEY = (id: string) => `iconlib:${id}`;

/** "My Logo (dark).svg" → "my-logo-dark" */
export const slugName = (s: string) => s.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'icon';

/** Validate a library (from a file or from storage). Item ids are rewritten to belong to this library. */
export function sanitizeLibrary(v: unknown, id = uid('lib')): IconLibrary | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const libName = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : 'My icons';
  const raw = Array.isArray(o.items) ? o.items.slice(0, MAX_LIBRARY_ITEMS) : [];
  const items: LibraryItem[] = [];
  const names = new Set<string>();
  for (const it of raw) {
    if (typeof it !== 'object' || it === null) continue;
    const r = it as Record<string, unknown>;
    const name = uniqueName(slugName(typeof r.name === 'string' ? r.name : 'icon'), names);
    const icon = r.icon ? sanitizeIconAsset(r.icon, `${libSetId(id)}:${name}`) : null;
    const picture = !icon && r.picture ? sanitizeAsset(r.picture) : null;
    if (icon) items.push({ name, icon: { ...icon, name, set: libName, license: '' } });
    else if (picture) items.push({ name, picture });
  }
  return { id, name: libName, createdAt: typeof o.createdAt === 'string' ? o.createdAt.slice(0, 40) : new Date().toISOString(), items };
}

function uniqueName(base: string, taken: Set<string>): string {
  let n = base;
  for (let i = 2; taken.has(n); i++) n = `${base}-${i}`;
  taken.add(n);
  return n;
}

/** The text of a .flowsketchlib file. */
export function serializeLibrary(lib: IconLibrary): string {
  return JSON.stringify({ format: 'flowsketchlib', version: 1, name: lib.name, createdAt: lib.createdAt, items: lib.items });
}

interface IconifyJSON { prefix?: string; width?: number; height?: number; icons: Record<string, { body: string; width?: number; height?: number; hidden?: boolean }> }
const isIconify = (v: unknown): v is IconifyJSON => typeof v === 'object' && v !== null && typeof (v as IconifyJSON).icons === 'object';

export interface ImportResult { items: LibraryItem[]; skipped: string[]; libraryName?: string }

/** Read files into library items. Unsupported or broken files are listed in `skipped` with the reason. */
export async function importFiles(files: File[]): Promise<ImportResult> {
  const items: LibraryItem[] = [];
  const skipped: string[] = [];
  let total = 0, libraryName: string | undefined;
  for (const f of files) {
    const ext = f.name.toLowerCase().split('.').pop() ?? '';
    total += f.size;
    if (total > MAX_IMPORT_BYTES) { skipped.push(`${f.name} (over the 30 MB import limit)`); continue; }
    try {
      if (ext === 'svg' || f.type === 'image/svg+xml') {
        const name = slugName(f.name);
        items.push({ name, icon: svgToIcon(await f.text(), { id: name, name, set: '', license: '' }) });
      } else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
        items.push({ name: slugName(f.name), picture: await fileToAsset(f) });
      } else if (ext === 'json' || ext === 'flowsketchlib') {
        const json: unknown = JSON.parse(await f.text());
        if (ext === 'flowsketchlib' || (json as { format?: string }).format === 'flowsketchlib') {
          const lib = sanitizeLibrary(json);
          if (!lib) throw new Error('not a FlowSketch library');
          libraryName ??= lib.name;
          items.push(...lib.items);
        } else if (isIconify(json)) {
          libraryName ??= typeof json.prefix === 'string' ? json.prefix : undefined;
          for (const [n, ic] of Object.entries(json.icons).slice(0, MAX_LIBRARY_ITEMS)) {
            if (ic.hidden || typeof ic.body !== 'string') continue;
            try { items.push({ name: n, icon: svgToIcon(iconifyToSvg(ic.body, ic.width ?? json.width ?? 16, ic.height ?? json.height ?? 16), { id: n, name: n, set: '', license: '' }) }); } catch { /* skip empty icons */ }
          }
        } else throw new Error('not an icon set (expected Iconify JSON)');
      } else if (!f.name.startsWith('.')) skipped.push(`${f.name} (not an SVG, PNG, JPEG, GIF, WebP or icon library)`);
    } catch (e) { skipped.push(`${f.name} (${(e as Error).message.replace(/\.$/, '').toLowerCase()})`); }
  }
  return { items, skipped, libraryName };
}

// ---- the libraries in this browser ------------------------------------------

interface LibState {
  libs: IconLibrary[];
  loaded: boolean;
  load(): Promise<void>;
  /** Add items to a library (a new one when `libId` is omitted). Returns the library. */
  add(items: LibraryItem[], opts: { libId?: string; name?: string }): Promise<IconLibrary>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export const useLibraries = create<LibState>((setState, getState) => ({
  libs: [],
  loaded: false,
  async load() {
    if (!store) { setState({ loaded: true }); return; }
    const ks = (await keys(store)).filter((k): k is string => typeof k === 'string' && k.startsWith('iconlib:'));
    const libs: IconLibrary[] = [];
    for (const k of ks) { const l = sanitizeLibrary(await get(k, store), k.slice('iconlib:'.length)); if (l) libs.push(l); }
    libs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    setState({ libs, loaded: true });
  },
  async add(items, { libId, name }) {
    const existing = libId ? getState().libs.find((l) => l.id === libId) : undefined;
    const base: IconLibrary = existing ?? { id: uid('lib'), name: name?.trim().slice(0, 80) || 'My icons', createdAt: new Date().toISOString(), items: [] };
    const merged = sanitizeLibrary({ ...base, items: [...base.items, ...items] }, base.id)!;
    if (store) await set(KEY(merged.id), merged, store);
    setState((s) => ({ libs: existing ? s.libs.map((l) => (l.id === merged.id ? merged : l)) : [...s.libs, merged] }));
    return merged;
  },
  async rename(id, name) {
    const lib = getState().libs.find((l) => l.id === id);
    if (!lib || !name.trim()) return;
    const next = { ...lib, name: name.trim().slice(0, 80) };
    if (store) await set(KEY(id), next, store);
    setState((s) => ({ libs: s.libs.map((l) => (l.id === id ? next : l)) }));
  },
  async remove(id) {
    if (store) await del(KEY(id), store);
    setState((s) => ({ libs: s.libs.filter((l) => l.id !== id) }));
  },
}));
