import { describe, expect, it } from 'vitest';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { DIAGRAM_TOOLS, MAX_TOOL_CALLS, runTool, startSession, toolDefinitions, type ToolContext } from '../src/ai/toolkit';
import type { EditTools } from '../src/ai/edits';
import { readPlaySteps } from '../src/store/sequence';
import type { ConnectorElement, FlowDocument, ShapeElement } from '../src/model/types';

const styles: EditTools = { shape: (k) => defaultToolStyle(`shape:${k}`), arrow: defaultToolStyle('arrow'), container: defaultToolStyle('container'), fit: (e) => e };
const ctx: ToolContext = { styles };
const box = (x: number, text: string): ShapeElement => ({ ...makeShape('rectangle', x, 0, 100, 60, defaultToolStyle('shape:rectangle')), text });
function sample() {
  const a = box(0, 'Client'), b = box(300, 'API'), c = box(600, 'Database');
  const ab = { ...makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 0, y: 0, elementId: b.id }, defaultToolStyle('arrow')), text: '1. request' };
  const bc = { ...makeConnector({ x: 0, y: 0, elementId: b.id }, { x: 0, y: 0, elementId: c.id }, defaultToolStyle('arrow')), text: '3. query' };
  const doc: FlowDocument = { ...newDocument(), elements: [a, b, c, ab, bc] };
  return { doc, a, b, c, ab, bc };
}
const json = (r: { content: string }) => JSON.parse(r.content);

describe('diagram tool kit', () => {
  it('offers tool definitions with unique names, by kind', () => {
    const defs = toolDefinitions();
    expect(new Set(defs.map((d) => d.name)).size).toBe(DIAGRAM_TOOLS.length);
    for (const d of defs) {
      expect((d as { strict?: boolean }).strict).toBeUndefined(); // checked by FlowSketch instead (see toolDefinitions)
      expect(d.input_schema).toMatchObject({ type: 'object', additionalProperties: false });
      expect((d.input_schema as { required: string[] }).required.sort()).toEqual(Object.keys((d.input_schema as { properties: object }).properties).sort());
    }
    expect(toolDefinitions(['read', 'check']).some((d) => d.name === 'remove')).toBe(false);
    expect(toolDefinitions(['read']).map((d) => d.name)).toEqual(['describe_page', 'get_item', 'find_items', 'list_pages', 'get_play_order']);
  });

  it('reads the page with short ids, details, search and play order', async () => {
    const { doc } = sample();
    const s = startSession(doc, ctx);
    const page = json(await runTool(s, 'describe_page', {}));
    expect(page.items.map((i: { id: string }) => i.id)).toEqual(['s1', 's2', 's3', 'a1', 'a2']);
    const api = json(await runTool(s, 'get_item', { id: 's2' }));
    expect(api).toMatchObject({ id: 's2', kind: 'rectangle', label: 'API', arrowsIn: ['a1'], arrowsOut: ['a2'] });
    expect(json(await runTool(s, 'get_item', { id: 'a2' }))).toMatchObject({ from: 's2', to: 's3', step: '3', plays: 'with all arrows' });
    expect(json(await runTool(s, 'find_items', { text: 'DATA', kind: 'any' })).items).toEqual([{ id: 's3', kind: 'rectangle', label: 'Database' }]);
    expect(json(await runTool(s, 'find_items', { text: '', kind: 'arrow' })).count).toBe(2);
    expect(json(await runTool(s, 'get_play_order', {}))).toEqual({ steps: [], afterTheOrder: [] });
    expect(json(await runTool(s, 'list_pages', {}))).toEqual([{ name: 'Page 1', current: true, items: 5 }]);
    expect(s.doc).toBe(doc); // reading changes nothing
  });

  it('changes a draft, never the original; new items get the next id and ids keep their meaning after a removal', async () => {
    const { doc } = sample();
    const s = startSession(doc, ctx);
    const added = json(await runTool(s, 'add_shape', { label: 'Cache', shape: 'cylinder', near: 's2', place: 'below', container: null }));
    expect(added.new).toEqual(['s4']);
    expect(json(await runTool(s, 'connect', { from: 's2', to: 's4', label: '2. look up', style: 'dashed', heads: 'both' })).new).toEqual(['a3']);
    expect((await runTool(s, 'remove', { id: 's1' })).ok).toBe(true); // takes a1 with it
    const after = json(await runTool(s, 'describe_page', {}));
    expect(after.items.map((i: { id: string }) => i.id)).toEqual(['s2', 's3', 'a2', 's4', 'a3']);
    expect(json(await runTool(s, 'get_item', { id: 's4' }))).toMatchObject({ kind: 'cylinder', label: 'Cache' });
    expect(doc.elements).toHaveLength(5); // the original is untouched
    expect(s.changes).toBe(3);
  });

  it('step numbers, play order, layout and theme tools', async () => {
    const { doc, ab, bc } = sample();
    const s = startSession(doc, ctx);
    expect(json(await runTool(s, 'play_in_label_order', {})).steps).toBe(2);
    expect(readPlaySteps(s.doc)).toEqual([[ab.id], [bc.id]]);
    expect(json(await runTool(s, 'renumber_steps', {})).relabelled).toBe(1);
    expect((s.doc.elements.find((e) => e.id === bc.id) as ConnectorElement).text).toBe('2. query');
    const lint = json(await runTool(s, 'lint', {}));
    expect(lint.issues).toEqual([]);
    expect((await runTool(s, 'auto_layout', { direction: 'top-to-bottom' })).ok).toBe(true);
    const a = s.doc.elements.find((e) => e.id === doc.elements[0].id)!, b = s.doc.elements.find((e) => e.id === doc.elements[1].id)!;
    expect(b.y).toBeGreaterThan(a.y);
    expect((await runTool(s, 'apply_theme', { theme: 'blueprint' })).ok).toBe(true);
    expect(s.doc.canvas.background).toBe('#1c3f72');
  });

  it('untrusted input: unknown tools, bad ids, wrong types, prompt-like text and the call limit are errors, not changes', async () => {
    const { doc } = sample();
    const s = startSession(doc, ctx);
    expect(json(await runTool(s, 'run_shell', { cmd: 'rm -rf /' }))).toEqual({ error: 'There is no tool called run_shell.' });
    expect((await runTool(s, 'remove', { id: 'el_whatever' })).ok).toBe(false);
    expect((await runTool(s, 'set_label', { id: 's1', label: 42 })).ok).toBe(false);
    expect((await runTool(s, 'get_item', 'not an object')).ok).toBe(false);
    expect((await runTool(s, 'apply_theme', { theme: 'neon' })).ok).toBe(false);
    expect((await runTool(s, 'snapshot', {})).ok).toBe(false); // no picture maker in tests
    expect(s.doc).toBe(doc);
    // control characters and bidi overrides are stripped from labels
    await runTool(s, 'set_label', { id: 's1', label: 'Cli‮ent\u0007' });
    expect(s.doc.elements[0].text).toBe('Client');
    s.calls = MAX_TOOL_CALLS;
    expect(json(await runTool(s, 'describe_page', {})).error).toContain('limit');
  });

  it('a snapshot comes back as a picture when the editor provides one', async () => {
    const s = startSession(sample().doc, { styles, snapshot: async () => ({ mediaType: 'image/png', data: 'iVBORw0KGgo=' }) });
    const r = await runTool(s, 'snapshot', {});
    expect(r).toMatchObject({ ok: true, image: { mediaType: 'image/png', data: 'iVBORw0KGgo=' } });
  });
});
