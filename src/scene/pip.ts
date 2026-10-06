// P1 #10 — Source picture-in-picture with a subject tracking box (reference #3).
// Drawn with Canvas 2D on top of the 3D frame; the same call serves preview and export.
import type { FrameStack } from '../io/decode';
import type { SubjectStats } from '../vision/align';
import type { Params } from '../state';

export class Pip {
  private frame = document.createElement('canvas');
  private frameIdx = -1;
  private fs: FrameStack | null = null;

  setFrames(fs: FrameStack | null) {
    this.fs = fs;
    this.frameIdx = -1;
    if (fs) {
      this.frame.width = fs.width;
      this.frame.height = fs.height;
    }
  }

  /** Draw onto a W×H context for playhead `cur` (fractional sampled-frame index). */
  draw(ctx: CanvasRenderingContext2D, W: number, H: number, p: Params, cur: number, stats: (SubjectStats | null)[] | null) {
    const fs = this.fs;
    if (!p.pip.enabled || !fs) return;
    const idx = Math.max(0, Math.min(fs.count - 1, Math.round(cur)));
    if (idx !== this.frameIdx) {
      const px = fs.width * fs.height * 4;
      const img = new ImageData(new Uint8ClampedArray(fs.data.buffer, fs.data.byteOffset + idx * px, px), fs.width, fs.height);
      this.frame.getContext('2d')!.putImageData(img, 0, 0);
      this.frameIdx = idx;
    }

    const unit = Math.min(W, H);
    const margin = Math.round(unit * 0.04);
    let w = W * p.pip.size;
    let h = (w * fs.height) / fs.width;
    if (h > H * 0.5) {
      h = H * 0.5;
      w = (h * fs.width) / fs.height;
    }
    const x = p.pip.corner.endsWith('l') ? margin : W - margin - w;
    const y = p.pip.corner.startsWith('t') ? margin : H - margin - h;

    ctx.save();
    ctx.drawImage(this.frame, x, y, w, h);
    ctx.lineWidth = Math.max(1, unit / 540);
    ctx.strokeStyle = 'rgba(242,240,235,0.6)';
    ctx.strokeRect(x, y, w, h);

    const s = stats?.[idx];
    if (p.pip.trackBox && s) {
      const bx = x + s.x0 * w;
      const by = y + s.y0 * h;
      ctx.lineWidth = Math.max(1.5, unit / 400);
      ctx.strokeStyle = p.pip.boxColor;
      ctx.strokeRect(bx, by, (s.x1 - s.x0) * w, (s.y1 - s.y0) * h);
      ctx.fillStyle = p.pip.boxColor;
      ctx.font = `600 ${Math.max(9, Math.round(unit / 60))}px ui-monospace, Menlo, monospace`;
      ctx.textBaseline = 'bottom';
      ctx.fillText(`SUBJECT  t=${fs.times[idx].toFixed(2)}s`, bx, Math.max(y + 12, by - 3));
    }
    ctx.restore();
  }
}
