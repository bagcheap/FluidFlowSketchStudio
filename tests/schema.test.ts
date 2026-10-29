import { describe, expect, it } from 'vitest';
import { DocumentError, parseDocument, serializeDocument } from '../src/model/schema';
import { SCHEMA_VERSION } from '../src/model/types';
import { SAMPLES } from '../src/templates/samples';
import { renderDocumentAtTime } from '../src/engine/render';
import { frameToSvg } from '../src/engine/svgExport';
import { HIGHLIGHT_COLORS, PALETTE_FILL, PALETTE_STROKE } from '../src/model/defaults';
import { colorLabel } from '../src/ui/colorNames';

describe('native .flowsketch format', () => {
  it('round-trips every sample losslessly (same diagram, same animation)', () => {
    for (const s of SAMPLES) {
      const doc = s.build();
      const back = parseDocument(serializeDocument(doc));
      expect(back.warnings).toEqual([]);
      expect(back.doc.elements).toEqual(doc.elements);
      expect(back.doc.animation).toEqual(doc.animation);
      expect(JSON.stringify(renderDocumentAtTime(back.doc, 1.3))).toEqual(JSON.stringify(renderDocumentAtTime(doc, 1.3)));
    }
  });

  it('rejects non-JSON, wrong formats and future schema versions with clear errors', () => {
    expect(() => parseDocument('{nope')).toThrow(DocumentError);
    expect(() => parseDocument(JSON.stringify({ format: 'excalidraw', elements: [] }))).toThrow(/Unsupported file format/);
    expect(() => parseDocument(JSON.stringify({ format: 'flowsketch', schemaVersion: 99, elements: [] }))).toThrow(/newer FlowSketch/);
    expect(() => parseDocument(JSON.stringify({ format: 'flowsketch', elements: 'x' }))).toThrow(/no element list/);
  });

  it('sanitises hostile or malformed content', () => {
    const { doc, warnings } = parseDocument({
      format: 'flowsketch', schemaVersion: 1,
      elements: [
        { id: 'a', type: 'shape', shape: 'nope', x: 'NaN', y: 1e99, w: -5, h: 40, text: '<script>alert(1)</script>', style: { stroke: 'url(javascript:alert(1))', fill: '#fff', strokeWidth: 9999 } },
        { id: 'a', type: 'shape', shape: 'ellipse', x: 0, y: 0, w: 10, h: 10 },
        { id: 'c', type: 'connector', start: { elementId: 'ghost', x: 1, y: 2 }, end: { elementId: 'a', x: 0, y: 0 } },
        { id: 'i', type: 'image', assetId: 'evil' },
        { type: 'mystery' },
      ],
      assets: { evil: { dataUrl: 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4=' } },
    });
    const [a, a2, c] = doc.elements as any[];
    expect(a.shape).toBe('roundRect');
    expect(a.x).toBe(0);
    expect(a.y).toBe(1e6);
    expect(a.w).toBe(0);
    expect(a.style.stroke).toBe('#1e1e2e');
    expect(a.style.strokeWidth).toBe(40);
    expect(a.text).toBe('<script>alert(1)</script>'); // kept as inert text
    expect(a2.id).not.toBe('a'); // duplicate ids are re-issued
    expect(c.start.elementId).toBeNull(); // dangling reference detached
    expect(c.end.elementId).toBe('a');
    expect(doc.elements.find((e) => e.type === 'image')).toBeUndefined(); // SVG asset refused
    expect(Object.keys(doc.assets)).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('migrates v0 documents', () => {
    const { doc } = parseDocument({ format: 'flowsketch', shapes: [{ id: 's', type: 'shape', shape: 'diamond', x: 1, y: 2, w: 3, h: 4 }], connectors: [] });
    expect(doc.elements).toHaveLength(1);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('SVG export', () => {
  it('escapes user text and produces vector paths', () => {
    const doc = SAMPLES[0].build();
    (doc.elements[1] as any).text = 'a < b & "c"';
    const svg = frameToSvg(renderDocumentAtTime(doc, 0), { rect: { x: 0, y: 0, w: 100, h: 100 }, background: '#fff', assets: {} });
    expect(svg).toContain('a &lt; b &amp; &quot;c&quot;');
    expect(svg).not.toContain('<script');
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThan(20);
  });
});

describe('palette colour names', () => {
  it('names every swatch (tooltips never fall back to a bare hex code)', () => {
    for (const c of [...PALETTE_STROKE, ...PALETTE_FILL, ...HIGHLIGHT_COLORS]) expect(colorLabel(c)).not.toBe(c);
    expect(colorLabel('#1864ab')).toBe('Dark blue · #1864ab');
    expect(colorLabel('#123456')).toBe('#123456');
  });
});
