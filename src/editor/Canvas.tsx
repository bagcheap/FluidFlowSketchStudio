// The live editing surface: a <canvas> showing renderDocumentAtTime() every frame,
// plus an SVG overlay for (static, non-animated) selection handles, guides and previews.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoxElement, ConnectorElement, DiagramElement, Endpoint, FlowDocument, Point } from '../model/types';
import { makeConnector, makeShape, makeText, newSeed, SHAPE_DEFAULT_SIZE, styleKey, uid } from '../model/defaults';
import { deleteElements, getElement, mapElements, useDoc } from '../store/docStore';
import { useUI } from '../store/uiStore';
import { renderDocumentAtTime, makeLookup, boxCorners } from '../engine/render';
import { drawFrame } from '../engine/canvasRenderer';
import { imageMap, onImageLoaded } from '../engine/images';
import { connectorPath } from '../engine/connectors';
import { STILL } from '../engine/animation';
import { toLocal, toWorld } from '../engine/connectors';
import { boxAt, hitTest, portAnchors, portPositions } from './hitTest';
import { applyStyle, cloneElements, dropSvgIcons, expandGroups, fitShapeToText, importIconLibraryFiles, insertIcon, insertImage, stage, styleOf, zoomAt } from '../store/commands';
import { ICON_DRAG_TYPE } from '../ui/IconsPanel';
import { TextEditor } from './TextEditor';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: [Handle, number, number][] = [['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['e', 1, 0.5], ['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1], ['w', 0, 0.5]];

