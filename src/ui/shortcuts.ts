// Global keyboard shortcuts. Ignored while typing in inputs / text editor.
import { useEffect } from 'react';
import { useDoc } from '../store/docStore';
import { useUI } from '../store/uiStore';
import * as cmd from '../store/commands';
import type { ShapeKind } from '../model/types';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl+';
export const SHIFT = isMac ? '⇧' : 'Shift+';
export const ALT = isMac ? '⌥' : 'Alt+';

export const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  { group: 'Tools', items: [['Select', 'V'], ['Hand / pan', 'H'], ['Rectangle', 'R'], ['Rounded rectangle', 'U'], ['Ellipse', 'O'], ['Diamond', 'D'], ['Arrow / connector', 'A'], ['Line', 'L'], ['Freehand pen', 'P'], ['Highlighter', 'M'], ['Text', 'T'], ['Image', 'I'], ['Eraser', 'E'], ['Format painter', 'F'], ['Shape library', 'S']] },
  { group: 'Edit', items: [['Undo', `${MOD}Z`], ['Redo', `${MOD}${SHIFT}Z`], ['Cut / Copy / Paste', `${MOD}X / C / V`], ['Copy / paste style', `${MOD}${ALT}C / V`], ['Duplicate', `${MOD}D`], ['Delete', 'Delete / Backspace'], ['Select all', `${MOD}A`], ['Edit text of selection', 'Enter'], ['Nudge (×10 with Shift)', 'Arrow keys']] },
  { group: 'Arrange', items: [['Group / ungroup', `${MOD}G / ${MOD}${SHIFT}G`], ['Bring forward / to front', `${MOD}] / ${MOD}${SHIFT}]`], ['Send backward / to back', `${MOD}[ / ${MOD}${SHIFT}[`], ['Lock / unlock', `${MOD}${SHIFT}L`]] },
  { group: 'View & play', items: [['Play / pause', 'K  (or Shift+Space)'], ['Restart animation', `${SHIFT}K`], ['Zoom in / out', `${MOD}+ / ${MOD}-`], ['Reset zoom', `${MOD}0`], ['Fit diagram', `${SHIFT}1`], ['Zoom to selection', `${SHIFT}2`], ['Temporary pan', 'Space + drag'], ['Presentation mode', `${MOD}${SHIFT}P`], ['Cancel / back to select', 'Esc']] },
  { group: 'File', items: [['Save', `${MOD}S`], ['Save as', `${MOD}${SHIFT}S`], ['Open', `${MOD}O`], ['New diagram', `${ALT}N`], ['Export animated GIF', `${MOD}${SHIFT}E`], ['Keyboard shortcuts', '?']] },
];

const TOOL_KEYS: Record<string, [string, ShapeKind?]> = {
  v: ['select'], h: ['hand'], r: ['shape', 'rectangle'], u: ['shape', 'roundRect'], o: ['shape', 'ellipse'], d: ['shape', 'diamond'],
  a: ['arrow'], l: ['line'], p: ['freehand'], m: ['highlighter'], t: ['text'], e: ['eraser'], f: ['painter'],
};

const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editable(e.target)) return;
      const u = useUI.getState();
      const D = useDoc.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (u.presentation) {
        if (e.key === 'Escape') { u.setPresentation(false); if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined); }
        if (k === ' ' || k === 'k') { e.preventDefault(); cmd.togglePlay(); }
        return;
      }
      if (u.dialog) { if (e.key === 'Escape') u.openDialog(null); return; }
      const run = (f: () => void) => { e.preventDefault(); f(); };
      if (mod) {
        if (k === 'z' && !e.shiftKey) return run(() => D.undo());
        if ((k === 'z' && e.shiftKey) || k === 'y') return run(() => D.redo());
        if (k === 'c' && e.altKey) return run(cmd.copyStyle);
        if (k === 'v' && e.altKey) return run(cmd.pasteStyle);
        if (k === 'c') { if (u.selection.length) run(() => cmd.copySelection()); return; }
        if (k === 'x') return run(cmd.cutSelection);
        if (k === 'v') return; // handled by the paste event (keeps system clipboard working)
        if (k === 'd') return run(cmd.duplicateSelection);
        if (k === 'a') return run(cmd.selectAll);
        if (k === 'g') return run(e.shiftKey ? cmd.ungroupSelection : cmd.groupSelection);
        if (k === 's') return run(() => void cmd.save(e.shiftKey));
        if (k === 'o') return run(() => void cmd.openFile());
        if (k === 'e' && e.shiftKey) return run(() => u.openDialog('gif'));
        if (k === 'p' && e.shiftKey) return run(() => { u.setPresentation(true); u.setPlaying(true); });
        if (k === 'l' && e.shiftKey) return run(cmd.toggleLock);
        if (e.key === ']') return run(() => cmd.reorder(e.shiftKey ? 'front' : 'forward'));
        if (e.key === '[') return run(() => cmd.reorder(e.shiftKey ? 'back' : 'backward'));
        if (e.key === '=' || e.key === '+') return run(() => cmd.zoomAt(1.2));
        if (e.key === '-') return run(() => cmd.zoomAt(1 / 1.2));
        if (e.key === '0') return run(cmd.resetZoom);
        return;
      }
      if (e.altKey && k === 'n') return run(cmd.newDiagram);
      if (e.key === 'Escape') {
        if (u.hint) u.setHint(null);
        if (u.tool === 'painter') { u.setCopiedStyle(null); }
        if (u.tool !== 'select') return run(() => u.setTool('select'));
        if (u.selection.length) return run(() => u.select([]));
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') return run(cmd.deleteSelection);
      if (e.key === 'Enter' && u.selection.length === 1) {
        const el = D.doc.elements.find((x) => x.id === u.selection[0]);
        if (el && (el.type === 'shape' || el.type === 'text' || el.type === 'connector')) return run(() => u.setEditing(el.id));
      }
      if (e.key.startsWith('Arrow') && u.selection.length) {
        const s = e.shiftKey ? 10 : 1;
        return run(() => cmd.nudge(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0));
      }
      if (e.key === '?' ) return run(() => u.openDialog('shortcuts'));
      if (e.shiftKey && e.code === 'Space') return run(cmd.togglePlay);
      if (k === 'k') return run(e.shiftKey ? cmd.restart : cmd.togglePlay);
      if (e.shiftKey && e.code === 'Digit1') return run(cmd.zoomToFit);
      if (e.shiftKey && e.code === 'Digit2') return run(cmd.zoomToSelection);
      if (e.shiftKey || e.altKey) return;
      if (k === 'i') return run(() => void cmd.insertImage());
      if (k === 's') return run(() => u.openDialog('shapes'));
      const t = TOOL_KEYS[k];
      if (t) return run(() => u.setTool(t[0] as never, t[1]));
    };
    const onPaste = (e: ClipboardEvent) => {
      if (editable(e.target)) return;
      const img = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (img) { e.preventDefault(); void cmd.insertImage(img); return; }
      const t = e.clipboardData?.getData('text/plain');
      e.preventDefault();
      void cmd.paste(t || undefined);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('paste', onPaste); };
  }, []);
}
