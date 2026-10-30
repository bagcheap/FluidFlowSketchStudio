import { describe, expect, it } from 'vitest';
import tablerRaw from '@iconify-json/tabler/icons.json?raw';
import { svgToIcon } from '../src/icons/svgToIcon';
import { iconSetFromJSON, searchNames } from '../src/icons/sets';
import { parseDocument, sanitizeIconAsset, serializeDocument } from '../src/model/schema';
import { defaultToolStyle, makeIcon, newDocument } from '../src/model/defaults';
import { elementBounds, renderDocumentAtTime } from '../src/engine/render';
import { frameToSvg } from '../src/engine/svgExport';
import type { FlowDocument, IconElement } from '../src/model/types';

const meta = { id: 'test:x', name: 'x', set: 'Test', license: 'MIT' };
const tabler = iconSetFromJSON({ id: 'tabler', name: 'Tabler Icons', group: 'General', license: 'MIT' }, JSON.parse(tablerRaw));

function iconDoc(opts: Partial<IconElement> = {}): { doc: FlowDocument; el: IconElement } {
  const icon = tabler.icon('database')!;
  const doc = newDocument('icons');
  const el = { ...makeIcon(icon.id, 100, 100, 56, defaultToolStyle('icon')), seed: 5, ...opts };
  doc.icons = { [icon.id]: icon };
  doc.elements = [el];
  return { doc, el };
}

