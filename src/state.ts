// Single source of truth for every user-facing parameter (spec §6).
// Panels write through store.set(path, value); renderers subscribe via store.on().

export type Aspect = '16:9' | '9:16' | '1:1' | '4:5' | '21:9' | 'custom';
export type ViewPreset = 'front' | 'side' | 'oblique' | 'top' | 'free';

export const DEFAULTS = {
  app: {
    mode: 'video' as 'video' | 'glb', // set by the loaded file; never part of a preset
  },
  canvas: {
    aspect: '9:16' as Aspect,
    customW: 1080,
    customH: 1920,
    resolution: 1080, // short side, px
    bgColor: '#0B0D10',
    gradient: false,
    gradTop: '#1A1F2B',
    gradBottom: '#0B0D10',
    sourceBg: true, // On = full frame planes, Off = subject only
    grain: 0, // paper grain overlay amount
  },
  block: {
    intensity: 0.6,
    frameCount: 120,
    subframes: 3, // interpolated slices per sampled frame, for a continuous volume
    inT: 0,
    outT: 0, // 0 → end of clip (resolved on load)
    spacing: 1, // % of screen height per sampled frame
    opacity: 0.15,
    falloff: 0.5,
    falloffCurve: 1, // exponent on frame age: <1 fades early, >1 keeps old frames longer
    heroOpacity: 1,
    intensityToSpacing: 1, // how strongly Intensity scales Spacing (0 = not at all)
    intensityToOpacity: 1, // how strongly Intensity scales Opacity
    blend: 'additive' as 'normal' | 'additive',
    colorOverTime: false,
    colorStart: '#FF6B2B',
    colorEnd: '#4A9EFF',
    feather: 4,
    highlight: true,
    heroFullFrame: false, // with Source background Off, keep the current frame's background
    bbox: false,
    bboxColor: '#F2F0EB',
  },
  subject: {
    model: 'general' as 'general' | 'person',
    anchor: 'none' as 'none' | 'center' | 'ground',
    anchorStrength: 1,
  },
  camera: {
    projection: 'perspective' as 'perspective' | 'orthographic',
    fov: 35,
    view: 'oblique' as ViewPreset,
    animation: 'orbit' as 'none' | 'orbit' | 'dolly' | 'orbit+dolly',
    orbitStart: -45, // degrees relative to the view, at t = 0
    orbitAngle: 90, // sweep over the whole duration
    orbitDir: 'ccw' as 'ccw' | 'cw',
    orbitEase: 'linear' as 'linear' | 'ease',
    dollyFrom: 1.12,
    dollyTo: 0.78,
    playback: 'buildup' as 'buildup' | 'static',
    buildTime: 5, // seconds until the block is complete (then it holds)
    buildAuto: true, // follows Duration until the user edits it
  },
  glb: {
    ghosts: 40, // baked poses in the stack
    unfold: 'linear' as 'linear' | 'none',
    axis: 'x' as 'x' | 'y' | 'z',
    length: 3, // unfold length in figure heights
    anchor: 'hips' as 'none' | 'hips' | 'ground',
    chain: 'loop' as 'loop' | 'arms' | 'legs' | 'spine' | 'all',
    ghostColor: '#AEB4BD',
    shading: 0.6, // headlight shading on ghosts
    heroTextured: true,
    rows: 160, // surface / point rows along time
    cols: 48, // points per row
    surfaceColor: '#9C9A93',
    surfaceOpacity: 0.35,
    lineColor: '#FF6B2B',
    // Sequence (seconds)
    stage: 'sequence' as 'sequence' | 'ghost' | 'surface' | 'points',
    buildEnd: 4,
    sweepStart: 4.5,
    sweepDur: 4,
    morphStart: 9.5,
    morphDur: 2.5,
    // Points stage (reference look)
    dotSize: 0.012, // figure heights
    inkColor: '#151515',
    paperColor: '#E4E3DF',
    paperGrain: 0.6,
    breathAmp: 0.18,
    breathSpeed: 1.2,
    breathFreq: 3, // bands along the time axis
    vertical: true, // stand the time axis upright in the points stage
  },
  pip: {
    enabled: false,
    corner: 'tl' as 'tl' | 'tr' | 'bl' | 'br',
    size: 0.3, // fraction of output width
    trackBox: true,
    boxColor: '#FF6B2B',
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

  /** Apply a (partial) params object leaf by leaf; unknown keys and wrong types are ignored. */
  load(src: unknown, base: any = DEFAULTS, prefix = '') {
    if (!src || typeof src !== 'object') return;
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      if (!(k in base) || (!prefix && k === 'app')) continue;
      const path = prefix + k;
      if (typeof base[k] === 'object') this.load(v, base[k], `${path}.`);
      else if (typeof v === typeof base[k]) this.set(path, v);
    }
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

/**
 * Intensity is a master scaler: 0.6 is neutral (×1), 0 flattens, 1 ≈ ×1.67.
 * Each linked parameter blends between "unaffected" (weight 0) and the full scale (weight 1).
 */
export function intensityScales(p: Params) {
  const k = p.block.intensity / DEFAULTS.block.intensity;
  const lerp = (w: number) => 1 + (k - 1) * w;
  return { spacing: lerp(p.block.intensityToSpacing), opacity: lerp(p.block.intensityToOpacity) };
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
