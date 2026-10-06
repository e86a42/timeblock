// §5.1 — Decode & sample: seek a hidden <video> to N evenly spaced times in [inT, outT]
// and pack every frame (RGBA, top row first) into one buffer for a DataArrayTexture.

export interface FrameStack {
  width: number;
  height: number;
  count: number;
  data: Uint8Array; // count × height × width × 4
  times: number[];
  thumbs: HTMLCanvasElement[];
  downscaled: boolean; // true when the GPU memory budget forced a smaller working size
}

export interface SampleOptions {
  inT: number;
  outT: number;
  count: number;
  maxLong?: number; // working resolution, long side
  budgetBytes?: number; // §10 — cap frames × working resolution
}

const THUMB_COUNT = 12;
const THUMB_LONG = 120;

export async function loadVideo(file: File): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = URL.createObjectURL(file);
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('이 브라우저에서 디코딩할 수 없는 영상입니다.'));
  });
  return video;
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', done);
      resolve();
    };
    // Some browsers skip 'seeked' when the target equals currentTime.
    const timer = setTimeout(done, 3000);
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

export async function sampleFrames(
  video: HTMLVideoElement,
  opts: SampleOptions,
  onProgress: (ratio: number) => void,
  signal: AbortSignal,
): Promise<FrameStack> {
  const { inT, outT, count } = opts;
  const maxLong = opts.maxLong ?? 720;
  const budget = opts.budgetBytes ?? 512 * 1024 * 1024;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  let scale = Math.min(1, maxLong / Math.max(vw, vh));
  let downscaled = false;
  const bytesAt = (s: number) => count * Math.round(vw * s) * Math.round(vh * s) * 4;
  if (bytesAt(scale) > budget) {
    scale *= Math.sqrt(budget / bytesAt(scale));
    downscaled = true;
  }
  const width = Math.max(2, Math.round(vw * scale));
  const height = Math.max(2, Math.round(vh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const data = new Uint8Array(count * width * height * 4);
  const times: number[] = [];
  const thumbs: HTMLCanvasElement[] = [];
  const thumbEvery = Math.max(1, (count - 1) / (THUMB_COUNT - 1));
  const thumbScale = THUMB_LONG / Math.max(width, height);
  const lastSafe = Math.max(0, video.duration - 0.04); // final timestamp often has no frame

  for (let i = 0; i < count; i++) {
    if (signal.aborted) throw new DOMException('Sampling cancelled', 'AbortError');
    const t = Math.min(lastSafe, count === 1 ? inT : inT + ((outT - inT) * i) / (count - 1));
    await seek(video, t);
    ctx.drawImage(video, 0, 0, width, height);
    data.set(ctx.getImageData(0, 0, width, height).data, i * width * height * 4);
    times.push(t);

    if (thumbs.length < THUMB_COUNT && i >= Math.round(thumbs.length * thumbEvery)) {
      const th = document.createElement('canvas');
      th.width = Math.round(width * thumbScale);
      th.height = Math.round(height * thumbScale);
      th.getContext('2d')!.drawImage(canvas, 0, 0, th.width, th.height);
      thumbs.push(th);
    }
    onProgress((i + 1) / count);
  }

  return { width, height, count, data, times, thumbs, downscaled };
}
