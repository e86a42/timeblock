// §5.4 — Per-frame subject statistics from masks, and Anchor offsets that cancel camera
// panning/shake by pinning the subject (centroid or ground contact) to its average position.
import type { MaskStack } from './segment';

/** Normalized image coordinates (0–1, y down). Null when the frame has no subject. */
export interface SubjectStats {
  cx: number;
  cy: number;
  bottom: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const THRESHOLD = 128;

export function computeStats(m: MaskStack): (SubjectStats | null)[] {
  const { width: w, height: h, count, data } = m;
  const stats: (SubjectStats | null)[] = [];
  for (let i = 0; i < count; i++) {
    const base = i * w * h;
    let n = 0, sx = 0, sy = 0;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      const row = base + y * w;
      for (let x = 0; x < w; x++) {
        if (data[row + x] < THRESHOLD) continue;
        n++;
        sx += x;
        sy += y;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    // Ignore specks: a subject must cover at least 0.2% of the frame.
    stats.push(
      n < w * h * 0.002
        ? null
        : { cx: sx / n / w, cy: sy / n / h, bottom: (y1 + 1) / h, x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h },
    );
  }
  return stats;
}

/** Fill empty frames from the nearest valid neighbour, then smooth with a small window. */
function track(values: (number | null)[], radius = 2): number[] {
  const filled = values.slice();
  const fill = (order: number[]) => {
    let last: number | null = null;
    for (const i of order) {
      if (filled[i] === null) filled[i] = last;
      else last = filled[i];
    }
  };
  const idx = filled.map((_, i) => i);
  fill(idx); // forward: gaps take the previous value
  fill(idx.reverse()); // backward: leading gaps take the first value
  const v = filled.map((x) => x ?? 0.5);
  return v.map((_, i) => {
    const lo = Math.max(0, i - radius);
    const win = v.slice(lo, Math.min(v.length, i + radius + 1));
    return mean(win);
  });
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);

/**
 * Offsets in plane units (x: frame aspect wide, y: 1 high, y up), packed RGBA per frame for a
 * float DataTexture. `aspect` = frame width / height.
 */
export function anchorOffsets(
  stats: (SubjectStats | null)[],
  mode: 'none' | 'center' | 'ground',
  strength: number,
  aspect: number,
): Float32Array {
  const out = new Float32Array(stats.length * 4);
  if (mode === 'none' || !stats.some(Boolean)) return out;
  const xs = track(stats.map((s) => s?.cx ?? null));
  const ys = track(stats.map((s) => (s ? (mode === 'ground' ? s.bottom : s.cy) : null)));
  const tx = mean(xs);
  const ty = mean(ys);
  for (let i = 0; i < stats.length; i++) {
    out[i * 4] = (tx - xs[i]) * aspect * strength;
    out[i * 4 + 1] = -(ty - ys[i]) * strength; // image y down → world y up
  }
  return out;
}
