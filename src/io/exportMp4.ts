// §7 — Offline export: render every frame deterministically at the output size, then encode
// with Mediabunny (WebCodecs) into MP4/H.264 or WebM/VP9. No real-time capture, no dropped frames.
import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  WebMOutputFormat,
  canEncodeVideo,
} from 'mediabunny';
import type { Params } from '../state';

const CODEC = { mp4: 'avc', webm: 'vp9' } as const;

export function exportQuality(e: Params['export']): Quality {
  if (e.bitrate === 'custom') return new Quality({ bitrate: e.customMbps * 1e6 });
  return { low: QUALITY_LOW, medium: QUALITY_MEDIUM, high: QUALITY_HIGH }[e.bitrate];
}

/** Which formats this browser can encode at the given size; empty reason = supported. */
export async function encodeSupport(w: number, h: number, fps: number) {
  if (typeof VideoEncoder === 'undefined') {
    const reason = '이 브라우저는 WebCodecs 인코딩을 지원하지 않습니다 (Chrome/Edge 데스크톱 권장)';
    return { mp4: reason, webm: reason };
  }
  const check = async (f: 'mp4' | 'webm') =>
    (await canEncodeVideo(CODEC[f], { width: w, height: h, frameRate: fps }).catch(() => false))
      ? ''
      : `${f === 'mp4' ? 'H.264' : 'VP9'} ${w}×${h} 인코딩을 지원하지 않습니다`;
  return { mp4: await check('mp4'), webm: await check('webm') };
}

export function defaultFileName(ext: string, d = new Date()) {
  const z = (n: number) => String(n).padStart(2, '0');
  return `timeblock_${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}.${ext}`;
}

export interface ExportJob {
  width: number;
  height: number;
  fps: number;
  duration: number;
  format: 'mp4' | 'webm';
  quality: Quality;
  /** Draw the frame at time t (seconds) into ctx (width × height). */
  renderFrame: (t: number, ctx: CanvasRenderingContext2D) => void;
  onProgress: (done: number, total: number, etaSec: number) => void;
  signal: AbortSignal;
}

export async function exportVideo(job: ExportJob): Promise<Blob> {
  const { width, height, fps, duration, format } = job;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  const output = new Output({
    format: format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, { codec: CODEC[format], quality: job.quality, keyFrameInterval: 1 });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  const total = Math.max(1, Math.round(duration * fps));
  const t0 = performance.now();
  try {
    for (let k = 0; k < total; k++) {
      if (job.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      job.renderFrame(k / fps, ctx);
      await source.add(k / fps, 1 / fps); // awaits encoder backpressure
      const elapsed = (performance.now() - t0) / 1000;
      job.onProgress(k + 1, total, (elapsed / (k + 1)) * (total - k - 1));
    }
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  return new Blob([output.target.buffer!], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
