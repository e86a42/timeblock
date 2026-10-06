// Single source of truth for every user-facing parameter (spec §6).
// Panels write through store.set(path, value); renderers subscribe via store.on().

export type Aspect = '16:9' | '9:16' | '1:1' | '4:5' | '21:9' | 'custom';
export type ViewPreset = 'front' | 'side' | 'oblique' | 'top' | 'free';

export const DEFAULTS = {
  canvas: {
    aspect: '9:16' as Aspect,
    customW: 1080,
    customH: 1920,
    resolution: 1080, // short side, px
    bgColor: '#0B0D10',
    gradient: false,
    gradTop: '#1A1F2B',
    gradBottom: '#0B0D10',
    sourceBg: true, // On = full frame planes, Off = subject only (M4)
  },
  block: {
    intensity: 0.6,
    frameCount: 60,
    inT: 0,
    outT: 0, // 0 → end of clip (resolved on load)
    spacing: 2, // % of screen height per frame
    opacity: 0.15,
    falloff: 0.5,
    blend: 'additive' as 'normal' | 'additive',
    colorOverTime: false,
    colorStart: '#FF6B2B',
    colorEnd: '#4A9EFF',
    feather: 4,
    highlight: true,
    bbox: false,
    bboxColor: '#F2F0EB',
  },
  camera: {
    projection: 'perspective' as 'perspective' | 'orthographic',
    fov: 35,
    view: 'oblique' as ViewPreset,
    animation: 'orbit' as 'none' | 'orbit' | 'dolly' | 'orbit+dolly',
    orbitAngle: 90,
    playback: 'buildup' as 'buildup' | 'static',
  },
  export: {
    format: 'mp4' as 'mp4' | 'webm',
    fps: 30,
    duration: 6,
    durationAuto: true, // follows In/Out length until the user edits it
    bitrate: 'high' as 'low' | 'medium' | 'high' | 'custom',
    customMbps: 20,
    fileName: '',
  },
};

export type Params = typeof DEFAULTS;
type Listener = (path: string) => void;

class Store {
  p: Params = structuredClone(DEFAULTS);
  private listeners = new Set<Listener>();

  get<T = unknown>(path: string): T {
    return path.split('.').reduce<any>((o, k) => o[k], this.p) as T;
  }

  set(path: string, value: unknown) {
    const keys = path.split('.');
    const last = keys.pop()!;
    const obj = keys.reduce<any>((o, k) => o[k], this.p);
    if (obj[last] === value) return;
    obj[last] = value;
    this.listeners.forEach((l) => l(path));
  }

  on(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const store = new Store();

/** Output pixel size from Canvas settings, both sides forced even for H.264 (§7). */
export function outputSize(c: Params['canvas']): { w: number; h: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (c.aspect === 'custom') return { w: even(c.customW), h: even(c.customH) };
  const [a, b] = c.aspect.split(':').map(Number);
  const short = c.resolution;
  return a >= b
    ? { w: even((short * a) / b), h: even(short) }
    : { w: even(short), h: even((short * b) / a) };
}

/** Intensity is a master scaler: 0.6 is neutral (×1), 0 flattens, 1 ≈ ×1.67. */
export function intensityScale(p: Params) {
  return p.block.intensity / DEFAULTS.block.intensity;
}
