// Desktop app (Tauri) file I/O. Inside the app window, browser downloads and the File System Access API don't
// exist, so saving and exporting use the native macOS Open/Save dialogs and write the chosen file directly.
// In a normal browser none of this runs (and the Tauri packages are only loaded inside the app).

/** True when FlowSketch runs inside the desktop app. */
export const isDesktopApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface FileFilter { name: string; extensions: string[] }

/** Guess a dialog filter from a file name, e.g. "Diagram.gif" → GIF image (*.gif). */
export function filterFor(name: string): FileFilter[] {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (!ext) return [];
  const label: Record<string, string> = {
    flowsketch: 'FlowSketch diagram', flowsketchlib: 'FlowSketch icon library', gif: 'GIF image', png: 'PNG image',
    jpg: 'JPEG image', jpeg: 'JPEG image', svg: 'SVG image', html: 'HTML page', webm: 'WebM video', mp4: 'MP4 video',
  };
  return [{ name: label[ext] ?? ext.toUpperCase(), extensions: [ext] }];
}

/** Ask where to save (native dialog). Returns the chosen path, or null if cancelled. */
export async function pickSavePath(suggestedName: string): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  return (await save({ defaultPath: suggestedName, filters: filterFor(suggestedName) })) ?? null;
}

/** Write bytes or text to a path chosen in a native dialog. */
export async function writeToPath(path: string, data: Blob | string): Promise<void> {
  const fs = await import('@tauri-apps/plugin-fs');
  if (typeof data === 'string') await fs.writeTextFile(path, data);
  else await fs.writeFile(path, new Uint8Array(await data.arrayBuffer()));
}

/** Save a file with the native dialog. Returns the file name used, or null if cancelled. */
export async function saveWithDialog(data: Blob | string, suggestedName: string): Promise<string | null> {
  const path = await pickSavePath(suggestedName);
  if (!path) return null;
  await writeToPath(path, data);
  return baseName(path);
}

/** Native Open dialog for one file. Returns its path and text, or null if cancelled. */
export async function openWithDialog(filters: FileFilter[]): Promise<{ path: string; name: string; text: string } | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ multiple: false, directory: false, filters });
  if (!path || Array.isArray(path)) return null;
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  return { path, name: baseName(path), text: await readTextFile(path) };
}

export const baseName = (p: string) => p.split(/[\\/]/).pop() || p;
