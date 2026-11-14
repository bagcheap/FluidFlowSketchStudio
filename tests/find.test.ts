import { describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { findMatches, replaceAll, replaceOne } from '../src/store/find';
import { addPage, switchPage } from '../src/store/pages';
import { closeFind, currentMatches, findNext, goToMatch, openFind, replaceAllMatches, replaceCurrent } from '../src/store/commands';
import { useDoc } from '../src/store/docStore';
import { useUI } from '../src/store/uiStore';
import type { FlowDocument } from '../src/model/types';

const t = defaultToolStyle('shape:rectangle');
const box = (x: number, y: number, text: string, extra = {}) => ({ ...makeShape('rectangle', x, y, 120, 60, t), text, ...extra });

/** Page 1: three boxes and an arrow; page 2: one box. Page 1 is current. */
function twoPages(): FlowDocument {
  const a = box(300, 0, 'Token vault'), b = box(0, 0, 'Get token'), c = box(0, 200, 'Portal', { note: 'Refreshes the TOKEN' });
  const arrow = { ...makeConnector({ x: 0, y: 0, elementId: b.id }, { x: 0, y: 0, elementId: a.id }, defaultToolStyle('arrow')), text: '2. Send token' };
  let doc: FlowDocument = { ...newDocument(), elements: [a, b, c, arrow] };
  const p1 = doc.activePage;
  doc = addPage(doc, 'Detail');
  doc = { ...doc, elements: [box(0, 0, 'Token exchange')] };
  return switchPage(doc, p1);
}

const goToPageBack = () => goToMatch(0);

describe('find', () => {
  it('finds text in labels, arrow labels and notes, page by page, top to bottom then left to right; ignores case unless asked', () => {
    const doc = twoPages();
    const ms = findMatches(doc, 'token', { matchCase: false, allPages: true });
    const text = (m: (typeof ms)[number]) => { const els = m.pageId === doc.activePage ? doc.elements : doc.pages.find((p) => p.id === m.pageId)!.elements; return els.find((e) => e.id === m.id)![m.field] ?? ''; };
    expect(ms.map(text)).toEqual(['Get token', 'Token vault', '2. Send token', 'Refreshes the TOKEN', 'Token exchange']);
    expect(ms.at(-1)!.pageId).not.toBe(doc.activePage);
    expect(findMatches(doc, 'token', { matchCase: false, allPages: false }).length).toBe(4); // this page only
    expect(findMatches(doc, 'Token', { matchCase: true, allPages: true }).length).toBe(2);
    expect(findMatches(doc, '', { matchCase: false, allPages: true })).toEqual([]);
    // several in one label: each one counts
    expect(findMatches({ ...doc, elements: [box(0, 0, 'aaa a')] }, 'a', { matchCase: false, allPages: false }).length).toBe(4);
  });

  it('replace one or all (this page or every page); locked items are left alone', () => {
    const doc = twoPages();
    const o = { matchCase: false, allPages: true };
    const all = replaceAll(doc, 'token', 'key', o);
    expect(all.count).toBe(5);
    expect(findMatches(all.doc, 'key', o).length).toBe(5);
    expect(all.doc.elements.find((e) => e.text === 'Get key')).toBeTruthy();
    expect(all.doc.pages.find((p) => p.id !== doc.activePage)!.elements[0].text).toBe('key exchange');
    const here = replaceAll(doc, 'token', 'key', { ...o, allPages: false });
    expect(here.count).toBe(4);
    expect(here.doc.pages.find((p) => p.id !== doc.activePage)!.elements[0].text).toBe('Token exchange');
    // one match: just that occurrence
    const twice = { ...doc, elements: [box(0, 0, 'ab ab')] };
    const m = findMatches(twice, 'ab', o)[1];
    expect(replaceOne(twice, m, 'ab', 'X', false)!.elements[0].text).toBe('ab X');
    // locked
    const locked = { ...doc, elements: doc.elements.map((e) => ({ ...e, locked: true })) };
    const r = replaceAll(locked, 'token', 'key', { ...o, allPages: false });
    expect(r.count).toBe(0); expect(r.locked).toBe(4); expect(r.doc).toBe(locked);
    expect(replaceOne(locked, findMatches(locked, 'token', o)[0], 'token', 'key', false)).toBeNull();
  });

  it('the commands: next/previous wrap and go to the page; Replace and Replace all are one undo step each', () => {
    const doc = twoPages();
    useDoc.getState().replace(() => doc);
    openFind(true);
    useUI.getState().setFind({ query: 'token', replace: 'key' });
    expect(currentMatches().length).toBe(5);
    expect(useUI.getState().find!.index).toBe(-1); // nothing current until Enter
    findNext(1); // the first Enter goes to the first match
    expect(useUI.getState().find!.index).toBe(0);
    useUI.getState().setFind({ index: -1 });
    findNext(-1); // the first Shift+Enter goes to the last
    expect(useUI.getState().find!.index).toBe(4);
    goToPageBack();
    goToMatch(0);
    expect(useUI.getState().selection).toEqual([currentMatches()[0].id]);
    findNext(-1); // wraps to the last, on the other page
    expect(useDoc.getState().doc.activePage).not.toBe(doc.activePage);
    expect(useUI.getState().find!.index).toBe(4);
    findNext(1);
    expect(useDoc.getState().doc.activePage).toBe(doc.activePage);
    replaceCurrent();
    expect(useDoc.getState().doc.elements.some((e) => e.text === 'Get key')).toBe(true);
    expect(currentMatches().length).toBe(4);
    replaceAllMatches();
    expect(currentMatches().length).toBe(0);
    useDoc.getState().undo();
    expect(currentMatches().length).toBe(4);
    closeFind();
    expect(useUI.getState().find).toBeNull();
  });
});
