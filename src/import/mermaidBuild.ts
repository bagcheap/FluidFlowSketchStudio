// A parsed Mermaid graph → FlowSketch elements: shapes in their tools' remembered styles, arrows, and containers
// for subgraphs, then auto-laid out and centred on a point.
import type { BoxElement, ConnectorElement, ContainerElement, DiagramElement, Endpoint, FlowDocument, Point, ShapeKind, ToolStyle } from '../model/types';
import { baseFields, makeConnector, makeShape, SHAPE_DEFAULT_SIZE } from '../model/defaults';
import { elementBounds } from '../engine/render';
import { moveElements } from '../store/containers';
import { autoLayout } from '../layout/autoLayout';
import type { LayoutDir } from '../layout/layered';
import type { MGraph } from './mermaid';

export interface BuildTools {
  shape: (kind: ShapeKind) => ToolStyle;
  arrow: ToolStyle;
  line: ToolStyle;
  container: ToolStyle;
  /** Grow a shape so its label fits (commands.fitShapeToText). */
  fit: (e: DiagramElement) => DiagramElement;
}

const attached = (id: string): Endpoint => ({ x: 0, y: 0, elementId: id, anchor: null });

/** Add the graph to `doc`, laid out in `dir` and centred on `at`. Returns the document and the new top-level ids. */
export function buildMermaid(doc: FlowDocument, g: MGraph, tools: BuildTools, dir: LayoutDir, at: Point): { doc: FlowDocument; ids: string[]; shapes: number; arrows: number } {
  const idOf = new Map<string, string>(); // Mermaid id → element id
  const shapes: BoxElement[] = g.nodes.map((n) => {
    const [w, h] = SHAPE_DEFAULT_SIZE[n.shape] ?? [160, 80];
    const el = { ...makeShape(n.shape, 0, 0, w, h, tools.shape(n.shape)), text: n.label };
    idOf.set(n.id, el.id);
    return tools.fit(el) as BoxElement;
  });
  // containers: created outer-first, so each sits behind the ones inside it
  const containers: ContainerElement[] = [];
  for (const grp of g.groups) {
    const c: ContainerElement = {
      ...baseFields(tools.container), type: 'container', x: 0, y: 0, w: 100, h: 60, text: grp.title,
      style: { ...tools.container.style }, textStyle: { ...tools.container.textStyle }, members: [], anim: { mode: 'off' },
    };
    idOf.set(grp.id, c.id);
    containers.push(c);
  }
  containers.forEach((c, i) => { c.members = g.groups[i].members.map((m) => idOf.get(m)).filter((x): x is string => !!x); });
  const arrows: ConnectorElement[] = g.edges.flatMap((e) => {
    const a = idOf.get(e.from), b = idOf.get(e.to);
    if (!a || !b) return [];
    const plain = e.startHead === 'none' && e.endHead === 'none';
    const c = makeConnector(attached(a), attached(b), plain ? tools.line : tools.arrow);
    c.startHead = e.startHead; c.endHead = e.endHead; c.text = e.label;
    if (e.stroke === 'dotted') c.style = { ...c.style, strokeStyle: 'dashed' };
    if (e.stroke === 'thick') c.style = { ...c.style, strokeWidth: Math.max(3, c.style.strokeWidth + 1.5) };
    return [c];
  });

  const boxIds = [...containers.map((c) => c.id), ...shapes.map((s) => s.id)];
  let out: FlowDocument = { ...doc, elements: [...doc.elements, ...containers, ...shapes, ...arrows] };
  const dirOf = new Map(g.groups.map((grp) => [idOf.get(grp.id)!, grp.dir]));
  out = autoLayout(out, dir, boxIds, (id) => dirOf.get(id));

  // centre the new diagram on `at`
  const mine = new Set([...boxIds, ...arrows.map((a) => a.id)]);
  const bs = out.elements.filter((e) => mine.has(e.id) && e.type !== 'connector').map((e) => elementBounds(out, e));
  if (bs.length) {
    const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
    const x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h));
    out = moveElements(out, mine, at.x - (x0 + x1) / 2, at.y - (y0 + y1) / 2);
  }
  const inside = new Set(containers.flatMap((c) => c.members));
  const tops = [...boxIds.filter((id) => !inside.has(id))];
  return { doc: out, ids: tops, shapes: shapes.length, arrows: arrows.length };
}
