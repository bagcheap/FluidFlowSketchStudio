// Layered ("Sugiyama-style") graph layout, kept small and dependency-free.
// Boxes are placed in ranks that follow the arrows (rank = longest path from a source), ordered inside each rank
// to reduce crossings (barycentre sweeps), then spaced out and centred under their neighbours.
// Pure: boxes + edges in, top-left positions out (the layout's bounding box starts at 0,0).

export type LayoutDir = 'TB' | 'BT' | 'LR' | 'RL';
export interface LayoutBox { id: string; w: number; h: number }
export interface LayoutOptions { rankGap?: number; nodeGap?: number }

export const RANK_GAP = 80; // between ranks (along the flow)
export const NODE_GAP = 50; // between neighbours in a rank

export function layered(boxes: LayoutBox[], edges: [string, string][], dir: LayoutDir, opts: LayoutOptions = {}): Map<string, { x: number; y: number }> {
  const rankGap = opts.rankGap ?? RANK_GAP, nodeGap = opts.nodeGap ?? NODE_GAP;
  const out = new Map<string, { x: number; y: number }>();
  if (!boxes.length) return out;
  const ids = boxes.map((b) => b.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const horizontal = dir === 'LR' || dir === 'RL';
  // "along" = size in the flow direction, "across" = size within a rank
  const along = (b: LayoutBox) => (horizontal ? b.w : b.h);
  const across = (b: LayoutBox) => (horizontal ? b.h : b.w);
  const box = new Map(boxes.map((b) => [b.id, b]));

  // edges between known boxes, no self-loops, no duplicates
  const seen = new Set<string>();
  const es: [string, string][] = [];
  for (const [a, b] of edges) {
    if (a === b || !index.has(a) || !index.has(b)) continue;
    const k = a + '\u0000' + b;
    if (!seen.has(k)) { seen.add(k); es.push([a, b]); }
  }

  // 1. break cycles: reverse edges that close a cycle (DFS in input order)
  const succ = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [a, b] of es) succ.get(a)!.push(b);
  const state = new Map<string, number>(); // 1 = on stack, 2 = done
  const back = new Set<string>();
  const visit = (v: string) => {
    state.set(v, 1);
    for (const w of succ.get(v)!) {
      if (state.get(w) === 1) back.add(v + '\u0000' + w);
      else if (!state.get(w)) visit(w);
    }
    state.set(v, 2);
  };
  for (const id of ids) if (!state.get(id)) visit(id);
  const dag: [string, string][] = es.map(([a, b]) => (back.has(a + '\u0000' + b) ? [b, a] : [a, b]));

  // 2. ranks: longest path from a source (Kahn's order)
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [a, b] of dag) { succs.get(a)!.push(b); preds.get(b)!.push(a); }
  const indeg = new Map(ids.map((id) => [id, preds.get(id)!.length]));
  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  for (let qi = 0; qi < queue.length; qi++) {
    const v = queue[qi];
    for (const w of succs.get(v)!) {
      rank.set(w, Math.max(rank.get(w)!, rank.get(v)! + 1));
      indeg.set(w, indeg.get(w)! - 1);
      if (indeg.get(w) === 0) queue.push(w);
    }
  }
  // pull sources down next to what they feed (a lone source of a deep node shouldn't sit at rank 0 far away)
  for (const id of ids) {
    if (preds.get(id)!.length || !succs.get(id)!.length) continue;
    rank.set(id, Math.max(0, Math.min(...succs.get(id)!.map((w) => rank.get(w)!)) - 1));
  }

  const nRanks = Math.max(...ids.map((id) => rank.get(id)!)) + 1;
  const layers: string[][] = Array.from({ length: nRanks }, () => []);
  for (const id of ids) layers[rank.get(id)!].push(id);

  // 3. order within ranks: barycentre sweeps (down, then up), stable
  const pos = new Map<string, number>();
  const setPos = () => layers.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
  setPos();
  const bary = (id: string, nb: string[]) => (nb.length ? nb.reduce((s, n) => s + pos.get(n)!, 0) / nb.length : pos.get(id)!);
  for (let it = 0; it < 6; it++) {
    const down = it % 2 === 0;
    const order = down ? layers.map((_, i) => i).slice(1) : layers.map((_, i) => i).reverse().slice(1);
    for (const r of order) {
      const l = layers[r];
      const key = new Map(l.map((id) => [id, bary(id, down ? preds.get(id)! : succs.get(id)!)]));
      l.sort((a, b) => key.get(a)! - key.get(b)! || index.get(a)! - index.get(b)!);
      l.forEach((id, i) => pos.set(id, i));
    }
  }

  // 4. coordinates: ranks stacked along the flow; inside a rank, each box near the centre of its neighbours
  const rankStart: number[] = [];
  let acc = 0;
  for (const l of layers) {
    rankStart.push(acc);
    acc += Math.max(...l.map((id) => along(box.get(id)!))) + rankGap;
  }
  const centre = new Map<string, number>(); // across-axis centre of each box
  const place = (l: string[], want: (id: string) => number | null) => {
    const desired = l.map((id) => want(id));
    // pack left to right, never overlapping; boxes with no wish follow the previous one
    const xs: number[] = [];
    let right = -Infinity;
    l.forEach((id, i) => {
      const half = across(box.get(id)!) / 2;
      const d = desired[i] ?? (Number.isFinite(right) ? right + nodeGap + half : half);
      const c = Math.max(d, Number.isFinite(right) ? right + nodeGap + half : -Infinity);
      xs.push(c);
      right = c + half;
    });
    // shift the row so it sits, on average, where its boxes wanted to be
    const wanted = desired.map((d, i) => (d ?? xs[i]) - xs[i]);
    const shift = wanted.reduce((s, v) => s + v, 0) / Math.max(1, l.length);
    l.forEach((id, i) => centre.set(id, xs[i] + shift));
  };
  place(layers[0], () => null);
  for (let r = 1; r < nRanks; r++) {
    place(layers[r], (id) => {
      const p = preds.get(id)!.filter((n) => centre.has(n));
      return p.length ? p.reduce((s, n) => s + centre.get(n)!, 0) / p.length : null;
    });
  }
  // a second pass upwards centres parents over their children
  for (let r = nRanks - 2; r >= 0; r--) {
    place(layers[r], (id) => {
      const s = succs.get(id)!;
      return s.length ? s.reduce((t, n) => t + centre.get(n)!, 0) / s.length : centre.get(id)!;
    });
  }

  // 5. to x/y (top-left), normalised so the layout starts at 0,0; mirrored for BT/RL
  let minA = Infinity;
  for (const id of ids) minA = Math.min(minA, centre.get(id)! - across(box.get(id)!) / 2);
  const total = acc - rankGap;
  for (const id of ids) {
    const b = box.get(id)!;
    const r = rank.get(id)!;
    const rankSize = Math.max(...layers[r].map((n) => along(box.get(n)!)));
    let a = rankStart[r] + (rankSize - along(b)) / 2; // centred in its rank
    if (dir === 'BT' || dir === 'RL') a = total - a - along(b);
    const c = centre.get(id)! - across(b) / 2 - minA;
    out.set(id, horizontal ? { x: a, y: c } : { x: c, y: a });
  }
  return out;
}
