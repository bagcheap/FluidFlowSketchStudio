// Diagram themes (pure): one click gives the whole diagram a coordinated look: canvas background and grid, shape
// outlines and fills, text, arrows and their highlight colours. Fills keep their variety: each different fill colour
// in the diagram becomes one of the theme's fills, in the order they first appear. Pictures, multi-colour logos'
// own colours, borderless and see-through items keep what makes them so; locked items are left alone.
import type { ConnectorElement, DiagramElement, FlowDocument, ToolStyle } from '../model/types';

type GridStyle = FlowDocument['canvas']['grid'];

export interface Theme {
  id: string;
  name: string;
  background: string;
  grid: GridStyle;
  stroke: string; // shape outlines
  text: string;
  fills: string[];
  arrow: string; // arrow lines
  container: string; // container borders
  highlight: string;
  ret: string; // round-trip return colour
}

export const THEMES: Theme[] = [
  { id: 'whiteboard', name: 'Whiteboard', background: '#fbfaf7', grid: 'dots', stroke: '#1e1e1e', text: '#1e1e1e', fills: ['#ffffff', '#e7f5ff', '#ebfbee', '#fff9db', '#fff0f6', '#f3f0ff'], arrow: '#343a40', container: '#868e96', highlight: '#3b82f6', ret: '#ec4899' },
  { id: 'pastel', name: 'Pastel', background: '#fffdf8', grid: 'dots', stroke: '#495057', text: '#343a40', fills: ['#d0ebff', '#d3f9d8', '#fff3bf', '#ffdeeb', '#e5dbff', '#c5f6fa'], arrow: '#868e96', container: '#adb5bd', highlight: '#f59e0b', ret: '#8b5cf6' },
  { id: 'blueprint', name: 'Blueprint', background: '#1c3f72', grid: 'lines', stroke: '#e7f5ff', text: '#ffffff', fills: ['#245089', '#2b5c9c', '#1f4a80', '#30639f'], arrow: '#a5d8ff', container: '#74c0fc', highlight: '#ffd43b', ret: '#63e6be' },
  { id: 'dark', name: 'Dark', background: '#1e1e24', grid: 'dots', stroke: '#ced4da', text: '#f1f3f5', fills: ['#2b2d42', '#22333b', '#2d2a3e', '#1f3a3d', '#3a2e2e'], arrow: '#adb5bd', container: '#6c757d', highlight: '#22d3ee', ret: '#f472b6' },
  { id: 'mono', name: 'Monochrome', background: '#ffffff', grid: 'none', stroke: '#212529', text: '#212529', fills: ['#ffffff', '#f1f3f5', '#e9ecef', '#dee2e6'], arrow: '#495057', container: '#adb5bd', highlight: '#212529', ret: '#868e96' },
];

const seeThrough = (c: string) => !c || c === 'transparent' || c === 'none';

/** The diagram with the theme applied (every page), as one change. */
export function applyThemeToDoc(doc: FlowDocument, t: Theme): FlowDocument {
  // each different fill colour, in order of first appearance across all pages, becomes one of the theme's fills
  const fillMap = new Map<string, string>();
  const pages = [doc.elements, ...doc.pages.map((p) => p.elements)];
  for (const els of pages) for (const e of els) {
    if (e.locked || e.type === 'connector' || e.type === 'image' || e.type === 'container' || e.type === 'text') continue;
    const f = e.style.fill.toLowerCase();
    if (e.style.fillStyle === 'none' || seeThrough(f) || fillMap.has(f)) continue;
    fillMap.set(f, t.fills[fillMap.size % t.fills.length]);
  }
  const fill = (f: string) => fillMap.get(f.toLowerCase()) ?? f;
  const one = (e: DiagramElement): DiagramElement => {
    if (e.locked || e.type === 'image') return e;
    const textStyle = { ...e.textStyle, color: t.text };
    switch (e.type) {
      case 'shape': case 'icon':
        return { ...e, textStyle, style: { ...e.style, stroke: seeThrough(e.style.stroke) ? e.style.stroke : t.stroke, fill: e.style.fillStyle === 'none' ? e.style.fill : fill(e.style.fill) } };
      case 'freehand':
        return e.highlighter ? e : { ...e, style: { ...e.style, stroke: t.stroke } };
      case 'text':
        return { ...e, textStyle };
      case 'container':
        return { ...e, textStyle, style: { ...e.style, stroke: seeThrough(e.style.stroke) ? e.style.stroke : t.container } };
      case 'connector': {
        // the highlight colours come from the theme: an arrow's own ones go
        const c: ConnectorElement = { ...e, textStyle, style: { ...e.style, stroke: t.arrow } };
        if (c.anim && ('highlightColor' in c.anim || 'returnColor' in c.anim)) {
          const anim = { ...c.anim };
          delete anim.highlightColor; delete anim.returnColor;
          if (Object.keys(anim).length) c.anim = anim; else delete c.anim;
        }
        return c;
      }
      default: return e;
    }
  };
  return {
    ...doc,
    canvas: { ...doc.canvas, background: t.background, grid: t.grid },
    animation: { ...doc.animation, connector: { ...doc.animation.connector, highlightColor: t.highlight, returnColor: t.ret } },
    elements: doc.elements.map(one),
    pages: doc.pages.map((p) => ({ ...p, elements: p.elements.map(one) })),
  };
}

/** A remembered tool style in the theme's colours, so new shapes, arrows and text match. */
export function themeToolStyle(key: string, ts: ToolStyle, t: Theme): ToolStyle {
  const textStyle = { ...ts.textStyle, color: t.text };
  if (key === 'arrow' || key === 'line' || key.startsWith('seq:')) {
    const ca = ts.connectorAnim ? { ...ts.connectorAnim } : undefined;
    if (ca) { delete ca.highlightColor; delete ca.returnColor; }
    const stroke = key === 'seq:bar' ? t.stroke : t.arrow;
    return { ...ts, textStyle, style: { ...ts.style, stroke, ...(key === 'seq:bar' ? { fill: t.fills[0] } : {}) }, ...(ca ? { connectorAnim: ca } : {}) };
  }
  if (key === 'container') return { ...ts, textStyle, style: { ...ts.style, stroke: t.container } };
  if (key === 'text') return { ...ts, textStyle };
  if (key.startsWith('shape:') || key === 'icon') {
    return { ...ts, textStyle, style: { ...ts.style, stroke: seeThrough(ts.style.stroke) ? ts.style.stroke : t.stroke, fill: ts.style.fillStyle === 'none' ? ts.style.fill : t.fills[0] } };
  }
  if (key === 'pen') return { ...ts, style: { ...ts.style, stroke: t.stroke } };
  return ts;
}
