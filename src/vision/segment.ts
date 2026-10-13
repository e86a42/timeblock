// §5.2 — Subject masks with MediaPipe Image Segmenter (VIDEO mode, segmentForVideo).
// Computed once per sampled frame set and cached; Source background On/Off only flips a uniform.
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import type { FrameStack } from '../io/decode';

export type MaskModel = 'general' | 'person';

const MODELS: Record<MaskModel, string> = {
  // DeepLab v3: 21 classes (person, animals, vehicles…); subject = 1 − background.
  general:
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/deeplab_v3/float32/latest/deeplab_v3.tflite',
  // Selfie multiclass: background, hair, body-skin, face-skin, clothes, others.
  person:
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
};

// Static scene furniture in DeepLab's VOC label set — never the moving subject.
const SCENE_CLASSES = new Set(['chair', 'diningtable', 'sofa', 'pottedplant', 'tv']);

// The wasm runtime is copied from node_modules into public/ by scripts/copy-mediapipe.mjs.
const WASM_BASE = `${import.meta.env.BASE_URL}mediapipe/wasm`;

type Delegate = 'GPU' | 'CPU';
const segmenters = new Map<string, Promise<ImageSegmenter>>();
let clock = 0; // VIDEO mode requires strictly increasing timestamps across all calls

/** Cached segmenter per model; 'GPU' falls back to CPU when the GPU delegate can't start. */
function getSegmenter(model: MaskModel, delegate: Delegate = 'GPU') {
  const key = `${model}:${delegate}`;
  let s = segmenters.get(key);
  if (!s) {
    s = (async () => {
      let fileset;
      try {
        fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      } catch (e) {
        throw new Error(`MediaPipe 런타임을 불러오지 못했습니다 (public/mediapipe 확인 — npm run dev로 실행): ${(e as Error).message}`);
      }
      const create = (d: Delegate) =>
        ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODELS[model], delegate: d },
          runningMode: 'VIDEO',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
      try {
        return await create(delegate);
      } catch (e) {
        if (delegate === 'CPU') throw e;
        try {
          return await create('CPU');
        } catch (e2) {
          throw new Error(`세그멘테이션 모델을 불러오지 못했습니다 (네트워크 확인): ${(e2 as Error).message}`);
        }
      }
    })();
    s.catch(() => segmenters.delete(key));
    segmenters.set(key, s);
  }
  return s;
}

export interface MaskStack {
  width: number;
  height: number;
  count: number;
  data: Uint8Array; // count × height × width, subject confidence 0–255
}

export async function computeMasks(
  fs: FrameStack,
  model: MaskModel,
  onProgress: (r: number, phase: string) => void,
  signal: AbortSignal,
): Promise<MaskStack> {
  onProgress(0, '세그멘테이션 모델 로드 중…');
  let seg = await getSegmenter(model);
  let onCpu = false;
  const { width: w, height: h, count } = fs;
  const out = new Uint8Array(count * w * h);
  const px = w * h;

  // Subject = 1 − Σ(non-subject classes). Single-mask models output foreground directly.
  const labels = seg.getLabels().map((l) => l.toLowerCase());
  const excluded = labels.map((l, k) => (k === 0 || l === 'background' || SCENE_CLASSES.has(l) ? k : -1)).filter((k) => k >= 0);

  for (let i = 0; i < count; i++) {
    if (signal.aborted) throw new DOMException('Masking cancelled', 'AbortError');
    const rgba = new Uint8ClampedArray(fs.data.buffer, fs.data.byteOffset + i * px * 4, px * 4);
    const frame = new ImageData(rgba, w, h);
    const onResult = (res: { confidenceMasks?: { width: number; height: number; getAsFloat32Array(): Float32Array }[] }) => {
      const masks = res.confidenceMasks ?? [];
      if (!masks.length) return;
      const { width: mw, height: mh } = masks[0];
      const fg = new Float32Array(mw * mh).fill(1);
      if (masks.length === 1) fg.set(masks[0].getAsFloat32Array());
      else
        for (const k of excluded) {
          const f = masks[k]?.getAsFloat32Array();
          if (f) for (let q = 0; q < f.length; q++) fg[q] -= f[q];
        }
      const dst = out.subarray(i * px, (i + 1) * px);
      // Nearest resample (identity when the model returns the working size).
      for (let y = 0; y < h; y++) {
        const sy = Math.min(mh - 1, Math.floor((y * mh) / h)) * mw;
        for (let x = 0; x < w; x++) {
          const v = fg[sy + Math.min(mw - 1, Math.floor((x * mw) / w))];
          dst[y * w + x] = Math.max(0, Math.min(1, v)) * 255;
        }
      }
    };
    clock += 40;
    try {
      seg.segmentForVideo(frame, clock, onResult);
    } catch (e) {
      // The GPU path can fail mid-run (e.g. its WebGL context was lost): retry once on CPU.
      if (onCpu) throw e;
      console.warn('Segmenter GPU path failed, retrying on CPU:', e);
      segmenters.delete(`${model}:GPU`);
      seg = await getSegmenter(model, 'CPU');
      onCpu = true;
      clock += 40;
      seg.segmentForVideo(frame, clock, onResult);
    }
    onProgress((i + 1) / count, `피사체 마스크 계산 ${i + 1}/${count}`);
    if (i % 4 === 3) await new Promise((r) => setTimeout(r)); // keep the UI responsive
  }
  return { width: w, height: h, count, data: out };
}
