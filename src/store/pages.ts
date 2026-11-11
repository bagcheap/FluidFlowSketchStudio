// Pages (tabs): several diagrams in one document. The current page's elements live in doc.elements, so every
// editing command, export and the renderer work on the current page without knowing about pages.
import type { FlowDocument, Page } from '../model/types';
import { uid } from '../model/defaults';
import { allPages, MAX_PAGES } from '../model/schema';

export { allPages };

/** Show page `id`: the current elements go back into their page, the target's come out. */
export function switchPage(doc: FlowDocument, id: string): FlowDocument {
  if (id === doc.activePage) return doc;
  const target = doc.pages.find((p) => p.id === id);
  if (!target) return doc;
  return {
    ...doc,
    pages: doc.pages.map((p) => (p.id === doc.activePage ? { ...p, elements: doc.elements } : p.id === id ? { ...p, elements: [] } : p)),
    activePage: id,
    elements: target.elements,
  };
}

/** A name not used by another page: "Page 3", or "Name (2)". */
export function uniquePageName(doc: FlowDocument, base?: string): string {
  const taken = new Set(doc.pages.map((p) => p.name));
  if (base && !taken.has(base)) return base;
  if (base) { for (let i = 2; ; i++) if (!taken.has(`${base} (${i})`)) return `${base} (${i})`; }
  for (let i = doc.pages.length + 1; ; i++) if (!taken.has(`Page ${i}`)) return `Page ${i}`;
}

/** Add an empty page after the current one and switch to it. */
export function addPage(doc: FlowDocument, name?: string): FlowDocument {
  if (doc.pages.length >= MAX_PAGES) return doc;
  const page: Page = { id: uid('page'), name: uniquePageName(doc, name?.trim() || undefined), elements: [] };
  const at = doc.pages.findIndex((p) => p.id === doc.activePage) + 1;
  const withPage = { ...doc, pages: [...doc.pages.slice(0, at), page, ...doc.pages.slice(at)] };
  return switchPage(withPage, page.id);
}

/** Copy a page (new ids throughout, so arrows and containers point at the copies) and switch to the copy. */
export function duplicatePage(doc: FlowDocument, id: string, clone: (els: FlowDocument['elements']) => FlowDocument['elements']): FlowDocument {
  if (doc.pages.length >= MAX_PAGES) return doc;
  const src = allPages(doc).find((p) => p.id === id);
  if (!src) return doc;
  const page: Page = { id: uid('page'), name: uniquePageName(doc, `${src.name} copy`), elements: clone(src.elements) };
  const at = doc.pages.findIndex((p) => p.id === id) + 1;
  return switchPage({ ...doc, pages: [...doc.pages.slice(0, at), page, ...doc.pages.slice(at)] }, page.id);
}

/** Delete a page (never the last one). Deleting the current page shows its neighbour. Icon/picture data is kept. */
export function deletePage(doc: FlowDocument, id: string): FlowDocument {
  if (doc.pages.length <= 1) return doc;
  const i = doc.pages.findIndex((p) => p.id === id);
  if (i < 0) return doc;
  let out = doc;
  if (id === doc.activePage) out = switchPage(doc, doc.pages[i + 1]?.id ?? doc.pages[i - 1].id);
  return pruneData({ ...out, pages: out.pages.filter((p) => p.id !== id) });
}

/** Drop icon and picture data no page uses any more. */
export function pruneData(doc: FlowDocument): FlowDocument {
  const els = allPages(doc).flatMap((p) => p.elements);
  const icons = new Set(els.flatMap((e) => (e.type === 'icon' ? [e.iconId] : [])));
  const assets = new Set(els.flatMap((e) => (e.type === 'image' ? [e.assetId] : [])));
  return {
    ...doc,
    icons: Object.fromEntries(Object.entries(doc.icons).filter(([k]) => icons.has(k))),
    assets: Object.fromEntries(Object.entries(doc.assets).filter(([k]) => assets.has(k))),
  };
}

export function renamePage(doc: FlowDocument, id: string, name: string): FlowDocument {
  const n = name.trim().slice(0, 60);
  if (!n) return doc;
  return { ...doc, pages: doc.pages.map((p) => (p.id === id ? { ...p, name: n } : p)) };
}

/** Move a page one place left (-1) or right (+1) in the tab order. */
export function movePage(doc: FlowDocument, id: string, by: -1 | 1): FlowDocument {
  const i = doc.pages.findIndex((p) => p.id === id), j = i + by;
  if (i < 0 || j < 0 || j >= doc.pages.length) return doc;
  const pages = [...doc.pages];
  [pages[i], pages[j]] = [pages[j], pages[i]];
  return { ...doc, pages };
}
