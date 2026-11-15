import { describe, expect, it } from 'vitest';
import { deflateSync } from 'fflate';
import { importDrawio, htmlToText, parseStyle } from '../src/import/drawio';
import { importExcalidraw } from '../src/import/excalidraw';
import { parseAnyDiagram } from '../src/import/formats';
import { toMermaid, mermaidLabel } from '../src/export/mermaidExport';
import { parseMermaid } from '../src/import/mermaid';
import { importMermaid } from '../src/store/commands';
import { useDoc } from '../src/store/docStore';
import { defaultToolStyle, makeConnector, makeShape, newDocument } from '../src/model/defaults';
import { allPages } from '../src/model/schema';
import type { ConnectorElement, ContainerElement, DiagramElement, FlowDocument, ShapeElement } from '../src/model/types';

const u8 = (s: string) => new Uint8Array(new TextEncoder().encode(s));
const byText = (els: DiagramElement[], t: string) => els.find((e) => e.text === t)!;

const DRAWIO = `<mxfile host="app.diagrams.net"><diagram id="p1" name="Overview"><mxGraphModel background="#fafafa"><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="a" value="Start" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="40" y="60" width="120" height="60" as="geometry"/></mxCell>
<mxCell id="b" value="&lt;b&gt;Check&lt;/b&gt;&lt;br&gt;it" style="rhombus;whiteSpace=wrap;html=1;fontStyle=1;" vertex="1" parent="1"><mxGeometry x="260" y="50" width="100" height="80" as="geometry"/></mxCell>
<mxCell id="e1" value="go" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;dashed=1;endArrow=block;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="200" y="90"/></Array></mxGeometry></mxCell>
<mxCell id="lane" value="Team" style="swimlane;startSize=23;" vertex="1" parent="1"><mxGeometry x="40" y="200" width="300" height="160" as="geometry"/></mxCell>
<mxCell id="c" value="Inside" style="ellipse;fillColor=#d5e8d4;" vertex="1" parent="lane"><mxGeometry x="20" y="40" width="80" height="50" as="geometry"/></mxCell>
<mxCell id="t" value="Note text" style="text;html=1;" vertex="1" parent="1"><mxGeometry x="400" y="200" width="90" height="30" as="geometry"/></mxCell>
<mxCell id="g" value="" style="group" vertex="1" connectable="0" parent="1"><mxGeometry x="400" y="300" width="200" height="60" as="geometry"/></mxCell>
<mxCell id="g1" value="G1" style="" vertex="1" parent="g"><mxGeometry x="0" y="0" width="80" height="60" as="geometry"/></mxCell>
<mxCell id="g2" value="G2" style="" vertex="1" parent="g"><mxGeometry x="120" y="0" width="80" height="60" as="geometry"/></mxCell>
<mxCell id="x" value="&lt;script&gt;alert(1)&lt;/script&gt;Safe" style="" vertex="1" parent="1"><mxGeometry x="600" y="40" width="80" height="40" as="geometry"/></mxCell>
<mxCell id="img" value="" style="shape=image;image=javascript:alert(1)" vertex="1" parent="1"><mxGeometry x="600" y="100" width="40" height="40" as="geometry"/></mxCell>
</root></mxGraphModel></diagram><diagram id="p2" name="Detail">PLACEHOLDER</diagram></mxfile>`;
const PAGE2 = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="d" value="Deep" style="" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="50" as="geometry"/></mxCell></root></mxGraphModel>';
// draw.io's compressed form: URI-encode, raw deflate, base64
const compressed = btoa(String.fromCharCode(...deflateSync(u8(encodeURIComponent(PAGE2)))));

