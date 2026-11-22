// Native file I/O: File System Access API when available (save back in place), download fallback.
// In the desktop app (Tauri) the native macOS dialogs are used instead (see native.ts).
import type { FlowDocument } from '../model/types';
import { MAX_FILE_BYTES, serializeDocument, DocumentError, type ParseResult } from '../model/schema';
import { OPEN_ACCEPT, OPEN_EXTENSIONS, parseAnyDiagram, type SourceFormat } from '../import/formats';
import { baseName, isDesktopApp, openWithDialog, pickSavePath, saveWithDialog, writeToPath } from './native';
import { useUI } from '../store/uiStore';
import { createStore, get, set } from 'idb-keyval';

type Perm = 'granted' | 'denied' | 'prompt';
type Handle = {
  name: string;
  createWritable(): Promise<{ write(d: Blob | string): Promise<void>; close(): Promise<void> }>;
  queryPermission?(o: { mode: 'readwrite' }): Promise<Perm>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<Perm>;
};
let currentHandle: Handle | null = null;
/** Desktop app: the file the current diagram was opened from or last saved to (Save writes back to it). */
let currentPath: string | null = null;
/** The diagram the handle/path above belongs to (so a restore never overrides a file just opened). */
let currentDocId: string | null = null;
/** The diagram's title when it was last opened or saved: renamed since then, Save asks where (with the new name). */
let fileTitle: string | null = null;

// The file each diagram belongs to is remembered across restarts, so Save still writes back after the app or the
// tab is reopened (the last diagram is restored from autosave, or one is opened from Recents). Browser: the file
// handle in IndexedDB (Chrome/Edge keep handles; writing asks for permission again once). Desktop app: the path in
// localStorage; the app keeps its permission to write files you chose (persisted scope).
const handles = typeof indexedDB !== 'undefined' ? createStore('flowsketch-files', 'handles') : null;
const PATHS = 'flowsketch:fileOf';
const MAX_REMEMBERED = 50;

function readPaths(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(PATHS) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([k, p]) => typeof k === 'string' && typeof p === 'string' && p.length < 4096)) as Record<string, string>;
  } catch { return {}; }
}

function rememberFile(docId: string) {
  currentDocId = docId;
  if (isDesktopApp) {
    if (!currentPath) return;
    const all = readPaths();
    delete all[docId];
    const kept = Object.entries({ ...all, [docId]: currentPath }).slice(-MAX_REMEMBERED);
    try { localStorage.setItem(PATHS, JSON.stringify(Object.fromEntries(kept))); } catch { /* not remembered */ }
  } else if (currentHandle && handles) {
    set(docId, currentHandle, handles).catch(() => undefined);
  }
}

/** A diagram was loaded: Save goes back to the file it last came from or went to, if that's known. */
export async function restoreFileFor(docId: string, title: string): Promise<void> {
  if (currentDocId === docId) return; // just opened or saved: already known
  currentDocId = docId; currentHandle = null; currentPath = null; fileTitle = title;
  if (isDesktopApp) { currentPath = readPaths()[docId] ?? null; return; }
  if (!handles) return;
  try {
    const h = await get<Handle>(docId, handles);
    if (h && currentDocId === docId && typeof h.createWritable === 'function') currentHandle = h;
  } catch { /* no handle */ }
}

/** Chrome asks once per visit before writing to a file remembered from an earlier one. */
async function mayWrite(h: Handle): Promise<boolean> {
  if (!h.queryPermission || !h.requestPermission) return true;
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}

const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : {};
export const hasFSAccess = typeof w.showSaveFilePicker === 'function';

export function resetFileHandle() { currentHandle = null; currentPath = null; currentDocId = null; fileTitle = null; }

export function safeFileName(title: string, ext: string) {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 80) || 'diagram';
  return `${base}.${ext}`;
}

