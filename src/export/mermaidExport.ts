// Export the current page as Mermaid flowchart text (pure). Boxes become nodes (shape kept where Mermaid has one),
// arrows between them become links (label, dashed, thick, no head, both heads), containers become subgraphs. Things
// Mermaid can't express (positions, colours, animation, pen strokes, free arrows) are left out; the layout direction
// is taken from which way most arrows point. FlowSketch's own Mermaid import reads the result back.
import type { BoxElement, ConnectorElement, ContainerElement, FlowDocument, ShapeKind } from '../model/types';

/** Mermaid's node syntax for each FlowSketch shape (others become plain boxes). */
const WRAP: Partial<Record<ShapeKind, [string, string]>> = {
  rectangle: ['[', ']'], roundRect: ['(', ')'], pill: ['([', '])'], ellipse: ['((', '))'], diamond: ['{', '}'],
  hexagon: ['{{', '}}'], parallelogram: ['[/', '/]'], trapezoid: ['[/', '\\]'], cylinder: ['[(', ')]'],
  bpmnStart: ['((', '))'], bpmnEnd: ['((', '))'], bpmnIntermediate: ['((', '))'], bpmnGateway: ['{', '}'], bpmnParallel: ['{', '}'],
};

/** A label as a Mermaid quoted string: quotes as #quot;, line breaks as <br/>, nothing that ends the string. */
export function mermaidLabel(text: string): string {
  return `"${text.trim().replace(/"/g, '#quot;').replace(/\r?\n/g, '<br/>').replace(/[\u0000-\u001f]/g, ' ')}"`;
}

const centre = (e: BoxElement) => ({ x: e.x + e.w / 2, y: e.y + e.h / 2 });

/** The page's flowchart as Mermaid text. */
export function toMermaid(doc: FlowDocument): string {
  const els = doc.elements;
  const byId = new Map(els.map((e) => [e.id, e]));
  // nodes: shapes, icons and pictures, plus text boxes that an arrow is attached to
  const attached = new Set(els.flatMap((e) => (e.type === 'connector' ? [e.start.elementId, e.end.elementId] : [])).filter(Boolean) as string[]);
  const nodes = els.filter((e): e is BoxElement => e.type === 'shape' || e.type === 'icon' || e.type === 'image' || (e.type === 'text' && attached.has(e.id)));
  const nodeIds = new Map(nodes.map((n, i) => [n.id, `n${i + 1}`]));
  // links: arrows with both ends on nodes (not lifelines, activation bars or loops to the same shape)
  const links = els.filter((e): e is ConnectorElement => e.type === 'connector' && !e.bar && !!e.start.elementId && !!e.end.elementId
    && e.start.elementId !== e.end.elementId && nodeIds.has(e.start.elementId) && nodeIds.has(e.end.elementId));
  // direction: across if most arrows run sideways, else down
  let across = 0, down = 0;
  for (const l of links) {
    const a = centre(byId.get(l.start.elementId!) as BoxElement), b = centre(byId.get(l.end.elementId!) as BoxElement);
    across += Math.abs(b.x - a.x); down += Math.abs(b.y - a.y);
  }
  const lines: string[] = [`flowchart ${links.length && across >= down ? 'LR' : 'TD'}`];
  const nodeLine = (n: BoxElement, indent: string) => {
    const [o, c] = (n.type === 'shape' && WRAP[n.shape]) || WRAP.rectangle!;
    const label = n.text.trim() || (n.type === 'shape' ? '' : n.type === 'icon' ? n.iconId.split(':').pop() ?? '' : '');
    return `${indent}${nodeIds.get(n.id)}${o}${mermaidLabel(label || ' ')}${c}`;
  };
  // subgraphs: containers, nested, holding the nodes directly inside them
  const containers = els.filter((e): e is ContainerElement => e.type === 'container');
  const parentOf = new Map<string, string>();
  for (const c of containers) for (const m of c.members) parentOf.set(m, c.id);
  const written = new Set<string>();
  let sg = 0;
  const writeContainer = (c: ContainerElement, depth: number) => {
    const indent = '  '.repeat(depth);
    lines.push(`${indent}subgraph sg${++sg}[${mermaidLabel(c.text || 'Group')}]`);
    for (const m of c.members) {
      const e = byId.get(m);
      if (!e) continue;
      if (e.type === 'container') writeContainer(e, depth + 1);
      else if (nodeIds.has(e.id) && !written.has(e.id)) { lines.push(nodeLine(e as BoxElement, indent + '  ')); written.add(e.id); }
    }
    lines.push(`${indent}end`);
  };
  for (const c of containers) if (!parentOf.has(c.id)) writeContainer(c, 1);
  for (const n of nodes) if (!written.has(n.id)) lines.push(nodeLine(n, '  '));
  for (const l of links) {
    let a = nodeIds.get(l.start.elementId!)!, b = nodeIds.get(l.end.elementId!)!;
    const startHead = l.startHead !== 'none', endHead = l.endHead !== 'none';
    if (startHead && !endHead) [a, b] = [b, a]; // points backwards: write it the way it points
    // thick: as the Mermaid import draws ==> (at least 3 px)
    const dashed = l.style.strokeStyle !== 'solid', thick = l.style.strokeWidth >= 3;
    const link = startHead && endHead ? (dashed ? '<-.->' : thick ? '<==>' : '<-->')
      : !startHead && !endHead ? (dashed ? '-.-' : thick ? '===' : '---')
      : dashed ? '-.->' : thick ? '==>' : '-->';
    const label = l.text.trim() ? `|${mermaidLabel(l.text)}|` : '';
    lines.push(`  ${a} ${link}${label} ${b}`);
  }
  return lines.join('\n') + '\n';
}
