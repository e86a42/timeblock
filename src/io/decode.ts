// §5.1 — Decode & sample N evenly spaced frames in [inT, outT] and pack them (RGBA, top row
// first) into one buffer for a DataArrayTexture. Mediabunny (WebCodecs) decodes each packet at
// most once; browsers/codecs it can't handle fall back to seeking a hidden <video>.
import { ALL_FORMATS, BlobSource, CanvasSink, Input, type InputVideoTrack } from 'mediabunny';

export interface FrameStack {
  width: number;
  height: number;
  count: number;
  data: Uint8Array<ArrayBuffer>; // count × height × width × 4
  times: number[]; // seconds from clip start
  thumbs: HTMLCanvasElement[];
  downscaled: boolean; // true when the memory budget forced a smaller working size
}

export interface SampleOptions {
  inT: number;
  outT: number;
  count: number;
  maxLong?: number; // working resolution, long side
  budgetBytes?: number; // §10 — cap frames × working resolution
}

export interface VideoSource {
  name: string;
  width: number;
  height: number;
  duration: number;
  fps: number; // 0 when unknown
  decoder: 'webcodecs' | 'video-element';
  sample(opts: SampleOptions, onProgress: (r: number) => void, signal: AbortSignal): Promise<FrameStack>;
  dispose(): void;
}

const THUMB_COUNT = 12;
const THUMB_LONG = 120;

export async function openSource(file: File): Promise<VideoSource> {
  try {
    return await openWithMediabunny(file);
  } catch (e) {
    console.warn('Mediabunny decode unavailable, falling back to <video>:', e);
    return openWithVideoElement(file);
  }
}

/** Shared packing loop: draws each source frame into a work canvas and copies its pixels. */
async function pack(
  srcW: number,
  srcH: number,
  opts: SampleOptions,
  frames: (times: number[], width: number, height: number) => AsyncIterable<CanvasImageSource | null>,
  onProgress: (r: number) => void,
  signal: AbortSignal,
): Promise<FrameStack> {
  const { inT, outT, count } = opts;
  const budget = opts.budgetBytes ?? 512 * 1024 * 1024;
  let scale = Math.min(1, (opts.maxLong ?? 720) / Math.max(srcW, srcH));
  let downscaled = false;
  const bytesAt = (s: number) => count * Math.round(srcW * s) * Math.round(srcH * s) * 4;
  if (bytesAt(scale) > budget) {
    scale *= Math.sqrt(budget / bytesAt(scale));
    downscaled = true;
  }
  const width = Math.max(2, Math.round(srcW * scale));
  const height = Math.max(2, Math.round(srcH * scale));

  const times = Array.from({ length: count }, (_, i) =>
    count === 1 ? inT : inT + ((outT - inT) * i) / (count - 1),
  );
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const data = new Uint8Array(count * width * height * 4);
  const thumbs: HTMLCanvasElement[] = [];
  const thumbEvery = Math.max(1, (count - 1) / (THUMB_COUNT - 1));
  const thumbScale = THUMB_LONG / Math.max(width, height);

  let i = 0;
  for await (const img of frames(times, width, height)) {
    if (signal.aborted) throw new DOMException('Sampling cancelled', 'AbortError');
    if (img) ctx.drawImage(img, 0, 0, width, height); // null → repeat previous frame
    data.set(ctx.getImageData(0, 0, width, height).data, i * width * height * 4);
    if (thumbs.length < THUMB_COUNT && i >= Math.round(thumbs.length * thumbEvery)) {
      const th = document.createElement('canvas');
      th.width = Math.round(width * thumbScale);
      th.height = Math.round(height * thumbScale);
      th.getContext('2d')!.drawImage(canvas, 0, 0, th.width, th.height);
      thumbs.push(th);
    }
    onProgress(++i / count);
    if (i >= count) break;
  }
  return { width, height, count, data, times, thumbs, downscaled };
}

async function openWithMediabunny(file: File): Promise<VideoSource> {
  if (typeof VideoDecoder === 'undefined') throw new Error('WebCodecs unsupported');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track: InputVideoTrack | null = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('No video track');
  if (!(await track.canDecode())) throw new Error(`Codec ${track.codec} not decodable`);
  const start = await track.getFirstTimestamp();
  const end = await track.computeDuration();
  const stats = await track.computePacketStats(120);
  const width = track.displayWidth;
  const height = track.displayHeight;

  return {
    name: file.name,
    width,
    height,
    duration: end - start,
    fps: stats.averagePacketRate,
    decoder: 'webcodecs',
    sample: (opts, onProgress, signal) =>
      pack(
        width,
        height,
        opts,
        async function* (times, w, h) {
          const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 2 });
          for await (const wc of sink.canvasesAtTimestamps(times.map((t) => start + t))) {
            yield (wc?.canvas as CanvasImageSource | undefined) ?? null;
          }
        },
        onProgress,
        signal,
      ),
    dispose: () => input.dispose(),
  };
}

async function openWithVideoElement(file: File): Promise<VideoSource> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = URL.createObjectURL(file);
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('이 브라우저에서 디코딩할 수 없는 영상입니다.'));
  });
  const seek = (t: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        video.removeEventListener('seeked', done);
        resolve();
      };
      const timer = setTimeout(done, 3000); // 'seeked' may not fire if t equals currentTime
      video.addEventListener('seeked', done);
      video.currentTime = t;
    });
  const lastSafe = Math.max(0, video.duration - 0.04); // the final timestamp often has no frame

  return {
    name: file.name,
    width: video.videoWidth,
    height: video.videoHeight,
    duration: video.duration,
    fps: 0,
    decoder: 'video-element',
    sample: (opts, onProgress, signal) =>
      pack(
        video.videoWidth,
        video.videoHeight,
        opts,
        async function* (times) {
          for (const t of times) {
            await seek(Math.min(lastSafe, t));
            yield video;
          }
        },
        onProgress,
        signal,
      ),
    dispose: () => URL.revokeObjectURL(video.src),
  };
}
