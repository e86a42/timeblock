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

const segmenters = new Map<MaskModel, Promise<ImageSegmenter>>();
let clock = 0; // VIDEO mode requires strictly increasing timestamps across all calls

function getSegmenter(model: MaskModel) {
  let s = segmenters.get(model);
  if (!s) {
    s = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const create = (delegate: 'GPU' | 'CPU') =>
        ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODELS[model], delegate },
          runningMode: 'VIDEO',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
      try {
        return await create('GPU');
      } catch {
        return await create('CPU');
      }
    })();
    s.catch(() => segmenters.delete(model));
    segmenters.set(model, s);
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
  const seg = await getSegmenter(model);
  const { width: w, height: h, count } = fs;
  const out = new Uint8Array(count * w * h);
  const px = w * h;

  // Subject = 1 − Σ(non-subject classes). Single-mask models output foreground directly.
  const labels = seg.getLabels().map((l) => l.toLowerCase());
  const excluded = labels.map((l, k) => (k === 0 || l === 'background' || SCENE_CLASSES.has(l) ? k : -1)).filter((k) => k >= 0);

  for (let i = 0; i < count; i++) {
    if (signal.aborted) throw new DOMException('Masking cancelled', 'AbortError');
    const rgba = new Uint8ClampedArray(fs.data.buffer, fs.data.byteOffset + i * px * 4, px * 4);
    clock += 40;
    seg.segmentForVideo(new ImageData(rgba, w, h), clock, (res) => {
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
    });
    onProgress((i + 1) / count, `피사체 마스크 계산 ${i + 1}/${count}`);
    if (i % 4 === 3) await new Promise((r) => setTimeout(r)); // keep the UI responsive
  }
  return { width: w, height: h, count, data: out };
}
