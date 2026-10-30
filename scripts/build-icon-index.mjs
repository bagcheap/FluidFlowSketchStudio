// Writes src/icons/names.json: the visible icon names of every built-in set, so the Icons panel can search
// all sets without downloading them first. Run after updating an @iconify-json package:
//   npm run icons:index
// tests/iconSets.test.ts fails if this file no longer matches the installed packages.
import { readFileSync, writeFileSync } from 'node:fs';

const SETS = ['tabler', 'devicon', 'logos', 'simple-icons', 'k8s']; // keep in sync with ICON_SETS in src/icons/sets.ts
const out = {};
for (const id of SETS) {
  const json = JSON.parse(readFileSync(new URL(`../node_modules/@iconify-json/${id}/icons.json`, import.meta.url), 'utf8'));
  out[id] = Object.keys(json.icons).filter((n) => !json.icons[n].hidden).sort();
}
writeFileSync(new URL('../src/icons/names.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(Object.entries(out).map(([k, v]) => `${k}: ${v.length}`).join(', '));
