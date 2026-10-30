import { Component, useEffect, useState, type ReactNode } from 'react';
import { X, Sparkles, FolderOpen, LayoutTemplate, SlidersHorizontal } from 'lucide-react';
import { Canvas } from './editor/Canvas';
import { TopBar } from './ui/TopBar';
import { Toolbar } from './ui/Toolbar';
import { Inspector } from './ui/Inspector';
import { IconsPanel } from './ui/IconsPanel';
import { Timeline } from './ui/Timeline';
import { useShortcuts } from './ui/shortcuts';
import { useDoc } from './store/docStore';
import { useUI } from './store/uiStore';
import * as cmd from './store/commands';
import { autosave, loadAutosave } from './persistence/storage';
import { openDroppedFile } from './persistence/files';
import { DocumentError } from './model/schema';
import { resetTextMetrics } from './engine/text';
import { GifDialog } from './ui/dialogs/GifDialog';
import { ImageDialog, SvgDialog, VideoDialog } from './ui/dialogs/ExportDialogs';
import { AboutDialog, AnimationDialog, DocPropsDialog, HelpDialog, PrefsDialog, RecentDialog, ShapesDialog, ShortcutsDialog, TemplatesDialog, WhatsNewDialog } from './ui/dialogs/MiscDialogs';
import { SAMPLES, STARTER_ID } from './templates/samples';
import { Modal } from './ui/dialogs/Modal';
import { IconLibrariesDialog } from './ui/dialogs/IconLibrariesDialog';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h1>Something went wrong</h1>
        <p>{this.state.error.message}</p>
        <p>Your last autosave is safe in this browser. Reloading will restore it.</p>
        <button className="btn primary" onClick={() => location.reload()}>Reload FlowSketch</button>
      </div>
    );
  }
}

function useTheme() {
  const theme = useUI((s) => s.prefs.theme);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme; };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

function useAutosave() {
  const revision = useDoc((s) => s.revision);
  useEffect(() => {
    const t = setTimeout(() => {
      const d = useDoc.getState().doc;
      if (!d.elements.length && !useDoc.getState().dirty) return;
      autosave(d).then(() => useDoc.getState().markAutosaved()).catch((e) => useUI.getState().toast(`Autosave failed: ${(e as Error).message}`, 'error'));
    }, 700);
    return () => clearTimeout(t);
  }, [revision]);
}

function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const hint = useUI((s) => s.hint);
  return (
    <div className="toasts no-canvas" aria-live="polite">
      {hint && <div className="toast hint">{hint}<button className="icon-btn sm" aria-label="Dismiss" onClick={() => useUI.getState().setHint(null)}><X size={13} /></button></div>}
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span>{t.text}</span>
          {t.action && <button className="link" onClick={() => { t.action!.run(); useUI.getState().dismissToast(t.id); }}>{t.action.label}</button>}
          <button className="icon-btn sm" aria-label="Dismiss" onClick={() => useUI.getState().dismissToast(t.id)}><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}

function Welcome() {
  const empty = useDoc((s) => s.doc.elements.length === 0);
  const dismissed = useUI((s) => s.welcomeDismissed);
  if (!empty) return null;
  const blank = () => useUI.setState({ welcomeDismissed: true });
  return (
    <div className="welcome">
      <div className="welcome-arrow">Pick a tool &amp; start drawing ↑</div>
      {!dismissed && <div className="welcome-card no-canvas" role="dialog" aria-label="Welcome">
        <button className="icon-btn sm welcome-x" aria-label="Close and start with a blank canvas" title="Start with a blank canvas" onClick={blank}><X size={15} /></button>
        <div className="welcome-title"><Sparkles size={18} /> Diagrams that feel alive</div>
        <p>Draw shapes, connect them with arrows, and they gently wobble while arrows show the flow. Export a looping GIF in a click.</p>
        <div className="welcome-actions">
          <button className="btn primary" onClick={() => { const s = SAMPLES.find((x) => x.id === STARTER_ID)!; cmd.loadDocument(s.build(), null, true); useUI.getState().setPlaying(true); }} data-testid="open-sample"><Sparkles size={14} /> Open a live sample</button>
          <button className="btn" onClick={() => useUI.getState().openDialog('templates')}><LayoutTemplate size={14} /> Templates</button>
          <button className="btn" onClick={() => void cmd.openFile()}><FolderOpen size={14} /> Open file</button>
        </div>
        <button className="link welcome-blank" onClick={blank} data-testid="start-blank">Start with a blank canvas</button>
        <p className="dim small">Saved in this browser automatically · <kbd>?</kbd> for shortcuts</p>
      </div>}
    </div>
  );
}

