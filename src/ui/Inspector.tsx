// Context-sensitive properties panel.
// With a selection it edits those objects; with a drawing tool active it edits that tool's
// remembered defaults (existing objects are never touched by default changes).
import type { ReactNode } from 'react';
import { AlignCenter, AlignLeft, ArrowRightLeft, AlignRight, ArrowDownToLine, ArrowUpToLine, Bold, ClipboardPaste, Copy, CopyPlus, Italic, Lock, Paintbrush, RotateCcw, Trash2, Unlock, FoldVertical, BringToFront, SendToBack, AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal } from 'lucide-react';
import type { ConnectorAnim, ConnectorElement, ContainerElement, DiagramElement, FillStyle, IconElement, ShapeAnim, ShapeKind, Style, TextStyle, ToolStyle } from '../model/types';
import { HIGHLIGHT_COLORS, PALETTE_FILL, PALETTE_STROKE, styleKey } from '../model/defaults';
import { getElement, mapElements, useDoc } from '../store/docStore';
import { useUI } from '../store/uiStore';
import * as cmd from '../store/commands';
import { ColorPicker, NumberField, Row, Section, Segmented, Select, Slider, Toggle } from './controls';
import { FONT_LABELS } from '../engine/text';
import { SHAPE_LABELS } from '../engine/shapes';
import { iconTitle } from '../icons/sets';
import { VENDORS } from '../icons/zipImport';
import { SHAPE_KINDS } from '../model/schema';

const ROUGH = [{ v: 0, label: 'Precise' }, { v: 0.7, label: 'Slight' }, { v: 1.5, label: 'Sketchy' }, { v: 2.6, label: 'Wild' }] as const;

type Kind = 'shape' | 'text' | 'freehand' | 'image' | 'icon' | 'container' | 'connector';

