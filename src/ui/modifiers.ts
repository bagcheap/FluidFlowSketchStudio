// The "cycle fill" modifier: Cmd on a Mac (Ctrl-click there is a right-click), Ctrl elsewhere.
// Tracked globally so commands run from menus (e.g. Add container) can tell whether it was held.
const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export const isCycleKey = (e: { metaKey: boolean; ctrlKey: boolean }) => (mac ? e.metaKey : e.ctrlKey);

let held = false;
export const cycleKeyHeld = () => held;

if (typeof window !== 'undefined') {
  const track = (e: KeyboardEvent | PointerEvent | MouseEvent) => { held = isCycleKey(e); };
  window.addEventListener('keydown', track, true);
  window.addEventListener('keyup', track, true);
  window.addEventListener('pointerdown', track, true);
  window.addEventListener('click', track, true);
  window.addEventListener('blur', () => { held = false; });
}