/** Save a file the user asked for (export, library, …): a download in the browser, a Save dialog in the desktop app. */
export function downloadBlob(blob: Blob, name: string) {
  if (isDesktopApp) {
    saveWithDialog(blob, name).catch((e) => useUI.getState().toast(`Couldn't save ${name}: ${(e as Error)?.message ?? e}`, 'error'));
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Save a file and let the user choose where: the native Save dialog in the desktop app, the browser's Save dialog where
 * it has one (File System Access), else a download. Resolves false if the user cancelled.
 */
export async function saveFileAs(blob: Blob, name: string, kind: { description: string; mime: string; ext: string }): Promise<boolean> {
  if (isDesktopApp || !hasFSAccess) { downloadBlob(blob, name); return true; }
  try {
    const h = await (w.showSaveFilePicker as (o: unknown) => Promise<Handle>)({ suggestedName: name, types: [{ description: kind.description, accept: { [kind.mime]: [`.${kind.ext}`] } }] });
    const out = await h.createWritable();
    await out.write(blob);
    await out.close();
    return true;
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return false;
    throw e;
  }
}

/** Save. Returns the file name used, or null if the user cancelled. */
export async function saveDocumentFile(doc: FlowDocument, saveAs = false): Promise<string | null> {
  const json = serializeDocument(doc);
  // renamed since it was opened or last saved: ask where to save, suggesting the new name
  if (fileTitle !== null && doc.title !== fileTitle && (currentPath || currentHandle)) saveAs = true;
  if (isDesktopApp) {
    // Save writes back to the file it came from; Save as (or a new diagram) asks where
    let path = !currentPath || saveAs ? await pickSavePath(safeFileName(doc.title, 'flowsketch')) : currentPath;
    if (!path) return null;
    try { await writeToPath(path, json); } catch (e) {
      if (path !== currentPath || saveAs) throw e;
      // no longer allowed to write there (moved, or permission lost): ask where instead
      path = await pickSavePath(safeFileName(doc.title, 'flowsketch'));
      if (!path) return null;
      await writeToPath(path, json);
    }
    currentPath = path;
    fileTitle = doc.title;
    rememberFile(doc.id);
    return baseName(path);
  }
  const blob = new Blob([json], { type: 'application/json' });
  if (hasFSAccess) {
    try {
      if (!currentHandle || saveAs || !(await mayWrite(currentHandle))) {
        currentHandle = await (w.showSaveFilePicker as (o: unknown) => Promise<Handle>)({
          suggestedName: safeFileName(doc.title, 'flowsketch'),
          types: [{ description: 'FlowSketch diagram', accept: { 'application/json': ['.flowsketch'] } }],
        });
      }
      const ws = await currentHandle.createWritable();
      await ws.write(blob);
      await ws.close();
      fileTitle = doc.title;
      rememberFile(doc.id);
      return currentHandle.name;
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return null;
      // fall through to download (e.g. sandboxed iframe)
    }
  }
  const name = safeFileName(doc.title, 'flowsketch');
  downloadBlob(blob, name);
  return name;
}

type Opened = ParseResult & { name: string; format: SourceFormat };

async function readFile(file: File): Promise<Opened> {
  if (file.size > MAX_FILE_BYTES) throw new DocumentError('File is too large to open (limit 25 MB).');
  const text = await file.text();
  return { ...parseAny(text, file.name), name: file.name };
}

/** Any supported format; a conversion error reads as a plain message. */
function parseAny(text: string, name: string) {
  try { return parseAnyDiagram(text, name); } catch (e) {
    if (e instanceof DocumentError) throw e;
    throw new DocumentError((e as Error)?.message || 'That file could not be read.');
  }
}

/**
 * Where an opened file can be saved back to: only FlowSketch's own files. A draw.io or Excalidraw file opened here is
 * a converted copy, so Save asks where to save it (as a .flowsketch file) and never overwrites the original.
 */
function keepFile(r: Opened, path: string | null, handle: Handle | null) {
  if (r.format === 'flowsketch') { currentPath = path; currentHandle = handle; fileTitle = r.doc.title; rememberFile(r.doc.id); return; }
  currentPath = null; currentHandle = null; fileTitle = null; currentDocId = r.doc.id;
}

export async function openDocumentFile(): Promise<Opened | null> {
  if (isDesktopApp) {
    const f = await openWithDialog([{ name: 'Diagrams (FlowSketch, draw.io, Excalidraw)', extensions: OPEN_EXTENSIONS }]);
    if (!f) return null;
    if (f.text.length > MAX_FILE_BYTES) throw new DocumentError('File is too large to open (limit 25 MB).');
    const r = { ...parseAny(f.text, f.name), name: f.name };
    keepFile(r, f.path, null);
    return r;
  }
  if (typeof w.showOpenFilePicker === 'function') {
    try {
      const [h] = await (w.showOpenFilePicker as (o: unknown) => Promise<(Handle & { getFile(): Promise<File> })[]>)({
        types: [{ description: 'Diagrams (FlowSketch, draw.io, Excalidraw)', accept: { 'application/json': ['.flowsketch', '.json', '.excalidraw'], 'application/xml': ['.drawio', '.xml'] } }],
      });
      const r = await readFile(await h.getFile());
      keepFile(r, null, h);
      return r;
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return null;
      if (e instanceof DocumentError) throw e;
    }
  }
  const file = await pickFile(OPEN_ACCEPT);
  if (!file) return null;
  currentHandle = null; currentPath = null;
  const r = await readFile(file);
  currentDocId = r.doc.id; // a copy picked from disk: no file to write back to, so Save asks
  return r;
}

export async function openDroppedFile(file: File) {
  currentHandle = null; currentPath = null;
  const r = await readFile(file);
  currentDocId = r.doc.id; // dropped: no file to write back to, so Save asks
  return r;
}

/** Pick several files, or (with `directory`) every file in a folder. Resolves [] if cancelled. */
export function pickFiles(accept: string, directory = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = true;
    if (directory) input.setAttribute('webkitdirectory', '');
    input.style.display = 'none';
    document.body.appendChild(input);
    const done = (f: File[]) => { input.remove(); resolve(f); };
    input.onchange = () => done([...(input.files ?? [])]);
    input.addEventListener('cancel', () => done([]));
    input.click();
  });
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.style.display = 'none';
    // attached to the DOM: some browsers ignore click() on detached file inputs
    document.body.appendChild(input);
    const done = (f: File | null) => { input.remove(); resolve(f); };
    input.onchange = () => done(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}
