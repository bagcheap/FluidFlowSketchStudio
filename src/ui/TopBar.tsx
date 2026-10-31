import { useEffect, useState } from 'react';
import { Download, Moon, Play, Redo2, Sun, Undo2, Monitor } from 'lucide-react';
import { useDoc } from '../store/docStore';
import { useUI } from '../store/uiStore';
import * as cmd from '../store/commands';
import { MenuBar, type MenuDef, type MenuItem } from './MenuBar';
import { ALT, MOD, SHIFT } from './shortcuts';
import { SHAPE_LABELS } from '../engine/shapes';
import { SHAPE_KINDS } from '../model/schema';
import { exportPng, exportSvg, copyPngToClipboard, exportHtmlPlayer } from '../export/staticExport';
import { saveCustomTemplate } from '../persistence/storage';
import { videoSupport } from '../export/video';
import { Logo } from './Logo';

export function TopBar() {
  const doc = useDoc((s) => s.doc);
  const dirty = useDoc((s) => s.dirty);
  const canUndo = useDoc((s) => s.past.length > 0);
  const canRedo = useDoc((s) => s.future.length > 0);
  const fileName = useDoc((s) => s.fileName);
  const autosavedAt = useDoc((s) => s.autosavedAt);
  const sel = useUI((s) => s.selection);
  const prefs = useUI((s) => s.prefs);
  const ui = useUI.getState();
  const [title, setTitle] = useState(doc.title);
  useEffect(() => setTitle(doc.title), [doc.title]);
  const a = doc.animation;
  const hasSel = sel.length > 0;
  const selConnector = doc.elements.some((e) => e.type === 'connector' && sel.includes(e.id));
  const selContainer = doc.elements.some((e) => e.type === 'container' && sel.includes(e.id));
  const toggle = (k: keyof typeof prefs) => () => ui.updatePrefs({ [k]: !prefs[k] } as never);

  const anim = (patch: Partial<typeof a>) => () => cmd.setAnimation(patch, 'menu');
  const menus: MenuDef[] = [
    { id: 'file', label: 'File', items: [
      { label: 'New diagram', shortcut: `${ALT}N`, run: cmd.newDiagram },
      { label: 'Open…', shortcut: `${MOD}O`, run: () => void cmd.openFile() },
      { label: 'Recent documents…', run: () => ui.openDialog('recent') },
      { label: 'New from template…', run: () => ui.openDialog('templates') },
      { sep: true },
      { label: 'Save', shortcut: `${MOD}S`, run: () => void cmd.save() },
      { label: 'Save as…', shortcut: `${MOD}${SHIFT}S`, run: () => void cmd.save(true) },
      { label: 'Rename…', run: () => cmd.renameDocument() },
      { label: 'Duplicate document', run: cmd.duplicateDocument },
      { label: 'Save as custom template', run: () => saveCustomTemplate(useDoc.getState().doc).then(() => ui.toast('Saved to your templates', 'success')).catch((e) => ui.toast(String(e.message ?? e), 'error')) },
      { sep: true },
      { label: 'Import diagram file…', run: () => void cmd.openFile() },
      { label: 'Import image…', run: () => void cmd.insertImage() },
      { label: 'Export', sub: exportItems() },
      { sep: true },
      { label: 'Document properties…', run: () => ui.openDialog('docprops') },
      { label: 'Recover autosaved document…', run: () => ui.openDialog('recent') },
    ] },
    { id: 'edit', label: 'Edit', items: [
      { label: 'Undo', shortcut: `${MOD}Z`, run: () => useDoc.getState().undo(), disabled: !canUndo },
      { label: 'Redo', shortcut: `${MOD}${SHIFT}Z`, run: () => useDoc.getState().redo(), disabled: !canRedo },
      { sep: true },
      { label: 'Cut', shortcut: `${MOD}X`, run: cmd.cutSelection, disabled: !hasSel },
      { label: 'Copy', shortcut: `${MOD}C`, run: () => void cmd.copySelection(), disabled: !hasSel },
      { label: 'Paste', shortcut: `${MOD}V`, run: () => void cmd.paste() },
      { label: 'Duplicate', shortcut: `${MOD}D`, run: cmd.duplicateSelection, disabled: !hasSel },
      { label: 'Delete', shortcut: 'Del', run: cmd.deleteSelection, disabled: !hasSel },
      { sep: true },
      { label: 'Copy style', shortcut: `${MOD}${ALT}C`, run: cmd.copyStyle, disabled: sel.length !== 1 },
      { label: 'Paste style', shortcut: `${MOD}${ALT}V`, run: cmd.pasteStyle, disabled: !hasSel },
      { label: 'Format painter', shortcut: 'F', run: () => ui.setTool('painter') },
      { label: 'Set as default style', run: cmd.applySelectionStyleToDefaults, disabled: sel.length !== 1, note: 'for new drawings with this tool' },
      { label: 'Reset default style', run: cmd.resetSelectionToolStyle, disabled: sel.length !== 1 },
      { label: 'Reset all default styles…', run: () => void cmd.resetAllToolStyles() },
      { sep: true },
      { label: 'Select all', shortcut: `${MOD}A`, run: cmd.selectAll },
      { label: 'Deselect', shortcut: 'Esc', run: cmd.deselect, disabled: !hasSel },
      { sep: true },
      { label: 'Preferences…', run: () => ui.openDialog('prefs') },
    ] },
    { id: 'insert', label: 'Insert', items: [
      { label: 'Basic shape', sub: (['rectangle', 'roundRect', 'ellipse', 'diamond', 'triangle', 'pill', 'hexagon'] as const).map((k) => ({ label: SHAPE_LABELS[k], run: () => cmd.insertShapeAtCenter(k) })) },
      { label: 'Flowchart symbol', sub: SHAPE_KINDS.filter((k) => !['rectangle', 'roundRect', 'ellipse', 'triangle', 'star'].includes(k)).map((k) => ({ label: SHAPE_LABELS[k], run: () => cmd.insertShapeAtCenter(k) })) },
      { label: 'Shape library…', shortcut: 'S', run: () => ui.openDialog('shapes') },
      { label: 'Arrow / connector', shortcut: 'A', run: () => ui.setTool('arrow') },
      { label: 'Line', shortcut: 'L', run: () => ui.setTool('line') },
      { label: 'Text', shortcut: 'T', run: () => ui.setTool('text') },
      { label: 'Image…', shortcut: 'I', run: () => void cmd.insertImage() },
      { label: 'Icons…', shortcut: `${SHIFT}I`, run: () => ui.updatePrefs({ showIconPanel: true }) },
      { label: 'Container around selection', run: cmd.addContainer, disabled: !hasSel },
      { label: 'Group selection', shortcut: `${MOD}G`, run: cmd.groupSelection, disabled: sel.length < 2 },
      { label: 'Template…', run: () => ui.openDialog('templates') },
    ] },
    { id: 'arrange', label: 'Arrange', items: [
      { label: 'Group', shortcut: `${MOD}G`, run: cmd.groupSelection, disabled: sel.length < 2 },
      { label: 'Ungroup', shortcut: `${MOD}${SHIFT}G`, run: cmd.ungroupSelection, disabled: !hasSel },
      { sep: true },
      { label: 'Align', sub: [
        { label: 'Left', run: () => cmd.align('left') }, { label: 'Centre', run: () => cmd.align('hcenter') }, { label: 'Right', run: () => cmd.align('right') },
        { sep: true }, { label: 'Top', run: () => cmd.align('top') }, { label: 'Middle', run: () => cmd.align('vcenter') }, { label: 'Bottom', run: () => cmd.align('bottom') },
      ], disabled: sel.length < 2 },
      { label: 'Distribute', sub: [{ label: 'Horizontally', run: () => cmd.distribute('h') }, { label: 'Vertically', run: () => cmd.distribute('v') }], disabled: sel.length < 3 },
      { sep: true },
      { label: 'Bring to front', shortcut: `${MOD}${SHIFT}]`, run: () => cmd.reorder('front'), disabled: !hasSel },
      { label: 'Bring forward', shortcut: `${MOD}]`, run: () => cmd.reorder('forward'), disabled: !hasSel },
      { label: 'Send backward', shortcut: `${MOD}[`, run: () => cmd.reorder('backward'), disabled: !hasSel },
      { label: 'Send to back', shortcut: `${MOD}${SHIFT}[`, run: () => cmd.reorder('back'), disabled: !hasSel },
      { sep: true },
      { label: 'Flip horizontal', run: () => cmd.flip('h'), disabled: !hasSel },
      { label: 'Flip vertical', run: () => cmd.flip('v'), disabled: !hasSel },
      { label: 'Swap arrow direction', run: () => cmd.swapDirection(), disabled: !selConnector },
      { sep: true },
      { label: 'Add container', run: cmd.addContainer, disabled: !hasSel },
      { label: 'Fit container to contents', run: cmd.fitSelectedContainers, disabled: !selContainer },
      { label: 'Remove container (keep contents)', run: cmd.removeSelectedContainers, disabled: !selContainer },
      { sep: true },
      { label: 'Lock / unlock', shortcut: `${MOD}${SHIFT}L`, run: cmd.toggleLock, disabled: !hasSel },
      { label: 'Unlock all', run: cmd.unlockAll },
      { sep: true },
      { label: 'Snap to grid', checked: prefs.snapToGrid, run: toggle('snapToGrid') },
      { label: 'Smart alignment guides', checked: prefs.smartGuides, run: toggle('smartGuides') },
    ] },
    { id: 'animation', label: 'Animation', items: [
      { label: 'Animation enabled', checked: a.enabled, run: anim({ enabled: !a.enabled }) },
      { label: 'Animate shapes', checked: a.animateShapes, run: anim({ animateShapes: !a.animateShapes }) },
      { label: 'Animate connectors', checked: a.animateConnectors, run: anim({ animateConnectors: !a.animateConnectors }) },
      { label: 'Global animation settings…', run: () => ui.openDialog('animation') },
      { sep: true },
      { label: 'Shape preset → selection', disabled: !hasSel, sub: Object.entries(cmd.SHAPE_PRESETS).map(([k, v]) => ({ label: k, run: () => cmd.applyAnimToSelection(v) })) },
      { label: 'Arrow flow type → selection', disabled: !hasSel, sub: Object.entries(cmd.ARROW_PRESETS).map(([k, v]) => ({ label: k, run: () => cmd.applyAnimToSelection(undefined, v) })) },
      { label: 'Default arrow flow (document)', sub: Object.entries(cmd.ARROW_PRESETS).map(([k, v]) => ({ label: k, checked: a.connector.mode === v.mode, run: () => cmd.setAnimation({ connector: { ...a.connector, ...v } }) })) },
      { label: 'Reset selected to document defaults', run: cmd.resetAnimSelected, disabled: !hasSel },
      { sep: true },
      { label: 'Duration', sub: [2, 3, 4, 5, 6, 8, 10].map((s) => ({ label: `${s} seconds`, checked: a.duration === s, run: anim({ duration: s }) })) },
      { label: 'Playback speed', sub: [0.25, 0.5, 1, 1.5, 2].map((s) => ({ label: `${s}×`, checked: a.playbackSpeed === s, run: anim({ playbackSpeed: s }) })) },
      { label: 'Loop', checked: a.loop, run: anim({ loop: !a.loop }) },
      { label: 'Reduced-motion mode', checked: a.reducedMotion, run: anim({ reducedMotion: !a.reducedMotion }) },
      { sep: true },
      { label: 'Reset all animation settings', run: cmd.resetDocAnimation },
    ] },
    { id: 'view', label: 'View', items: [
      { label: 'Zoom in', shortcut: `${MOD}+`, run: () => cmd.zoomAt(1.2) },
      { label: 'Zoom out', shortcut: `${MOD}-`, run: () => cmd.zoomAt(1 / 1.2) },
      { label: 'Reset zoom (100%)', shortcut: `${MOD}0`, run: cmd.resetZoom },
      { label: 'Fit diagram', shortcut: `${SHIFT}1`, run: cmd.zoomToFit },
      { label: 'Zoom to selection', shortcut: `${SHIFT}2`, run: cmd.zoomToSelection, disabled: !hasSel },
      { sep: true },
      { label: 'Presentation mode', shortcut: `${MOD}${SHIFT}P`, run: () => { ui.setPresentation(true); ui.setPlaying(true); } },
      { label: 'Fullscreen', run: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => ui.toast('Fullscreen is not available here', 'error')) },
      { sep: true },
      { label: 'Grid', sub: (['dots', 'lines', 'none'] as const).map((g) => ({ label: g === 'none' ? 'Plain' : g === 'dots' ? 'Dot grid' : 'Line grid', checked: doc.canvas.grid === g, run: () => useDoc.getState().commit((d) => ({ ...d, canvas: { ...d.canvas, grid: g } })) })) },
      { label: 'Alignment guides', checked: prefs.smartGuides, run: toggle('smartGuides') },
      { label: 'Show inspector', checked: prefs.showInspector, run: toggle('showInspector') },
      { label: 'Show timeline', checked: prefs.showTimeline, run: toggle('showTimeline') },
      { sep: true },
      { label: 'Theme', sub: (['light', 'dark', 'system'] as const).map((t) => ({ label: t[0].toUpperCase() + t.slice(1), checked: prefs.theme === t, run: () => ui.updatePrefs({ theme: t }) })) },
    ] },
    { id: 'export', label: 'Export', items: exportItems() },
    { id: 'help', label: 'Help', items: [
      { label: 'Getting started & feature guide', run: () => ui.openDialog('help') },
      { label: 'Keyboard shortcuts', shortcut: '?', run: () => ui.openDialog('shortcuts') },
      { label: 'Sample diagrams…', run: () => ui.openDialog('templates') },
      { label: 'What’s new', run: () => ui.openDialog('whatsnew') },
      { label: 'About FlowSketch Studio', run: () => ui.openDialog('about') },
    ] },
  ];

  function exportItems(): MenuItem[] {
    const vs = videoSupport();
    return [
      { label: 'Animated GIF…', shortcut: `${MOD}${SHIFT}E`, run: () => ui.openDialog('gif') },
      { label: vs ? `Video (${vs.label})…` : 'Video', note: vs ? undefined : 'not supported in this browser', disabled: !vs, run: () => ui.openDialog('video') },
      { label: 'PNG / JPEG image…', run: () => ui.openDialog('image') },
      { label: 'SVG (vector)…', run: () => ui.openDialog('svg') },
      { label: 'Standalone HTML player', run: () => void exportHtmlPlayer().catch((e) => ui.toast(String(e.message ?? e), 'error')) },
      { sep: true },
      { label: 'Quick PNG (current frame)', run: () => void exportPng({}).catch((e) => ui.toast(String(e.message ?? e), 'error')) },
      { label: 'Quick SVG (current frame)', run: () => void exportSvg({}).catch((e) => ui.toast(String(e.message ?? e), 'error')) },
      { label: 'Copy image to clipboard', run: () => void copyPngToClipboard().then(() => ui.toast('Image copied', 'success')).catch((e) => ui.toast(String(e.message ?? e), 'error')) },
      { label: 'Diagram file (.flowsketch)', run: () => void cmd.save(true) },
    ];
  }

  const status = dirty
    ? (autosavedAt ? 'Autosaved in browser · not saved to file' : 'Unsaved changes')
    : fileName ? `Saved · ${fileName}` : 'All changes saved';

  return (
    <header className="topbar no-canvas">
      <div className="brand" title="FlowSketch Studio"><Logo /><span className="brand-name">FlowSketch</span></div>
      <input
        className="doc-title"
        aria-label="Document title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== doc.title ? cmd.renameDocument(title) : setTitle(doc.title)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTitle(doc.title); (e.target as HTMLInputElement).blur(); } }}
      />
      <MenuBar menus={menus} />
      <div className="topbar-right">
        <span className={`save-status ${dirty ? 'dirty' : ''}`} role="status" aria-live="polite"><span className="dot" />{status}</span>
        <button className="icon-btn" aria-label="Undo" title={`Undo (${MOD}Z)`} disabled={!canUndo} onClick={() => useDoc.getState().undo()}><Undo2 size={17} /></button>
        <button className="icon-btn" aria-label="Redo" title={`Redo (${MOD}${SHIFT}Z)`} disabled={!canRedo} onClick={() => useDoc.getState().redo()}><Redo2 size={17} /></button>
        <button className="icon-btn" aria-label="Toggle theme" title="Theme: light / dark / system" onClick={() => ui.updatePrefs({ theme: prefs.theme === 'light' ? 'dark' : prefs.theme === 'dark' ? 'system' : 'light' })}>
          {prefs.theme === 'light' ? <Sun size={17} /> : prefs.theme === 'dark' ? <Moon size={17} /> : <Monitor size={17} />}
        </button>
        <button className="btn ghost" onClick={() => { ui.setPresentation(true); ui.setPlaying(true); }} title={`Present (${MOD}${SHIFT}P)`}><Play size={15} /> Present</button>
        <button className="btn primary" onClick={() => ui.openDialog('gif')} title="Export animated GIF"><Download size={15} /> Export GIF</button>
      </div>
    </header>
  );
}