type Interaction =
  | { k: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { k: 'create'; id: string; start: Point; moved: boolean; onExisting: boolean }
  | { k: 'connect'; id: string; start: Point; moved: boolean }
  | { k: 'move'; ids: string[]; start: Point; orig: FlowDocument; moved: boolean; dupDone: boolean }
  | { k: 'resize'; id: string; handle: Handle; orig: BoxElement }
  | { k: 'resizeMulti'; ids: string[]; handle: Handle; box: { x: number; y: number; w: number; h: number }; orig: FlowDocument }
  | { k: 'rotate'; id: string; orig: BoxElement; startAngle: number }
  | { k: 'marquee'; start: Point; cur: Point; additive: string[] }
  | { k: 'endpoint'; id: string; which: 'start' | 'end' }
  | { k: 'bend'; id: string; index: number }
  | { k: 'freehand'; id: string; pts: Point[] }
  | { k: 'erase'; ids: Set<string> }
  | { k: 'label'; id: string };

interface Overlay {
  marquee?: { x: number; y: number; w: number; h: number };
  guides?: { x1: number; y1: number; x2: number; y2: number }[];
  target?: string | null;
  port?: Point | null;
}

const isEditable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

export function Canvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doc = useDoc((s) => s.doc);
  const selection = useUI((s) => s.selection);
  const view = useUI((s) => s.view);
  const editingId = useUI((s) => s.editingId);
  const presentation = useUI((s) => s.presentation);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [overlay, setOverlay] = useState<Overlay>({});
  const [spaceDown, setSpaceDown] = useState(false);
  const inter = useRef<Interaction | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ d: number; zoom: number; cx: number; cy: number } | null>(null);
  const redraw = useRef(true);
  // a text element created by clicking, until its first edit finishes (so create + type is one undo step)
  const newText = useRef<{ id: string; after: FlowDocument } | null>(null);

  // ---- resize --------------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      stage.w = r.width; stage.h = r.height;
      setSize({ w: r.width, h: r.height });
      redraw.current = true;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- render loop ------------------------------------------------------------
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastKey = '';
    const off = onImageLoaded(() => { redraw.current = true; });
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const u = useUI.getState();
      const d = useDoc.getState();
      const a = d.doc.animation;
      if (u.playing) {
        let t = u.time + dt * a.playbackSpeed;
        if (t >= a.duration) {
          if (a.loop) t %= a.duration; else { t = a.duration; u.setPlaying(false); }
        }
        u.setTime(t);
      }
      const it = inter.current;
      const susp = u.prefs.suspendWhileDragging && it && (it.k === 'move' || it.k === 'resize' || it.k === 'rotate' || it.k === 'resizeMulti')
        ? new Set(it.k === 'move' || it.k === 'resizeMulti' ? it.ids : [it.id]) : undefined;
      const key = `${d.revision}|${u.time.toFixed(4)}|${u.view.x},${u.view.y},${u.view.zoom}|${stage.w}x${stage.h}|${u.editingId}|${susp ? [...susp].join() : ''}`;
      if (key === lastKey && !redraw.current) return;
      lastKey = key; redraw.current = false;
      const c = canvasRef.current;
      if (!c) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const W = Math.round(stage.w * dpr), H = Math.round(stage.h * dpr);
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = d.doc.canvas.background;
      ctx.fillRect(0, 0, W, H);
      if (!u.presentation) drawGrid(ctx, d.doc, u.view, dpr);
      const frame = renderDocumentAtTime(d.doc, u.time, {
        flags: { suspended: susp },
        hide: u.editingId ? new Set([u.editingId]) : undefined,
        cull: { x: u.view.x, y: u.view.y, w: stage.w / u.view.zoom, h: stage.h / u.view.zoom },
      });
      drawFrame(ctx, frame, { images: imageMap(d.doc.assets), originX: u.view.x, originY: u.view.y, scale: u.view.zoom * dpr });
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); off(); };
  }, []);

  // ---- coordinate helpers --------------------------------------------------------
  const toWorldPt = useCallback((e: { clientX: number; clientY: number }): Point => {
    const r = wrapRef.current!.getBoundingClientRect();
    const v = useUI.getState().view;
    return { x: v.x + (e.clientX - r.left) / v.zoom, y: v.y + (e.clientY - r.top) / v.zoom };
  }, []);
  const toScreen = (p: Point) => ({ x: (p.x - view.x) * view.zoom, y: (p.y - view.y) * view.zoom });

  // ---- handle geometry (static) --------------------------------------------------
  const selEls = selection.map((id) => getElement(doc, id)).filter(Boolean) as DiagramElement[];
  const single = selEls.length === 1 ? selEls[0] : null;
  const singleBox = single && single.type !== 'connector' ? single : null;
  const singleConn = single && single.type === 'connector' ? single : null;
  const multiBox = (() => {
    if (selEls.length < 2) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of selEls) {
      const pts = e.type === 'connector' ? connectorPath(e, makeLookup(doc, null)).control : boxCorners(e);
      for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  })();

  function handleAt(p: Point): { kind: 'resize' | 'rotate' | 'endpoint' | 'bend' | 'addBend' | 'multi'; handle?: Handle; which?: 'start' | 'end'; index?: number } | null {
    const r = 9 / view.zoom;
    const near = (q: Point) => Math.hypot(q.x - p.x, q.y - p.y) < r;
    if (singleBox && !singleBox.locked) {
      if (near(toWorld(singleBox, STILL, { x: singleBox.w / 2, y: -26 / view.zoom }))) return { kind: 'rotate' };
      for (const [h, fx, fy] of HANDLES) {
        if ((singleBox.type === 'text') && (h === 'n' || h === 's')) continue;
        if (near(toWorld(singleBox, STILL, { x: fx * singleBox.w, y: fy * singleBox.h }))) return { kind: 'resize', handle: h };
      }
    }
    if (singleConn && !singleConn.locked) {
      const path = connectorPath(singleConn, makeLookup(doc, null));
      if (near(path.pts[path.pts.length - 1])) return { kind: 'endpoint', which: 'end' };
      if (near(path.pts[0])) return { kind: 'endpoint', which: 'start' };
      for (let i = 0; i < singleConn.bends.length; i++) if (near(singleConn.bends[i])) return { kind: 'bend', index: i };
      const ctrl = [path.pts[0], ...singleConn.bends, path.pts[path.pts.length - 1]];
      for (let i = 0; i < ctrl.length - 1; i++) {
        const m = { x: (ctrl[i].x + ctrl[i + 1].x) / 2, y: (ctrl[i].y + ctrl[i + 1].y) / 2 };
        if (near(m)) return { kind: 'addBend', index: i };
      }
    }
    if (multiBox && !selEls.some((e) => e.locked)) {
      for (const [h, fx, fy] of HANDLES) {
        if (h.length !== 2) continue;
        if (near({ x: multiBox.x + fx * multiBox.w, y: multiBox.y + fy * multiBox.h })) return { kind: 'multi', handle: h };
      }
    }
    return null;
  }

  // ---- pointer handlers ------------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    if (isEditable(e.target) || (e.target as HTMLElement).closest('.no-canvas')) return;
    const u = useUI.getState();
    if (u.editingId) { (document.activeElement as HTMLElement)?.blur?.(); }
    wrapRef.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      // pinch-zoom: abandon whatever single-pointer gesture started
      if (inter.current && inter.current.k !== 'pan') useDoc.getState().cancel();
      inter.current = null;
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: u.view.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    const p = toWorldPt(e);
    const D = useDoc.getState();
    const d = D.doc;
    if (u.presentation) return;
    if (e.button === 1 || spaceDown || u.tool === 'hand') {
      inter.current = { k: 'pan', sx: e.clientX, sy: e.clientY, vx: u.view.x, vy: u.view.y };
      return;
    }
    if (e.button !== 0) return;

    switch (u.tool) {
      case 'select': {
        const h = handleAt(p);
        if (h) {
          D.begin();
          if (h.kind === 'rotate' && singleBox) {
            const c = { x: singleBox.x + singleBox.w / 2, y: singleBox.y + singleBox.h / 2 };
            inter.current = { k: 'rotate', id: singleBox.id, orig: singleBox, startAngle: Math.atan2(p.y - c.y, p.x - c.x) };
          } else if (h.kind === 'resize' && singleBox) inter.current = { k: 'resize', id: singleBox.id, handle: h.handle!, orig: singleBox };
          else if (h.kind === 'multi' && multiBox) inter.current = { k: 'resizeMulti', ids: selection, handle: h.handle!, box: multiBox, orig: d };
          else if (h.kind === 'endpoint' && singleConn) inter.current = { k: 'endpoint', id: singleConn.id, which: h.which! };
          else if (h.kind === 'bend' && singleConn) inter.current = { k: 'bend', id: singleConn.id, index: h.index! };
          else if (h.kind === 'addBend' && singleConn) {
            D.live((dd) => mapElements(dd, [singleConn.id], (c) => { const cc = c as ConnectorElement; const b = [...cc.bends]; b.splice(h.index!, 0, p); return { ...cc, bends: b }; }));
            inter.current = { k: 'bend', id: singleConn.id, index: h.index! };
          }
          return;
        }
        const hit = hitTest(d, p, u.view.zoom);
        if (hit) {
          let ids = expandGroups(d, [hit.id]);
          if (e.shiftKey) {
            const cur = new Set(u.selection);
            const isSel = ids.every((id) => cur.has(id));
            ids.forEach((id) => (isSel ? cur.delete(id) : cur.add(id)));
            u.select([...cur]);
            return;
          }
          if (!ids.every((id) => u.selection.includes(id))) u.select(ids);
          else ids = u.selection;
          if (ids.every((id) => getElement(d, id)?.locked)) return;
          D.begin();
          inter.current = { k: 'move', ids: useUI.getState().selection.filter((id) => !getElement(d, id)?.locked), start: p, orig: d, moved: false, dupDone: false };
          return;
        }
        inter.current = { k: 'marquee', start: p, cur: p, additive: e.shiftKey ? u.selection : [] };
        if (!e.shiftKey) u.select([]);
        return;
      }
      case 'shape': {
        const existing = hitTest(d, p, u.view.zoom);
        const ts = u.toolStyle(styleKey('shape', u.shapeKind));
        const el = makeShape(u.shapeKind, p.x, p.y, 1, 1, ts);
        D.begin();
        D.live((dd) => ({ ...dd, elements: [...dd.elements, el] }));
        inter.current = { k: 'create', id: el.id, start: p, moved: false, onExisting: !!existing };
        return;
      }
      case 'arrow':
      case 'line': {
        const ts = u.toolStyle(u.tool);
        const target = boxAt(d, p, u.view.zoom);
        const start: Endpoint = target ? attachEndpoint(target, p, null) : { x: p.x, y: p.y, elementId: null, anchor: null };
        const el = makeConnector(start, { x: p.x, y: p.y, elementId: null, anchor: null }, ts);
        D.begin();
        D.live((dd) => ({ ...dd, elements: [...dd.elements, el] }));
        inter.current = { k: 'connect', id: el.id, start: p, moved: false };
        return;
      }
      case 'freehand':
      case 'highlighter': {
        const ts = u.toolStyle(u.tool);
        const id = uid();
        const el: DiagramElement = { id, type: 'freehand', x: p.x, y: p.y, w: 1, h: 1, rotation: 0, locked: false, groupIds: [], seed: newSeed(), style: { ...ts.style }, text: '', textStyle: { ...ts.textStyle }, points: [[0, 0]], highlighter: u.tool === 'highlighter', ...(ts.shapeAnim ? { anim: { ...ts.shapeAnim } } : {}) };
        D.begin();
        D.live((dd) => ({ ...dd, elements: [...dd.elements, el] }));
        inter.current = { k: 'freehand', id, pts: [p] };
        return;
      }
      case 'text': {
        const hit = hitTest(d, p, u.view.zoom, (x) => x.type === 'text' || x.type === 'shape');
        if (hit) { startTextEdit(hit.id); return; }
        createTextAt(p);
        return;
      }
      case 'image':
        void insertImage(undefined, p);
        return;
      case 'eraser': {
        D.begin();
        inter.current = { k: 'erase', ids: new Set() };
        eraseAt(p);
        return;
      }
      case 'painter': {
        const hit = hitTest(d, p, u.view.zoom);
        if (!hit) return;
        if (!u.copiedStyle || e.altKey) { u.setCopiedStyle(styleOf(hit)); u.setHint('Style picked — click objects to apply it (Alt+click to pick again, Esc to finish)'); }
        else applyStyle(expandGroups(d, [hit.id]), u.copiedStyle);
        return;
      }
    }
  };

  function attachEndpoint(target: BoxElement, p: Point, other: Point | null): Endpoint {
    // snap to a port when close, otherwise "auto" (aims at the other end)
    const ports = portPositions(target);
    const anchors = portAnchors(target);
    const r = 14 / useUI.getState().view.zoom;
    for (let i = 0; i < ports.length; i++) if (Math.hypot(ports[i].x - p.x, ports[i].y - p.y) < r) return { x: p.x, y: p.y, elementId: target.id, anchor: anchors[i] };
    void other;
    return { x: p.x, y: p.y, elementId: target.id, anchor: null };
  }

  function eraseAt(p: Point) {
    const it = inter.current;
    if (!it || it.k !== 'erase') return;
    const d = useDoc.getState().doc;
    const hit = hitTest(d, p, useUI.getState().view.zoom, (x) => !x.locked);
    if (hit && !it.ids.has(hit.id)) {
      const ids = expandGroups(d, [hit.id]);
      ids.forEach((id) => it.ids.add(id));
      useDoc.getState().live((dd) => deleteElements(dd, new Set(ids)));
    }
  }

  function createTextAt(p: Point) {
    const u = useUI.getState();
    const ts = u.toolStyle('text');
    const el = makeText(p.x, p.y - ts.textStyle.fontSize * 0.7, '', ts);
    useDoc.getState().commit((dd) => ({ ...dd, elements: [...dd.elements, el] }));
    newText.current = { id: el.id, after: useDoc.getState().doc };
    u.select([el.id]);
    u.setEditing(el.id);
  }

  function startTextEdit(id: string) {
    const d = useDoc.getState().doc;
    const el = getElement(d, id);
    if (!el || el.locked || el.type === 'image' || el.type === 'freehand') return;
    useUI.getState().select([id]);
    useUI.getState().setEditing(id);
  }

  // Pointer events always report detail=0, so double-clicks are handled here.
  const onDoubleClick = (e: React.MouseEvent) => {
    if (isEditable(e.target) || (e.target as HTMLElement).closest('.no-canvas')) return;
    const u = useUI.getState();
    if (u.presentation || !['select', 'shape', 'text'].includes(u.tool)) return;
    const p = toWorldPt(e);
    const d = useDoc.getState().doc;
    const hit = hitTest(d, p, u.view.zoom);
    if (hit) startTextEdit(hit.id);
    else if (u.tool === 'select') createTextAt(p);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const r = wrapRef.current!.getBoundingClientRect();
      const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
      const v = useUI.getState().view;
      zoomAt((pinch.current.zoom * dist) / pinch.current.d / v.zoom, cx, cy);
      const pcx = pinch.current.cx - r.left, pcy = pinch.current.cy - r.top;
      const v2 = useUI.getState().view;
      useUI.getState().setView({ x: v2.x - (cx - pcx) / v2.zoom, y: v2.y - (cy - pcy) / v2.zoom });
      pinch.current.cx = (a.x + b.x) / 2; pinch.current.cy = (a.y + b.y) / 2;
      return;
    }
    const it = inter.current;
    const p = toWorldPt(e);
    const u = useUI.getState();
    const D = useDoc.getState();
    if (!it) {
      // hover feedback for connector tools
      if (u.tool === 'arrow' || u.tool === 'line') {
        const t = boxAt(D.doc, p, u.view.zoom);
        if ((t?.id ?? null) !== (overlay.target ?? null)) setOverlay((o) => ({ ...o, target: t?.id ?? null }));
      } else if (overlay.target) setOverlay((o) => ({ ...o, target: null }));
      updateCursor(p);
      return;
    }
    switch (it.k) {
      case 'pan': {
        const z = u.view.zoom;
        u.setView({ x: it.vx - (e.clientX - it.sx) / z, y: it.vy - (e.clientY - it.sy) / z });
        return;
      }
      case 'create': {
        const dx = p.x - it.start.x, dy = p.y - it.start.y;
        if (!it.moved && Math.hypot(dx, dy) * u.view.zoom < 4) return;
        it.moved = true;
        let w = Math.abs(dx), h = Math.abs(dy);
        if (e.shiftKey) { const m = Math.max(w, h); w = m; h = m; }
        const x = dx < 0 ? it.start.x - w : it.start.x, y = dy < 0 ? it.start.y - h : it.start.y;
        D.live((d) => mapElements(d, [it.id], (el) => ({ ...el, x, y, w: Math.max(1, w), h: Math.max(1, h) })));
        return;
      }
      case 'connect': {
        if (!it.moved && Math.hypot(p.x - it.start.x, p.y - it.start.y) * u.view.zoom < 4) return;
        it.moved = true;
        const c = getElement(D.doc, it.id) as ConnectorElement;
        let q = p;
        if (e.shiftKey && !c.start.elementId) q = snapAngle(c.start, p);
        const target = boxAt(D.doc, q, u.view.zoom, c.start.elementId ?? undefined);
        const end: Endpoint = target ? attachEndpoint(target, q, null) : { x: q.x, y: q.y, elementId: null, anchor: null };
        setOverlay((o) => ({ ...o, target: target?.id ?? null }));
        D.live((d) => mapElements(d, [it.id], (el) => ({ ...(el as ConnectorElement), end })));
        return;
      }
      case 'endpoint': {
        const c = getElement(D.doc, it.id) as ConnectorElement;
        const otherId = (it.which === 'start' ? c.end : c.start).elementId ?? undefined;
        const target = e.altKey ? null : boxAt(D.doc, p, u.view.zoom, otherId);
        const ep: Endpoint = target ? attachEndpoint(target, p, null) : { x: p.x, y: p.y, elementId: null, anchor: null };
        setOverlay((o) => ({ ...o, target: target?.id ?? null }));
        D.live((d) => mapElements(d, [it.id], (el) => ({ ...(el as ConnectorElement), [it.which]: ep })));
        return;
      }
      case 'bend': {
        D.live((d) => mapElements(d, [it.id], (el) => { const c = el as ConnectorElement; const b = [...c.bends]; b[it.index] = snapPt(p); return { ...c, bends: b }; }));
        return;
      }
      case 'move': {
        let dx = p.x - it.start.x, dy = p.y - it.start.y;
        if (!it.moved && Math.hypot(dx, dy) * u.view.zoom < 3) return;
        if (!it.moved && e.altKey && !it.dupDone) {
          // Alt-drag duplicates: originals stay, copies move
          it.dupDone = true;
          const clones = cloneElements(it.orig, it.ids.map((id) => getElement(it.orig, id)!), 0, 0);
          D.live((d) => ({ ...d, elements: [...d.elements, ...clones] }));
          it.orig = useDoc.getState().doc;
          it.ids = clones.map((c) => c.id);
          u.select(it.ids);
        }
        it.moved = true;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        const snapped = snapMove(it.orig, it.ids, dx, dy);
        dx = snapped.dx; dy = snapped.dy;
        setOverlay((o) => ({ ...o, guides: snapped.guides }));
        const ids = new Set(it.ids);
        D.live(() => mapElements(it.orig, ids, (el) => {
          if (el.type === 'connector') {
            const mv = (q: Endpoint) => (q.elementId ? q : { ...q, x: q.x + dx, y: q.y + dy });
            return { ...el, start: mv(el.start), end: mv(el.end), bends: el.bends.map((b) => ({ x: b.x + dx, y: b.y + dy })) };
          }
          return { ...el, x: el.x + dx, y: el.y + dy };
        }));
        return;
      }
      case 'resize': {
        D.live((d) => mapElements(d, [it.id], () => resizeBox(it.orig, it.handle, p, e.shiftKey || it.orig.type === 'image' && !e.altKey)));
        return;
      }
      case 'resizeMulti': {
        const b = it.box;
        const ax = it.handle.includes('w') ? b.x + b.w : b.x, ay = it.handle.includes('n') ? b.y + b.h : b.y;
        let sx = Math.max(0.05, Math.abs(p.x - ax) / Math.max(1, b.w)), sy = Math.max(0.05, Math.abs(p.y - ay) / Math.max(1, b.h));
        if (e.shiftKey) { const s = Math.max(sx, sy); sx = s; sy = s; }
        const ids = new Set(it.ids);
        const fx = (x: number) => ax + (x - ax) * sx, fy = (y: number) => ay + (y - ay) * sy;
        D.live(() => mapElements(it.orig, ids, (el) => {
          if (el.type === 'connector') {
            const mv = (q: Endpoint) => (q.elementId ? q : { ...q, x: fx(q.x), y: fy(q.y) });
            return { ...el, start: mv(el.start), end: mv(el.end), bends: el.bends.map((q) => ({ x: fx(q.x), y: fy(q.y) })) };
          }
          return { ...el, x: fx(el.x), y: fy(el.y), w: el.w * sx, h: el.h * sy };
        }));
        return;
      }
      case 'rotate': {
        const o = it.orig;
        const c = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
        let deg = o.rotation + ((Math.atan2(p.y - c.y, p.x - c.x) - it.startAngle) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        deg = ((deg % 360) + 540) % 360 - 180;
        D.live((d) => mapElements(d, [it.id], (el) => ({ ...el, rotation: Math.round(deg * 10) / 10 })));
        return;
      }
      case 'marquee': {
        it.cur = p;
        const r = { x: Math.min(it.start.x, p.x), y: Math.min(it.start.y, p.y), w: Math.abs(p.x - it.start.x), h: Math.abs(p.y - it.start.y) };
        setOverlay((o) => ({ ...o, marquee: r }));
        const inside = D.doc.elements.filter((el) => {
          const pts = el.type === 'connector' ? connectorPath(el, makeLookup(D.doc, null)).control : boxCorners(el);
          return pts.every((q) => q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h);
        }).map((el) => el.id);
        u.select([...it.additive, ...expandGroups(D.doc, inside)]);
        return;
      }
      case 'freehand': {
        const last = it.pts[it.pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * u.view.zoom < 1.5) return;
        it.pts.push(p);
        const xs = it.pts.map((q) => q.x), ys = it.pts.map((q) => q.y);
        const x0 = Math.min(...xs), y0 = Math.min(...ys);
        const w = Math.max(1, Math.max(...xs) - x0), h = Math.max(1, Math.max(...ys) - y0);
        const points = it.pts.map((q) => [(q.x - x0) / w, (q.y - y0) / h] as [number, number]);
        D.live((d) => mapElements(d, [it.id], (el) => ({ ...el, x: x0, y: y0, w, h, points } as DiagramElement)));
        return;
      }
      case 'erase': eraseAt(p); return;
      default: return;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pinch.current) { if (pointers.current.size < 2) pinch.current = null; return; }
    const it = inter.current;
    inter.current = null;
    setOverlay((o) => ({ ...o, marquee: undefined, guides: undefined, target: null }));
    if (!it) return;
    const D = useDoc.getState();
    const u = useUI.getState();
    switch (it.k) {
      case 'create': {
        if (!it.moved) {
          if (it.onExisting) { D.cancel(); u.setHint('Tip: drag to draw on top of a shape · double-click a shape to edit its text'); return; }
          const [w, h] = SHAPE_DEFAULT_SIZE[u.shapeKind] ?? [160, 80];
          D.live((d) => mapElements(d, [it.id], (el) => ({ ...el, x: it.start.x - w / 2, y: it.start.y - h / 2, w, h })));
        } else {
          D.live((d) => mapElements(d, [it.id], (el) => (el.w < 4 || el.h < 4 ? { ...el, w: Math.max(el.w, 20), h: Math.max(el.h, 20) } : el)));
        }
        D.end();
        afterCreate(it.id);
        return;
      }
      case 'connect': {
        if (!it.moved) {
          const c = getElement(D.doc, it.id) as ConnectorElement;
          const s = c.start;
          D.live((d) => mapElements(d, [it.id], (el) => ({ ...(el as ConnectorElement), end: { x: it.start.x + 140, y: it.start.y, elementId: null, anchor: null }, start: s.elementId ? s : { ...s } })));
        }
        D.end();
        afterCreate(it.id);
        return;
      }
      case 'freehand': {
        if (it.pts.length < 2) { D.cancel(); return; }
        D.end();
        return;
      }
      case 'move':
        if (!it.moved) {
          D.cancel();
          const h = hitTest(D.doc, toWorldPt(e), u.view.zoom);
          if (h && !e.shiftKey && u.selection.length > 1) u.select(expandGroups(D.doc, [h.id]));
          return;
        }
        D.end();
        return;
      case 'marquee': return;
      case 'pan': return;
      default:
        D.end();
    }
  };

  function afterCreate(id: string) {
    const u = useUI.getState();
    if (!u.prefs.continuousDrawing) { u.setTool('select'); u.select([id]); }
  }

  function snapPt(p: Point): Point {
    const u = useUI.getState();
    if (!u.prefs.snapToGrid) return p;
    const g = useDoc.getState().doc.canvas.gridSize;
    return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
  }

  function snapAngle(from: Point, p: Point): Point {
    const a = Math.atan2(p.y - from.y, p.x - from.x);
    const s = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    const d = Math.hypot(p.x - from.x, p.y - from.y);
    return { x: from.x + Math.cos(s) * d, y: from.y + Math.sin(s) * d };
  }

  function snapMove(orig: FlowDocument, ids: string[], dx: number, dy: number) {
    const u = useUI.getState();
    const guides: Overlay['guides'] = [];
    const moving = ids.map((id) => getElement(orig, id)).filter((x): x is BoxElement => !!x && x.type !== 'connector');
    if (!moving.length) return { dx, dy, guides };
    const x0 = Math.min(...moving.map((m) => m.x)) + dx, x1 = Math.max(...moving.map((m) => m.x + m.w)) + dx;
    const y0 = Math.min(...moving.map((m) => m.y)) + dy, y1 = Math.max(...moving.map((m) => m.y + m.h)) + dy;
    if (u.prefs.snapToGrid) {
      const g = orig.canvas.gridSize;
      return { dx: dx + Math.round(x0 / g) * g - x0, dy: dy + Math.round(y0 / g) * g - y0, guides };
    }
    if (!u.prefs.smartGuides) return { dx, dy, guides };
    const tol = 6 / u.view.zoom;
    const others = orig.elements.filter((o): o is BoxElement => o.type !== 'connector' && !ids.includes(o.id) && o.rotation === 0);
    let bx: { d: number; v: number } | null = null, by: { d: number; v: number } | null = null;
    const mx = [x0, (x0 + x1) / 2, x1], my = [y0, (y0 + y1) / 2, y1];
    for (const o of others) {
      for (const ox of [o.x, o.x + o.w / 2, o.x + o.w]) for (const m of mx) { const d = ox - m; if (Math.abs(d) < tol && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, v: ox }; }
      for (const oy of [o.y, o.y + o.h / 2, o.y + o.h]) for (const m of my) { const d = oy - m; if (Math.abs(d) < tol && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, v: oy }; }
    }
    if (bx) { dx += bx.d; guides.push({ x1: bx.v, y1: Math.min(y0, ...others.map((o) => o.y)) - 20, x2: bx.v, y2: Math.max(y1, ...others.map((o) => o.y + o.h)) + 20 }); }
    if (by) { dy += by.d; guides.push({ x1: Math.min(x0, ...others.map((o) => o.x)) - 20, y1: by.v, x2: Math.max(x1, ...others.map((o) => o.x + o.w)) + 20, y2: by.v }); }
    return { dx, dy, guides };
  }

  function updateCursor(p: Point) {
    const el = wrapRef.current;
    if (!el) return;
    const u = useUI.getState();
    let c = 'default';
    if (spaceDown || u.tool === 'hand') c = 'grab';
    else if (u.tool === 'select') {
      const h = handleAt(p);
      if (h?.kind === 'rotate') c = 'grab';
      else if (h?.kind === 'resize' || h?.kind === 'multi') c = ({ n: 'ns', s: 'ns', e: 'ew', w: 'ew', nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw' } as const)[h.handle!] + '-resize';
      else if (h) c = 'crosshair';
      else if (hitTest(useDoc.getState().doc, p, u.view.zoom)) c = 'move';
    } else if (u.tool === 'text') c = 'text';
    else if (u.tool === 'eraser' || u.tool === 'painter') c = 'cell';
    else c = 'crosshair';
    el.style.cursor = c;
  }

  // ---- wheel / keyboard pan ------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.no-canvas')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const u = useUI.getState();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), e.clientX - r.left, e.clientY - r.top);
      } else {
        const k = e.deltaMode === 1 ? 20 : 1;
        const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k, dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
        u.setView({ x: u.view.x + dx / u.view.zoom, y: u.view.y + dy / u.view.zoom });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    const kd = (e: KeyboardEvent) => { if (e.code === 'Space' && !isEditable(e.target) && !e.repeat) { setSpaceDown(true); el.style.cursor = 'grab'; e.preventDefault(); } };
    const ku = (e: KeyboardEvent) => { if (e.code === 'Space') { setSpaceDown(false); el.style.cursor = 'default'; } };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { el.removeEventListener('wheel', onWheel); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, []);

  // Escape while an interaction is in progress cancels it and returns to Select (handled before global shortcuts)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !inter.current) return;
      const it = inter.current;
      inter.current = null;
      if (it.k !== 'pan' && it.k !== 'marquee') useDoc.getState().cancel();
      setOverlay({});
      if (useUI.getState().tool !== 'select') useUI.getState().setTool('select');
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // ---- drag & drop files ----------------------------------------------------------------
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const icon = e.dataTransfer.getData(ICON_DRAG_TYPE); // "<set>:<name>" dragged from the Icons panel
    if (icon) { const i = icon.indexOf(':'); void insertIcon(icon.slice(0, i), icon.slice(i + 1), toWorldPt(e)); return; }
    const files = [...(e.dataTransfer.files ?? [])];
    const svgs = files.filter((f) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name));
    if (svgs.length) { void dropSvgIcons(svgs, toWorldPt(e)); return; }
    if (files.some((f) => /\.(flowsketchlib|zip)$/i.test(f.name))) { void importIconLibraryFiles(files); return; }
    const f = files[0];
    if (!f) return;
    if (f.type.startsWith('image/')) void insertImage(f, toWorldPt(e));
    else window.dispatchEvent(new CustomEvent('flowsketch:openfile', { detail: f }));
  };

  // ---- overlay rendering (static geometry) ------------------------------------------------
  const z = view.zoom;
  const hs = 8 / z;
  const accent = 'var(--accent)';
  const overlayEls: JSX.Element[] = [];
  if (!presentation) {
    for (const el of selEls) {
      if (el.type === 'connector') continue;
      const pts = boxCorners(el);
      overlayEls.push(<polygon key={'sel' + el.id} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={el.locked ? '#9ca3af' : accent} strokeWidth={1.25 / z} strokeDasharray={el.locked ? `${4 / z} ${3 / z}` : undefined} />);
    }
    for (const el of selEls) {
      if (el.type !== 'connector') continue;
      const path = connectorPath(el, makeLookup(doc, null));
      overlayEls.push(<polyline key={'csel' + el.id} points={path.pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={accent} strokeOpacity={0.35} strokeWidth={(el.style.strokeWidth + 6) / z} strokeLinecap="round" />);
    }
    if (singleBox && !singleBox.locked && !editingId) {
      const rp = toWorld(singleBox, STILL, { x: singleBox.w / 2, y: -26 / z });
      const top = toWorld(singleBox, STILL, { x: singleBox.w / 2, y: 0 });
      overlayEls.push(<line key="rotl" x1={top.x} y1={top.y} x2={rp.x} y2={rp.y} stroke={accent} strokeWidth={1 / z} />);
      overlayEls.push(<circle key="rot" cx={rp.x} cy={rp.y} r={hs * 0.6} fill="var(--panel)" stroke={accent} strokeWidth={1.5 / z} />);
      for (const [h, fx, fy] of HANDLES) {
        if (singleBox.type === 'text' && (h === 'n' || h === 's')) continue;
        const p = toWorld(singleBox, STILL, { x: fx * singleBox.w, y: fy * singleBox.h });
        overlayEls.push(<rect key={h} x={p.x - hs / 2} y={p.y - hs / 2} width={hs} height={hs} rx={2 / z} fill="var(--panel)" stroke={accent} strokeWidth={1.5 / z} transform={`rotate(${singleBox.rotation} ${p.x} ${p.y})`} />);
      }
    }
    if (singleConn && !singleConn.locked) {
      const path = connectorPath(singleConn, makeLookup(doc, null));
      const ends = [path.pts[0], path.pts[path.pts.length - 1]];
      const ctrl = [ends[0], ...singleConn.bends, ends[1]];
      for (let i = 0; i < ctrl.length - 1; i++) {
        const m = { x: (ctrl[i].x + ctrl[i + 1].x) / 2, y: (ctrl[i].y + ctrl[i + 1].y) / 2 };
        overlayEls.push(<circle key={'mid' + i} cx={m.x} cy={m.y} r={hs * 0.45} fill={accent} fillOpacity={0.35} stroke="none" />);
      }
      singleConn.bends.forEach((b, i) => overlayEls.push(<circle key={'b' + i} cx={b.x} cy={b.y} r={hs * 0.55} fill="var(--panel)" stroke={accent} strokeWidth={1.5 / z} />));
      ends.forEach((p, i) => {
        const attached = !!(i === 0 ? singleConn.start : singleConn.end).elementId;
        overlayEls.push(<circle key={'e' + i} cx={p.x} cy={p.y} r={hs * 0.65} fill={attached ? accent : 'var(--panel)'} stroke={accent} strokeWidth={1.5 / z} />);
      });
    }
    if (multiBox) {
      overlayEls.push(<rect key="mb" x={multiBox.x} y={multiBox.y} width={multiBox.w} height={multiBox.h} fill="none" stroke={accent} strokeDasharray={`${4 / z} ${4 / z}`} strokeWidth={1 / z} />);
      for (const [h, fx, fy] of HANDLES) if (h.length === 2) overlayEls.push(<rect key={'m' + h} x={multiBox.x + fx * multiBox.w - hs / 2} y={multiBox.y + fy * multiBox.h - hs / 2} width={hs} height={hs} rx={2 / z} fill="var(--panel)" stroke={accent} strokeWidth={1.5 / z} />);
    }
    const target = overlay.target ? getElement(doc, overlay.target) : null;
    if (target && target.type !== 'connector') {
      overlayEls.push(<polygon key="tgt" points={boxCorners(target).map((p) => `${p.x},${p.y}`).join(' ')} fill={accent} fillOpacity={0.06} stroke={accent} strokeWidth={2 / z} />);
      portPositions(target).forEach((p, i) => overlayEls.push(<circle key={'port' + i} cx={p.x} cy={p.y} r={5 / z} fill="var(--panel)" stroke={accent} strokeWidth={1.5 / z} />));
    }
    if (overlay.marquee) {
      const m = overlay.marquee;
      overlayEls.push(<rect key="mq" x={m.x} y={m.y} width={m.w} height={m.h} fill={accent} fillOpacity={0.07} stroke={accent} strokeWidth={1 / z} />);
    }
    overlay.guides?.forEach((g, i) => overlayEls.push(<line key={'g' + i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="#ec4899" strokeWidth={1 / z} strokeDasharray={`${3 / z} ${3 / z}`} />));
  }

  return (
    <div
      ref={wrapRef}
      className="stage"
      data-testid="stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      // a click that just opened the text editor must not let the browser move focus off it (blur commits/deletes the text)
      onMouseDown={(e) => { if (useUI.getState().editingId && !isEditable(e.target)) e.preventDefault(); }}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      role="application"
      aria-label="Diagram canvas"
    >
      <canvas ref={canvasRef} className="stage-canvas" style={{ width: size.w, height: size.h }} />
      <svg className="stage-overlay" width={size.w} height={size.h} aria-hidden>
        <g transform={`scale(${z}) translate(${-view.x} ${-view.y})`}>{overlayEls}</g>
      </svg>
      {editingId && <TextEditor key={editingId} id={editingId} toScreen={toScreen} onDone={(id, text) => {
        const D = useDoc.getState();
        const el = getElement(D.doc, id);
        useUI.getState().setEditing(null);
        const fresh = newText.current?.id === id ? newText.current : null;
        newText.current = null;
        if (!el) return;
        if (fresh && D.doc === fresh.after) {
          // nothing else changed since the click: replace the empty creation with the finished text
          D.revertLast();
          if (!text.trim()) { useUI.getState().select([]); return; }
          D.commit((d) => ({ ...d, elements: [...d.elements, fitShapeToText({ ...el, text } as DiagramElement)] }));
          return;
        }
        if (el.type === 'text' && !text.trim()) { D.commit((d) => deleteElements(d, new Set([id]))); useUI.getState().select([]); return; }
        if (text === el.text) return;
        // typing a label on an icon whose label is hidden shows it
        D.commit((d) => mapElements(d, [id], (x) => fitShapeToText({ ...x, text, ...(x.type === 'icon' && x.labelPos === 'none' && text.trim() ? { labelPos: 'below' } : {}) } as DiagramElement)));
      }} />}
    </div>
  );
}

function resizeBox(o: BoxElement, h: Handle, p: Point, keepRatio: boolean): BoxElement {
  const l = toLocal(o, STILL, p);
  let x0 = 0, y0 = 0, x1 = o.w, y1 = o.h;
  if (h.includes('w')) x0 = l.x; if (h.includes('e')) x1 = l.x;
  if (h.includes('n')) y0 = l.y; if (h.includes('s')) y1 = l.y;
  let w = Math.abs(x1 - x0), hh = Math.abs(y1 - y0);
  if (keepRatio && h.length === 2) {
    const r = o.w / Math.max(1, o.h);
    if (w / Math.max(1, hh) > r) hh = w / r; else w = hh * r;
    if (h.includes('w')) x0 = x1 - w; else x1 = x0 + w;
    if (h.includes('n')) y0 = y1 - hh; else y1 = y0 + hh;
  }
  w = Math.max(4, w); hh = Math.max(4, hh);
  const lc = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const wc = toWorld(o, STILL, lc);
  let res: BoxElement = { ...o, w, h: hh, x: wc.x - w / 2, y: wc.y - hh / 2 };
  if (o.type === 'text') {
    // text keeps its height = content; scale font on corner drags
    if (h.length === 2) {
      const s = w / Math.max(1, o.w);
      res = { ...res, textStyle: { ...o.textStyle, fontSize: Math.max(6, Math.round(o.textStyle.fontSize * s * 10) / 10) } } as BoxElement;
    }
    res = fitShapeToText(res) as BoxElement;
    if (h.length === 1) res = { ...res, w } as BoxElement;
  }
  return res;
}

const gridTiles = new Map<string, HTMLCanvasElement>();

/** Grid drawn with a cached repeating pattern: one fill per frame instead of thousands of dots. */
function drawGrid(ctx: CanvasRenderingContext2D, doc: FlowDocument, v: { x: number; y: number; zoom: number }, dpr: number) {
  if (doc.canvas.grid === 'none') return;
  let g = doc.canvas.gridSize;
  while (g * v.zoom < 12) g *= 2;
  const step = g * v.zoom * dpr; // device px between grid points
  const key = `${doc.canvas.grid}|${step.toFixed(2)}|${dpr}`;
  let tile = gridTiles.get(key);
  if (!tile) {
    const n = Math.max(2, Math.round(step));
    tile = document.createElement('canvas');
    tile.width = tile.height = n;
    const t = tile.getContext('2d')!;
    t.fillStyle = t.strokeStyle = 'rgba(100,100,120,0.24)';
    if (doc.canvas.grid === 'dots') { const r = Math.max(0.9, 1.1 * dpr); t.fillRect(0, 0, r, r); }
    else { t.globalAlpha = 0.5; t.fillRect(0, 0, n, 1); t.fillRect(0, 0, 1, n); }
    if (gridTiles.size > 40) gridTiles.clear();
    gridTiles.set(key, tile);
  }
  const pat = ctx.createPattern(tile, 'repeat');
  if (!pat) return;
  const scale = step / tile.width;
  const ox = ((-v.x * v.zoom * dpr) % step + step) % step, oy = ((-v.y * v.zoom * dpr) % step + step) % step;
  pat.setTransform(new DOMMatrix([scale, 0, 0, scale, ox, oy]));
  ctx.save();
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}
