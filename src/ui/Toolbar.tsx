// Floating drawing toolbar. Tools stay active after drawing (continuous mode, lock icon).
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRightLeft, ArrowUpRight, Circle, Diamond, Eraser, Hand, Highlighter, ImagePlus, Lock, LockOpen, Minus, MousePointer2, Paintbrush, Pencil, Shapes, Square, RectangleHorizontal, Type } from 'lucide-react';
import type { ShapeKind } from '../model/types';
import type { ToolId } from '../model/defaults';
import { useUI } from '../store/uiStore';
import { insertImage } from '../store/commands';
import { ShapeIcon } from './ShapeIcon';
import { SHAPE_LABELS } from '../engine/shapes';
import { SHAPE_KINDS } from '../model/schema';

interface T { id: ToolId; shape?: ShapeKind; icon: ReactNode; label: string; key: string; tip: string }

const TOOLS: (T | 'sep')[] = [
  { id: 'hand', icon: <Hand size={18} />, label: 'Hand (pan)', key: 'H', tip: 'Drag to move around the canvas. Hold Space with any tool to pan temporarily' },
  { id: 'select', icon: <MousePointer2 size={18} />, label: 'Select', key: 'V', tip: 'Click to select, drag to move, drag on empty canvas to box-select. Shift-click adds to the selection' },
  'sep',
  { id: 'shape', shape: 'rectangle', icon: <Square size={18} />, label: 'Rectangle', key: 'R', tip: 'Click to place, or drag to size. Shift keeps it square' },
  { id: 'shape', shape: 'roundRect', icon: <RectangleHorizontal size={18} />, label: 'Rounded rectangle', key: 'U', tip: 'Click to place, or drag to size. Shift keeps it square' },
  { id: 'shape', shape: 'ellipse', icon: <Circle size={18} />, label: 'Ellipse', key: 'O', tip: 'Click to place, or drag to size. Shift draws a circle' },
  { id: 'shape', shape: 'diamond', icon: <Diamond size={18} />, label: 'Diamond', key: 'D', tip: 'Decision shape. Click to place, or drag to size' },
];
const TOOLS2: (T | 'sep')[] = [
  { id: 'arrow', icon: <ArrowUpRight size={18} />, label: 'Arrow / connector', key: 'A', tip: 'Drag from one shape to another to connect them. The arrow follows the shapes when they move' },
  { id: 'pair', icon: <ArrowRightLeft size={18} />, label: 'Request ⇄ response', key: 'Q', tip: 'Drag from the sender to the receiver: draws a request arrow and a dashed response arrow back, each with its own label' },
  { id: 'line', icon: <Minus size={18} />, label: 'Line', key: 'L', tip: 'Drag to draw a line without arrowheads. Can also connect shapes' },
  { id: 'freehand', icon: <Pencil size={18} />, label: 'Freehand pen', key: 'P', tip: 'Draw freely by dragging' },
  { id: 'highlighter', icon: <Highlighter size={18} />, label: 'Highlighter', key: 'M', tip: 'Draw a wide translucent stroke to mark things up' },
  { id: 'text', icon: <Type size={18} />, label: 'Text', key: 'T', tip: 'Click to add text. Click a shape to edit its label. Esc finishes' },
  { id: 'image', icon: <ImagePlus size={18} />, label: 'Image', key: 'I', tip: 'Insert a PNG, JPEG, GIF or WebP picture' },
  { id: 'eraser', icon: <Eraser size={18} />, label: 'Eraser', key: 'E', tip: 'Click or drag over objects to delete them' },
  { id: 'painter', icon: <Paintbrush size={18} />, label: 'Format painter', key: 'F', tip: 'Click an object to pick up its style, then click others to apply it. Alt-click picks again' },
];
const BASIC = new Set<ShapeKind>(['rectangle', 'roundRect', 'ellipse', 'diamond']);

export function Toolbar() {
  const tool = useUI((s) => s.tool);
  const shapeKind = useUI((s) => s.shapeKind);
  const continuous = useUI((s) => s.prefs.continuousDrawing);
  const [more, setMore] = useState(false);
  // Esc closes the shape pop-up (the global Esc handler then returns to Select)
  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMore(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [more]);
  const ui = useUI.getState();
  const btn = (t: T | 'sep', i: number) => {
    if (t === 'sep') return <span key={'s' + i} className="tb-sep" aria-hidden />;
    const active = tool === t.id && (t.id !== 'shape' || shapeKind === t.shape);
    return (
      <button
        key={t.id + (t.shape ?? '')}
        className={`tb-btn ${active ? 'active' : ''}`}
        aria-pressed={active}
        aria-label={`${t.label} (${t.key})`}
        title={`${t.label} (${t.key})\n${t.tip}`}
        data-tool={t.shape ?? t.id}
        onClick={() => (t.id === 'image' ? void insertImage() : ui.setTool(t.id, t.shape))}
      >
        {t.icon}<span className="tb-key">{t.key}</span>
      </button>
    );
  };
  const extraActive = tool === 'shape' && !BASIC.has(shapeKind);
  return (
    <div className="toolbar no-canvas" role="toolbar" aria-label="Drawing tools">
      <button className={`tb-btn ${continuous ? 'active-soft' : ''}`} aria-pressed={continuous} title={continuous ? 'Tool stays active after drawing (click to switch back to Select after each shape)' : 'Return to Select after drawing'} aria-label="Keep tool active" onClick={() => ui.updatePrefs({ continuousDrawing: !continuous })}>
        {continuous ? <Lock size={16} /> : <LockOpen size={16} />}
      </button>
      <span className="tb-sep" aria-hidden />
      {TOOLS.map(btn)}
      <div className="tb-more-wrap">
        <button className={`tb-btn ${extraActive ? 'active' : ''}`} aria-haspopup="true" aria-expanded={more} aria-label="More shapes (S)" title={"More shapes (S)\nParallelogram, hexagon, cylinder, cloud, star and more"} data-tool="more" onClick={() => setMore(!more)}>
          {extraActive ? <ShapeIcon kind={shapeKind} size={18} /> : <Shapes size={18} />}<span className="tb-key">S</span>
        </button>
        {more && (
          <div className="shape-pop" role="menu" onMouseLeave={() => setMore(false)}>
            {SHAPE_KINDS.map((k) => (
              <button key={k} role="menuitem" className={`shape-cell ${tool === 'shape' && shapeKind === k ? 'on' : ''}`} title={SHAPE_LABELS[k]} aria-label={SHAPE_LABELS[k]} onClick={() => { ui.setTool('shape', k); setMore(false); }}>
                <ShapeIcon kind={k} size={22} />
              </button>
            ))}
            <button className="shape-cell wide" onClick={() => { setMore(false); ui.openDialog('shapes'); }}>Search library…</button>
          </div>
        )}
      </div>
      <span className="tb-sep" aria-hidden />
      {TOOLS2.map(btn)}
    </div>
  );
}
