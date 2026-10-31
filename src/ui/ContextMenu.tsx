// Right-click menu on the canvas: actions for the selection, or for the canvas when nothing is under the pointer.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDoc } from '../store/docStore';
import { useUI } from '../store/uiStore';
import * as cmd from '../store/commands';
import { ItemList, type MenuItem } from './MenuBar';
import { ALT, MOD, SHIFT } from './shortcuts';

function selectionItems(): MenuItem[] {
  const doc = useDoc.getState().doc;
  const ui = useUI.getState();
  const els = doc.elements.filter((e) => ui.selection.includes(e.id));
  const one = els.length === 1 ? els[0] : null;
  const anyLocked = els.some((e) => e.locked);
  const containers = els.filter((e) => e.type === 'container');
  const toolKey = one ? cmd.toolKeyFor(one) : null;
  return [
    ...(one && !one.locked && one.type !== 'image' && one.type !== 'freehand' ? [{ label: one.type === 'container' ? 'Rename' : 'Edit text', shortcut: 'Enter', run: () => ui.setEditing(one.id) }, { sep: true } as MenuItem] : []),
    { label: 'Cut', shortcut: `${MOD}X`, run: cmd.cutSelection },
    { label: 'Copy', shortcut: `${MOD}C`, run: () => void cmd.copySelection() },
    { label: 'Paste', shortcut: `${MOD}V`, run: () => void cmd.paste() },
    { label: 'Duplicate', shortcut: `${MOD}D`, run: cmd.duplicateSelection },
    { label: containers.length ? 'Delete (with contents)' : 'Delete', shortcut: 'Del', run: cmd.deleteSelection, disabled: els.every((e) => e.locked) },
    { sep: true },
    { label: 'Copy style', shortcut: `${MOD}${ALT}C`, run: cmd.copyStyle, disabled: !one },
    { label: 'Paste style', shortcut: `${MOD}${ALT}V`, run: cmd.pasteStyle, disabled: !ui.copiedStyle },
    { label: 'Set as default style', run: cmd.applySelectionStyleToDefaults, disabled: !toolKey, note: toolKey ? `for new ${cmd.toolName(toolKey)} drawings` : undefined },
    { label: 'Reset default style', run: cmd.resetSelectionToolStyle, disabled: !toolKey },
    { sep: true },
    { label: 'Add container', run: cmd.addContainer, disabled: anyLocked },
    ...(containers.length ? [
      { label: 'Fit container to contents', run: cmd.fitSelectedContainers },
      { label: 'Remove container', note: 'keep contents', run: cmd.removeSelectedContainers },
    ] : []),
    { label: 'Group', shortcut: `${MOD}G`, run: cmd.groupSelection, disabled: els.length < 2 },
    { label: 'Ungroup', shortcut: `${MOD}${SHIFT}G`, run: cmd.ungroupSelection, disabled: !els.some((e) => e.groupIds.length) },
    { label: 'Order', sub: [
      { label: 'Bring to front', shortcut: `${MOD}${SHIFT}]`, run: () => cmd.reorder('front') },
      { label: 'Bring forward', shortcut: `${MOD}]`, run: () => cmd.reorder('forward') },
      { label: 'Send backward', shortcut: `${MOD}[`, run: () => cmd.reorder('backward') },
      { label: 'Send to back', shortcut: `${MOD}${SHIFT}[`, run: () => cmd.reorder('back') },
    ] },
    ...(els.length >= 2 ? [{ label: 'Align', sub: [
      { label: 'Left', run: () => cmd.align('left') }, { label: 'Centre', run: () => cmd.align('hcenter') }, { label: 'Right', run: () => cmd.align('right') },
      { sep: true }, { label: 'Top', run: () => cmd.align('top') }, { label: 'Middle', run: () => cmd.align('vcenter') }, { label: 'Bottom', run: () => cmd.align('bottom') },
    ] } as MenuItem] : []),
    ...(els.some((e) => e.type === 'connector') ? [{ label: 'Swap direction', run: () => cmd.swapDirection() } as MenuItem] : []),
    { sep: true },
    { label: anyLocked ? 'Unlock' : 'Lock', shortcut: `${MOD}${SHIFT}L`, run: cmd.toggleLock },
  ];
}

function canvasItems(): MenuItem[] {
  const doc = useDoc.getState().doc;
  const ui = useUI.getState();
  const setGrid = (g: 'dots' | 'lines' | 'none') => useDoc.getState().commit((d) => ({ ...d, canvas: { ...d.canvas, grid: g } }));
  return [
    { label: 'Paste', shortcut: `${MOD}V`, run: () => void cmd.paste() },
    { label: 'Select all', shortcut: `${MOD}A`, run: cmd.selectAll, disabled: !doc.elements.length },
    { sep: true },
    { label: 'Grid', sub: (['dots', 'lines', 'none'] as const).map((g) => ({ label: g === 'none' ? 'Plain' : g === 'dots' ? 'Dot grid' : 'Line grid', checked: doc.canvas.grid === g, run: () => setGrid(g) })) },
    { label: 'Snap to grid', checked: ui.prefs.snapToGrid, run: () => ui.updatePrefs({ snapToGrid: !ui.prefs.snapToGrid }) },
    { label: 'Alignment guides', checked: ui.prefs.smartGuides, run: () => ui.updatePrefs({ smartGuides: !ui.prefs.smartGuides }) },
    { sep: true },
    { label: 'Fit diagram', shortcut: `${SHIFT}1`, run: cmd.zoomToFit, disabled: !doc.elements.length },
    { label: 'Reset zoom (100%)', shortcut: `${MOD}0`, run: cmd.resetZoom },
    { sep: true },
    { label: 'Icons…', shortcut: `${SHIFT}I`, run: () => ui.updatePrefs({ showIconPanel: true }) },
    { label: 'Reset all default styles…', run: () => void cmd.resetAllToolStyles() },
  ];
}

export function ContextMenu() {
  const at = useUI((s) => s.contextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; flip: boolean } | null>(null);
  const close = () => useUI.getState().setContextMenu(null);

  // keep the menu on screen; open submenus to the left near the right edge
  useLayoutEffect(() => {
    if (!at || !ref.current) { setPos(null); return; }
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(at.x, innerWidth - r.width - 4)), y: Math.max(4, Math.min(at.y, innerHeight - r.height - 4)), flip: at.x > innerWidth - r.width - 240 });
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } }; // Esc closes only the menu
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('wheel', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [at]);

  if (!at) return null;
  const items = useUI.getState().selection.length ? selectionItems() : canvasItems();
  return (
    <div ref={ref} className={`ctx-menu no-canvas ${pos?.flip ? 'flip' : ''}`} style={{ left: pos?.x ?? at.x, top: pos?.y ?? at.y, visibility: pos ? 'visible' : 'hidden' }} onContextMenu={(e) => e.preventDefault()} aria-label="Context menu">
      <ItemList items={items} onClose={close} />
    </div>
  );
}
