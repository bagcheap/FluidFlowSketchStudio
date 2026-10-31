import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, Search, Trash2 } from 'lucide-react';
import type { FlowDocument } from '../../model/types';
import { useDoc } from '../../store/docStore';
import { useUI } from '../../store/uiStore';
import * as cmd from '../../store/commands';
import { Modal } from './Modal';
import { Row, Segmented, Select, Slider, Toggle } from '../controls';
import { SHORTCUTS } from '../shortcuts';
import { SAMPLES } from '../../templates/samples';
import { listCustomTemplates, deleteCustomTemplate, listRecents, loadRecent, loadAutosave, removeRecent, type CustomTemplate, type RecentEntry } from '../../persistence/storage';
import { parseDocument } from '../../model/schema';
import { renderDocumentAtTime, contentBounds } from '../../engine/render';
import { frameToSvg } from '../../engine/svgExport';
import { SHAPE_LABELS } from '../../engine/shapes';
import { SHAPE_KINDS } from '../../model/schema';
import { ShapeIcon } from '../ShapeIcon';
import { uid } from '../../model/defaults';
import { version } from '../../../package.json';
import { boldRuns, RELEASES } from '../changelog';

const close = () => useUI.getState().openDialog(null);

export function AnimationDialog() {
  const a = useDoc((s) => s.doc.animation);
  const set = (p: Partial<typeof a>) => cmd.setAnimation(p);
  const setShape = (p: Partial<typeof a.shape>) => cmd.setAnimation({ shape: { ...a.shape, ...p } }, 'anim-shape');
  const setConn = (p: Partial<typeof a.connector>) => cmd.setAnimation({ connector: { ...a.connector, ...p } }, 'anim-conn');
  return (
    <Modal title="Animation settings" wide footer={<><button className="btn" onClick={cmd.resetDocAnimation}>Reset to defaults</button><button className="btn primary" onClick={close}>Done</button></>}>
      <p className="note">Document defaults apply to every object that doesn’t override them. Per-object overrides live in the inspector (a dot marks an overridden value).</p>
      <div className="cols2">
        <div>
          <h3>Global</h3>
          <Toggle label="Animation enabled" checked={a.enabled} onChange={(v) => set({ enabled: v })} />
          <Toggle label="Animate all shapes" checked={a.animateShapes} onChange={(v) => set({ animateShapes: v })} />
          <Toggle label="Animate all connectors" checked={a.animateConnectors} onChange={(v) => set({ animateConnectors: v })} />
          <Toggle label="Reduced-motion mode (everything still)" checked={a.reducedMotion} onChange={(v) => set({ reducedMotion: v })} />
          <Slider label="Duration" value={a.duration} min={0.5} max={30} step={0.5} unit="s" onChange={(v) => set({ duration: v })} />
          <Toggle label="Loop" checked={a.loop} onChange={(v) => set({ loop: v })} />
          <Toggle label="Seamless loops (snap speeds to fit the loop)" checked={a.seamless} onChange={(v) => set({ seamless: v })} />
          <Slider label="Playback speed" value={a.playbackSpeed} min={0.1} max={4} step={0.05} unit="×" onChange={(v) => set({ playbackSpeed: v })} />
          <Slider label="Global squiggle" value={a.intensityScale} min={0} max={3} step={0.05} unit="×" onChange={(v) => set({ intensityScale: v })} />
          <Slider label="Global movement speed" value={a.speedScale} min={0} max={4} step={0.05} unit="×" onChange={(v) => set({ speedScale: v })} />
          <Slider label="Global arrow speed" value={a.arrowSpeedScale} min={0} max={4} step={0.05} unit="×" onChange={(v) => set({ arrowSpeedScale: v })} />
          <Toggle label="Synchronise objects (same phase)" checked={a.synchronize} onChange={(v) => set({ synchronize: v })} />
          <Toggle label="Randomise phases per object" checked={a.randomizePhases} onChange={(v) => set({ randomizePhases: v })} />
        </div>
        <div>
          <h3>Default shape motion</h3>
          <Select label="Style" value={a.shape.mode} onChange={(v) => setShape({ mode: v })} options={[{ v: 'combined', label: 'Combined organic motion' }, { v: 'float', label: 'Gentle float' }, { v: 'wobble', label: 'Organic wobble' }, { v: 'boil', label: 'Sketch boil' }, { v: 'sway', label: 'Soft sway' }, { v: 'off', label: 'Off' }]} />
          <Slider label="Squiggle" value={a.shape.intensity} min={0} max={10} step={0.5} onChange={(v) => setShape({ intensity: v })} />
          <Slider label="Speed" value={a.shape.speed} min={0} max={2} step={0.05} unit="Hz" onChange={(v) => setShape({ speed: v })} />
          <Slider label="Movement" value={a.shape.amplitude} min={0} max={12} step={0.1} unit="px" onChange={(v) => setShape({ amplitude: v })} />
          <Slider label="Rotation" value={a.shape.rotation} min={0} max={6} step={0.1} unit="°" onChange={(v) => setShape({ rotation: v })} />
          <Slider label="Deform" value={a.shape.deform} min={0} max={10} step={0.1} unit="px" onChange={(v) => setShape({ deform: v })} />
          <Slider label="Smoothness" value={a.shape.smoothness} min={0} max={1} step={0.05} onChange={(v) => setShape({ smoothness: v })} />
          <Row label="Text"><Segmented label="Text motion" value={a.shape.textMotion} onChange={(v) => setShape({ textMotion: v })} options={[{ v: 'follow', label: 'Follows' }, { v: 'stable', label: 'Stable' }, { v: 'independent', label: 'Own drift' }]} /></Row>
          <h3>Default arrow flow</h3>
          <Select label="Arrow style" value={a.connector.mode} onChange={(v) => setConn({ mode: v })} options={[{ v: 'travel', label: 'Travelling highlight' }, { v: 'drawOn', label: 'Draw on' }, { v: 'dash', label: 'Marching dashes' }, { v: 'pulse', label: 'Pulse' }, { v: 'none', label: 'Static' }]} />
          <Slider label="Speed" value={a.connector.speed} min={0.05} max={3} step={0.05} unit="/s" onChange={(v) => setConn({ speed: v })} />
          <Slider label="Highlight length" value={a.connector.highlightLength} min={4} max={300} unit="px" onChange={(v) => setConn({ highlightLength: v })} />
        </div>
      </div>
    </Modal>
  );
}

