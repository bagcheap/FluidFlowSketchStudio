// Auto-layout for a diagram: shapes, icons and pictures are arranged with the layered layout, following the arrows
// between them. Containers are laid out inside-out: first each container's own contents (inside the container),
// then the container is fitted and placed as one block with everything else at its level.
import type { DiagramElement, FlowDocument } from '../model/types';
import { elementBounds } from '../engine/render';
import { containerHeader } from '../engine/render';
import { CONTAINER_PAD, fitToContents, moveElements, parentOf, withMembers } from '../store/containers';
import { layered, type LayoutDir } from './layered';

/** Elements auto-layout moves: shapes, icons, pictures and containers (not text, pen strokes, arrows or locked items). */
export const canLayout = (e: DiagramElement | undefined): boolean =>
  !!e && !e.locked && (e.type === 'shape' || e.type === 'icon' || e.type === 'image' || e.type === 'container');

/**
 * Lay out `ids` (or, without ids, the whole diagram) in direction `dir`. The laid-out group keeps its top-left
 * corner where it was. `dirOf` can give a container its own direction (Mermaid `direction` inside a subgraph).
 */
export function autoLayout(doc: FlowDocument, dir: LayoutDir, ids?: string[], dirOf?: (containerId: string) => LayoutDir | undefined): FlowDocument {
  const scope = new Set((ids ?? doc.elements.map((e) => e.id)).filter((id) => canLayout(doc.elements.find((e) => e.id === id))));
  if (!scope.size) return doc;
  // the top of the scope: items whose container isn't itself being laid out
  const tops = [...scope].filter((id) => !scope.has(parentOf(doc, id)?.id ?? ''));
  let out = doc;
  const done = new Set<string>();

  const arrange = (members: string[], d: LayoutDir, origin: { x: number; y: number } | null) => {
    if (!members.length) return;
    // containers among them first, inside-out
    for (const id of members) {
      const e = out.elements.find((x) => x.id === id);
      if (e?.type === 'container' && !done.has(id)) {
        done.add(id);
        const inner = e.members.filter((m) => canLayout(out.elements.find((x) => x.id === m)));
        if (inner.length) {
          const head = containerHeader(e);
          arrange(inner, dirOf?.(id) ?? d, { x: e.x + CONTAINER_PAD, y: e.y + CONTAINER_PAD + head });
          out = fitToContents(out, id);
        }
      }
    }
    const set = new Set(members);
    const bounds = new Map(members.map((id) => [id, elementBounds(out, out.elements.find((x) => x.id === id)!)]));
    // arrows between these items (an arrow to something inside a container counts for that container)
    const levelOf = (id: string | null | undefined): string | null => {
      for (let cur = id, n = 0; cur && n < 100; cur = parentOf(out, cur)?.id ?? null, n++) if (set.has(cur)) return cur;
      return null;
    };
    const edges: [string, string][] = [];
    for (const c of out.elements) {
      if (c.type !== 'connector') continue;
      const a = levelOf(c.start.elementId), b = levelOf(c.end.elementId);
      if (a && b && a !== b) edges.push([a, b]);
    }
    const pos = layered(members.map((id) => ({ id, w: bounds.get(id)!.w, h: bounds.get(id)!.h })), edges, d);
    const o = origin ?? {
      x: Math.min(...members.map((id) => bounds.get(id)!.x)),
      y: Math.min(...members.map((id) => bounds.get(id)!.y)),
    };
    for (const id of members) {
      const b = bounds.get(id)!, p = pos.get(id)!;
      out = moveElements(out, new Set(withMembers(out, [id])), o.x + p.x - b.x, o.y + p.y - b.y);
    }
  };

  arrange(tops, dir, null);
  return out;
}
