// Icon sets: the built-in ones (open-licence Iconify packages) and your own libraries. Each built-in set's
// data is a separate file the browser downloads the first time it is shown (then it comes from the cache),
// so the app's normal load is unchanged. A small names index (names.json) lets search cover every set
// without downloading them all.
import tablerUrl from '@iconify-json/tabler/icons.json?url';
import deviconUrl from '@iconify-json/devicon/icons.json?url';
import logosUrl from '@iconify-json/logos/icons.json?url';
import simpleUrl from '@iconify-json/simple-icons/icons.json?url';
import k8sUrl from '@iconify-json/k8s/icons.json?url';
import type { Asset, IconAsset } from '../model/types';
import { iconifyToSvg, svgToIcon } from './svgToIcon';
import { libSetId, useLibraries, type IconLibrary } from './libraries';
import type { Vendor } from './zipImport';

/** How one of your libraries appears as a set. */
export const libInfo = (l: IconLibrary): IconSetInfo => ({ id: libSetId(l.id), name: l.name, group: l.name, license: '', ...(l.vendor ? { vendor: l.vendor } : {}) });

export interface IconSetInfo {
  id: string;
  name: string;
  group: string; // short label for the panel's filter chips
  license: string;
  brands?: boolean; // logos of companies and products (trademarks of their owners)
  url?: string; // built-in sets only
  vendor?: Vendor; // an official cloud-provider package imported by the user
}

// keep the ids in sync with scripts/build-icon-index.mjs
export const ICON_SETS: IconSetInfo[] = [
  { id: 'tabler', name: 'Tabler Icons', group: 'General', license: 'MIT', url: tablerUrl },
  { id: 'devicon', name: 'Devicon', group: 'Software', license: 'MIT', brands: true, url: deviconUrl },
  { id: 'logos', name: 'SVG Logos', group: 'Logos', license: 'CC0', brands: true, url: logosUrl },
  { id: 'simple-icons', name: 'Simple Icons', group: 'Brands', license: 'CC0', brands: true, url: simpleUrl },
  { id: 'k8s', name: 'Kubernetes', group: 'Kubernetes', license: 'Apache-2.0', url: k8sUrl },
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
  names: string[]; // visible items, sorted
  icon(name: string): IconAsset | null; // vector icons (converted on first use, then cached)
  picture?(name: string): Asset | null; // raster pictures in your own libraries
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
/** Built-in sets already downloaded in this session (the panel previews only these, plus the first set). */
export const loadedSets = new Set<string>();

/** A built-in set or one of your libraries, by id. */
export function loadIconSet(id: string): Promise<IconSet> {
  const lib = useLibraries.getState().libs.find((l) => libSetId(l.id) === id);
  if (lib) {
    const byName = new Map(lib.items.map((it) => [it.name, it]));
    return Promise.resolve({
      info: libInfo(lib),
      names: lib.items.map((it) => it.name).sort(),
      icon: (n) => byName.get(n)?.icon ?? null,
      picture: (n) => byName.get(n)?.picture ?? null,
    });
  }
  const info = ICON_SETS.find((s) => s.id === id);
  if (!info?.url) return Promise.reject(new Error(`This icon set is not available (${id}).`));
  let p = loading.get(id);
  if (!p) {
    p = fetch(info.url).then((r) => { if (!r.ok) throw new Error(`Could not load ${info.name} (${r.status}).`); return r.json(); })
      .then((json: IconifyJSON) => { loadedSets.add(id); return iconSetFromJSON(info, json); });
    p.catch(() => loading.delete(id)); // allow a retry after a failed download
    loading.set(id, p);
  }
  return p;
}

let namesIndex: Promise<Record<string, string[]>> | null = null;
/** Visible icon names of every built-in set (about 50 KB), for searching across sets. */
export function loadNamesIndex(): Promise<Record<string, string[]>> {
  namesIndex ??= import('./names.json').then((m) => m.default as Record<string, string[]>);
  return namesIndex;
}

/** Name search: whole-name match first, then names starting with the query, then words, then substrings. */
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