export function ShortcutsDialog() {
  return (
    <Modal title="Keyboard shortcuts" wide>
      <div className="shortcuts">
        {SHORTCUTS.map((g) => (
          <div key={g.group}><h3>{g.group}</h3><table><tbody>{g.items.map(([a, k]) => <tr key={a}><td>{a}</td><td><kbd>{k}</kbd></td></tr>)}</tbody></table></div>
        ))}
      </div>
    </Modal>
  );
}

export function HelpDialog() {
  return (
    <Modal title="Getting started" wide>
      <div className="help">
        <h3>1 · Draw</h3>
        <p>Pick a shape (<kbd>R</kbd>, <kbd>U</kbd>, <kbd>O</kbd>, <kbd>D</kbd> or <kbd>S</kbd> for the library) and click to drop a default-sized shape or drag for a custom size (<kbd>Shift</kbd> keeps proportions). <b>The tool stays active</b>, so you can keep drawing — press <kbd>Esc</kbd> or <kbd>V</kbd> to go back to Select. Colours and sizes you set while a tool is active become that tool’s remembered defaults, separately per tool.</p>
        <h3>2 · Write</h3>
        <p>Double-click any shape or arrow (or press <kbd>Enter</kbd> with it selected) to type. Shapes grow to fit their text. Double-click empty canvas for free text.</p>
        <h3>3 · Connect</h3>
        <p>Press <kbd>A</kbd> and drag from one shape to another. Arrows attach to shapes (dropping near a side’s dot pins to that port) and follow them when moved, resized or animated. Select an arrow to drag its ends, drag the faint mid-dots to add bends, and switch Straight / Curved / Elbow routing in the inspector.</p>
        <h3>4 · Bring it to life</h3>
        <p>Press <kbd>K</kbd> or the play button. Every shape gently floats and wobbles; arrows show a travelling highlight in the direction of flow. In the inspector, <b>Squiggle</b> (0–10) sets how alive a shape is — 0 is perfectly still — and <b>Hand-drawn</b> sets how sketchy its static outline is; they are independent. Per-object settings override the document defaults (Animation ▸ Global settings). Arrows can travel, draw on, march or pulse.</p>
        <h3>5 · Save & share</h3>
        <p>Your work autosaves in this browser. <kbd>⌘/Ctrl S</kbd> saves a <code>.flowsketch</code> file you can reopen later with everything editable. Export ▸ Animated GIF renders deterministic frames using the same maths as the preview; PNG, SVG, video and a standalone HTML player are also available.</p>
        <h3>Tips</h3>
        <ul>
          <li>Right-click for the most common actions. Select shapes and choose <b>Add container</b> to frame them: the container moves everything inside, and shapes dragged in or out join or leave it.</li>
          <li>Icons: press <kbd>⇧ I</kbd> to open the Icons panel, search, then drag an icon onto the canvas or click it.</li>
          <li>Alt-drag duplicates; arrow keys nudge (<kbd>Shift</kbd> ×10); hold <kbd>Space</kbd> to pan; <kbd>⌘/Ctrl</kbd>+scroll or pinch to zoom.</li>
          <li>Format painter (<kbd>F</kbd>): click a shape to pick its style, then click others to apply it.</li>
          <li>Presentation mode (<kbd>⌘/Ctrl ⇧ P</kbd>) hides all chrome and plays fullscreen.</li>
        </ul>
      </div>
    </Modal>
  );
}

