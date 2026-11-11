// Mermaid flowchart text → a plain graph (nodes, arrows, subgraphs). Only data comes out: the text is untrusted,
// so labels are plain text, and Mermaid's interactive or styling statements (click, style, classDef, class,
// linkStyle) are ignored. Relaxed on purpose: "User --> GE --> MCP Server" works without a header, and names may
// contain spaces.
import type { HeadKind, ShapeKind } from '../model/types';
import type { LayoutDir } from '../layout/layered';

export interface MNode { id: string; label: string; shape: ShapeKind }
export interface MEdge { from: string; to: string; label: string; startHead: HeadKind; endHead: HeadKind; stroke: 'solid' | 'dotted' | 'thick' }
export interface MGroup { id: string; title: string; members: string[]; dir?: LayoutDir; parent: string | null }
export interface MGraph { dir: LayoutDir; hasHeader: boolean; nodes: MNode[]; edges: MEdge[]; groups: MGroup[]; warnings: string[] }

// Limits that keep hostile or accidental huge input from freezing the app
export const MAX_NODES = 500;
export const MAX_EDGES = 2000; // "a & b & … --> x & y & …" multiplies
export const MAX_TEXT_CHARS = 100_000;
const MAX_LINE = 2000;
const MAX_STATEMENTS = 5000;
const MAX_GROUPS = 200;
const MAX_DEPTH = 20; // subgraphs inside subgraphs
const MAX_LABEL = 200;
const GROUP = '\u0000group:'; // group keys can't clash with node names

/**
 * Remove characters that can hide or disguise text: control characters, zero-width spaces and joiners used for
 * spoofing, and bidirectional overrides ("Trojan Source"). New lines and tabs stay; emoji joiners (U+200D) stay.
 */
export function plainText(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '');
}

const DIRS: Record<string, LayoutDir> = { TB: 'TB', TD: 'TB', BT: 'BT', LR: 'LR', RL: 'RL' };
const HEADER = /^\s*(?:graph|flowchart)\b\s*([A-Za-z]{2})?\s*;?\s*$/i;
const IGNORED = /^\s*(?:style|classDef|class|click|linkStyle|accTitle|accDescr|title)\b/i;
// a link: optional start head, the line (--, ==, -.-) and optional end head
const LINK_RAW = /^(<|o|x)?(-{2,}|={2,}|-\.+-)(>|o|x)?/;
/** A link needs a head or at least three characters: "--" alone is ordinary text, "---" is a line. */
const LINK = { exec: (r: string) => { const m = LINK_RAW.exec(r); return m && (m[3] || m[2].length >= 3) ? m : null; }, test: (r: string) => !!LINK.exec(r) };
// a link with its label inline: "-- yes -->", "== yes ==>", "-. yes .->"
const LINK_TEXT = /^(<|o|x)?(--|==|-\.)\s+(.+?)\s+(-{2,}|={2,}|\.+-)(>|o|x)?(?=\s|$|[^->=.ox])/;

/** Shapes, outermost brackets first (so "([" wins over "("). */
const SHAPES: [string, string, ShapeKind][] = [
  ['(((', ')))', 'ellipse'], ['((', '))', 'ellipse'], ['([', '])', 'pill'], ['[(', ')]', 'cylinder'], ['[[', ']]', 'rectangle'],
  ['{{', '}}', 'hexagon'], ['[/', '/]', 'parallelogram'], ['[\\', '\\]', 'parallelogram'], ['[/', '\\]', 'trapezoid'], ['[\\', '/]', 'trapezoid'],
  ['(', ')', 'roundRect'], ['[', ']', 'rectangle'], ['{', '}', 'diamond'], ['>', ']', 'document'],
];

/** Plain text from a Mermaid label: quotes off, <br> to a new line, other tags and markdown markers removed. */
export function cleanLabel(s: string): string {
  let t = plainText(s).trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('`') && t.endsWith('`'))) t = t.slice(1, -1);
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&quot;|#quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'")
    .replace(/\*\*(.+?)\*\*/g, '$1');
  return t.split('\n').map((l) => l.trim()).join('\n').trim().slice(0, MAX_LABEL);
}

