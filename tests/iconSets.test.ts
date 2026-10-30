import { describe, expect, it } from 'vitest';
import tablerRaw from '@iconify-json/tabler/icons.json?raw';
import deviconRaw from '@iconify-json/devicon/icons.json?raw';
import logosRaw from '@iconify-json/logos/icons.json?raw';
import simpleRaw from '@iconify-json/simple-icons/icons.json?raw';
import k8sRaw from '@iconify-json/k8s/icons.json?raw';
import names from '../src/icons/names.json';
import { ICON_SETS, iconSetFromJSON } from '../src/icons/sets';
import { svgToIcon } from '../src/icons/svgToIcon';
import { pathBBox } from '../src/icons/pathBounds';
import { importFiles, sanitizeLibrary, serializeLibrary } from '../src/icons/libraries';
import { defaultToolStyle, makeIcon, newDocument } from '../src/model/defaults';
import { renderDocumentAtTime } from '../src/engine/render';
import { frameToSvg } from '../src/engine/svgExport';

const RAW: Record<string, string> = { tabler: tablerRaw, devicon: deviconRaw, logos: logosRaw, 'simple-icons': simpleRaw, k8s: k8sRaw };
const meta = { id: 't:x', name: 'x', set: 'Test', license: 'MIT' };

describe('built-in icon sets', () => {
  it('has a names index that matches the installed packages (run `npm run icons:index` after updating one)', () => {
    expect(Object.keys(names).sort()).toEqual(ICON_SETS.map((s) => s.id).sort());
    for (const s of ICON_SETS) {
      const json = JSON.parse(RAW[s.id]);
      const visible = Object.keys(json.icons).filter((n) => !json.icons[n].hidden).sort();
      expect((names as Record<string, string[]>)[s.id], s.id).toEqual(visible);
    }
  });

  it('keeps logo gradients and draws them in SVG export', () => {
    const logos = iconSetFromJSON(ICON_SETS[2], JSON.parse(logosRaw));
    const firefox = logos.icon('firefox')!;
    expect(firefox.mono).toBe(false);
    const grads = firefox.parts.filter((p) => typeof p.fill === 'object' && p.fill);
    expect(grads.length).toBeGreaterThan(3);
    expect(grads.every((p) => p.bbox || (typeof p.fill === 'object' && p.fill && !p.fill.bbox))).toBe(true);
    const doc = newDocument('g');
    doc.icons = { [firefox.id]: firefox };
    doc.elements = [makeIcon(firefox.id, 0, 0, 64, defaultToolStyle('icon'))];
    const svg = frameToSvg(renderDocumentAtTime(doc, 0), { rect: { x: 0, y: 0, w: 100, h: 100 }, background: null, assets: {} });
    expect(svg).toMatch(/<(linear|radial)Gradient id="fsg1"/);
    expect(svg).toContain('fill="url(#fsg1)"');
  });
});

describe('SVG features used by logo sets', () => {
  it('follows gradient href chains and <use> references inside the same file only', () => {
    const ic = svgToIcon(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">
      <defs><linearGradient id="base"><stop offset="0%" stop-color="#112233"/><stop offset="100%" style="stop-color:#445566;stop-opacity:.5"/></linearGradient>
        <linearGradient id="g" xlink:href="#base" x1="0" y1="0" x2="0" y2="1"/><path id="dot" d="M1 1h2v2h-2z"/></defs>
      <use xlink:href="#dot" x="5" fill="url(#g)"/><use href="https://evil.example/x.svg#dot"/><use href="#missing"/></svg>`, meta);
    expect(ic.parts).toHaveLength(1);
    expect(ic.parts[0].m).toEqual([1, 0, 0, 1, 5, 0]);
    expect(ic.parts[0].fill).toMatchObject({ type: 'linear', x2: 0, y2: 1, stops: [{ offset: 0, color: '#112233' }, { offset: 1, color: '#445566', opacity: 0.5 }] });
    expect(ic.parts[0].bbox).toEqual([1, 1, 2, 2]);
  });

  it('measures path bounds including arcs and curves', () => {
    const near = (b: number[] | null, e: number[]) => b!.forEach((v, i) => expect(v).toBeCloseTo(e[i], 1));
    near(pathBBox('M4 6a8 3 0 1 0 16 0A8 3 0 1 0 4 6'), [4, 3, 16, 6]); // Tabler's database top: an ellipse from two arcs
    near(pathBBox('m10 10 5 0 0 5z'), [10, 10, 5, 5]); // implicit lines after a relative move
    near(pathBBox('M0 0C0 10 10 10 10 0'), [0, 0, 10, 10]); // control points bound the curve
    expect(pathBBox('')).toBeNull();
  });
});

describe('your icon libraries', () => {
  const file = (name: string, text: string, type = '') => new File([text], name, { type });

  it('imports SVG files and Iconify JSON, and lists what it skipped', async () => {
    const r = await importFiles([
      file('Cloud Server.svg', '<svg viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>', 'image/svg+xml'),
      file('broken.svg', '<svg><script>alert(1)</script></svg>', 'image/svg+xml'),
      file('pack.json', JSON.stringify({ prefix: 'team', width: 24, height: 24, icons: { a: { body: '<path d="M0 0h4"/>' }, hid: { body: '<path d="M0 0h4"/>', hidden: true } } })),
      file('notes.txt', 'hello'),
    ]);
    expect(r.items.map((i) => i.name)).toEqual(['cloud-server', 'a']);
    expect(r.libraryName).toBe('team');
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped.join(' ')).toMatch(/broken\.svg.*no shapes.*notes\.txt/);
  });

  it('round-trips through a .flowsketchlib file and validates what it reads', async () => {
    const lib = sanitizeLibrary({ name: 'Team', items: [{ name: 'Box', icon: svgToIcon('<svg viewBox="0 0 8 8"><rect width="8" height="8"/></svg>', meta) }, { name: 'box', icon: svgToIcon('<svg viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"/></svg>', meta) }] }, 'abc')!;
    expect(lib.items.map((i) => [i.name, i.icon!.id, i.icon!.set])).toEqual([['box', 'lib-abc:box', 'Team'], ['box-2', 'lib-abc:box-2', 'Team']]);
    const back = await importFiles([new File([serializeLibrary(lib)], 'Team.flowsketchlib')]);
    expect(back.libraryName).toBe('Team');
    expect(back.items.map((i) => i.icon!.parts)).toEqual(lib.items.map((i) => i.icon!.parts));
    const evil = sanitizeLibrary({ name: 'x', items: [{ name: 'a', icon: { parts: [{ d: 'M0 0 <script>' }] } }, { name: 'b', picture: { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' } }, { name: 'c', icon: { parts: [{ d: 'M0 0h1', fill: '#f00' }] } }] })!;
    expect(evil.items.map((i) => i.name)).toEqual(['c']); // the script-bearing path and the SVG "picture" are dropped
  });
});