const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const Rich = ({ text }: { text: string }) => <>{boldRuns(text).map((r, i) => (r.bold ? <b key={i}>{r.text}</b> : <span key={i}>{r.text}</span>))}</>;

/** Help ▸ What's new: the release notes from CHANGELOG.md. */
export function WhatsNewDialog() {
  return (
    <Modal title="What's new" wide>
      <div className="help whats-new">
        {RELEASES.map((r) => (
          <section key={r.version} aria-label={`Version ${r.version}`}>
            <h3>{r.version === 'Unreleased' ? 'Coming in the next version' : `Version ${r.version}`}{r.date && <span className="dim"> · {fmtDate(r.date)}</span>}</h3>
            {r.notes.map((n, i) => <p key={i}><Rich text={n} /></p>)}
            {r.groups.map((g) => (
              <div key={g.title}>
                <h4>{g.title}</h4>
                <ul>{g.items.map((it, i) => <li key={i}><Rich text={it} /></li>)}</ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}

export function AboutDialog() {
  return (
    <Modal title="About FlowSketch Studio">
      <p><b>FlowSketch Studio</b> {version} — an editor for gently animated, hand-drawn flow diagrams. <button className="link" onClick={() => useUI.getState().openDialog('whatsnew')}>What's new</button></p>
      <p className="note">Everything runs locally in your browser; documents are never uploaded. Built with React, Rough.js (MIT), gifenc (MIT), fflate (MIT), Zustand (MIT), idb-keyval (Apache-2.0), Lucide icons (ISC) and the Kalam & Inter fonts (OFL).</p>
      <p className="note">A personal learning project; it is not published or distributed. Built-in icons: Tabler Icons and Devicon (MIT), SVG Logos and Simple Icons (CC0), Kubernetes icons (Apache-2.0); see THIRD_PARTY_NOTICES.md. Logos are trademarks of their owners. AWS, Azure and Google Cloud icons are not included: you import them from each provider, under that provider’s terms.</p>
    </Modal>
  );
}

export function PrefsDialog() {
  const p = useUI((s) => s.prefs);
  const up = useUI.getState().updatePrefs;
  return (
    <Modal title="Preferences" footer={<button className="btn primary" onClick={close}>Done</button>}>
      <Toggle label="Continuous drawing (tool stays active after drawing)" checked={p.continuousDrawing} onChange={(v) => up({ continuousDrawing: v })} />
      <Toggle label="Colours I set on selected objects also become that tool’s default" checked={p.selectionUpdatesDefaults} onChange={(v) => up({ selectionUpdatesDefaults: v })} />
      <Toggle label="Use shared style defaults for all shape tools" checked={p.sharedStyles} onChange={(v) => up({ sharedStyles: v, sharedStyle: v ? useUI.getState().toolStyle('shape:roundRect') : null })} />
      <Toggle label="Pause an object’s motion while dragging/resizing it" checked={p.suspendWhileDragging} onChange={(v) => up({ suspendWhileDragging: v })} />
      <Toggle label="Autoplay animation on open (ignored if your system asks for reduced motion)" checked={p.autoplay} onChange={(v) => up({ autoplay: v })} />
      <Toggle label="Snap to grid" checked={p.snapToGrid} onChange={(v) => up({ snapToGrid: v })} />
      <Toggle label="Smart alignment guides" checked={p.smartGuides} onChange={(v) => up({ smartGuides: v })} />
      <Row label="Theme"><Segmented label="Theme" value={p.theme} onChange={(v) => up({ theme: v })} options={[{ v: 'light', label: 'Light' }, { v: 'dark', label: 'Dark' }, { v: 'system', label: 'System' }]} /></Row>
      <button className="btn small" onClick={() => { up({ toolStyles: {}, sharedStyle: null }); useUI.getState().toast('All remembered tool styles reset'); }}>Reset all remembered tool styles</button>
    </Modal>
  );
}

export function DocPropsDialog() {
  const doc = useDoc((s) => s.doc);
  const [title, setTitle] = useState(doc.title);
  const counts = doc.elements.reduce<Record<string, number>>((m, e) => ({ ...m, [e.type]: (m[e.type] ?? 0) + 1 }), {});
  return (
    <Modal title="Document properties" footer={<button className="btn primary" onClick={() => { cmd.renameDocument(title); close(); }}>Save</button>}>
      <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <table className="props"><tbody>
        <tr><td>Created</td><td>{new Date(doc.createdAt).toLocaleString()}</td></tr>
        <tr><td>Last changed</td><td>{new Date(doc.updatedAt).toLocaleString()}</td></tr>
        <tr><td>Objects</td><td>{doc.elements.length} ({Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'})</td></tr>
        <tr><td>Images</td><td>{Object.keys(doc.assets).length}</td></tr>
        <tr><td>Format</td><td>.flowsketch (JSON) · schema v{doc.schemaVersion}</td></tr>
        <tr><td>Document id</td><td><code>{doc.id}</code></td></tr>
      </tbody></table>
      <Slider label="Default export margin" value={doc.exportPrefs.padding} min={0} max={200} unit="px" onChange={(v) => useDoc.getState().commit((d) => ({ ...d, exportPrefs: { ...d.exportPrefs, padding: v } }), 'pad')} />
    </Modal>
  );
}

export function RecentDialog() {
  const [list, setList] = useState<RecentEntry[] | null>(null);
  const [auto, setAuto] = useState<FlowDocument | null>(null);
  const refresh = () => { void listRecents().then(setList); void loadAutosave().then(setAuto); };
  useEffect(refresh, []);
  const open = async (id: string) => {
    if (!(await cmd.confirmDiscard())) return;
    try { const d = await loadRecent(id); if (d) { cmd.loadDocument(d); close(); } else useUI.getState().toast('That document is no longer stored', 'error'); }
    catch (e) { useUI.getState().toast(`Could not open: ${(e as Error).message}`, 'error'); }
  };
  return (
    <Modal title="Recent documents" footer={<><button className="btn" onClick={() => { close(); void cmd.openFile(); }}><FolderOpen size={14} /> Open file…</button><button className="btn primary" onClick={close}>Close</button></>}>
      {auto && <div className="recover"><b>Autosave:</b> “{auto.title}” · {auto.elements.length} objects · <button className="link" onClick={async () => { if (await cmd.confirmDiscard()) { cmd.loadDocument(auto, null, true); close(); } }}>Restore</button></div>}
      {list === null ? <p>Loading…</p> : list.length === 0 ? <p className="note">Nothing yet — documents appear here as soon as they autosave.</p> : (
        <ul className="recent-list">
          {list.map((r) => (
            <li key={r.id}>
              <button className="recent-open" onClick={() => void open(r.id)}><b>{r.title}</b><span className="dim">{new Date(r.updatedAt).toLocaleString()} · {r.elements} objects</span></button>
              <button className="icon-btn sm" aria-label={`Remove ${r.title} from recents`} onClick={async () => { if (await useUI.getState().ask(`Remove “${r.title}” from this browser’s storage?`, 'Remove')) void removeRecent(r.id).then(refresh); }}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <p className="note">Stored only in this browser. Browser storage can be cleared — save important work to a file.</p>
    </Modal>
  );
}

function Thumb({ doc }: { doc: FlowDocument }) {
  const svg = useMemo(() => {
    const b = contentBounds(doc);
    if (!b) return '';
    const frame = renderDocumentAtTime(doc, 0.5, { flags: { still: true } });
    return frameToSvg(frame, { rect: { x: b.x - 20, y: b.y - 20, w: b.w + 40, h: b.h + 40 }, background: doc.canvas.background, assets: doc.assets });
  }, [doc]);
  return <img className="thumb" alt="" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} />;
}

export function TemplatesDialog() {
  const [custom, setCustom] = useState<CustomTemplate[]>([]);
  useEffect(() => { void listCustomTemplates().then(setCustom); }, []);
  const built = useMemo(() => SAMPLES.map((s) => ({ ...s, doc: s.build() })), []);
  const use = async (d: FlowDocument) => {
    if (!(await cmd.confirmDiscard())) return;
    cmd.loadDocument({ ...structuredClone(d), id: uid('doc'), createdAt: new Date().toISOString() }, null, true);
    useUI.getState().setPlaying(true);
    close();
  };
  return (
    <Modal title="Templates & samples" wide>
      <p className="note">Opening a template creates a new, fully editable copy.</p>
      <div className="tpl-grid">
        {built.map((s) => (
          <button key={s.id} className="tpl" onClick={() => use(s.doc)} data-template={s.id}>
            <Thumb doc={s.doc} />
            <b>{s.title}</b><span className="dim">{s.description}</span>
          </button>
        ))}
      </div>
      {custom.length > 0 && <>
        <h3>Your templates</h3>
        <div className="tpl-grid">
          {custom.map((t) => {
            let d: FlowDocument | null = null;
            try { d = parseDocument(t.json).doc; } catch { /* skip */ }
            if (!d) return null;
            const doc = d;
            return (
              <div key={t.id} className="tpl">
                <button className="tpl-inner" onClick={() => use(doc)}><Thumb doc={doc} /><b>{t.title}</b></button>
                <button className="icon-btn sm" aria-label={`Delete template ${t.title}`} onClick={() => void deleteCustomTemplate(t.id).then(() => listCustomTemplates().then(setCustom))}><Trash2 size={14} /></button>
              </div>
            );
          })}
        </div>
      </>}
    </Modal>
  );
}

export function ShapesDialog() {
  const [q, setQ] = useState('');
  const kinds = SHAPE_KINDS.filter((k) => (SHAPE_LABELS[k] + ' ' + k).toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title="Shape library">
      <label className="search"><Search size={15} /><input autoFocus placeholder="Search shapes (e.g. database, decision)…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && kinds[0]) { useUI.getState().setTool('shape', kinds[0]); close(); } }} /></label>
      <div className="lib-grid">
        {kinds.map((k) => (
          <button key={k} className="lib-cell" onClick={() => { useUI.getState().setTool('shape', k); close(); }}>
            <ShapeIcon kind={k} size={34} /><span>{SHAPE_LABELS[k]}</span>
          </button>
        ))}
        {!kinds.length && <p className="note">No shapes match “{q}”.</p>}
      </div>
    </Modal>
  );
}
