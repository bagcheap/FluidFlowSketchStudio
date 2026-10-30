// Native file I/O: File System Access API when available (save back in place), download fallback.
import type { FlowDocument } from '../model/types';
import { MAX_FILE_BYTES, parseDocument, serializeDocument, DocumentError, type ParseResult } from '../model/schema';

type Handle = { name: string; createWritable(): Promise<{ write(d: Blob | string): Promise<void>; close(): Promise<void> }> };
let currentHandle: Handle | null = null;

const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : {};
export const hasFSAccess = typeof w.showSaveFilePicker === 'function';

export function resetFileHandle() { currentHandle = null; }

export function safeFileName(title: string, ext: string) {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 80) || 'diagram';
  return `${base}.${ext}`;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Save. Returns the file name used, or null if the user cancelled. */
export async function saveDocumentFile(doc: FlowDocument, saveAs = false): Promise<string | null> {
  const json = serializeDocument(doc);
  const blob = new Blob([json], { type: 'application/json' });
  if (hasFSAccess) {
    try {
      if (!currentHandle || saveAs) {
        currentHandle = await (w.showSaveFilePicker as (o: unknown) => Promise<Handle>)({
          suggestedName: safeFileName(doc.title, 'flowsketch'),
          types: [{ description: 'FlowSketch diagram', accept: { 'application/json': ['.flowsketch'] } }],
        });
      }
      const ws = await currentHandle.createWritable();
      await ws.write(blob);
      await ws.close();
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

async function readFile(file: File): Promise<ParseResult & { name: string }> {
  if (file.size > MAX_FILE_BYTES) throw new DocumentError('File is too large to open (limit 25 MB).');
  const text = await file.text();
  return { ...parseDocument(text), name: file.name };
}

export async function openDocumentFile(): Promise<(ParseResult & { name: string }) | null> {
  if (typeof w.showOpenFilePicker === 'function') {
    try {
      const [h] = await (w.showOpenFilePicker as (o: unknown) => Promise<(Handle & { getFile(): Promise<File> })[]>)({
        types: [{ description: 'FlowSketch diagram', accept: { 'application/json': ['.flowsketch', '.json'] } }],
      });
      const r = await readFile(await h.getFile());
      currentHandle = h;
      return r;
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return null;
      if (e instanceof DocumentError) throw e;
    }
  }
  const file = await pickFile('.flowsketch,.json,application/json');
  if (!file) return null;
  currentHandle = null;
  return readFile(file);
}

export async function openDroppedFile(file: File) { currentHandle = null; return readFile(file); }

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
