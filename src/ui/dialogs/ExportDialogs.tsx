import { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { useDoc } from '../../store/docStore';
import { useUI } from '../../store/uiStore';
import { exportPng, exportSvg } from '../../export/staticExport';
import { exportVideo, videoFormats } from '../../export/video';
import { downloadBlob, safeFileName } from '../../persistence/files';
import { Modal } from './Modal';
import { Row, Segmented, Slider, Toggle } from '../controls';

function TimeChoice({ value, onChange }: { value: number; onChange: (t: number) => void }) {
  const dur = useDoc((s) => s.doc.animation.duration);
  return <Slider label="Timestamp" value={value} min={0} max={dur} step={0.05} unit="s" onChange={onChange} hint="Which moment of the animation to capture" />;
}

export function ImageDialog() {
  const doc = useDoc((s) => s.doc);
  const sel = useUI((s) => s.selection);
  const [fmt, setFmt] = useState<'png' | 'jpeg'>('png');
  const [scale, setScale] = useState(2);
  const [transparent, setTransparent] = useState(false);
  const [padding, setPadding] = useState(doc.exportPrefs.padding);
  const [fit, setFit] = useState<'content' | 'view'>('content');
  const [onlySel, setOnlySel] = useState(false);
  const [time, setTime] = useState(useUI.getState().time);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { await exportPng({ format: fmt, scale, transparent: fmt === 'png' && transparent, padding, fit, onlySelected: onlySel, time }); useUI.getState().toast('Image exported', 'success'); }
    catch (e) { useUI.getState().toast(`Export failed: ${(e as Error).message}`, 'error'); }
    setBusy(false);
  };
  return (
    <Modal title="Export image" footer={<><button className="btn ghost" onClick={() => useUI.getState().openDialog(null)}>Close</button><button className="btn primary" disabled={busy} onClick={run}><Download size={14} /> Export {fmt.toUpperCase()}</button></>}>
      <Row label="Format"><Segmented label="Format" value={fmt} onChange={setFmt} options={[{ v: 'png', label: 'PNG' }, { v: 'jpeg', label: 'JPEG' }]} /></Row>
      <Row label="Scale"><Segmented label="Scale" value={scale} onChange={setScale} options={[1, 2, 3, 4].map((s) => ({ v: s, label: `${s}×` }))} /></Row>
      <Row label="Framing"><Segmented label="Framing" value={fit} onChange={setFit} options={[{ v: 'content', label: 'Crop to content' }, { v: 'view', label: 'Current view' }]} /></Row>
      <Slider label="Margin" value={padding} min={0} max={200} unit="px" onChange={setPadding} />
      {fmt === 'png' && <Toggle label="Transparent background" checked={transparent} onChange={setTransparent} />}
      {sel.length > 0 && <Toggle label="Selected objects only" checked={onlySel} onChange={setOnlySel} />}
      <TimeChoice value={time} onChange={setTime} />
    </Modal>
  );
}

export function SvgDialog() {
  const sel = useUI((s) => s.selection);
  const doc = useDoc((s) => s.doc);
  const [transparent, setTransparent] = useState(false);
  const [padding, setPadding] = useState(doc.exportPrefs.padding);
  const [onlySel, setOnlySel] = useState(false);
  const [embed, setEmbed] = useState(true);
  const [time, setTime] = useState(useUI.getState().time);
  const run = async () => {
    try { await exportSvg({ transparent, padding, onlySelected: onlySel, embedFonts: embed, time }); useUI.getState().toast('SVG exported', 'success'); }
    catch (e) { useUI.getState().toast(`Export failed: ${(e as Error).message}`, 'error'); }
  };
  return (
    <Modal title="Export SVG (vector)" footer={<><button className="btn ghost" onClick={() => useUI.getState().openDialog(null)}>Close</button><button className="btn primary" onClick={run}><Download size={14} /> Export SVG</button></>}>
      <p className="note">Exports true vector paths and text for one frame of the animation, keeping the hand-drawn look.</p>
      <Slider label="Margin" value={padding} min={0} max={200} unit="px" onChange={setPadding} />
      <Toggle label="Transparent background" checked={transparent} onChange={setTransparent} />
      <Toggle label="Embed fonts (larger file, looks identical everywhere)" checked={embed} onChange={setEmbed} />
      {sel.length > 0 && <Toggle label="Selected objects only" checked={onlySel} onChange={setOnlySel} />}
      <TimeChoice value={time} onChange={setTime} />
    </Modal>
  );
}

export function VideoDialog() {
  const doc = useDoc((s) => s.doc);
  const formats = videoFormats();
  const [mime, setMime] = useState(formats[0]?.mime ?? '');
  const [width, setWidth] = useState(1280);
  const [fps, setFps] = useState(30);
  const [loops, setLoops] = useState(2);
  const [prog, setProg] = useState<[number, number] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const fmt = formats.find((f) => f.mime === mime);
  const run = async () => {
    setErr(null);
    abort.current = new AbortController();
    try {
      const blob = await exportVideo(doc, { mime, width, fps, loops, duration: doc.animation.duration, bitrate: 6_000_000, background: doc.canvas.background, fit: 'content', padding: doc.exportPrefs.padding }, (d, t) => setProg([d, t]), abort.current.signal);
      downloadBlob(blob, safeFileName(doc.title, fmt?.ext ?? 'webm'));
      useUI.getState().toast('Video exported', 'success');
    } catch (e) { setErr((e as DOMException).name === 'AbortError' ? 'Export cancelled.' : `Video export failed: ${(e as Error).message}`); }
    setProg(null);
  };
  if (!formats.length) return <Modal title="Export video"><p>This browser does not support recording video from a canvas. Try a recent Chrome, Edge or Firefox — or export an animated GIF.</p></Modal>;
  return (
    <Modal title="Export video" footer={<>
      {prog ? <button className="btn" onClick={() => abort.current?.abort()}>Cancel</button> : <button className="btn ghost" onClick={() => useUI.getState().openDialog(null)}>Close</button>}
      <button className="btn primary" disabled={!!prog} onClick={run}><Download size={14} /> Export {fmt?.label}</button>
    </>}>
      <Row label="Format"><Segmented label="Video format" value={mime} onChange={setMime} options={formats.map((f) => ({ v: f.mime, label: f.label }))} /></Row>
      <Row label="Width"><Segmented label="Width" value={width} onChange={setWidth} options={[{ v: 854, label: '480p' }, { v: 1280, label: '720p' }, { v: 1920, label: '1080p' }]} /></Row>
      <Row label="FPS"><Segmented label="Frame rate" value={fps} onChange={setFps} options={[24, 30, 60].map((f) => ({ v: f, label: String(f) }))} /></Row>
      <Slider label="Repeat loop" value={loops} min={1} max={10} unit="×" onChange={setLoops} />
      <p className="note">Video is recorded in real time ({(doc.animation.duration * loops).toFixed(1)}s) using your browser’s encoder; keep this tab visible while it records.</p>
      {prog && <div className="progress" role="progressbar" aria-valuenow={prog[0]} aria-valuemax={prog[1]}><div className="bar" style={{ width: `${(prog[0] / prog[1]) * 100}%` }} /><span>Recording {prog[0]} / {prog[1]}</span></div>}
      {err && <div className="error" role="alert">{err}</div>}
    </Modal>
  );
}