export function Inspector() {
  const doc = useDoc((s) => s.doc);
  const selection = useUI((s) => s.selection);
  const tool = useUI((s) => s.tool);
  const shapeKind = useUI((s) => s.shapeKind);
  useUI((s) => s.prefs.toolStyles);
  useUI((s) => s.prefs.sharedStyle);
  const ui = useUI.getState();
  const els = selection.map((id) => getElement(doc, id)).filter(Boolean) as DiagramElement[];

  // ---- target abstraction ---------------------------------------------------------------
  const toolKey = tool === 'shape' || tool === 'arrow' || tool === 'line' || tool === 'freehand' || tool === 'highlighter' || tool === 'text' ? styleKey(tool, shapeKind) : null;
  const onSelection = els.length > 0;
  if (!onSelection && !toolKey) return <CanvasPanel />;
  const ts: ToolStyle | null = toolKey ? ui.toolStyle(toolKey) : null;
  const first = els[0];
  const kinds = new Set<Kind>(onSelection ? els.map((e) => e.type) : [toolKey === 'arrow' || toolKey === 'line' ? 'connector' : toolKey === 'text' ? 'text' : toolKey === 'freehand' || toolKey === 'highlighter' ? 'freehand' : 'shape']);
  const style: Style = onSelection ? first.style : ts!.style;
  const text: TextStyle = onSelection ? first.textStyle : ts!.textStyle;
  const anyLocked = els.some((e) => e.locked);
  const editable = !anyLocked;
  const ids = els.map((e) => e.id);

  const setStyle = (p: Partial<Style>) => {
    const key = 'style:' + Object.keys(p).join();
    if (onSelection) { useDoc.getState().commit((d) => mapElements(d, ids, (e) => ({ ...e, style: { ...e.style, ...p } })), key + ids.join()); cmd.rememberSelectionStyle(ids); }
    else ui.setToolStyle(toolKey!, { ...ts!, style: { ...ts!.style, ...p } });
  };
  const setText = (p: Partial<TextStyle>) => {
    if (onSelection) { useDoc.getState().commit((d) => mapElements(d, ids, (e) => cmd.fitShapeToText({ ...e, textStyle: { ...e.textStyle, ...p } } as DiagramElement)), 'text:' + Object.keys(p).join() + ids.join()); cmd.rememberSelectionStyle(ids); }
    else ui.setToolStyle(toolKey!, { ...ts!, textStyle: { ...ts!.textStyle, ...p } });
  };
  const setConn = (p: Partial<ConnectorElement>) => {
    if (onSelection) useDoc.getState().commit((d) => mapElements(d, ids, (e) => (e.type === 'connector' ? { ...e, ...p } : e)), 'conn:' + Object.keys(p).join() + ids.join());
    else ui.setToolStyle(toolKey!, { ...ts!, ...p });
  };
  const setShapeAnim = (p: Partial<ShapeAnim>) => {
    if (onSelection) useDoc.getState().commit((d) => mapElements(d, ids, (e) => (e.type !== 'connector' ? { ...e, anim: { ...e.anim, ...p } } : e)), 'sanim:' + Object.keys(p).join() + ids.join());
    else ui.setToolStyle(toolKey!, { ...ts!, shapeAnim: { ...ts!.shapeAnim, ...p } });
  };
  const resetShapeAnimKey = (k: keyof ShapeAnim) => {
    const strip = <T extends object>(o: T | undefined) => { if (!o) return o; const c = { ...o } as Record<string, unknown>; delete c[k]; return Object.keys(c).length ? (c as T) : undefined; };
    if (onSelection) useDoc.getState().commit((d) => mapElements(d, ids, (e) => (e.type !== 'connector' ? { ...e, anim: strip(e.anim) } : e)));
    else ui.setToolStyle(toolKey!, { ...ts!, shapeAnim: strip(ts!.shapeAnim) });
  };
  const setConnAnim = (p: Partial<ConnectorAnim>) => {
    if (onSelection) useDoc.getState().commit((d) => mapElements(d, ids, (e) => (e.type === 'connector' ? { ...e, anim: { ...e.anim, ...p } } : e)), 'canim:' + Object.keys(p).join() + ids.join());
    else ui.setToolStyle(toolKey!, { ...ts!, connectorAnim: { ...ts!.connectorAnim, ...p } });
  };
  const resetConnAnimKey = (k: keyof ConnectorAnim) => {
    const strip = <T extends object>(o: T | undefined) => { if (!o) return o; const c = { ...o } as Record<string, unknown>; delete c[k]; return Object.keys(c).length ? (c as T) : undefined; };
    if (onSelection) useDoc.getState().commit((d) => mapElements(d, ids, (e) => (e.type === 'connector' ? { ...e, anim: strip(e.anim) } : e)));
    else ui.setToolStyle(toolKey!, { ...ts!, connectorAnim: strip(ts!.connectorAnim) });
  };

  const shapeOv: Partial<ShapeAnim> = (onSelection ? (els.find((e) => e.type !== 'connector') as { anim?: Partial<ShapeAnim> } | undefined)?.anim : ts!.shapeAnim) ?? {};
  const connOv: Partial<ConnectorAnim> = (onSelection ? (els.find((e) => e.type === 'connector') as ConnectorElement | undefined)?.anim : ts!.connectorAnim) ?? {};
  const sa: ShapeAnim = { ...doc.animation.shape, ...shapeOv };
  const ca: ConnectorAnim = { ...doc.animation.connector, ...connOv };
  const conn = onSelection ? (els.find((e) => e.type === 'connector') as ConnectorElement | undefined) : undefined;
  const routing = conn?.routing ?? ts?.routing ?? 'curved';
  const startHead = conn?.startHead ?? ts?.startHead ?? 'none';
  const endHead = conn?.endHead ?? ts?.endHead ?? 'arrow';
  const hasBox = kinds.has('shape') || kinds.has('text') || kinds.has('image') || kinds.has('freehand');
  const hasFillable = kinds.has('shape') || kinds.has('container');
  const hasText = kinds.has('shape') || kinds.has('text') || kinds.has('connector') || kinds.has('icon') || kinds.has('container');
  const containers = els.filter((e): e is ContainerElement => e.type === 'container');
  const iconEls = els.filter((e): e is IconElement => e.type === 'icon');
  const onlyIcons = onSelection && iconEls.length === els.length;
  const firstIcon = iconEls[0];
  const allMono = iconEls.every((e) => doc.icons[e.iconId]?.mono);
  const setIcon = (p: Partial<IconElement>) => useDoc.getState().commit((d) => mapElements(d, ids, (e) => (e.type === 'icon' ? { ...e, ...p } : e)), 'icon:' + Object.keys(p).join() + ids.join());
  const singleShape = els.length === 1 && first.type === 'shape' ? first : null;
  const singleBox = els.length === 1 && first.type !== 'connector' ? first : null;

  const heading = onSelection
    ? els.length === 1 ? `${first.type === 'shape' ? SHAPE_LABELS[first.shape] : first.type === 'connector' ? (first.endHead === 'none' && first.startHead === 'none' ? 'Line' : 'Arrow') : first.type === 'icon' ? `Icon · ${iconTitle(doc.icons[first.iconId]?.name ?? 'missing')}` : first.type === 'container' ? `Container · ${first.text || 'untitled'}` : first.type[0].toUpperCase() + first.type.slice(1)}` : `${els.length} objects`
    : `New ${toolKey!.startsWith('shape:') ? SHAPE_LABELS[toolKey!.slice(6) as ShapeKind].toLowerCase() : toolKey}`;

  return (
    <aside className="inspector no-canvas" aria-label="Properties">
      <div className="insp-head">
        <div>
          <div className="insp-title">{heading}</div>
          <div className="insp-sub">{onSelection ? (anyLocked ? 'Locked — unlock to edit' : 'Editing selected objects') : 'Defaults for the next shapes you draw'}</div>
        </div>
        {!onSelection && toolKey && (
          <div className="insp-actions">
            <button className="icon-btn sm" title="Reset this tool's default style to the original" aria-label="Reset default style" onClick={() => cmd.resetToolStyle(toolKey)}><RotateCcw size={14} /></button>
          </div>
        )}
        {onSelection && (
          <div className="insp-actions">
            <button className="icon-btn sm" title="Copy style" aria-label="Copy style" onClick={cmd.copyStyle} disabled={els.length !== 1}><Copy size={14} /></button>
            <button className="icon-btn sm" title="Paste style" aria-label="Paste style" onClick={cmd.pasteStyle}><ClipboardPaste size={14} /></button>
            <button className="icon-btn sm" title="Use this style for new drawings with this tool" aria-label="Apply style to tool defaults" onClick={cmd.applySelectionStyleToDefaults} disabled={els.length !== 1}><Paintbrush size={14} /></button>
          </div>
        )}
      </div>
      <div className="insp-scroll">
        <fieldset disabled={!editable} className="insp-fieldset">
          {singleShape && (
            <Section title="Shape">
              <Select label="Shape type" value={singleShape.shape} options={SHAPE_KINDS.map((k) => ({ v: k, label: SHAPE_LABELS[k] }))} onChange={(v) => useDoc.getState().commit((d) => mapElements(d, ids, (e) => (e.type === 'shape' ? { ...e, shape: v } : e)))} />
            </Section>
          )}
          {containers.length > 0 && (
            <Section title="Container">
              {containers.length === 1 && <p className="insp-tip">{containers[0].members.length === 1 ? '1 item' : `${containers[0].members.length} items`} inside. Drag shapes in or out to add or remove them; the container grows to fit. Double-click the title to rename it.</p>}
              <div className="btn-row">
                <button className="btn small" onClick={cmd.fitSelectedContainers} title="Resize to fit what is inside (grows or shrinks)">Fit to contents</button>
                <button className="btn small" onClick={cmd.removeSelectedContainers} title="Delete the container but keep what is inside it">Remove container</button>
              </div>
            </Section>
          )}
          {firstIcon && (
            <Section title="Icon">
              {iconEls.length === 1 && (() => {
                const a = doc.icons[firstIcon.iconId];
                if (!a) return null;
                // built-in sets name a licence ("MIT"); provider packages name the provider's terms ("AWS terms")
                const lic = !a.license ? '' : a.license.includes(' ') ? ` · ${a.license}` : ` · ${a.license} licence`;
                return <p className="insp-tip">{(a.set || 'Imported icon') + lic}{a.license === VENDORS.azure.terms && <><br />{VENDORS.azure.note}</>}</p>;
              })()}
              {allMono && <ColorPicker label="Icon colour" value={firstIcon.style.stroke} palette={PALETTE_STROKE} onChange={(c) => setStyle({ stroke: c })} />}
              {allMono && <Toggle label="Hand-drawn" checked={firstIcon.sketch} onChange={(v) => setIcon({ sketch: v })} />}
              <Row label="Label">
                <Segmented label="Label position" value={firstIcon.labelPos} onChange={(v) => setIcon({ labelPos: v })} options={[{ v: 'below', label: 'Below' }, { v: 'right', label: 'Right' }, { v: 'none', label: 'None' }]} />
              </Row>
              <Row label="Background">
                <Segmented label="Icon background" value={firstIcon.frame} onChange={(v) => setIcon({ frame: v })} options={[{ v: 'none', label: 'None' }, { v: 'circle', label: 'Circle' }, { v: 'square', label: 'Square' }]} />
              </Row>
              {firstIcon.frame !== 'none' && <ColorPicker label="Background colour" value={firstIcon.style.fill} palette={PALETTE_FILL} onChange={(c) => setStyle({ fill: c })} />}
            </Section>
          )}
          {!onlyIcons && <Section title={kinds.has('connector') && !hasBox ? 'Line' : 'Stroke'}>
            <ColorPicker label="Stroke colour" value={style.stroke} palette={PALETTE_STROKE} onChange={(c) => setStyle({ stroke: c })} />
            <Slider label="Width" value={style.strokeWidth} min={0} max={kinds.has('freehand') ? 40 : 16} step={0.5} unit="px" onChange={(v) => setStyle({ strokeWidth: v })} />
            <Row label="Pattern">
              <Segmented label="Stroke pattern" value={style.strokeStyle} onChange={(v) => setStyle({ strokeStyle: v })} options={[{ v: 'solid', label: 'Solid' }, { v: 'dashed', label: 'Dashed' }, { v: 'dotted', label: 'Dotted' }]} />
            </Row>
            <Row label="Hand-drawn" hint="Static roughness of the outline (separate from animated squiggle)">
              <Segmented label="Hand-drawn style" value={ROUGH.reduce((b, r) => (Math.abs(r.v - style.roughness) < Math.abs(b.v - style.roughness) ? r : b)).v} onChange={(v) => setStyle({ roughness: v })} options={ROUGH.map((r) => ({ v: r.v, label: r.label }))} />
            </Row>
            <Slider label="Roughness" value={style.roughness} min={0} max={3} step={0.1} onChange={(v) => setStyle({ roughness: v })} />
          </Section>}

          {hasFillable && (
            <Section title="Fill">
              <ColorPicker label="Fill colour" value={style.fill} palette={PALETTE_FILL} allowTransparent onChange={(c) => setStyle({ fill: c, ...(c === 'transparent' ? { fillStyle: 'none' as FillStyle } : style.fillStyle === 'none' ? { fillStyle: 'solid' as FillStyle } : {}) })} />
              <Row label="Style">
                <Segmented label="Fill style" value={style.fillStyle} onChange={(v) => setStyle({ fillStyle: v })} options={[{ v: 'none', label: 'None' }, { v: 'solid', label: 'Solid' }, { v: 'hachure', label: 'Hatch' }, { v: 'cross-hatch', label: 'Cross' }]} />
              </Row>
              <Slider label="Corner radius" value={style.cornerRadius} min={0} max={80} onChange={(v) => setStyle({ cornerRadius: v })} hint="Rectangles, rounded rectangles and speech bubbles" />
              <Toggle label="Soft shadow" checked={style.shadow} onChange={(v) => setStyle({ shadow: v })} />
            </Section>
          )}

          <Section title="Opacity" defaultOpen={false}>
            <Slider label="Opacity" value={Math.round(style.opacity * 100)} min={5} max={100} unit="%" onChange={(v) => setStyle({ opacity: v / 100 })} />
          </Section>

          {kinds.has('connector') && (
            <Section title="Connector">
              {onSelection && <button className="btn small" title="Start and end trade places, so the arrow points the other way" onClick={() => cmd.swapDirection(ids)}><ArrowRightLeft size={13} /> Swap direction</button>}
              <Row label="Routing">
                <Segmented label="Routing" value={routing} onChange={(v) => setConn({ routing: v })} options={[{ v: 'straight', label: 'Straight' }, { v: 'curved', label: 'Curved' }, { v: 'elbow', label: 'Elbow' }]} />
              </Row>
              <Row label="Start">
                <Select label="Start arrowhead" value={startHead} onChange={(v) => setConn({ startHead: v })} options={HEADS} />
              </Row>
              <Row label="End">
                <Select label="End arrowhead" value={endHead} onChange={(v) => setConn({ endHead: v })} options={HEADS} />
              </Row>
              {conn && routing === 'curved' && conn.bends.length === 0 && <Slider label="Curvature" value={conn.curvature} min={-1} max={1} step={0.05} onChange={(v) => setConn({ curvature: v })} />}
              {conn && conn.bends.length > 0 && <button className="btn small" onClick={() => setConn({ bends: [] })}>Remove {conn.bends.length} bend point{conn.bends.length > 1 ? 's' : ''}</button>}
              {conn && <Slider label="Label position" value={conn.labelPos} min={0} max={1} step={0.01} onChange={(v) => setConn({ labelPos: v })} />}
              {conn && <Slider label="Label offset" value={conn.labelOffset} min={-80} max={80} unit="px" onChange={(v) => setConn({ labelOffset: v })} />}
              <p className="insp-tip">Drag an end onto a shape to attach (snaps to side ports). Drag the faint mid-dots to add bends; Alt-drag an end to detach.</p>
            </Section>
          )}

          {hasText && (
            <Section title="Text" defaultOpen={kinds.has('text')}>
              <Row label="Font">
                <Segmented label="Font family" value={text.fontFamily} onChange={(v) => setText({ fontFamily: v })} options={(Object.keys(FONT_LABELS) as (keyof typeof FONT_LABELS)[]).map((f) => ({ v: f, label: <span className={`font-${f}`}>{FONT_LABELS[f]}</span>, title: FONT_LABELS[f] }))} />
              </Row>
              <Slider label="Size" value={text.fontSize} min={8} max={96} unit="px" onChange={(v) => setText({ fontSize: v })} />
              <Row label="Style">
                <div className="btn-row">
                  <button className={`icon-btn sm ${text.bold ? 'on' : ''}`} aria-pressed={text.bold} aria-label="Bold" onClick={() => setText({ bold: !text.bold })}><Bold size={14} /></button>
                  <button className={`icon-btn sm ${text.italic ? 'on' : ''}`} aria-pressed={text.italic} aria-label="Italic" onClick={() => setText({ italic: !text.italic })}><Italic size={14} /></button>
                  <span className="sep" />
                  <Segmented label="Horizontal alignment" value={text.align} onChange={(v) => setText({ align: v })} options={[{ v: 'left', label: <AlignLeft size={14} />, title: 'Left' }, { v: 'center', label: <AlignCenter size={14} />, title: 'Centre' }, { v: 'right', label: <AlignRight size={14} />, title: 'Right' }]} />
                </div>
              </Row>
              {!kinds.has('connector') && !onlyIcons && !kinds.has('container') && (
                <Row label="Vertical">
                  <Segmented label="Vertical alignment" value={text.vAlign} onChange={(v) => setText({ vAlign: v })} options={[{ v: 'top', label: <ArrowUpToLine size={14} />, title: 'Top' }, { v: 'middle', label: <FoldVertical size={14} />, title: 'Middle' }, { v: 'bottom', label: <ArrowDownToLine size={14} />, title: 'Bottom' }]} />
                </Row>
              )}
              <ColorPicker label="Text colour" value={text.color} palette={PALETTE_STROKE} onChange={(c) => setText({ color: c })} />
              <Slider label="Padding" value={text.padding} min={0} max={60} unit="px" onChange={(v) => setText({ padding: v })} />
              <Slider label="Line height" value={text.lineHeight} min={0.9} max={2.2} step={0.05} onChange={(v) => setText({ lineHeight: v })} />
              {onSelection && els.length === 1 && first.type !== 'image' && first.type !== 'freehand' && <button className="btn small" onClick={() => ui.setEditing(first.id)}>Edit text (Enter)</button>}
            </Section>
          )}

          {(hasBox) && (
            <Section title="Shape animation" right={<button className="mini-btn" title="Reset to document defaults" aria-label="Reset shape animation to document defaults" onClick={() => (onSelection ? cmd.resetAnimSelected() : ui.setToolStyle(toolKey!, { ...ts!, shapeAnim: undefined }))}><RotateCcw size={12} /></button>}>
              <Select label="Animation style" value={sa.mode} onChange={(v) => setShapeAnim({ mode: v })} options={[{ v: 'combined', label: 'Combined organic motion' }, { v: 'float', label: 'Gentle float' }, { v: 'wobble', label: 'Organic wobble' }, { v: 'boil', label: 'Sketch boil' }, { v: 'sway', label: 'Soft sway' }, { v: 'off', label: 'Off (still)' }]} />
              {sa.mode !== 'off' && <>
                <Slider label="Squiggle" value={sa.intensity} min={0} max={10} step={0.5} overridden={'intensity' in shapeOv} onReset={() => resetShapeAnimKey('intensity')} onChange={(v) => setShapeAnim({ intensity: v })} hint="Master intensity: 0 = perfectly still" />
                <Slider label="Speed" value={sa.speed} min={0} max={2} step={0.05} unit="Hz" overridden={'speed' in shapeOv} onReset={() => resetShapeAnimKey('speed')} onChange={(v) => setShapeAnim({ speed: v })} />
                <Slider label="Movement" value={sa.amplitude} min={0} max={12} step={0.1} unit="px" overridden={'amplitude' in shapeOv} onReset={() => resetShapeAnimKey('amplitude')} onChange={(v) => setShapeAnim({ amplitude: v })} hint="Translation at squiggle 2" />
                <Slider label="Rotation" value={sa.rotation} min={0} max={6} step={0.1} unit="°" overridden={'rotation' in shapeOv} onReset={() => resetShapeAnimKey('rotation')} onChange={(v) => setShapeAnim({ rotation: v })} />
                <Slider label="Deform" value={sa.deform} min={0} max={10} step={0.1} unit="px" overridden={'deform' in shapeOv} onReset={() => resetShapeAnimKey('deform')} onChange={(v) => setShapeAnim({ deform: v })} hint="Outline deformation" />
                <Slider label="Smoothness" value={sa.smoothness} min={0} max={1} step={0.05} overridden={'smoothness' in shapeOv} onReset={() => resetShapeAnimKey('smoothness')} onChange={(v) => setShapeAnim({ smoothness: v })} />
                <Slider label="Phase" value={sa.phase} min={0} max={1} step={0.01} overridden={'phase' in shapeOv} onReset={() => resetShapeAnimKey('phase')} onChange={(v) => setShapeAnim({ phase: v })} />
                <Slider label="Delay" value={sa.delay} min={0} max={Math.max(1, doc.animation.duration)} step={0.1} unit="s" overridden={'delay' in shapeOv} onReset={() => resetShapeAnimKey('delay')} onChange={(v) => setShapeAnim({ delay: v })} />
                <Row label="Text">
                  <Segmented label="Text motion" value={sa.textMotion} onChange={(v) => setShapeAnim({ textMotion: v })} options={[{ v: 'follow', label: 'Moves with shape' }, { v: 'stable', label: 'Stable' }, { v: 'independent', label: 'Own drift' }]} />
                </Row>
                {onSelection && <button className="btn small" onClick={() => useDoc.getState().commit((d) => mapElements(d, ids, (e) => ({ ...e, seed: Math.floor(Math.random() * 2 ** 31) + 1 })))}>Re-roll seed (new sketch & motion)</button>}
              </>}
            </Section>
          )}

          {kinds.has('connector') && (
            <Section title="Arrow animation" right={<button className="mini-btn" title="Reset to document defaults" aria-label="Reset arrow animation" onClick={() => (onSelection ? cmd.resetAnimSelected() : ui.setToolStyle(toolKey!, { ...ts!, connectorAnim: undefined }))}><RotateCcw size={12} /></button>}>
              <Select label="Arrow animation" value={ca.mode} onChange={(v) => setConnAnim({ mode: v })} options={[{ v: 'travel', label: 'Travelling highlight' }, { v: 'drawOn', label: 'Draw on' }, { v: 'dash', label: 'Marching dashes' }, { v: 'pulse', label: 'Pulsing highlight' }, { v: 'none', label: 'Static' }]} />
              {ca.mode !== 'none' && <>
                <Slider label="Speed" value={ca.speed} min={0.05} max={3} step={0.05} unit="/s" overridden={'speed' in connOv} onReset={() => resetConnAnimKey('speed')} onChange={(v) => setConnAnim({ speed: v })} hint="Trips (or cycles) per second, snapped to fit the loop" />
                <Row label="Direction">
                  <Segmented label="Direction" value={ca.direction} onChange={(v) => setConnAnim({ direction: v })} options={[{ v: 'forward', label: 'Forward →' }, { v: 'reverse', label: '← Reverse' }]} />
                </Row>
              </>}
              {(ca.mode === 'travel' || ca.mode === 'pulse') && <>
                <ColorPicker label="Highlight colour" value={ca.highlightColor} palette={HIGHLIGHT_COLORS} onChange={(c) => setConnAnim({ highlightColor: c })} />
                <Slider label="Opacity" value={Math.round(ca.highlightOpacity * 100)} min={10} max={100} unit="%" onChange={(v) => setConnAnim({ highlightOpacity: v / 100 })} />
                <Toggle label="Glow" checked={ca.glow} onChange={(v) => setConnAnim({ glow: v })} />
              </>}
              {ca.mode === 'travel' && <>
                <Slider label="Length" value={ca.highlightLength} min={4} max={300} unit="px" overridden={'highlightLength' in connOv} onReset={() => resetConnAnimKey('highlightLength')} onChange={(v) => setConnAnim({ highlightLength: v })} />
                <Slider label="Segments" value={ca.segments} min={1} max={8} onChange={(v) => setConnAnim({ segments: v })} hint="Simultaneous moving segments, evenly spaced" />
                <Toggle label="Rounded segment ends" checked={ca.roundCaps} onChange={(v) => setConnAnim({ roundCaps: v })} />
              </>}
              {ca.mode === 'drawOn' && <>
                <Slider label="Drawing time" value={Math.round(ca.drawFraction * 100)} min={5} max={100} unit="%" onChange={(v) => setConnAnim({ drawFraction: v / 100 })} hint="Share of each cycle spent drawing" />
                <Slider label="Pause" value={Math.round(ca.pauseFraction * 100)} min={0} max={90} unit="%" onChange={(v) => setConnAnim({ pauseFraction: v / 100 })} hint="Share of each cycle hidden/erasing before it restarts" />
                <Toggle label="Erase from tail before restarting" checked={ca.erase} onChange={(v) => setConnAnim({ erase: v })} />
              </>}
              {ca.mode !== 'none' && <>
                <Slider label="Delay" value={ca.delay} min={0} max={Math.max(1, doc.animation.duration)} step={0.1} unit="s" onChange={(v) => setConnAnim({ delay: v })} />
                <Toggle label="Pulse arrowhead" checked={ca.arrowPulse} onChange={(v) => setConnAnim({ arrowPulse: v })} />
              </>}
            </Section>
          )}

          {singleBox && (
            <Section title="Position & size" defaultOpen={false}>
              <div className="grid2">
                <NumberField label="X" value={singleBox.x} onChange={(v) => useDoc.getState().commit((d) => mapElements(d, ids, (e) => ({ ...e, x: v })))} />
                <NumberField label="Y" value={singleBox.y} onChange={(v) => useDoc.getState().commit((d) => mapElements(d, ids, (e) => ({ ...e, y: v })))} />
                <NumberField label="W" min={4} value={singleBox.w} onChange={(v) => useDoc.getState().commit((d) => mapElements(d, ids, (e) => ({ ...e, w: Math.max(4, v) })))} />
                <NumberField label="H" min={4} value={singleBox.h} onChange={(v) => useDoc.getState().commit((d) => mapElements(d, ids, (e) => ({ ...e, h: Math.max(4, v) })))} />
                <NumberField label="Rotation °" value={singleBox.rotation} onChange={(v) => useDoc.getState().commit((d) => mapElements(d, ids, (e) => ({ ...e, rotation: ((v % 360) + 540) % 360 - 180 })))} />
              </div>
            </Section>
          )}
        </fieldset>

        {onSelection && (
          <Section title="Arrange">
            {els.length > 1 && (
              <div className="btn-row wrap">
                <IconBtn label="Align left" onClick={() => cmd.align('left')}><AlignStartVertical size={15} /></IconBtn>
                <IconBtn label="Align centre" onClick={() => cmd.align('hcenter')}><AlignCenterVertical size={15} /></IconBtn>
                <IconBtn label="Align right" onClick={() => cmd.align('right')}><AlignEndVertical size={15} /></IconBtn>
                <IconBtn label="Align top" onClick={() => cmd.align('top')}><AlignStartHorizontal size={15} /></IconBtn>
                <IconBtn label="Align middle" onClick={() => cmd.align('vcenter')}><AlignCenterHorizontal size={15} /></IconBtn>
                <IconBtn label="Align bottom" onClick={() => cmd.align('bottom')}><AlignEndHorizontal size={15} /></IconBtn>
                <button className="btn small" disabled={els.length < 3} onClick={() => cmd.distribute('h')}>Distribute ↔</button>
                <button className="btn small" disabled={els.length < 3} onClick={() => cmd.distribute('v')}>Distribute ↕</button>
              </div>
            )}
            <div className="btn-row wrap">
              <IconBtn label="Bring to front" onClick={() => cmd.reorder('front')}><BringToFront size={15} /></IconBtn>
              <IconBtn label="Send to back" onClick={() => cmd.reorder('back')}><SendToBack size={15} /></IconBtn>
              <IconBtn label="Duplicate" onClick={cmd.duplicateSelection}><CopyPlus size={15} /></IconBtn>
              <IconBtn label={anyLocked ? 'Unlock' : 'Lock'} onClick={cmd.toggleLock}>{anyLocked ? <Unlock size={15} /> : <Lock size={15} />}</IconBtn>
              <IconBtn label="Delete" onClick={cmd.deleteSelection}><Trash2 size={15} /></IconBtn>
              {els.length > 1 && <button className="btn small" onClick={cmd.groupSelection}>Group</button>}
              {els.some((e) => e.groupIds.length) && <button className="btn small" onClick={cmd.ungroupSelection}>Ungroup</button>}
            </div>
          </Section>
        )}
        {!onSelection && toolKey && (
          <div className="insp-foot">
            <button className="btn small" onClick={() => { const p = ui.prefs; const ts2 = { ...p.toolStyles }; delete ts2[toolKey]; ui.updatePrefs({ toolStyles: ts2 }); }}>Reset this tool’s defaults</button>
            <Toggle label="Keep tool active after drawing" checked={ui.prefs.continuousDrawing} onChange={(v) => ui.updatePrefs({ continuousDrawing: v })} />
            <Toggle label="Share one style across shape tools" checked={ui.prefs.sharedStyles} onChange={(v) => ui.updatePrefs({ sharedStyles: v, sharedStyle: v ? ts : null })} />
          </div>
        )}
      </div>
    </aside>
  );
}

