// ZIP import: official AWS / Azure / Google Cloud icon packages (downloaded by the user from the provider)
// or any ZIP of SVG icons. Only .svg entries are read (nested ZIPs one level deep); everything goes through
// svgToIcon like any other import.
import { unzipSync, type Unzipped } from 'fflate';
import type { IconAsset } from '../model/types';
import { svgToIcon } from './svgToIcon';

export type Vendor = 'aws' | 'azure' | 'gcp';
export const VENDORS: Record<Vendor, { name: string; library: string; terms: string; url: string; note?: string }> = {
  aws: { name: 'AWS', library: 'AWS Architecture Icons', terms: 'AWS terms', url: 'https://aws.amazon.com/architecture/icons/' },
  azure: { name: 'Microsoft Azure', library: 'Azure Icons', terms: 'Microsoft terms', url: 'https://learn.microsoft.com/azure/architecture/icons/', note: 'Microsoft’s terms ask that Azure icons are not cropped, flipped or rotated.' },
  gcp: { name: 'Google Cloud', library: 'Google Cloud Icons', terms: 'Google terms', url: 'https://cloud.google.com/icons' },
};

const MAX_ZIP_BYTES = 300 * 1024 * 1024;
const MAX_SVG_BYTES = 2 * 1024 * 1024;

/** Which provider a package comes from, judged from its file name and folder layout. */
export function detectVendor(paths: string[], zipName: string): Vendor | null {
  const all = `${zipName}\n${paths.slice(0, 400).join('\n')}`;
  if (/Architecture-Service-Icons|Resource-Icons_|(^|\/)Arch_|(^|\/)Res_|Asset-Package/i.test(all)) return 'aws';
  if (/icon-service-|Azure_Public_Service_Icons|azure/i.test(all)) return 'azure';
  if (/google|gcp/i.test(all)) return 'gcp';
  return null;
}

const SIZE = /^(\d{2,3})(x\d{2,3})?$/; // a folder named for an icon size: "64", "32x32"
const clean = (s: string) => s
  .replace(/\.svg$/i, '')
  .replace(/^(Arch-Category|Arch-Group|Arch|Res)[_-]/i, '') // AWS prefixes
  .replace(/^\d+-icon-service-/i, '') // Azure prefix
  .replace(/[_-](Light|Dark)(?=$|[_-])/gi, '')
  .replace(/[_-](16|24|32|48|64|80|128)(?=$|[_-])/g, '')
  .replace(/[_-]\d{6,8}$/, ''); // release dates on folder names
const title = (s: string) => clean(s).replace(/[_-]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
const slug = (s: string) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'icon';

export interface PackPick { path: string; name: string; category: string }

/**
 * Choose one SVG per icon: the light-background variant, at the largest size (vendor packs repeat each icon
 * at several sizes and in light/dark versions), named without vendor prefixes and grouped by folder.
 */
export function planPack(paths: string[]): PackPick[] {
  const best = new Map<string, { path: string; score: number; name: string; category: string }>();
  for (const path of paths) {
    const parts = path.split('/').filter(Boolean);
    const file = parts.pop() ?? '';
    if (!/\.svg$/i.test(file) || parts.some((p) => p === '__MACOSX' || p.startsWith('.')) || file.startsWith('.')) continue;
    const dir = [...parts].reverse().find((p) => !SIZE.test(p));
    const category = dir && parts.length > 0 ? title(dir) || 'Icons' : 'Icons';
    const name = slug(file);
    const size = Math.max(0, ...[...file.matchAll(/[_-](16|24|32|48|64|80|128)(?=$|[_.-])/g)].map((m) => +m[1]), ...parts.filter((p) => SIZE.test(p)).map((p) => parseInt(p, 10)));
    const score = (/[_-]Dark(?=$|[_.-])/i.test(file) ? -1000 : 0) + (size || 50);
    const key = `${category}\n${name}`;
    const prev = best.get(key);
    if (!prev || score > prev.score) best.set(key, { path, score, name, category });
  }
  return [...best.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)).map(({ path, name, category }) => ({ path, name, category }));
}

/** Read the SVG entries of a ZIP (and of ZIPs inside it, one level deep). */
export function readZipSvgs(data: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const read = (buf: Uint8Array, prefix: string, depth: number) => {
    let files: Unzipped;
    try {
      files = unzipSync(buf, { filter: (f) => (/\.svg$/i.test(f.name) && f.originalSize <= MAX_SVG_BYTES) || (depth === 0 && /\.zip$/i.test(f.name) && f.originalSize <= MAX_ZIP_BYTES) });
    } catch { throw new Error('this ZIP file could not be read'); }
    const decoder = new TextDecoder();
    for (const [name, bytes] of Object.entries(files)) {
      if (/\.zip$/i.test(name)) read(bytes, `${prefix}${name.replace(/\.zip$/i, '')}/`, depth + 1);
      else out.set(prefix + name, decoder.decode(bytes));
    }
  };
  read(data, '', 0);
  return out;
}

export interface ZipImport { items: { name: string; category: string; icon: IconAsset }[]; skipped: string[]; libraryName: string; vendor: Vendor | null }

/** Turn a ZIP file into library items. `onProgress` is called while converting (large packs hold thousands of icons). */
export async function importZip(file: File, onProgress?: (done: number, total: number) => void): Promise<ZipImport> {
  if (file.size > MAX_ZIP_BYTES) throw new Error('this ZIP is larger than 300 MB');
  return importZipBytes(new Uint8Array(await file.arrayBuffer()), file.name, onProgress);
}

export async function importZipBytes(data: Uint8Array, fileName: string, onProgress?: (done: number, total: number) => void): Promise<ZipImport> {
  const svgs = readZipSvgs(data);
  const vendor = detectVendor([...svgs.keys()], fileName);
  const picks = planPack([...svgs.keys()]);
  if (!picks.length) throw new Error('no SVG icons in this ZIP');
  const items: ZipImport['items'] = [];
  const skipped: string[] = [];
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i];
    try { items.push({ name: p.name, category: p.category, icon: svgToIcon(svgs.get(p.path)!, { id: p.name, name: p.name, set: '', license: '' }) }); } catch (e) { skipped.push(`${p.path} (${(e as Error).message.replace(/\.$/, '').toLowerCase()})`); }
    if (i % 40 === 39) { onProgress?.(i + 1, picks.length); await new Promise((r) => setTimeout(r, 0)); } // keep the page responsive
  }
  onProgress?.(picks.length, picks.length);
  return { items, skipped, libraryName: vendor ? VENDORS[vendor].library : fileName.replace(/\.zip$/i, ''), vendor };
}
