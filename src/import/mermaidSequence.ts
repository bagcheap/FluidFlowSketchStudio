// Mermaid sequence-diagram text → a plain list of participants and steps (messages, notes, blocks).
// Untrusted input, like flowcharts: plain text only, hidden characters stripped, sizes capped, and
// interactive/styling statements (link, links, properties, details, box colours…) ignored.
import type { HeadKind } from '../model/types';
import { cleanLabel, plainText } from './mermaid';

export interface SParticipant { id: string; label: string; actor: boolean }
export type SStep =
  | { k: 'msg'; from: string; to: string; text: string; endHead: HeadKind; startHead: HeadKind; dashed: boolean }
  | { k: 'note'; at: string[]; side: 'left' | 'right' | 'over'; text: string }
  | { k: 'open'; kind: string; text: string } // loop, alt, opt, par, critical, break, rect
  | { k: 'else'; kind: string; text: string } // else (alt), and (par), option (critical)
  | { k: 'close' };
export interface SGraph { participants: SParticipant[]; steps: SStep[]; autonumber: boolean; warnings: string[] }

export const MAX_PARTICIPANTS = 100;
export const MAX_STEPS = 1000;
const MAX_TEXT_CHARS = 100_000;
const MAX_LINE = 2000;
const MAX_DEPTH = 20;

export const SEQUENCE_HEADER = /^\s*sequenceDiagram\b/;

/** Is the first real line "sequenceDiagram"? */
export function isSequence(text: string): boolean {
  const first = text.split('\n').find((l) => l.trim() && !l.trim().startsWith('%%')) ?? '';
  return SEQUENCE_HEADER.test(first);
}

// longest first, so "-->>" isn't read as "-->" followed by ">"
const ARROWS: [string, { endHead: HeadKind; startHead: HeadKind; dashed: boolean }][] = [
  ['<<-->>', { endHead: 'triangle', startHead: 'triangle', dashed: true }],
  ['<<->>', { endHead: 'triangle', startHead: 'triangle', dashed: false }],
  ['-->>', { endHead: 'triangle', startHead: 'none', dashed: true }],
  ['->>', { endHead: 'triangle', startHead: 'none', dashed: false }],
  ['--x', { endHead: 'bar', startHead: 'none', dashed: true }],
  ['-x', { endHead: 'bar', startHead: 'none', dashed: false }],
  ['--)', { endHead: 'arrow', startHead: 'none', dashed: true }],
  ['-)', { endHead: 'arrow', startHead: 'none', dashed: false }],
  ['-->', { endHead: 'none', startHead: 'none', dashed: true }],
  ['->', { endHead: 'none', startHead: 'none', dashed: false }],
];
const BLOCKS = /^(loop|alt|opt|par|critical|break|rect)\b\s*(.*)$/i;
const DIVIDERS = /^(else|and|option)\b\s*(.*)$/i;
const IGNORED = /^(activate|deactivate|title|accTitle|accDescr|link|links|properties|details|box|create|destroy|style|classDef|class|click)\b/i;
const NAME = (s: string) => plainText(s).trim().slice(0, 100);

export function parseSequence(input: string): SGraph {
  const g: SGraph = { participants: [], steps: [], autonumber: false, warnings: [] };
  const byId = new Map<string, SParticipant>();
  const text = plainText(input);
  if (text.length > MAX_TEXT_CHARS) g.warnings.push(`Only the first ${MAX_TEXT_CHARS.toLocaleString()} characters were read`);
  const ref = (rawId: string, label?: string, actor = false): string | null => {
    const id = NAME(rawId);
    if (!id) return null;
    let p = byId.get(id);
    if (!p) {
      if (byId.size >= MAX_PARTICIPANTS) return null;
      p = { id, label: label ?? id, actor };
      byId.set(id, p); g.participants.push(p);
    } else if (label !== undefined) { p.label = label; p.actor = actor; }
    return id;
  };
  let depth = 0, tooMany = false, header = false, skipBox = 0;
  const lines = text.slice(0, MAX_TEXT_CHARS).split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/%%.*$/, '').trim();
    if (!line) return;
    if (!header) { if (SEQUENCE_HEADER.test(line)) { header = true; return; } }
    if (raw.length > MAX_LINE) { g.warnings.push(`Line ${i + 1}: too long`); return; }
    if (g.steps.length >= MAX_STEPS) { tooMany = true; return; }
    if (/^autonumber\b/i.test(line)) { g.autonumber = true; return; }
    if (/^box\b/i.test(line)) { skipBox++; return; } // participant groups: their participants are still read
    if (IGNORED.test(line)) return;
    const pm = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(line);
    if (pm) { if (!ref(pm[2], pm[3] !== undefined ? cleanLabel(pm[3]) : undefined, pm[1].toLowerCase() === 'actor')) g.warnings.push(`Line ${i + 1}: too many participants`); return; }
    const nm = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i.exec(line);
    if (nm) {
      const at = nm[2].split(',').map((s) => ref(s)).filter((x): x is string => !!x).slice(0, 2);
      if (at.length) g.steps.push({ k: 'note', at, side: nm[1].toLowerCase().startsWith('left') ? 'left' : nm[1].toLowerCase().startsWith('right') ? 'right' : 'over', text: cleanLabel(nm[3]) });
      return;
    }
    const bm = BLOCKS.exec(line);
    if (bm) {
      if (depth >= MAX_DEPTH) { g.warnings.push(`Line ${i + 1}: blocks nested too deep`); depth++; return; }
      depth++;
      g.steps.push({ k: 'open', kind: bm[1].toLowerCase(), text: cleanLabel(bm[2]) });
      return;
    }
    const dm = DIVIDERS.exec(line);
    if (dm && depth > 0) { g.steps.push({ k: 'else', kind: dm[1].toLowerCase(), text: cleanLabel(dm[2]) }); return; }
    if (/^end$/i.test(line)) {
      if (skipBox) { skipBox--; return; }
      if (depth > 0) { if (depth <= MAX_DEPTH) g.steps.push({ k: 'close' }); depth--; } else g.warnings.push(`Line ${i + 1}: "end" without a block`);
      return;
    }
    // a message: From ->> To: text   (an optional + or - before "To" turns activation on/off; ignored)
    for (const [op, style] of ARROWS) {
      const at = line.indexOf(op);
      if (at <= 0) continue;
      const colon = line.indexOf(':', at + op.length);
      const from = ref(line.slice(0, at));
      const to = ref((colon < 0 ? line.slice(at + op.length) : line.slice(at + op.length, colon)).replace(/^\s*[+-]/, ''));
      if (!from || !to) break;
      g.steps.push({ k: 'msg', from, to, text: colon < 0 ? '' : cleanLabel(line.slice(colon + 1)), ...style });
      return;
    }
    g.warnings.push(`Line ${i + 1}: couldn't read "${line.slice(0, 60)}"`);
  });
  if (depth > 0) g.warnings.push('A block is missing its "end"');
  for (; depth > 0; depth--) if (depth <= MAX_DEPTH) g.steps.push({ k: 'close' });
  if (tooMany) g.warnings.push(`Only the first ${MAX_STEPS} steps were read`);
  return g;
}
