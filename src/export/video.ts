// Video export via MediaRecorder on an offscreen canvas stream (capability-checked; WebM or MP4).
import type { FlowDocument } from '../model/types';
import { exportRect, fitAspect, frameRenderer, type Framing } from './raster';

const CANDIDATES = [
  { mime: 'video/mp4;codecs=avc1.42E01F', ext: 'mp4', label: 'MP4' },
  { mime: 'video/webm;codecs=vp9', ext: 'webm', label: 'WebM (VP9)' },
  { mime: 'video/webm;codecs=vp8', ext: 'webm', label: 'WebM (VP8)' },
  { mime: 'video/webm', ext: 'webm', label: 'WebM' },
  { mime: 'video/mp4', ext: 'mp4', label: 'MP4' },
];

export function videoFormats() {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined' || !('captureStream' in HTMLCanvasElement.prototype)) return [];
  return CANDIDATES.filter((c) => { try { return MediaRecorder.isTypeSupported(c.mime); } catch { return false; } });
}

export function videoSupport() { return videoFormats()[0] ?? null; }

export interface VideoSettings extends Framing { width: number; fps: number; duration: number; loops: number; mime: string; bitrate: number; background: string }

export async function exportVideo(doc: FlowDocument, s: VideoSettings, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<Blob> {
  const fmt = videoFormats().find((f) => f.mime === s.mime);
  if (!fmt) throw new Error('This browser cannot record that video format.');
  let rect = exportRect(doc, s);
  const W = Math.round(s.width / 2) * 2;
  const H = Math.round(((rect.h / rect.w) * W) / 2) * 2;
  rect = fitAspect(rect, W, H);
  const r = await frameRenderer(doc, rect, W, H, s.background, s.onlyIds);
  const stream = (r.canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: s.bitrate });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((res) => { rec.onstop = () => res(); });
  const total = Math.round(s.duration * s.fps) * Math.max(1, s.loops);
  r.render(0);
  rec.start(250);
  const t0 = performance.now();
  try {
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const t = ((i / s.fps) % s.duration);
      r.render(t);
      track.requestFrame?.();
      onProgress(i + 1, total);
      // pace in real time: MediaRecorder timestamps frames by wall clock
      const target = t0 + ((i + 1) * 1000) / s.fps;
      await new Promise((res) => setTimeout(res, Math.max(0, target - performance.now())));
    }
  } finally {
    if (rec.state !== 'inactive') rec.stop();
    await stopped;
    track.stop();
  }
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  return new Blob(chunks, { type: fmt.mime.split(';')[0] });
}