describe('SVG → icon conversion', () => {
  it('converts a Tabler icon into recolourable path parts', () => {
    const ic = tabler.icon('database')!;
    expect(ic).toMatchObject({ id: 'tabler:database', name: 'database', set: 'Tabler Icons', license: 'MIT', w: 24, h: 24, mono: true });
    expect(ic.parts).toHaveLength(3);
    expect(ic.parts.every((p) => p.stroke === 'currentColor' && p.fill === null && p.strokeWidth === 2 && p.linecap === 'round')).toBe(true);
    expect(tabler.names.length).toBeGreaterThan(6000);
  });

  it('keeps only geometry and paint from a hostile SVG', () => {
    const evil = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" onload="alert(1)">
      <script>alert(1)</script>
      <style>path { fill: url(javascript:alert(1)) }</style>
      <foreignObject><iframe xmlns="http://www.w3.org/1999/xhtml" src="javascript:alert(1)"/></foreignObject>
      <image href="https://evil.example/x.png" width="24" height="24"/>
      <a href="javascript:alert(1)"><path d="M0 0L5 5"/></a>
      <use href="#p"/>
      <text>hi</text>
      <path id="p" d="M1 1L23 23" stroke="red" onclick="alert(1)" style="stroke-width: 3; behavior: url(x.htc)"/>
      <path d="M0 0 javascript:alert(1)"/>
      <path d="M2 2h4" fill="url(javascript:alert(1))" stroke="expression(alert(1))"/>
    </svg>`;
    const ic = svgToIcon(evil, meta);
    // only the red line survives: once itself, once through <use href="#p"> (a reference inside the same file);
    // the last path's paint was unsafe, so it draws nothing and is dropped
    expect(ic.parts).toHaveLength(2);
    for (const p of ic.parts) expect(p).toMatchObject({ d: 'M1 1L23 23', stroke: 'red', strokeWidth: 3 });
    const json = JSON.stringify(ic);
    for (const bad of ['script', 'javascript', 'href', 'onload', 'onclick', 'alert', 'evil', 'expression', 'htc']) expect(json).not.toContain(bad);
  });

  it('converts basic shapes, transforms, viewBox offsets and gradients', () => {
    const ic = svgToIcon(`<svg viewBox="10 10 20 20"><defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/></linearGradient></defs>
      <g transform="translate(2 3) scale(2)"><rect x="10" y="10" width="4" height="4" rx="1" fill="url(#g)"/></g>
      <circle cx="20" cy="20" r="3" fill="#00ff00"/><polygon points="10,10 12,10 11,12"/><line x1="10" y1="10" x2="30" y2="30" stroke="blue"/></svg>`, meta);
    expect(ic.w).toBe(20);
    expect(ic.parts.map((p) => p.d.slice(0, 1))).toEqual(['M', 'M', 'M', 'M']);
    expect(ic.parts[0]).toMatchObject({ m: [2, 0, 0, 2, -8, -7], bbox: [10, 10, 4, 4] }); // translate(-10,-10) · translate(2,3) · scale(2)
    expect(ic.parts[0].fill).toMatchObject({ type: 'linear', bbox: true, x1: 0, x2: 1, stops: [{ offset: 0, color: '#ff0000', opacity: 1 }] });
    expect(ic.parts[1].fill).toBe('#00ff00');
    expect(ic.parts[2].fill).toBe('#000000'); // SVG's default fill
    expect(ic.parts[3]).toMatchObject({ stroke: 'blue', fill: '#000000' });
    expect(ic.mono).toBe(false);
  });

  it('rejects files that are not SVG or have nothing to draw', () => {
    expect(() => svgToIcon('<html><body>hi</body></html>', meta)).toThrow();
    expect(() => svgToIcon('<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>', meta)).toThrow(/no shapes/);
  });
});

describe('icons in .flowsketch files', () => {
  it('round-trips an icon element and its vector data', () => {
    const { doc, el } = iconDoc({ text: 'Orders DB', frame: 'circle', sketch: true, labelPos: 'right' });
    const back = parseDocument(serializeDocument(doc)).doc;
    expect(back.elements[0]).toEqual(el);
    expect(back.icons['tabler:database']).toEqual(doc.icons['tabler:database']);
  });

  it('validates icon data from files and never trusts the "mono" flag', () => {
    expect(sanitizeIconAsset({ parts: [{ d: 'M0 0L1 1 <script>' }] }, 'x')).toBeNull();
    const ic = sanitizeIconAsset({ name: 'n', mono: true, parts: [{ d: 'M0 0L1 1', stroke: 'red', fill: 'url(#x)' }] }, 'x')!;
    expect(ic.mono).toBe(false);
    expect(ic.parts[0].fill).toBeNull();
    const raw = JSON.parse(serializeDocument(iconDoc().doc));
    delete raw.icons['tabler:database'];
    const { doc, warnings } = parseDocument(raw);
    expect(doc.elements).toHaveLength(0);
    expect(warnings.join(' ')).toMatch(/icon whose data is missing/);
  });

  it('opens version 1 files', () => {
    const raw = { format: 'flowsketch', schemaVersion: 1, elements: [] };
    const { doc } = parseDocument(raw);
    expect(doc.icons).toEqual({});
  });
});

describe('drawing icons', () => {
  it('draws crisp paths in the element colour, with a label below', () => {
    const { doc, el } = iconDoc({ text: 'Orders DB' });
    doc.elements[0] = { ...el, style: { ...el.style, stroke: '#1864ab' } };
    const items = renderDocumentAtTime(doc, 0).items;
    const parts = items.find((i) => i.id === el.id)!.parts;
    expect(parts).toHaveLength(3);
    expect(parts.every((p) => p.k === 'path' && p.stroke === '#1864ab')).toBe(true);
    const label = items.find((i) => i.id === el.id + ':label')!;
    const line = (label.parts[0] as { lines: { y: number }[] }).lines[0];
    expect(line.y).toBeGreaterThan(el.h); // below the icon, in its local coordinates
    expect(elementBounds(doc, doc.elements[0]).h).toBeGreaterThan(el.h + 10); // bounds include the label
  });

  it('draws hand-drawn geometry when sketch is on, and a background frame', () => {
    const { doc, el } = iconDoc({ sketch: true, frame: 'circle' });
    const parts = renderDocumentAtTime(doc, 0).items.find((i) => i.id === el.id)!.parts;
    expect(parts[0]).toMatchObject({ k: 'sets', fill: '#ffffff' }); // the frame
    expect(parts.slice(1).every((p) => p.k === 'sets' && p.m)).toBe(true);
    expect(JSON.stringify(renderDocumentAtTime(doc, 1.2))).toEqual(JSON.stringify(renderDocumentAtTime(structuredClone(doc), 1.2)));
  });

  it('exports real SVG paths without currentColor', () => {
    const { doc } = iconDoc();
    const svg = frameToSvg(renderDocumentAtTime(doc, 0), { rect: { x: 0, y: 0, w: 300, h: 300 }, background: null, assets: {} });
    expect(svg).toContain('<path d="M4 6a8 3 0 1 0 16 0A8 3 0 1 0 4 6" transform="matrix(');
    expect(svg).not.toContain('currentColor');
  });
});

describe('icon search', () => {
  it('ranks whole names, then prefixes, then words, then substrings', () => {
    const names = ['cloud-data-connection', 'database', 'database-export', 'brand-mysql', 'server-database', 'cloud'];
    expect(searchNames(names, 'database')).toEqual(['database', 'database-export', 'server-database']);
    expect(searchNames(names, 'cloud')).toEqual(['cloud', 'cloud-data-connection']);
    expect(searchNames(names, 'sql')).toEqual(['brand-mysql']);
  });
});
