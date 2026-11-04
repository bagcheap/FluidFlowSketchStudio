import { describe, expect, it } from 'vitest';
import { cleanLabel, looksLikeMermaid, parseMermaid } from '../src/import/mermaid';
import { buildMermaid } from '../src/import/mermaidBuild';
import { defaultToolStyle, newDocument } from '../src/model/defaults';
import { fitShapeToText } from '../src/store/commands';
import { parseDocument, serializeDocument } from '../src/model/schema';
import type { ConnectorElement, ContainerElement, ShapeElement } from '../src/model/types';

const tools = {
  shape: (k: string) => defaultToolStyle(`shape:${k}`), arrow: defaultToolStyle('arrow'), line: defaultToolStyle('line'),
  container: defaultToolStyle('container'), fit: fitShapeToText,
};

describe('Mermaid flowchart reader', () => {
  it('reads the relaxed one-liner, names with spaces included', () => {
    const g = parseMermaid('User --> GE --> MCP Server');
    expect(g.nodes.map((n) => n.label)).toEqual(['User', 'GE', 'MCP Server']);
    expect(g.edges.map((e) => [e.from, e.to])).toEqual([['User', 'GE'], ['GE', 'MCP Server']]);
    expect(g.dir).toBe('LR');
    expect(g.warnings).toEqual([]);
  });

  it('reads the header direction, shapes, labels and link styles', () => {
    const g = parseMermaid(`flowchart TD
      A([Start]) --> B{Ok?}
      B -->|yes| C[(DB)]
      B -- no --> D((Stop))
      C -.-> E{{Prep}}; C ==> F[/In/]
      D --- E
      A <--> F
      E --o G(Round)
      %% a comment
      style A fill:#f9f`);
    expect(g.dir).toBe('TB');
    const shape = Object.fromEntries(g.nodes.map((n) => [n.id, n.shape]));
    expect(shape).toEqual({ A: 'pill', B: 'diamond', C: 'cylinder', D: 'ellipse', E: 'hexagon', F: 'parallelogram', G: 'roundRect' });
    expect(g.nodes.find((n) => n.id === 'B')!.label).toBe('Ok?');
    const e = (a: string, b: string) => g.edges.find((x) => x.from === a && x.to === b)!;
    expect(e('B', 'C').label).toBe('yes');
    expect(e('B', 'D').label).toBe('no');
    expect(e('C', 'E').stroke).toBe('dotted');
    expect(e('C', 'F').stroke).toBe('thick');
    expect(e('D', 'E').endHead).toBe('none');
    expect([e('A', 'F').startHead, e('A', 'F').endHead]).toEqual(['arrow', 'arrow']);
    expect(e('E', 'G').endHead).toBe('dot');
    expect(g.warnings).toEqual([]);
  });

  it('expands & and chains into every pair', () => {
    const g = parseMermaid('graph LR\n a & b --> c & d');
    expect(g.edges.map((e) => e.from + e.to).sort()).toEqual(['ac', 'ad', 'bc', 'bd']);
  });

  it('turns subgraphs into groups, nested, with their own direction', () => {
    const g = parseMermaid(`flowchart LR
      subgraph cloud [Google Cloud]
        direction TB
        a --> b
        subgraph inner
          c
        end
      end
      x --> a`);
    expect(g.groups.map((gr) => [gr.title, gr.members, gr.dir])).toEqual([
      ['Google Cloud', ['a', 'b', '\u0000group:inner'], 'TB'],
      ['inner', ['c'], undefined],
    ]);
  });

  it('treats labels as plain text and ignores interactive statements', () => {
    expect(cleanLabel('"<b>Bold</b><br/>next <script>x</script>"')).toBe('Bold\nnext x');
    const g = parseMermaid('graph TD\n A["<img src=x onerror=alert(1)>Hi"] --> B\n click A "javascript:alert(1)"\n click B callback');
    expect(g.nodes[0].label).toBe('Hi');
    expect(g.warnings).toEqual([]);
  });

  it('reports lines it cannot read and keeps the rest', () => {
    const g = parseMermaid('graph TD\n A --> B\n ]]] nonsense [[[\n B --> C');
    expect(g.edges).toHaveLength(2);
    expect(g.warnings[0]).toMatch(/Line 3/);
  });

  it('tells flowcharts from ordinary text', () => {
    expect(looksLikeMermaid('User --> GE')).toBe(true);
    expect(looksLikeMermaid('flowchart TB')).toBe(true);
    expect(looksLikeMermaid('Just a note')).toBe(false);
    expect(looksLikeMermaid('Remember: a -- b is fine')).toBe(false);
  });
});

describe('building a diagram from Mermaid', () => {
  it('makes shapes, attached arrows and containers, laid out without overlaps and centred', () => {
    const g = parseMermaid('flowchart LR\n User --> GE -->|q| MCP[(MCP Server)]\n subgraph GCP\n GE\n MCP\n end');
    const r = buildMermaid(newDocument(), g, tools, g.dir, { x: 500, y: 300 });
    const shapes = r.doc.elements.filter((e): e is ShapeElement => e.type === 'shape');
    const arrows = r.doc.elements.filter((e): e is ConnectorElement => e.type === 'connector');
    const [box] = r.doc.elements.filter((e): e is ContainerElement => e.type === 'container');
    expect(shapes.map((s) => [s.text, s.shape])).toEqual([['User', 'rectangle'], ['GE', 'rectangle'], ['MCP Server', 'cylinder']]);
    expect(arrows).toHaveLength(2);
    expect(arrows[1].text).toBe('q');
    expect(arrows.every((a) => a.start.elementId && a.end.elementId)).toBe(true);
    expect(box.text).toBe('GCP');
    expect(box.members).toEqual([shapes[1].id, shapes[2].id]);
    // left to right, no overlaps, inside the container
    expect(shapes[0].x + shapes[0].w).toBeLessThan(box.x);
    expect(shapes[1].x + shapes[1].w).toBeLessThan(shapes[2].x);
    for (const s of shapes.slice(1)) expect(s.x >= box.x && s.x + s.w <= box.x + box.w && s.y >= box.y && s.y + s.h <= box.y + box.h).toBe(true);
    // the container is behind its shapes; tops are the selection
    expect(r.doc.elements.indexOf(box)).toBeLessThan(r.doc.elements.indexOf(shapes[1]));
    expect(r.ids.sort()).toEqual([box.id, shapes[0].id].sort());
    // and it survives a save and reload
    expect(parseDocument(serializeDocument(r.doc)).doc.elements).toHaveLength(r.doc.elements.length);
  });
});
