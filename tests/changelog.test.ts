import { describe, expect, it } from 'vitest';
import { boldRuns, parseChangelog, RELEASES } from '../src/ui/changelog';
import { version } from '../package.json';

describe('CHANGELOG.md (shown in Help ▸ What\'s new)', () => {
  it('has a dated entry for the current package version', () => {
    const entry = RELEASES.find((r) => r.version === version);
    expect(entry, `CHANGELOG.md needs a "## [${version}] - YYYY-MM-DD" section`).toBeDefined();
    expect(entry!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('lists versions newest first, each with content in the standard groups', () => {
    const released = RELEASES.filter((r) => r.version !== 'Unreleased');
    const key = (v: string) => v.split('.').map((n) => n.padStart(4, '0')).join('.');
    expect(released.map((r) => key(r.version))).toEqual(released.map((r) => key(r.version)).sort().reverse());
    for (const r of RELEASES) {
      expect(r.groups.length + r.notes.length).toBeGreaterThan(0);
      for (const g of r.groups) {
        expect(['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']).toContain(g.title);
        expect(g.items.length).toBeGreaterThan(0);
      }
    }
  });

  it('parses headings, groups, bullets and bold text', () => {
    const [r] = parseChangelog('# Changelog\nintro\n## [1.2.0] - 2027-01-02\nA note.\n### Fixed\n- **Bold** fix\n- Plain fix\n');
    expect(r).toEqual({ version: '1.2.0', date: '2027-01-02', notes: ['A note.'], groups: [{ title: 'Fixed', items: ['**Bold** fix', 'Plain fix'] }] });
    expect(boldRuns('**Esc** works')).toEqual([{ text: 'Esc', bold: true }, { text: ' works', bold: false }]);
  });
});
