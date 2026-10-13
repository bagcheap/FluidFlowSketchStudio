// Image asset decoding/caching. Only raster formats are accepted (no SVG => no script injection).
import type { Asset } from '../model/types';
import { uid } from '../model/defaults';
import { MAX_ASSET_BYTES } from '../model/schema';

const cache = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();
export const onImageLoaded = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };

export function imageMap(assets: Record<string, Asset>): Map<string, CanvasImageSource> {
  const m = new Map<string, CanvasImageSource>();
  for (const [id, a] of Object.entries(assets)) {
    let img = cache.get(a.dataUrl);
    if (!img) {
      img = new Image();
      img.onload = () => listeners.forEach((f) => f());
      img.src = a.dataUrl;
      cache.set(a.dataUrl, img);
    }
    if (img.complete && img.naturalWidth) m.set(id, img);
  }
  return m;
}

/** Wait until every asset is decoded (used before exporting). */
export async function preloadImages(assets: Record<string, Asset>): Promise<Map<string, CanvasImageSource>> {
  imageMap(assets);
  await Promise.all(Object.values(assets).map((a) => cache.get(a.dataUrl)!.decode().catch(() => undefined)));
  return imageMap(assets);
}

const OK = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export async function fileToAsset(file: File): Promise<Asset> {
  if (!OK.includes(file.type)) throw new Error('Unsupported image type. Use PNG, JPEG, GIF or WebP.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Image is larger than 20 MB.');
  const url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
  const img = new Image();
  img.src = url;
  await img.decode();
  let { naturalWidth: w, naturalHeight: h } = img;
  let dataUrl = url;
  let mime = file.type as Asset['mime'];
  const MAX = 2000;
  if (w > MAX || h > MAX || url.length > MAX_ASSET_BYTES) {
    const s = Math.min(1, MAX / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    dataUrl = c.toDataURL(mime, 0.88);
    w = c.width; h = c.height;
  }
  return { id: uid('asset'), mime, dataUrl, width: w, height: h };
}
