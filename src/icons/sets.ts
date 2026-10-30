// Built-in icon sets. Each set's data is a separate file that the browser downloads the first time the
// Icons panel opens it (then it comes from the cache), so the app's normal load is unchanged.
import tablerUrl from '@iconify-json/tabler/icons.json?url';
import type { IconAsset } from '../model/types';
import { iconifyToSvg, svgToIcon } from './svgToIcon';

export interface IconSetInfo { id: string; name: string; license: string; url: string }

export const ICON_SETS: IconSetInfo[] = [
  { id: 'tabler', name: 'Tabler Icons', license: 'MIT', url: tablerUrl },
];

interface IconifyJSON {
  prefix: string;
  width?: number;
  height?: number;
  icons: Record<string, { body: string; width?: number; height?: number; hidden?: boolean }>;
  aliases?: Record<string, { parent: string }>;
}

export interface IconSet {
  info: IconSetInfo;
  names: string[]; // visible icons, sorted
  icon(name: string): IconAsset | null; // converted on first use, then cached
}

/** Build a set from Iconify JSON (the format the built-in sets ship in). */
export function iconSetFromJSON(info: IconSetInfo, json: IconifyJSON): IconSet {
  const cache = new Map<string, IconAsset | null>();
  const names = Object.keys(json.icons).filter((n) => !json.icons[n].hidden).sort();
  return {
    info,
    names,
    icon(name) {
      if (cache.has(name)) return cache.get(name)!;
      const key = json.icons[name] ? name : json.aliases?.[name]?.parent;
      const src = key ? json.icons[key] : undefined;
      let out: IconAsset | null = null;
      if (src) {
        const w = src.width ?? json.width ?? 16, h = src.height ?? json.height ?? 16;
        try { out = svgToIcon(iconifyToSvg(src.body, w, h), { id: `${info.id}:${name}`, name, set: info.name, license: info.license }); } catch { out = null; }
      }
      cache.set(name, out);
      return out;
    },
  };
}

const loading = new Map<string, Promise<IconSet>>();

export function loadIconSet(id: string): Promise<IconSet> {
  const info = ICON_SETS.find((s) => s.id === id);
  if (!info) return Promise.reject(new Error(`Unknown icon set "${id}".`));
  let p = loading.get(id);
  if (!p) {
    p = fetch(info.url).then((r) => { if (!r.ok) throw new Error(`Could not load ${info.name} (${r.status}).`); return r.json(); })
      .then((json: IconifyJSON) => iconSetFromJSON(info, json));
    p.catch(() => loading.delete(id)); // allow a retry after a failed download
    loading.set(id, p);
  }
  return p;
}

/** Name search: whole-name match first, then names starting with the query, then containing it. */
export function searchNames(names: string[], query: string, limit = 300): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, '-');
  if (!q) return names.slice(0, limit);
  const exact: string[] = [], starts: string[] = [], word: string[] = [], has: string[] = [];
  for (const n of names) {
    if (n === q) exact.push(n);
    else if (n.startsWith(q)) starts.push(n);
    else if (n.includes('-' + q)) word.push(n);
    else if (n.includes(q)) has.push(n);
  }
  return [...exact, ...starts, ...word, ...has].slice(0, limit);
}

/** "server-2" → "Server 2" */
export const iconTitle = (name: string) => name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
