// Human-readable names for palette colours (swatch tooltips). UI-only: kept out of model/ so the HTML player bundle doesn't carry it.
import { HUES } from '../model/defaults';

const HUE_NAMES = ['red', 'orange', 'yellow', 'green', 'teal', 'cyan', 'blue', 'indigo', 'violet', 'pink'];
const STRENGTH_NAMES: Record<keyof typeof HUES, string> = { tint: 'Pale ', light: 'Light ', bold: '', deep: 'Dark ' };
const COLOR_NAMES = new Map<string, string>([
  ['#1e1e2e', 'Ink'], ['#343a40', 'Charcoal'], ['#495057', 'Dark grey'], ['#4b5563', 'Slate'], ['#868e96', 'Grey'],
  ['#adb5bd', 'Silver'], ['#ced4da', 'Light grey'], ['#dee2e6', 'Pale grey'], ['#e9ecef', 'Mist'], ['#f8f9fa', 'Off-white'], ['#ffffff', 'White'],
  ['#7048e8', 'Purple'], ['#c2255c', 'Raspberry'], ['#e7e3ff', 'Lavender'], ['#fde68a', 'Butter'],
  ['#3b82f6', 'Blue'], ['#22c55e', 'Green'], ['#f59e0b', 'Amber'], ['#ec4899', 'Pink'], ['#8b5cf6', 'Violet'], ['#ef4444', 'Red'], ['#06b6d4', 'Cyan'],
]);
for (const [strength, colors] of Object.entries(HUES) as [keyof typeof HUES, string[]][]) {
  colors.forEach((c, i) => { const n = STRENGTH_NAMES[strength] + HUE_NAMES[i]; COLOR_NAMES.set(c, n[0].toUpperCase() + n.slice(1)); });
}

/** Tooltip text for a colour: "Dark blue · #1864ab", or just the code for custom colours. */
export function colorLabel(c: string): string {
  if (c === 'transparent') return 'No fill (transparent)';
  const name = COLOR_NAMES.get(c.toLowerCase());
  return name ? `${name} · ${c}` : c;
}
