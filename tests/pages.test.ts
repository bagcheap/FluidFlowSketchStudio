import { beforeEach, describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeIcon, makeShape, newDocument } from '../src/model/defaults';
import { parseDocument, serializeDocument } from '../src/model/schema';
import { addPage, allPages, deletePage, duplicatePage, movePage, renamePage, switchPage } from '../src/store/pages';
import { cloneElements, deleteSelection, goToPage, newPage } from '../src/store/commands';
import { useDoc } from '../src/store/docStore';
import { useUI } from '../src/store/uiStore';
import type { ConnectorElement, FlowDocument } from '../src/model/types';

const rect = (x: number) => makeShape('rectangle', x, 0, 100, 50, defaultToolStyle('shape:rectangle'));

function twoPages() {
  const a = rect(0), b = rect(200);
  const arrow = makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 0, y: 0, elementId: b.id }, defaultToolStyle('arrow'));
  let doc: FlowDocument = { ...newDocument(), elements: [a, b, arrow] };
  doc = addPage(doc, 'Second');
  doc = { ...doc, elements: [rect(500)] };
  return { doc, a, b, arrow };
}

describe('pages', () => {
  it('a new document has one page; adding a page switches to it, empty', () => {
    const d = newDocument();
    expect(d.pages.map((p) => p.name)).toEqual(['Page 1']);
    const { doc } = twoPages();
    expect(doc.pages.map((p) => p.name)).toEqual(['Page 1', 'Second']);
    expect(doc.activePage).toBe(doc.pages[1].id);
  });

  it('switching swaps the current elements in and out, losing nothing', () => {
    const { doc, a } = twoPages();
    const back = switchPage(doc, doc.pages[0].id);
    expect(back.elements.map((e) => e.id)).toContain(a.id);
    expect(allPages(back)[1].elements).toHaveLength(1);
    expect(switchPage(back, back.pages[1].id).elements).toEqual(doc.elements);
  });

  it('saves all pages and reopens on the page that was open', () => {
    const { doc, a, arrow } = twoPages();
    const again = parseDocument(serializeDocument(doc)).doc;
    expect(again.pages.map((p) => p.name)).toEqual(['Page 1', 'Second']);
    expect(again.activePage).toBe(doc.activePage);
    expect(again.elements).toHaveLength(1);
    const first = allPages(again)[0].elements;
    expect(first.map((e) => e.id)).toEqual([a.id, expect.any(String), arrow.id]);
    expect((first[2] as ConnectorElement).start.elementId).toBe(a.id);
  });

  it('opens older single-page files as "Page 1"', () => {
    const { doc } = parseDocument({ format: 'flowsketch', schemaVersion: 6, elements: [rect(0)] });
    expect(doc.pages.map((p) => p.name)).toEqual(['Page 1']);
    expect(doc.elements).toHaveLength(1);
  });

  it('checks each page on load: ids stay unique across pages, arrows only attach within their page', () => {
    const shared = rect(0);
    const stray = makeConnector({ x: 0, y: 0, elementId: shared.id }, { x: 9, y: 9, elementId: null }, defaultToolStyle('arrow'));
    const { doc } = parseDocument({ format: 'flowsketch', schemaVersion: 7, pages: [
      { id: 'p1', name: 'One', elements: [shared] },
      { id: 'p2', name: 'Two', elements: [shared, stray] },
    ], activePage: 'p2' });
    const [one, two] = allPages(doc);
    expect(one.elements[0].id).not.toBe(two.elements[0].id);
    expect(one.elements[0].id).toBe(shared.id); // the first page keeps the id
    expect((two.elements[1] as ConnectorElement).start.elementId).toBeNull(); // its target is on the other page: detached
  });

  it('duplicates a page with new ids, arrows pointing at the copies', () => {
    const { doc } = twoPages();
    const first = switchPage(doc, doc.pages[0].id);
    const d = duplicatePage(first, first.activePage, (els) => cloneElements(first, els, 0, 0));
    expect(d.pages.map((p) => p.name)).toEqual(['Page 1', 'Page 1 copy', 'Second']);
    const copy = d.elements;
    const orig = allPages(d)[0].elements;
    expect(copy.map((e) => e.id).some((id) => orig.some((o) => o.id === id))).toBe(false);
    const arrow = copy.find((e): e is ConnectorElement => e.type === 'connector')!;
    expect(copy.map((e) => e.id)).toContain(arrow.start.elementId);
  });

  it('renames, reorders and deletes pages; never the last one', () => {
    const { doc } = twoPages();
    let d = renamePage(doc, doc.pages[1].id, '  Flows  ');
    expect(d.pages[1].name).toBe('Flows');
    d = movePage(d, d.pages[1].id, -1);
    expect(d.pages.map((p) => p.name)).toEqual(['Flows', 'Page 1']);
    d = deletePage(d, d.activePage); // the current page: its neighbour is shown
    expect(d.pages.map((p) => p.name)).toEqual(['Page 1']);
    expect(d.elements).toHaveLength(3);
    expect(deletePage(d, d.activePage)).toBe(d);
  });

  it('keeps icon data used on another page when shapes are deleted here', () => {
    const icon = makeIcon('tabler:x', 0, 0, 48, defaultToolStyle('icon'));
    let doc: FlowDocument = { ...newDocument(), elements: [icon], icons: { 'tabler:x': { id: 'tabler:x', name: 'x', set: 'Tabler', license: 'MIT', w: 24, h: 24, parts: [], mono: true } } };
    doc = addPage(doc);
    useDoc.getState().load({ ...doc, elements: [makeIcon('tabler:x', 0, 0, 48, defaultToolStyle('icon'))] });
    useUI.getState().select([useDoc.getState().doc.elements[0].id]);
    deleteSelection();
    expect(useDoc.getState().doc.icons['tabler:x']).toBeDefined();
  });

  describe('commands', () => {
    beforeEach(() => useDoc.getState().load(newDocument()));
    it('adding a page is undoable; switching pages is not an undo step', () => {
      newPage();
      const d = useDoc.getState().doc;
      expect(d.pages).toHaveLength(2);
      goToPage(d.pages[0].id);
      expect(useDoc.getState().past).toHaveLength(1);
      useDoc.getState().undo();
      expect(useDoc.getState().doc.pages).toHaveLength(1);
    });
  });
});
