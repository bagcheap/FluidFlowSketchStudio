import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, RotateCcw } from 'lucide-react';
import { useDoc } from '../../store/docStore';
import { useUI } from '../../store/uiStore';
import { exportGif, planGif, type GifProgress, type GifSettings } from '../../export/gif';
import { frameRenderer } from '../../export/raster';
import { downloadBlob, safeFileName } from '../../persistence/files';
import { Modal } from './Modal';
import { Row, Segmented, Slider, Toggle } from '../controls';
import { videoSupport } from '../../export/video';

const fmtBytes = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);

export function GifDialog() {
  const doc = useDoc((s) => s.doc);
  const sel = useUI((s) => s.selection);
  const [name, setName] = useState(safeFileName(doc.title, 'gif'));
  const [s, setS] = useState<GifSettings>(() => ({
    width: doc.exportPrefs.gifWidth, height: 0, fps: doc.exportPrefs.gifFps, duration: doc.animation.duration, loopCount: 0,
    background: doc.canvas.background, colors: 256, dither: false, globalPalette: true, seamless: true,
    fit: 'content', padding: doc.exportPrefs.padding,
  }));
  const [lockAspect, setLockAspect] = useState(true);
  const [onlySel, setOnlySel] = useState(false);
  const [progress, setProgress] = useState<GifProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; blob: Blob; ms: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const set = (p: Partial<GifSettings>) => { setS((o) => ({ ...o, ...p })); setResult(null); };
  const settings: GifSettings = { ...s, height: lockAspect ? 0 : s.height, onlyIds: onlySel && sel.length ? new Set(sel) : undefined };
  const plan = useMemo(() => planGif(doc, settings), [doc, s, lockAspect, onlySel, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = !!progress && progress.phase !== 'done';

  // live preview using the exact export renderer at the chosen frame rate
  const pcRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const pw = 340;
    const ph = Math.round((plan.height / plan.width) * pw);
    void frameRenderer(doc, plan.rect, pw, ph, s.background, settings.onlyIds).then((r) => {
      if (!alive || !pcRef.current) return;
      pcRef.current.replaceChildren(r.canvas);
      r.canvas.className = 'gif-preview-canvas' + (s.background ? '' : ' checker');
      let i = 0;
      const tick = () => {
        if (!alive) return;
        r.render(plan.times[i % plan.frames]);
        i++;
        timer = window.setTimeout(tick, plan.delaysCs[(i - 1) % plan.frames] * 10);
      };
      tick();
    });
    return () => { alive = false; clearTimeout(timer); };
  }, [plan, s.background]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { abort.current?.abort(); if (result) URL.revokeObjectURL(result.url); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setError(null); setResult(null);
    abort.current = new AbortController();
    const t0 = performance.now();
    try {
      const blob = await exportGif(doc, settings, setProgress, abort.current.signal);
      const url = URL.createObjectURL(blob);
      setResult({ url, blob, ms: performance.now() - t0 });
      downloadBlob(blob, name.endsWith('.gif') ? name : name + '.gif');
      useDoc.getState().commit((d) => ({ ...d, exportPrefs: { ...d.exportPrefs, gifWidth: s.width, gifFps: s.fps, padding: s.padding } }), 'exportprefs');
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') setError('Export cancelled.');
      else setError(`Export failed: ${(e as Error).message}. Try a smaller width or fewer frames.`);
      setProgress(null);
    }
  };

  const vs = videoSupport();
  return (
    <Modal title="Export animated GIF" wide footer={<>
      {busy ? <button className="btn" onClick={() => abort.current?.abort()}>Cancel export</button> : <button className="btn ghost" onClick={() => useUI.getState().openDialog(null)}>Close</button>}
      {error && !busy && <button className="btn" onClick={run}><RotateCcw size={14} /> Retry</button>}
      {result && <button className="btn" onClick={() => downloadBlob(result.blob, name)}><Download size={14} /> Download again</button>}
      <button className="btn primary" disabled={busy || !doc.elements.length} onClick={run} data-testid="gif-export"><Download size={14} /> {busy ? 'Exporting…' : 'Export GIF'}</button>
    </>}>
      <div className="export-grid">
        <div className="export-preview">
          <div ref={pcRef} className="gif-preview" aria-label="Preview of the exported animation" />
          <div className="plan">
            <b>{plan.width} × {plan.height}px</b> · {plan.frames} frames · {s.fps} FPS · {s.duration}s<br />
            <span className="dim">Estimated size ≈ {fmtBytes(plan.estBytes)} (vector diagrams often compress smaller)</span>
          </div>
          {plan.warnings.map((w) => <div key={w} className="warn"><AlertTriangle size={14} /> {w}</div>)}
          {busy && progress && (
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="Export progress">
              <div className="bar" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              <span>{progress.phase === 'encode' ? 'Finishing GIF…' : `Rendering frame ${progress.done} / ${progress.total}`}</span>
            </div>
          )}
          {error && <div className="error" role="alert">{error}</div>}
          {result && (
            <div className="result">
              <img src={result.url} alt="Exported GIF" className="result-img" />
              <div className="dim">Done in {(result.ms / 1000).toFixed(1)}s · {fmtBytes(result.blob.size)} · downloaded as {name}</div>
            </div>
          )}
        </div>
        <div className="export-form">
          <label className="field"><span>File name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <Row label="Size">
            <Segmented label="Width preset" value={[640, 1280, 1920].includes(s.width) ? s.width : 0} onChange={(v) => v && set({ width: v })} options={[{ v: 640, label: 'Small' }, { v: 1280, label: 'Standard' }, { v: 1920, label: 'HD' }, { v: 0, label: 'Custom' }]} />
          </Row>
          <div className="grid2">
            <label className="numfield"><span>Width</span><input type="number" min={64} max={4096} value={s.width} onChange={(e) => set({ width: Math.max(64, Math.min(4096, Number(e.target.value) || 64)) })} /></label>
            <label className="numfield"><span>Height</span><input type="number" min={64} max={4096} disabled={lockAspect} value={lockAspect ? plan.height : s.height || plan.height} onChange={(e) => set({ height: Math.max(64, Math.min(4096, Number(e.target.value) || 64)) })} /></label>
          </div>
          <Toggle label="Lock aspect ratio to content" checked={lockAspect} onChange={(v) => { setLockAspect(v); if (!v) set({ height: plan.height }); }} />
          <Row label="Frame rate">
            <Segmented label="Frames per second" value={s.fps} onChange={(v) => set({ fps: v })} options={[10, 15, 24, 30].map((f) => ({ v: f, label: `${f}` }))} />
          </Row>
          <Slider label="Duration" value={s.duration} min={0.5} max={30} step={0.5} unit="s" onChange={(v) => set({ duration: v })} hint="Defaults to the document loop length" />
          <Row label="Loop">
            <Segmented label="Loop count" value={s.loopCount} onChange={(v) => set({ loopCount: v })} options={[{ v: 0, label: 'Forever' }, { v: 1, label: 'Once' }, { v: 3, label: '3×' }]} />
          </Row>
          <Toggle label="Seamless loop (last frame flows into first)" checked={s.seamless} onChange={(v) => set({ seamless: v })} />
          <Row label="Framing">
            <Segmented label="Framing" value={s.fit} onChange={(v) => set({ fit: v })} options={[{ v: 'content', label: 'Fit content' }, { v: 'view', label: 'Current view' }]} />
          </Row>
          <Slider label="Margin" value={s.padding} min={0} max={200} unit="px" onChange={(v) => set({ padding: v })} />
          {sel.length > 0 && <Toggle label={`Only the ${sel.length} selected object(s)`} checked={onlySel} onChange={setOnlySel} />}
          <Row label="Background">
            <Segmented label="Background" value={s.background === null ? 'none' : s.background === doc.canvas.background ? 'canvas' : 'white'} onChange={(v) => set({ background: v === 'none' ? null : v === 'canvas' ? doc.canvas.background : '#ffffff' })} options={[{ v: 'canvas', label: 'Canvas' }, { v: 'white', label: 'White' }, { v: 'none', label: 'Transparent' }]} />
          </Row>
          <details className="adv">
            <summary>Quality & colour</summary>
            <Slider label="Colours" value={s.colors} min={16} max={256} step={16} onChange={(v) => set({ colors: v })} hint="Fewer colours = smaller file" />
            <Toggle label="Shared palette across frames (no colour flicker)" checked={s.globalPalette} onChange={(v) => set({ globalPalette: v })} />
            <Toggle label="Ordered dithering (smoother gradients/glows)" checked={s.dither} onChange={(v) => set({ dither: v })} />
          </details>
          <p className="note">GIFs are limited to 256 colours and compress poorly. For long, large or very colourful animations, {vs ? <a href="#" onClick={(e) => { e.preventDefault(); useUI.getState().openDialog('video'); }}>export a {vs.label} video</a> : 'a video format'} will look better and be much smaller.</p>
        </div>
      </div>
    </Modal>
  );
}
