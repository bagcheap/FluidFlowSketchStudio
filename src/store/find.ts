// Find and replace (pure): text in shapes, text boxes, arrow labels, container titles, icon labels and hover notes,
// on the current page or every page. Matches are listed page by page in tab order, then top to bottom, left to right.
import type { DiagramElement, FlowDocument } from '../model/types';
import { allPages } from '../model/schema';
import { MAX_NOTE, MAX_TEXT } from '../model/schema';
import { connectorPath } from '../engine/connectors';
import { makeLookup } from '../engine/render';

export interface FindOptions { matchCase: boolean; allPages: boolean }
/** One occurrence: in item `id` on page `pageId`, in its label (`text`) or its hover note (`note`), at `at`. */
export interface Match { pageId: string; id: string; field: 'text' | 'note'; at: number; len: number }

/** Where each occurrence of `q` starts in `s` (no overlaps). */
function occurrences(s: string, q: string, matchCase: boolean): number[] {
  if (!q) return [];
  const hay = matchCase ? s : s.toLowerCase(), needle = matchCase ? q : q.toLowerCase();
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i >= 0 && out.length < 1000; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}


/** Every match, in order. At most 5,000. */
export function findMatches(doc: FlowDocument, query: string, o: FindOptions): Match[] {
  const out: Match[] = [];
  if (!query) return out;
  const pages = o.allPages ? allPages(doc) : allPages(doc).filter((p) => p.id === doc.activePage);
  for (const page of pages) {
    // reading order: top to bottom, then left to right (an arrow by where it starts)
    const look = makeLookup({ ...doc, elements: page.elements }, null);
    const key = new Map(page.elements.map((e) => {
      const p = e.type === 'connector' ? connectorPath(e, look).pts[0] ?? e.start : e;
      return [e.id, [p.y, p.x]] as const;
    }));
    const els = [...page.elements].sort((a, b) => { const [ay, ax] = key.get(a.id)!, [by, bx] = key.get(b.id)!; return ay - by || ax - bx; });
    for (const e of els) {
      for (const field of ['text', 'note'] as const) {
        const s = field === 'text' ? e.text : e.note ?? '';
        for (const at of occurrences(s, query, o.matchCase)) {
          out.push({ pageId: page.id, id: e.id, field, at, len: query.length });
          if (out.length >= 5000) return out;
        }
      }
    }
  }
  return out;
}

function replaceIn(s: string, query: string, by: string, matchCase: boolean, only?: number): { s: string; n: number } {
  const at = occurrences(s, query, matchCase).filter((i) => only === undefined || i === only);
  let out = s;
  for (const i of [...at].reverse()) out = out.slice(0, i) + by + out.slice(i + query.length);
  return { s: out, n: at.length };
}

/** Apply `edit` to the elements of every page the options cover (the current page's live in doc.elements). */
function onPages(doc: FlowDocument, o: FindOptions, edit: (els: DiagramElement[]) => DiagramElement[]): FlowDocument {
  return {
    ...doc,
    elements: edit(doc.elements),
    pages: doc.pages.map((p) => (p.id === doc.activePage || !o.allPages ? p : { ...p, elements: edit(p.elements) })),
  };
}

function replaceElement(e: DiagramElement, query: string, by: string, matchCase: boolean, field?: 'text' | 'note', only?: number): { e: DiagramElement; n: number } {
  let n = 0, next = e;
  if (!field || field === 'text') {
    const r = replaceIn(e.text, query, by, matchCase, only);
    if (r.n) { next = { ...next, text: r.s.slice(0, MAX_TEXT) }; n += r.n; }
  }
  if ((!field || field === 'note') && e.note) {
    const r = replaceIn(e.note, query, by, matchCase, only);
    if (r.n) { n += r.n; next = r.s.trim() ? { ...next, note: r.s.slice(0, MAX_NOTE) } : (({ note: _n, ...rest }) => rest)(next) as DiagramElement; }
  }
  return { e: next, n };
}

/** Replace every match (locked items are left alone). Returns the new document and how many were replaced. */
export function replaceAll(doc: FlowDocument, query: string, by: string, o: FindOptions): { doc: FlowDocument; count: number; locked: number } {
  let count = 0, locked = 0;
  if (!query) return { doc, count, locked };
  const out = onPages(doc, o, (els) => els.map((e) => {
    const r = replaceElement(e, query, by, o.matchCase);
    if (!r.n) return e;
    if (e.locked) { locked += r.n; return e; }
    count += r.n;
    return r.e;
  }));
  // pages not covered by the options are untouched; the current page always is covered
  return { doc: count ? out : doc, count, locked };
}

/** Replace one match (if it is still there and its item isn't locked). */
export function replaceOne(doc: FlowDocument, m: Match, query: string, by: string, matchCase: boolean): FlowDocument | null {
  const edit = (els: DiagramElement[]) => els.map((e) => (e.id === m.id && !e.locked ? replaceElement(e, query, by, matchCase, m.field, m.at).e : e));
  const pageEls = m.pageId === doc.activePage ? doc.elements : doc.pages.find((p) => p.id === m.pageId)?.elements;
  const target = pageEls?.find((e) => e.id === m.id);
  if (!target || target.locked) return null;
  if (m.pageId === doc.activePage) return { ...doc, elements: edit(doc.elements) };
  return { ...doc, pages: doc.pages.map((p) => (p.id === m.pageId ? { ...p, elements: edit(p.elements) } : p)) };
}
