// Tool / interaction / selection / viewport / playback / preference state.
// Preferences (including remembered per-tool styles) persist in localStorage.
import { create } from 'zustand';
import type { ShapeKind, ToolStyle } from '../model/types';
import { defaultToolStyle, styleKey, type ToolId } from '../model/defaults';

export type Theme = 'light' | 'dark' | 'system';
export type DialogId =
  | null | 'gif' | 'image' | 'svg' | 'video' | 'animation' | 'shortcuts' | 'help' | 'templates'
  | 'prefs' | 'docprops' | 'recent' | 'about' | 'shapes' | 'whatsnew' | 'iconlibs';

export interface Prefs {
  toolStyles: Record<string, ToolStyle>;
  sharedStyles: boolean;
  sharedStyle: ToolStyle | null;
  continuousDrawing: boolean;
  theme: Theme;
  snapToGrid: boolean;
  smartGuides: boolean;
  showInspector: boolean;
  showTimeline: boolean;
  recentColors: string[];
  suspendWhileDragging: boolean;
  autoplay: boolean;
  selectionUpdatesDefaults: boolean;
  showIconPanel: boolean; // the Icons panel docked on the left
  recentIcons: string[]; // "<set>:<name>", most recent first
  hiddenIconSets: string[]; // built-in icon sets switched off in Manage icon libraries
}

const PREFS_KEY = 'flowsketch.prefs.v1';

const DEFAULT_PREFS: Prefs = {
  toolStyles: {},
  sharedStyles: false,
  sharedStyle: null,
  continuousDrawing: true,
  theme: 'system',
  snapToGrid: false,
  smartGuides: true,
  showInspector: true,
  showTimeline: true,
  recentColors: [],
  suspendWhileDragging: true,
  autoplay: true,
  selectionUpdatesDefaults: true,
  showIconPanel: false,
  recentIcons: [],
  hiddenIconSets: [],
};

function loadPrefs(): Prefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PREFS_KEY) : null;
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw);
    return { ...DEFAULT_PREFS, ...(p && typeof p === 'object' ? p : {}) };
  } catch { return DEFAULT_PREFS; }
}

export interface Viewport { x: number; y: number; zoom: number }

export interface Toast { id: number; kind: 'info' | 'error' | 'success'; text: string; action?: { label: string; run: () => void } }

interface UIState {
  tool: ToolId;
  shapeKind: ShapeKind;
  selection: string[];
  view: Viewport;
  editingId: string | null;
  playing: boolean;
  time: number;
  dialog: DialogId;
  presentation: boolean;
  copiedStyle: ToolStyle | null;
  prefs: Prefs;
  toasts: Toast[];
  hint: string | null;
  menuOpen: string | null;
  reducedMotionOS: boolean;
  confirmReq: { message: string; ok: string; resolve: (v: boolean) => void } | null;
  welcomeDismissed: boolean;
}

interface UIActions {
  setTool(tool: ToolId, shape?: ShapeKind): void;
  select(ids: string[]): void;
  setView(v: Partial<Viewport>): void;
  setEditing(id: string | null): void;
  setPlaying(p: boolean): void;
  setTime(t: number): void;
  openDialog(d: DialogId): void;
  setPresentation(p: boolean): void;
  setCopiedStyle(s: ToolStyle | null): void;
  updatePrefs(p: Partial<Prefs>): void;
  toolStyle(key?: string): ToolStyle;
  setToolStyle(key: string, s: ToolStyle): void;
  pushRecentColor(c: string): void;
  pushRecentIcon(key: string): void;
  toast(text: string, kind?: Toast['kind'], action?: Toast['action']): void;
  dismissToast(id: number): void;
  setHint(h: string | null): void;
  setMenuOpen(m: string | null): void;
  /** In-app confirmation (native confirm() is unavailable in sandboxed hosts). */
  ask(message: string, ok?: string): Promise<boolean>;
}

let toastId = 0;

export const useUI = create<UIState & UIActions>((set, get) => ({
  tool: 'select',
  shapeKind: 'roundRect',
  selection: [],
  view: { x: -80, y: -60, zoom: 1 },
  editingId: null,
  playing: false,
  time: 0,
  dialog: null,
  presentation: false,
  copiedStyle: null,
  prefs: loadPrefs(),
  toasts: [],
  hint: null,
  menuOpen: null,
  confirmReq: null,
  welcomeDismissed: false,
  reducedMotionOS: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,

  setTool(tool, shape) { set((s) => ({ tool, shapeKind: shape ?? s.shapeKind, selection: tool === 'select' ? s.selection : [], editingId: null, welcomeDismissed: s.welcomeDismissed || (tool !== 'select' && tool !== 'hand') })); },
  select(ids) { set({ selection: [...new Set(ids)] }); },
  setView(v) { set((s) => ({ view: { ...s.view, ...v, zoom: Math.min(8, Math.max(0.1, v.zoom ?? s.view.zoom)) } })); },
  setEditing(id) { set({ editingId: id }); },
  setPlaying(p) { set({ playing: p }); },
  setTime(t) { set({ time: t }); },
  openDialog(d) { set({ dialog: d, menuOpen: null }); },
  setPresentation(p) { set({ presentation: p }); },
  setCopiedStyle(s) { set({ copiedStyle: s }); },
  updatePrefs(p) {
    const prefs = { ...get().prefs, ...p };
    set({ prefs });
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage full or disabled */ }
  },
  toolStyle(key) {
    const s = get();
    const k = key ?? styleKey(s.tool, s.shapeKind);
    const own = s.prefs.toolStyles[k] ?? defaultToolStyle(k);
    if (s.prefs.sharedStyles && s.prefs.sharedStyle && (k.startsWith('shape:') || k === 'text')) {
      return { ...own, style: { ...s.prefs.sharedStyle.style }, textStyle: { ...s.prefs.sharedStyle.textStyle } };
    }
    return own;
  },
  setToolStyle(key, ts) {
    const p = get().prefs;
    if (p.sharedStyles && (key.startsWith('shape:') || key === 'text')) get().updatePrefs({ sharedStyle: ts, toolStyles: { ...p.toolStyles, [key]: ts } });
    else get().updatePrefs({ toolStyles: { ...p.toolStyles, [key]: ts } });
  },
  pushRecentColor(c) {
    const rc = [c, ...get().prefs.recentColors.filter((x) => x !== c)].slice(0, 8);
    get().updatePrefs({ recentColors: rc });
  },
  pushRecentIcon(key) {
    get().updatePrefs({ recentIcons: [key, ...get().prefs.recentIcons.filter((x) => x !== key)].slice(0, 15) });
  },
  toast(text, kind = 'info', action) {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text, action }].slice(-4) }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 4000);
  },
  dismissToast(id) { set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })); },
  setHint(h) { set({ hint: h }); },
  setMenuOpen(m) { set({ menuOpen: m }); },
  ask(message, ok = 'Continue') {
    get().confirmReq?.resolve(false);
    return new Promise<boolean>((resolve) => set({ confirmReq: { message, ok, resolve: (v) => { set({ confirmReq: null }); resolve(v); } }, menuOpen: null }));
  },
}));

export const currentStyleKey = () => { const s = useUI.getState(); return styleKey(s.tool, s.shapeKind); };
