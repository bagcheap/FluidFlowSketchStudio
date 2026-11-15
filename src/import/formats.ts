// Opening a file of any supported format: FlowSketch's own, draw.io or Excalidraw. Other formats are converted, then
// pass through parseDocument like any FlowSketch file (validated, sanitised, references checked), so an imported
// diagram is exactly as safe as one opened from a .flowsketch file.
import { parseDocument, serializeDocument, type ParseResult } from '../model/schema';
import { importDrawio, looksLikeDrawio } from './drawio';
import { importExcalidraw, looksLikeExcalidraw } from './excalidraw';

export type SourceFormat = 'flowsketch' | 'draw.io' | 'Excalidraw';

/** File types the Open dialogs offer. */
export const OPEN_EXTENSIONS = ['flowsketch', 'json', 'drawio', 'xml', 'excalidraw'];
export const OPEN_ACCEPT = '.flowsketch,.json,.drawio,.xml,.excalidraw,application/json';

const stem = (name: string) => name.replace(/\.(drawio|xml|excalidraw|json)$/i, '').trim().slice(0, 200);

/** Read a file's text as whichever format it is. `format` says which; anything not FlowSketch's own is converted. */
export function parseAnyDiagram(text: string, fileName = ''): ParseResult & { format: SourceFormat } {
  if (looksLikeDrawio(text)) {
    const r = importDrawio(text, stem(fileName) || 'Imported from draw.io');
    const p = parseDocument(serializeDocument(r.doc));
    return { ...p, warnings: [...r.warnings, ...p.warnings], format: 'draw.io' };
  }
  if (looksLikeExcalidraw(text)) {
    const r = importExcalidraw(text, stem(fileName) || 'Imported from Excalidraw');
    const p = parseDocument(serializeDocument(r.doc));
    return { ...p, warnings: [...r.warnings, ...p.warnings], format: 'Excalidraw' };
  }
  return { ...parseDocument(text), format: 'flowsketch' };
}