/** Does this text look like a Mermaid flowchart (a header, or at least one arrow between two names)? */
export function looksLikeMermaid(text: string): boolean {
  if (text.length > MAX_TEXT_CHARS) return false;
  if (/^\s*sequenceDiagram\b/.test(text.split('\n').find((l) => l.trim() && !l.trim().startsWith('%%')) ?? '')) return true;
  const first = text.split('\n').find((l) => l.trim() && !l.trim().startsWith('%%')) ?? '';
  if (HEADER.test(first)) return true;
  const g = parseMermaid(text);
  return g.edges.length > 0 && g.warnings.length === 0;
}

/** Split into statements: lines, and ";" outside brackets and quotes. */
function statements(text: string, warnings: string[]): { s: string; line: number }[] {
  const out: { s: string; line: number }[] = [];
  text.slice(0, MAX_TEXT_CHARS).split(/\r?\n/).forEach((raw, i) => {
    if (out.length >= MAX_STATEMENTS) return;
    if (raw.length > MAX_LINE) { warnings.push(`Line ${i + 1}: too long (over ${MAX_LINE} characters)`); return; }
    const line = raw.replace(/%%.*$/, '');
    let depth = 0, quote = false, cur = '';
    for (const ch of line) {
      if (ch === '"') quote = !quote;
      if (!quote && '[({'.includes(ch)) depth++;
      if (!quote && '])}'.includes(ch)) depth = Math.max(0, depth - 1);
      if (ch === ';' && !quote && depth === 0) { if (cur.trim()) out.push({ s: cur.trim(), line: i + 1 }); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push({ s: cur.trim(), line: i + 1 });
  });
  return out;
}

export function parseMermaid(input: string): MGraph {
  const text = plainText(input); // hidden and control characters out before anything else
  const g: MGraph = { dir: 'LR', hasHeader: false, nodes: [], edges: [], groups: [], warnings: [] };
  const nodes = new Map<string, MNode>();
  let tooMany = false;
  const stack: MGroup[] = [];
  const claimed = new Set<string>(); // node/group ids already placed in a subgraph
  const inGroup = (id: string) => {
    const top = stack[stack.length - 1];
    if (top && !claimed.has(id) && id !== top.id) { top.members.push(id); claimed.add(id); }
  };
  const node = (id: string, label?: string, shape?: ShapeKind) => {
    let n = nodes.get(id);
    if (!n) {
      if (nodes.size >= MAX_NODES) return null;
      n = { id, label: label ?? plainText(id).slice(0, MAX_LABEL), shape: shape ?? 'rectangle' };
      nodes.set(id, n); g.nodes.push(n);
    } else if (label !== undefined) { n.label = label; n.shape = shape ?? n.shape; }
    inGroup(id);
    return n;
  };

  if (text.length > MAX_TEXT_CHARS) g.warnings.push(`Only the first ${MAX_TEXT_CHARS.toLocaleString()} characters were read`);
  const list = statements(text, g.warnings);
  let skipDepth = 0; // subgraphs nested too deep are read as plain lists (their "end" lines are matched here)
  list.forEach(({ s, line }, idx) => {
    if (idx === 0 && HEADER.test(s)) {
      const m = HEADER.exec(s)!;
      g.hasHeader = true;
      g.dir = DIRS[(m[1] ?? 'TB').toUpperCase()] ?? 'TB';
      return;
    }
    if (IGNORED.test(s)) return;
    const sub = /^subgraph\s+(.*)$/i.exec(s);
    if (sub) {
      if (stack.length >= MAX_DEPTH || g.groups.length >= MAX_GROUPS) {
        if (!skipDepth) g.warnings.push(`Line ${line}: too many subgraphs (or nested too deep); its shapes were kept without a container`);
        skipDepth++;
        return;
      }
      const rest = sub[1].trim();
      const m = /^([^\s[\]"]+)\s*\[(.*)\]$/.exec(rest);
      const id = m ? m[1] : /^[\w.-]+$/.test(rest) ? rest : `subgraph${g.groups.length + 1}`;
      const title = cleanLabel(m ? m[2] : rest) || plainText(id).slice(0, MAX_LABEL);
      let key = GROUP + id;
      for (let k = 2; g.groups.some((x) => x.id === key); k++) key = `${GROUP}${id}#${k}`; // repeated subgraph names
      const grp: MGroup = { id: key, title, members: [], parent: stack[stack.length - 1]?.id ?? null };
      inGroup(grp.id);
      g.groups.push(grp); stack.push(grp);
      return;
    }
    if (/^end$/i.test(s) && skipDepth) { skipDepth--; return; }
    if (/^end$/i.test(s)) { if (!stack.pop()) g.warnings.push(`Line ${line}: "end" without a subgraph`); return; }
    const dm = /^direction\s+([A-Za-z]{2})$/i.exec(s);
    if (dm) { const d = DIRS[dm[1].toUpperCase()]; if (d && stack.length) stack[stack.length - 1].dir = d; else if (d) g.dir = d; return; }
    if (!parseChain(s)) g.warnings.push(`Line ${line}: couldn't read "${s.slice(0, 60)}"`);
  });
  if (stack.length) g.warnings.push(`A subgraph is missing its "end"`);
  // a subgraph referenced by id in an arrow is a node of the same name in Mermaid terms; keep it simple: drop empty groups
  g.groups = g.groups.filter((gr) => gr.members.length);
  if (nodes.size >= MAX_NODES) g.warnings.push(`Only the first ${MAX_NODES} shapes were read`);
  if (tooMany) g.warnings.push(`Only the first ${MAX_EDGES} arrows were read`);
  return g;

  // ---- one statement of nodes and links: A[x] & B --> C -->|yes| D ----------------------------
  function parseChain(s: string): boolean {
    let i = 0;
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const atLink = () => {
      const r = s.slice(i);
      if ((r[0] === 'o' || r[0] === 'x') && !/\s/.test(s[i - 1] ?? ' ')) return false; // "Do-->B": the o belongs to the name
      return LINK_TEXT.test(r) || LINK.test(r);
    };
    // one node reference; returns its id
    const readNode = (): string | null => {
      ws();
      const start = i;
      // the id: up to a shape bracket, "&", ":::" or a link (names may contain spaces in relaxed mode)
      while (i < s.length && !'[({>&'.includes(s[i]) && !s.startsWith(':::', i) && !atLink()) i++;
      const id = s.slice(start, i).trim();
      if (!id || /[\]})|"]/.test(id)) return null;
      let label: string | undefined, shape: ShapeKind | undefined;
      for (const [open, close, kind] of SHAPES) {
        if (!s.startsWith(open, i)) continue;
        const end = findClose(s, i + open.length, close);
        if (end < 0) continue;
        label = cleanLabel(s.slice(i + open.length, end)); shape = kind; i = end + close.length;
        break;
      }
      if (s.startsWith(':::', i)) { i += 3; while (i < s.length && /[\w-]/.test(s[i])) i++; }
      return node(id, label, shape) ? id : null;
    };
    const readGroup = (): string[] | null => {
      const ids: string[] = [];
      for (;;) {
        const id = readNode();
        if (!id) return null;
        ids.push(id);
        ws();
        if (s[i] !== '&') return ids;
        i++;
      }
    };
    let left = readGroup();
    if (!left) return false;
    ws();
    if (i >= s.length) return true; // just node definitions
    while (i < s.length) {
      ws();
      const rest = s.slice(i);
      let m = LINK_TEXT.exec(rest);
      let label = '', startH: string | undefined, line: string, endH: string | undefined;
      if (m) { startH = m[1]; label = cleanLabel(m[3]); line = m[2] + m[4]; endH = m[5]; i += m[0].length; }
      else {
        m = LINK.exec(rest);
        if (!m) return false;
        startH = m[1]; line = m[2]; endH = m[3]; i += m[0].length;
        ws();
        if (s[i] === '|') { const e = s.indexOf('|', i + 1); if (e < 0) return false; label = cleanLabel(s.slice(i + 1, e)); i = e + 1; }
      }
      const right = readGroup();
      if (!right) return false;
      const stroke = line.startsWith('=') ? 'thick' : line.includes('.') ? 'dotted' : 'solid';
      const head = (h?: string): HeadKind => (h === '>' || h === '<' ? 'arrow' : h === 'o' ? 'dot' : h === 'x' ? 'bar' : 'none');
      for (const a of left) for (const b of right) {
        if (g.edges.length >= MAX_EDGES) { tooMany = true; break; }
        g.edges.push({ from: a, to: b, label, startHead: head(startH), endHead: head(endH), stroke });
      }
      left = right;
      ws();
    }
    return true;
  }
}

/** Index of `close` that ends a bracket opened before `from`, skipping quoted text. */
function findClose(s: string, from: number, close: string): number {
  let quote = false;
  for (let j = from; j < s.length; j++) {
    if (s[j] === '"') quote = !quote;
    if (!quote && s.startsWith(close, j)) return j;
  }
  return -1;
}
