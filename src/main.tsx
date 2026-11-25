import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/kalam/400.css';
import '@fontsource/kalam/700.css';
import './styles.css';
import { App } from './App';
import { useDoc } from './store/docStore';
import { useUI } from './store/uiStore';
import { makeLookup, playSchedule, renderDocumentAtTime } from './engine/render';
import { pageSnapshot } from './export/staticExport';
import { connectorPath } from './engine/connectors';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// Read-only inspection hook used by the end-to-end tests (e2e/run_e2e.py).
Object.assign(window, {
  __flowsketch: {
    doc: () => useDoc.getState().doc,
    ui: () => { const s = useUI.getState(); return { tool: s.tool, shapeKind: s.shapeKind, selection: s.selection, view: s.view, playing: s.playing, time: s.time, dialog: s.dialog, editingId: s.editingId, playOrderMode: s.playOrderMode, draftOriginal: !!s.draft?.original }; },
    toolStyle: (k: string) => useUI.getState().toolStyle(k),
    setView: (v: { x: number; y: number; zoom: number }) => useUI.getState().setView(v),
    pause: (t?: number) => { useUI.getState().setPlaying(false); if (t !== undefined) useUI.getState().setTime(t); },
    frame: (t: number) => JSON.parse(JSON.stringify(renderDocumentAtTime(useDoc.getState().doc, t))),
    /** A snapshot of the current page as the AI tools would send it: size and whether it is a PNG (not the picture itself). */
    snapshot: async () => { const img = await pageSnapshot(useDoc.getState().doc); if (!img) return null; const b = atob(img.data); return { png: b.slice(1, 4) === 'PNG', bytes: b.length, width: (b.charCodeAt(16) << 24) | (b.charCodeAt(17) << 16) | (b.charCodeAt(18) << 8) | b.charCodeAt(19), height: (b.charCodeAt(20) << 24) | (b.charCodeAt(21) << 16) | (b.charCodeAt(22) << 8) | b.charCodeAt(23) }; },
    /** When an arrow plays in the order, as [start, end] fractions of the loop (null if it doesn't). */
    playWindow: (id: string) => playSchedule(useDoc.getState().doc).win.get(id) ?? null,
    connectorEnds: (id: string) => {
      const d = useDoc.getState().doc;
      const c = d.elements.find((e) => e.id === id);
      if (!c || c.type !== 'connector') return null;
      const p = connectorPath(c, makeLookup(d, null));
      return { s: p.pts[0], e: p.pts[p.pts.length - 1] };
    },
    benchRender: (n: number) => {
      const d = useDoc.getState().doc;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) renderDocumentAtTime(d, i / 30);
      return (performance.now() - t0) / n;
    },
    measureFps: (ms: number) => new Promise<number>((res) => {
      let n = 0; const t0 = performance.now();
      const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else res((n * 1000) / (performance.now() - t0)); };
      requestAnimationFrame(f);
    }),
    history: () => ({ past: useDoc.getState().past.length, future: useDoc.getState().future.length }),
  },
});