function ConfirmDialog() {
  const req = useUI((s) => s.confirmReq);
  if (!req) return null;
  return (
    <Modal title="Are you sure?" onClose={() => req.resolve(false)} footer={<>
      <button className="btn ghost" onClick={() => req.resolve(false)}>Cancel</button>
      <button className="btn primary" data-testid="confirm-ok" onClick={() => req.resolve(true)}>{req.ok}</button>
    </>}>
      <p className="note">{req.message}</p>
    </Modal>
  );
}

function Dialogs() {
  const d = useUI((s) => s.dialog);
  switch (d) {
    case 'gif': return <GifDialog />;
    case 'image': return <ImageDialog />;
    case 'svg': return <SvgDialog />;
    case 'video': return <VideoDialog />;
    case 'animation': return <AnimationDialog />;
    case 'shortcuts': return <ShortcutsDialog />;
    case 'help': return <HelpDialog />;
    case 'about': return <AboutDialog />;
    case 'whatsnew': return <WhatsNewDialog />;
    case 'iconlibs': return <IconLibrariesDialog />;
    case 'prefs': return <PrefsDialog />;
    case 'docprops': return <DocPropsDialog />;
    case 'recent': return <RecentDialog />;
    case 'templates': return <TemplatesDialog />;
    case 'shapes': return <ShapesDialog />;
    default: return null;
  }
}

export function App() {
  useTheme();
  useAutosave();
  useShortcuts();
  const presentation = useUI((s) => s.presentation);
  const showInspector = useUI((s) => s.prefs.showInspector);
  const showTimeline = useUI((s) => s.prefs.showTimeline);
  const showIcons = useUI((s) => s.prefs.showIconPanel);
  const [sheet, setSheet] = useState(false); // small screens: inspector as a toggleable bottom sheet

  useEffect(() => {
    // restore last session, then start playing unless the OS asks for reduced motion
    void loadAutosave().then((doc) => {
      if (doc && doc.elements.length) { cmd.loadDocument(doc, null, true); }
      const u = useUI.getState();
      if (u.prefs.autoplay && !u.reducedMotionOS) u.setPlaying(true);
    }).catch(() => undefined);
    document.fonts?.ready.then(() => { resetTextMetrics(); useDoc.setState((s) => ({ revision: s.revision + 1 })); });
    const onOpen = async (e: Event) => {
      const f = (e as CustomEvent<File>).detail;
      const ok = await cmd.confirmDiscard();
      if (!ok) return;
      openDroppedFile(f).then((r) => { cmd.loadDocument(r.doc, r.name); if (r.warnings.length) useUI.getState().toast(`Opened with repairs: ${r.warnings[0]}`); })
        .catch((err) => useUI.getState().toast(err instanceof DocumentError ? err.message : 'Could not open that file.', 'error'));
    };
    window.addEventListener('flowsketch:openfile', onOpen);
    const onFs = () => { if (!document.fullscreenElement && useUI.getState().presentation) useUI.getState().setPresentation(false); };
    document.addEventListener('fullscreenchange', onFs);
    return () => { window.removeEventListener('flowsketch:openfile', onOpen); document.removeEventListener('fullscreenchange', onFs); };
  }, []);

  useEffect(() => {
    if (presentation) {
      document.documentElement.requestFullscreen?.().catch(() => undefined);
      requestAnimationFrame(() => cmd.zoomToFit());
    }
  }, [presentation]);

  return (
    <ErrorBoundary>
      <div className={`app ${presentation ? 'presenting' : ''} ${showInspector ? '' : 'no-inspector'} ${showTimeline ? '' : 'no-timeline'} ${sheet ? 'sheet-open' : ''} ${showIcons && !presentation ? 'icons-open' : ''}`}>
        {!presentation && <TopBar />}
        <main className="workspace">
          <Canvas />
          {!presentation && <Toolbar />}
          {!presentation && <Welcome />}
          {!presentation && showIcons && <IconsPanel />}
          {!presentation && showInspector && <Inspector />}
          {!presentation && showInspector && (
            <button className="sheet-toggle no-canvas" aria-expanded={sheet} aria-label="Show properties" onClick={() => setSheet(!sheet)}>
              {sheet ? <X size={18} /> : <SlidersHorizontal size={18} />}
            </button>
          )}
          {presentation && (
            <button className="present-exit no-canvas" onClick={() => { useUI.getState().setPresentation(false); if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined); }}>
              Exit presentation (Esc)
            </button>
          )}
        </main>
        {!presentation && showTimeline && <Timeline />}
        <Toasts />
        <Dialogs />
        <ConfirmDialog />
      </div>
    </ErrorBoundary>
  );
}
