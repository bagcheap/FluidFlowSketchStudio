// Hostile and oversized input: Mermaid text, ZIP packages and saved preferences.
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { MAX_EDGES, MAX_NODES, looksLikeMermaid, parseMermaid, plainText } from '../src/import/mermaid';
import { MAX_ZIP_ENTRIES, readZipSvgs } from '../src/icons/zipImport';
import { sanitizePrefs } from '../src/store/uiStore';
import { defaultToolStyle } from '../src/model/defaults';

describe('Mermaid text limits', () => {
  it('caps shapes and the arrows that "&" multiplies, with a warning', () => {
    const many = Array.from({ length: 80 }, (_, i) => `n${i}`).join(' & ');
    const g = parseMermaid(`graph LR\n${many} --> ${many.replace(/n/g, 'm')}`); // 80 × 80 = 6,400 arrows asked for
    expect(g.edges.length).toBe(MAX_EDGES);
    expect(g.warnings.join()).toMatch(/first 2000 arrows/);
    const huge = parseMermaid(Array.from({ length: 700 }, (_, i) => `a${i} --> b${i}`).join('\n'));
    expect(huge.nodes.length).toBe(MAX_NODES);
  });

  it('stays quick on long, unbalanced or pathological lines', () => {
    const t0 = performance.now();
    parseMermaid('A' + ' -- x'.repeat(380) + ' --> B'); // many partial link starts on one line
    parseMermaid('A[' + '"'.repeat(1500));
    parseMermaid('x'.repeat(5000) + ' --> y');
    parseMermaid(Array.from({ length: 6000 }, () => 'a').join('\n'));
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it('limits subgraph nesting; deeper ones keep their shapes without a container', () => {
    const open = Array.from({ length: 30 }, (_, i) => `subgraph s${i}`).join('\n');
    const close = Array.from({ length: 30 }, () => 'end').join('\n');
    const g = parseMermaid(`graph TB\n${open}\n a --> b\n${close}\n c --> a`);
    expect(g.groups.length).toBe(20);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
    expect(g.warnings.join()).toMatch(/nested too deep/);
    expect(g.warnings.join()).not.toMatch(/without a subgraph|missing its/);
  });

  it('strips hidden and direction-changing characters from labels and names', () => {
    expect(plainText('evil‮exe.txt')).toBe('evilexe.txt');
    expect(plainText('a​b\u0000c⁦d﻿')).toBe('abcd');
    expect(plainText('line1\nline2\tx')).toBe('line1\nline2\tx');
    const g = parseMermaid('Pay‮ment --> B["Re​fund\u0007"]');
    expect(g.nodes.map((n) => n.label)).toEqual(['Payment', 'Refund']);
  });

  it('keeps node names and subgraph keys apart, and repeated subgraph names apart', () => {
    const g = parseMermaid('graph TB\nsubgraph A\n x\nend\nsubgraph A\n y\nend\n group:A --> x');
    expect(g.groups.map((gr) => gr.members)).toEqual([['x'], ['y']]);
    expect(new Set(g.groups.map((gr) => gr.id)).size).toBe(2);
    expect(g.nodes.some((n) => n.id === 'group:A')).toBe(true);
  });

  it('does not treat very large pastes as flowcharts', () => {
    expect(looksLikeMermaid('a --> b\n' + 'x'.repeat(200_000))).toBe(false);
  });
});

describe('ZIP import limits', () => {
  it('refuses packages with more files than the budget (zip bomb)', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i <= MAX_ZIP_ENTRIES; i++) files[`i/${i}.svg`] = new Uint8Array(strToU8('<svg/>'));
    const zip = new Uint8Array(zipSync(files, { level: 0 }));
    expect(() => readZipSvgs(zip)).toThrow(/split it into smaller ZIPs/);
  });
});

describe('saved preferences', () => {
  it('falls back to defaults for wrong types and drops junk', () => {
    const p = sanitizePrefs({
      theme: 'neon', snapToGrid: 'yes', showInspector: false, recentColors: ['#ff0000', 'javascript:alert(1)', 5],
      recentQuickShapes: ['ellipse', 'nope'], recentIcons: ['tabler:database', '<img>'], hiddenIconSets: 'x',
    });
    expect(p.theme).toBe('system');
    expect(p.snapToGrid).toBe(false);
    expect(p.showInspector).toBe(false);
    expect(p.recentColors).toEqual(['#ff0000']);
    expect(p.recentQuickShapes).toEqual(['ellipse']);
    expect(p.recentIcons).toEqual(['tabler:database']);
    expect(p.hiddenIconSets).toEqual([]);
    expect(sanitizePrefs('garbage').theme).toBe('system');
  });

  it('validates remembered tool styles like styles in a file', () => {
    const p = sanitizePrefs(JSON.parse('{"toolStyles": {"shape:rectangle": {"style": {"fill": "url(javascript:x)", "strokeWidth": 1e9, "opacity": -4}, "textStyle": {"fontSize": "huge"}}, "__proto__": {"polluted": true}, "bad key!": {}}}'));
    const ts = p.toolStyles['shape:rectangle'];
    const d = defaultToolStyle('shape:rectangle');
    expect(ts.style.stroke).toBe(d.style.stroke); // valid values the tool already had are kept
    expect(ts.style.fill).toMatch(/^#[0-9a-f]{6}$/i); // the hostile value is replaced by a real colour
    expect(ts.style.strokeWidth).toBeLessThanOrEqual(100);
    expect(ts.style.opacity).toBeGreaterThanOrEqual(0);
    expect(ts.textStyle.fontSize).toBe(d.textStyle.fontSize);
    expect(Object.keys(p.toolStyles)).toEqual(['shape:rectangle']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
