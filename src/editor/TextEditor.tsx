// In-place text editing overlay (textarea aligned to the element's static text box).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Point } from '../model/types';
import { useDoc, getElement } from '../store/docStore';
import { useUI } from '../store/uiStore';
import { geometryFor } from '../engine/shapes';
import { cssFont } from '../engine/text';
import { connectorLabelRect, makeLookup, type LabelPart } from '../engine/render';

export function TextEditor({ id, toScreen, onDone }: { id: string; toScreen: (p: Point) => Point; onDone: (id: string, text: string, part: LabelPart) => void }) {
  const doc = useDoc((s) => s.doc);
  const view = useUI((s) => s.view);
  const el = getElement(doc, id);
  const [part] = useState(() => useUI.getState().editingPart); // a pair's request ('main') or response label
  const [text, setText] = useState((part === 'response' && el?.type === 'connector' ? el.pair?.text : el?.text) ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const [lines, setLines] = useState(1);

  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  useLayoutEffect(() => { setLines(Math.max(1, text.split('\n').length)); }, [text]);

  if (!el) return null;
  const finish = () => { if (done.current) return; done.current = true; onDone(id, text, part); };
  const z = view.zoom;
  const ts = el.textStyle;
  const lh = ts.fontSize * ts.lineHeight;
  const common: React.CSSProperties = {
    font: cssFont({ ...ts, fontSize: ts.fontSize * z }),
    lineHeight: `${lh * z}px`,
    color: ts.color,
    textAlign: ts.align,
  };

  let outer: React.CSSProperties;
  let inner: React.CSSProperties;
  if (el.type === 'connector') {
    const r = connectorLabelRect(el, part, makeLookup(doc, null), text);
    const c = toScreen({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    const w = Math.max(120, (text.length + 2) * ts.fontSize * 0.6) * z;
    outer = { left: c.x - w / 2, top: c.y - (lines * lh * z) / 2, width: w, height: lines * lh * z };
    inner = { ...common, left: 0, top: 0, width: '100%', height: '100%', textAlign: 'center', background: 'var(--canvas-chip)' };
  } else {
    const tb = el.type === 'shape' ? geometryFor(el).textBox : { x: 0, y: 0, w: Math.max(el.w, 200), h: el.h };
    const s = toScreen({ x: el.x, y: el.y });
    outer = { left: s.x, top: s.y, width: el.w * z, height: el.h * z, transform: `rotate(${el.rotation}deg)`, transformOrigin: 'center' };
    const pad = ts.padding;
    const h = lines * lh;
    const top = ts.vAlign === 'top' ? tb.y + pad : ts.vAlign === 'bottom' ? tb.y + tb.h - pad - h : tb.y + (tb.h - h) / 2;
    inner = { ...common, left: (tb.x + pad) * z, top: top * z, width: Math.max(20, tb.w - pad * 2) * z + (el.type === 'text' ? 400 : 2), height: h * z + 4 };
    if (el.type === 'text') inner.textAlign = 'left';
  }

  return (
    <div className="text-editor-host no-canvas" style={outer} onPointerDown={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        className="text-editor"
        aria-label="Edit text"
        spellCheck
        value={text}
        style={inner}
        wrap={el.type === 'shape' ? 'soft' : 'off'}
        onChange={(e) => setText(e.target.value.slice(0, 5000))}
        onBlur={finish}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); finish(); }
          // Esc also ends the drawing tool (the global Esc handler never sees keys from the editor)
          if (e.key === 'Escape' && useUI.getState().tool !== 'select') useUI.getState().setTool('select');
        }}
      />
    </div>
  );
}