describe('draw.io import', () => {
  const { doc, warnings } = importDrawio(DRAWIO.replace('PLACEHOLDER', compressed), 'Test');
  const els = doc.elements;

  it('reads styles and labels: shapes, colours, bold, HTML labels as plain text', () => {
    expect(parseStyle('rounded=1;ellipse;fillColor=#fff')).toEqual({ rounded: '1', ellipse: '', fillColor: '#fff' });
    expect(htmlToText('<b>A</b>&amp;B<br>C&#33;')).toBe('A&B\nC!');
    const a = byText(els, 'Start') as ShapeElement;
    expect(a).toMatchObject({ type: 'shape', shape: 'roundRect', x: 40, y: 60, w: 120, h: 60 });
    expect(a.style).toMatchObject({ fill: '#dae8fc', stroke: '#6c8ebf', fillStyle: 'solid' });
    const b = byText(els, 'Check\nit') as ShapeElement;
    expect(b.shape).toBe('diamond'); expect(b.textStyle.bold).toBe(true);
    expect(els.some((e) => e.text === 'Safe')).toBe(true); // tags removed, text kept, nothing run
    expect(doc.canvas.background).toBe('#fafafa');
  });

  it('arrows keep their ends, waypoints, routing, dash, heads and label', () => {
    const e = els.find((x) => x.type === 'connector') as ConnectorElement;
    expect(e.start.elementId).toBe(byText(els, 'Start').id);
    expect(e.end.elementId).toBe(byText(els, 'Check\nit').id);
    expect(e).toMatchObject({ routing: 'elbow', text: 'go', endHead: 'triangle', startHead: 'none' });
    expect(e.bends).toEqual([{ x: 200, y: 90 }]);
    expect(e.style.strokeStyle).toBe('dashed');
  });

  it('swimlanes become containers (children placed relative to them), groups stay grouped, text stays text', () => {
    const lane = byText(els, 'Team') as ContainerElement;
    expect(lane.type).toBe('container');
    const inside = byText(els, 'Inside');
    expect(inside).toMatchObject({ type: 'shape', x: 60, y: 240 });
    expect(lane.members).toEqual([inside.id]);
    const g1 = byText(els, 'G1'), g2 = byText(els, 'G2');
    expect(g1.groupIds.length).toBe(1); expect(g1.groupIds).toEqual(g2.groupIds);
    expect(g2.x).toBe(520);
    expect(byText(els, 'Note text').type).toBe('text');
  });

  it('several pages, compressed ones too; unsafe pictures skipped with a note', () => {
    expect(doc.pages.map((p) => p.name)).toEqual(['Overview', 'Detail']);
    expect(allPages(doc)[1].elements.map((e) => e.text)).toEqual(['Deep']);
    expect(Object.keys(doc.assets)).toEqual([]);
    expect(warnings.some((w) => /picture/.test(w))).toBe(true);
  });

  it('opening goes through the normal file checks; broken XML is an error', () => {
    const r = parseAnyDiagram(DRAWIO.replace('PLACEHOLDER', compressed), 'Flow.drawio');
    expect(r.format).toBe('draw.io');
    expect(r.doc.title).toBe('Flow');
    expect(r.doc.pages.length).toBe(2);
    expect(() => importDrawio('<mxfile><diagram>')).toThrow();
  });
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const EXCALIDRAW = JSON.stringify({
  type: 'excalidraw', version: 2, appState: { viewBackgroundColor: '#fffbea' },
  files: { f1: { mimeType: 'image/png', dataURL: PNG }, f2: { mimeType: 'image/svg+xml', dataURL: 'data:image/svg+xml;base64,PHN2Zz4=' } },
  elements: [
    { id: 'r', type: 'rectangle', x: 0, y: 0, width: 160, height: 80, strokeColor: '#1971c2', backgroundColor: '#a5d8ff', fillStyle: 'hachure', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, angle: 0, groupIds: [], roundness: { type: 3 }, boundElements: [{ id: 'rt', type: 'text' }] },
    { id: 'rt', type: 'text', x: 10, y: 20, width: 100, height: 25, text: 'Client', originalText: 'Client', fontSize: 20, fontFamily: 1, containerId: 'r', strokeColor: '#1e1e1e' },
    { id: 'o', type: 'ellipse', x: 300, y: 0, width: 120, height: 80, strokeColor: '#2f9e44', backgroundColor: 'transparent', fillStyle: 'solid', strokeStyle: 'dashed', roughness: 0, opacity: 60, angle: 0, groupIds: [] },
    { id: 'ar', type: 'arrow', x: 160, y: 40, width: 140, height: 0, points: [[0, 0], [140, 0]], startBinding: { elementId: 'r', focus: 0, gap: 2 }, endBinding: { elementId: 'o', focus: 0, gap: 2 }, startArrowhead: null, endArrowhead: 'triangle', strokeColor: '#1e1e1e', backgroundColor: 'transparent', strokeWidth: 2, roughness: 1, opacity: 100 },
    { id: 'at', type: 'text', x: 200, y: 30, width: 40, height: 20, text: 'calls', fontSize: 16, fontFamily: 2, containerId: 'ar' },
    { id: 'fd', type: 'freedraw', x: 0, y: 200, width: 50, height: 20, points: [[0, 0], [25, 20], [50, 0]], strokeColor: '#e03131', backgroundColor: 'transparent', opacity: 100 },
    { id: 'im', type: 'image', x: 500, y: 0, width: 40, height: 40, fileId: 'f1' },
    { id: 'sv', type: 'image', x: 560, y: 0, width: 40, height: 40, fileId: 'f2' },
    { id: 'tx', type: 'text', x: 0, y: 300, width: 120, height: 25, text: 'Free text', fontSize: 24, fontFamily: 3, textAlign: 'left' },
    { id: 'gone', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, isDeleted: true },
    { id: 'fr', type: 'frame', x: -20, y: -20, width: 480, height: 140, name: 'System' },
    { id: 'in', type: 'rectangle', x: 0, y: 500, width: 10, height: 10, frameId: 'fr' },
  ],
});

describe('Excalidraw import', () => {
  const { doc, warnings } = importExcalidraw(EXCALIDRAW, 'Ex');
  const els = doc.elements;
  it('shapes keep their look; bound text becomes the shape or arrow label', () => {
    const r = byText(els, 'Client') as ShapeElement;
    expect(r).toMatchObject({ type: 'shape', shape: 'roundRect', w: 160, h: 80 });
    expect(r.style).toMatchObject({ stroke: '#1971c2', fill: '#a5d8ff', fillStyle: 'hachure', roughness: 1 });
    expect(r.textStyle.fontFamily).toBe('hand');
    const o = els.find((e) => e.type === 'shape' && e.shape === 'ellipse') as ShapeElement;
    expect(o.style).toMatchObject({ fill: 'transparent', fillStyle: 'none', strokeStyle: 'dashed', roughness: 0, opacity: 0.6 });
    const a = els.find((e) => e.type === 'connector') as ConnectorElement;
    expect(a).toMatchObject({ text: 'calls', startHead: 'none', endHead: 'triangle' });
    expect(a.start.elementId).toBe(r.id); expect(a.end.elementId).toBe(o.id);
    expect(byText(els, 'Free text').textStyle).toMatchObject({ fontFamily: 'mono', fontSize: 24, align: 'left' });
    expect(doc.canvas.background).toBe('#fffbea');
  });
  it('pen strokes, raster pictures and frames come over; SVG pictures and deleted items do not', () => {
    const fd = els.find((e) => e.type === 'freehand')!;
    expect(fd).toMatchObject({ x: 0, y: 200, w: 50, h: 20 });
    expect(els.filter((e) => e.type === 'image').length).toBe(1);
    expect(warnings.some((w) => /picture/.test(w))).toBe(true);
    expect(els.length).toBe(8); // 12 items, less the deleted one, the SVG picture and the 2 texts that became labels
    const frame = els.find((e) => e.type === 'container') as ContainerElement;
    expect(frame.text).toBe('System'); expect(frame.members.length).toBe(1);
    expect(els[0]).toBe(frame); // behind its contents
  });
  it('opening it goes through the normal file checks', () => {
    const r = parseAnyDiagram(EXCALIDRAW, 'Sketch.excalidraw');
    expect(r.format).toBe('Excalidraw'); expect(r.doc.title).toBe('Sketch');
    expect(() => importExcalidraw('{"type":"excalidraw","elements":5}')).toThrow();
  });
});

describe('Mermaid export', () => {
  it('writes nodes with their shapes, links with labels and styles, containers as subgraphs; reads back the same', () => {
    const t = (k: string) => defaultToolStyle(k);
    const a = { ...makeShape('roundRect', 0, 0, 120, 60, t('shape:roundRect')), text: 'Say "hi"' };
    const b = { ...makeShape('diamond', 300, 0, 120, 60, t('shape:diamond')), text: 'Two\nlines' };
    const c = { ...makeShape('cylinder', 600, 0, 120, 60, t('shape:cylinder')), text: 'DB' };
    const ab = { ...makeConnector({ x: 0, y: 0, elementId: a.id }, { x: 0, y: 0, elementId: b.id }, t('arrow')), text: 'ask' };
    const cb = { ...makeConnector({ x: 0, y: 0, elementId: c.id }, { x: 0, y: 0, elementId: b.id }, t('arrow')), startHead: 'arrow' as const, endHead: 'none' as const };
    const bc = { ...makeConnector({ x: 0, y: 0, elementId: b.id }, { x: 0, y: 0, elementId: c.id }, t('arrow')), style: { ...t('arrow').style, strokeStyle: 'dashed' as const }, startHead: 'arrow' as const };
    const box: ContainerElement = { ...makeShape('rectangle', -20, -20, 480, 120, t('container')), type: 'container', text: 'Front end', members: [a.id, b.id] } as unknown as ContainerElement;
    const doc: FlowDocument = { ...newDocument(), elements: [box, a, b, c, ab, cb, bc] };
    const text = toMermaid(doc);
    expect(text.split('\n')[0]).toBe('flowchart LR');
    expect(text).toContain('n1("Say #quot;hi#quot;")');
    expect(text).toContain('n2{"Two<br/>lines"}');
    expect(text).toContain('n3[("DB")]');
    expect(text).toMatch(/subgraph sg1\["Front end"\]\n {4}n1/);
    expect(text).toContain('n1 -->|"ask"| n2');
    expect(text).toContain('n2 --> n3'); // pointing backwards: written the way it points
    expect(text).toContain('n2 <-.-> n3');
    const g = parseMermaid(text);
    expect(g.nodes.map((n) => n.label).sort()).toEqual(['DB', 'Say "hi"', 'Two\nlines']);
    expect(g.edges.length).toBe(3);
    expect(g.groups.map((x) => x.title)).toEqual(['Front end']);
    expect(mermaidLabel('a\u0007b')).toBe('"a b"');
  });

  /** What a flowchart means, whatever its node names: nodes by shape and label, links by their ends, label and style, subgraphs by title and members. */
  function meaning(text: string) {
    const g = parseMermaid(text);
    const lab = new Map(g.nodes.map((n) => [n.id, n.label]));
    return {
      dir: g.dir,
      nodes: g.nodes.map((n) => `${n.shape}: ${n.label}`).sort(),
      edges: g.edges.map((e) => `${lab.get(e.from)} -[${e.label}|${e.stroke}|${e.startHead}>${e.endHead}]-> ${lab.get(e.to)}`).sort(),
      groups: g.groups.map((x) => `${x.title}: ${x.members.map((m) => lab.get(m) ?? '(group)').sort().join(', ')}`).sort(),
    };
  }

  it('Mermaid in, Mermaid out: importing a flowchart and exporting it again gives the same flowchart', () => {
    const samples = [
      `flowchart TD
  A([Start]) --> B{Valid?}
  B -->|yes| C[(Store)]
  B -. no .-> D[/Reject/]
  C ==> E((Done))
  D --- F{{Note}}
  A <--> F
  subgraph Back end
    C
    E
  end`,
      `graph LR
  U(["End user"]) -->|"1. Sign in"| P[Portal]
  P <-->|"2. Ask"| A[Agent]
  A -.->|"3. Answer, with #quot;quotes#quot;"| P
  subgraph Cloud ["Cloud services"]
    A
    subgraph Data
      D[(Database)]
    end
  end
  A --> D`,
    ];
    for (const src of samples) {
      useDoc.getState().replace(() => newDocument());
      importMermaid(src);
      const back = toMermaid(useDoc.getState().doc);
      expect(meaning(back), back).toEqual(meaning(src));
    }
  });
});