const HEADS = [{ v: 'none', label: 'None' }, { v: 'arrow', label: 'Arrow' }, { v: 'triangle', label: 'Triangle' }, { v: 'dot', label: 'Dot' }, { v: 'bar', label: 'Bar' }] as { v: ConnectorElement['endHead']; label: string }[];

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button className="icon-btn sm" title={label} aria-label={label} onClick={onClick}>{children}</button>;
}

function CanvasPanel() {
  const doc = useDoc((s) => s.doc);
  const a = doc.animation;
  const setCanvas = (p: Partial<typeof doc.canvas>) => useDoc.getState().commit((d) => ({ ...d, canvas: { ...d.canvas, ...p } }), 'canvas');
  return (
    <aside className="inspector no-canvas" aria-label="Canvas properties">
      <div className="insp-head"><div><div className="insp-title">Canvas</div><div className="insp-sub">Pick a tool to set its defaults, or select objects to edit them</div></div></div>
      <div className="insp-scroll">
        <Section title="Background">
          <ColorPicker label="Canvas background" value={doc.canvas.background} palette={['#ffffff', '#fbfaf7', '#f6f7fb', '#fffbea', '#f3faf5', '#1e1e24']} onChange={(c) => setCanvas({ background: c })} />
          <Row label="Grid">
            <Segmented label="Grid" value={doc.canvas.grid} onChange={(v) => setCanvas({ grid: v })} options={[{ v: 'dots', label: 'Dots' }, { v: 'lines', label: 'Lines' }, { v: 'none', label: 'Plain' }]} />
          </Row>
          <Slider label="Grid size" value={doc.canvas.gridSize} min={8} max={80} step={2} unit="px" onChange={(v) => setCanvas({ gridSize: v })} />
        </Section>
        <Section title="Animation (document)">
          <Toggle label="Animation enabled" checked={a.enabled} onChange={(v) => cmd.setAnimation({ enabled: v })} />
          <Slider label="Global squiggle" value={a.intensityScale} min={0} max={3} step={0.05} unit="×" onChange={(v) => cmd.setAnimation({ intensityScale: v })} />
          <Slider label="Default squiggle" value={a.shape.intensity} min={0} max={10} step={0.5} onChange={(v) => cmd.setAnimation({ shape: { ...a.shape, intensity: v } })} />
          <Select label="Default shape motion" value={a.shape.mode} onChange={(v) => cmd.setAnimation({ shape: { ...a.shape, mode: v } })} options={[{ v: 'combined', label: 'Combined organic motion' }, { v: 'float', label: 'Gentle float' }, { v: 'wobble', label: 'Organic wobble' }, { v: 'boil', label: 'Sketch boil' }, { v: 'sway', label: 'Soft sway' }, { v: 'off', label: 'Off' }]} />
          <Select label="Default arrow flow" value={a.connector.mode} onChange={(v) => cmd.setAnimation({ connector: { ...a.connector, mode: v } })} options={[{ v: 'travel', label: 'Travelling highlight' }, { v: 'drawOn', label: 'Draw on' }, { v: 'dash', label: 'Marching dashes' }, { v: 'pulse', label: 'Pulse' }, { v: 'none', label: 'Static' }]} />
          <button className="btn small" onClick={() => useUI.getState().openDialog('animation')}>All animation settings…</button>
        </Section>
        <div className="insp-empty">
          <p><b>Quick start:</b> press <kbd>U</kbd> for a rounded rectangle, drag to draw (the tool stays active), <kbd>A</kbd> to connect shapes, double-click a shape to type, then <kbd>K</kbd> to play.</p>
        </div>
      </div>
    </aside>
  );
}

