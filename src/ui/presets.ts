// §6.5 — Presets: three built-in looks plus full-parameter JSON save/load.
import { DEFAULTS, store, type Params } from '../state';
import { download } from '../io/exportMp4';

type Partial2<T> = { [K in keyof T]?: Partial<T[K]> };

export const BUILTIN: Record<string, { label: string; params: Partial2<Params> }> = {
  ghostTrail: {
    label: 'Ghost Trail',
    params: {
      canvas: { sourceBg: false },
      block: {
        blend: 'additive', opacity: 0.12, falloff: 0.85, falloffCurve: 0.6, spacing: 1.2, subframes: 4,
        feather: 8, highlight: true, heroOpacity: 1, heroFullFrame: false, bbox: false, colorOverTime: false,
      },
      subject: { anchor: 'none' },
      camera: { animation: 'orbit', orbitStart: -30, orbitAngle: 60, orbitEase: 'ease', playback: 'buildup' },
      pip: { enabled: false },
    },
  },
  planeStack: {
    label: 'Plane Stack',
    params: {
      canvas: { sourceBg: false },
      block: {
        blend: 'normal', opacity: 0.35, falloff: 0.4, falloffCurve: 1, spacing: 1.5, subframes: 3,
        feather: 4, highlight: true, heroOpacity: 1, heroFullFrame: true, bbox: false, colorOverTime: false,
      },
      subject: { anchor: 'none' },
      camera: { animation: 'orbit+dolly', orbitStart: -45, orbitAngle: 90, orbitEase: 'linear', playback: 'buildup' },
      pip: { enabled: false },
    },
  },
  silhouetteVolume: {
    label: 'Silhouette Volume',
    params: {
      canvas: { sourceBg: false },
      block: {
        blend: 'additive', opacity: 0.1, falloff: 0.3, falloffCurve: 1, spacing: 1, subframes: 3,
        feather: 2, highlight: true, heroOpacity: 1, heroFullFrame: false, bbox: true, colorOverTime: true,
      },
      subject: { anchor: 'center', anchorStrength: 1 },
      camera: { animation: 'orbit', orbitStart: -60, orbitAngle: 120, orbitEase: 'linear', playback: 'buildup' },
      pip: { enabled: true, trackBox: true },
    },
  },
};

const FILE_TAG = 'timeblock-preset';

export function savePreset() {
  const json = JSON.stringify({ type: FILE_TAG, version: 1, params: store.p }, null, 2);
  download(new Blob([json], { type: 'application/json' }), 'timeblock_preset.json');
}

export async function loadPresetFile(file: File) {
  const obj = JSON.parse(await file.text());
  if (obj?.type !== FILE_TAG || typeof obj.params !== 'object') throw new Error('TIME.BLOCK 프리셋 파일이 아닙니다');
  // Auto-follow flags first so loaded Duration / Build-up values are not overwritten.
  store.set('export.durationAuto', false);
  store.set('camera.buildAuto', false);
  store.load(obj.params);
  // Auto-follow rules may have recomputed these while loading; the saved values win.
  store.load({ export: { duration: obj.params.export?.duration } });
  store.load({ camera: { buildTime: obj.params.camera?.buildTime } });
}

export function bindPresetMenu(select: HTMLSelectElement, onError: (msg: string) => void) {
  select.innerHTML = '';
  select.add(new Option('Preset', ''));
  for (const [id, p] of Object.entries(BUILTIN)) select.add(new Option(p.label, id));
  select.add(new Option('기본값으로 초기화', 'reset'));
  select.add(new Option('JSON 저장…', 'save'));
  select.add(new Option('JSON 불러오기…', 'load'));

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (f) await loadPresetFile(f).catch((e) => onError((e as Error).message));
  });

  select.addEventListener('change', () => {
    const v = select.value;
    select.value = '';
    if (v === 'save') savePreset();
    else if (v === 'load') fileInput.click();
    else if (v === 'reset') {
      const { inT, outT } = store.p.block; // keep the clip range
      store.load({ ...DEFAULTS, block: { ...DEFAULTS.block, inT, outT } });
    } else if (BUILTIN[v]) store.load(BUILTIN[v].params);
  });
}
