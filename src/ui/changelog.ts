// Reads CHANGELOG.md (the single source for release notes) for Help ▸ What's new.
// Understands the subset the file uses: "## [version] - date" headings, "### Group" headings,
// "- " bullets and plain paragraph lines, with **bold** inline.
import changelogSource from '../../CHANGELOG.md?raw';

export interface Release {
  version: string; // "0.1.1" or "Unreleased"
  date: string | null; // "2026-10-29"
  notes: string[]; // paragraph lines directly under the version heading
  groups: { title: string; items: string[] }[]; // Added / Changed / Fixed, in file order
}

export function parseChangelog(md: string): Release[] {
  const releases: Release[] = [];
  let cur: Release | null = null;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const h2 = /^## \[([^\]]+)\](?:\s*-\s*(\S+))?/.exec(line);
    if (h2) { cur = { version: h2[1], date: h2[2] ?? null, notes: [], groups: [] }; releases.push(cur); continue; }
    if (!cur || !line) continue; // the intro above the first version is for the file only
    const h3 = /^### (.+)$/.exec(line);
    if (h3) { cur.groups.push({ title: h3[1], items: [] }); continue; }
    const item = /^[-*] (.+)$/.exec(line);
    if (item && cur.groups.length) cur.groups[cur.groups.length - 1].items.push(item[1]);
    else if (!line.startsWith('#')) cur.notes.push(line);
  }
  return releases;
}

/** Split "**bold** rest" into plain and bold runs (rendered as text, never as HTML). */
export function boldRuns(text: string): { text: string; bold: boolean }[] {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((t) => (t.startsWith('**') && t.endsWith('**') ? { text: t.slice(2, -2), bold: true } : { text: t, bold: false }));
}

export const RELEASES = parseChangelog(changelogSource);
