// §6 — Right-side parameter panel: Canvas · Time Block · Camera · Export.
import { outputSize, store } from '../state';
import { bind, color, disable, note, number, section, seg, select, showIf, slider, text, toggle } from './controls';

const f2 = (v: number) => v.toFixed(2);
const p = () => store.p;

export function buildPanel(root: HTMLElement) {
  // ── Canvas ────────────────────────────────────────────────
  const c = section(root, 'Canvas');
  select(c, 'Aspect', 'canvas.aspect', [
    ['16:9', '16:9 가로'],
    ['9:16', '9:16 세로'],
    ['1:1', '1:1 정사각'],
    ['4:5', '4:5'],
    ['21:9', '21:9 와이드'],
    ['custom', 'Custom'],
  ]);
  const cw = number(c, 'Width', 'canvas.customW', 256, 4096, 'px');
  const ch = number(c, 'Height', 'canvas.customH', 256, 4096, 'px');
  showIf(cw.row, () => p().canvas.aspect === 'custom');
  showIf(ch.row, () => p().canvas.aspect === 'custom');
  const res = select(c, 'Resolution', 'canvas.resolution', [
    ['720', '720p'],
    ['1080', '1080p'],
    ['1440', '1440p'],
    ['2160', '2160p'],
  ]);
  showIf(res.row, () => p().canvas.aspect !== 'custom');
  const outInfo = note(c, 'note mono');
  bind(() => {
    const { w, h } = outputSize(p().canvas);
    outInfo.textContent = `출력 ${w} × ${h} px`;
  });
  color(c, 'Background', 'canvas.bgColor');
  toggle(c, 'Background gradient', 'canvas.gradient');
  const gt = color(c, 'Top', 'canvas.gradTop');
  const gb = color(c, 'Bottom', 'canvas.gradBottom');
  showIf(gt.row, () => p().canvas.gradient);
  showIf(gb.row, () => p().canvas.gradient);
  const srcBg = toggle(c, 'Source background', 'canvas.sourceBg');
  disable(srcBg.row, '배경 Off(피사체 분리)는 M4에서 연결됩니다');

  // ── Time Block ────────────────────────────────────────────
  const b = section(root, 'Time Block');
  slider(b, 'Intensity', 'block.intensity', { min: 0, max: 1, step: 0.01, fmt: f2 });
  slider(b, 'Frames', 'block.frameCount', { min: 4, max: 300, step: 1 });
  slider(b, 'Spacing', 'block.spacing', { min: 0, max: 50, step: 0.1, fmt: (v) => `${v.toFixed(1)}%` });
  slider(b, 'Opacity', 'block.opacity', { min: 0, max: 1, step: 0.01, fmt: f2 });
  slider(b, 'Falloff', 'block.falloff', { min: 0, max: 1, step: 0.01, fmt: f2 });
  seg(b, 'Blend', 'block.blend', [
    ['normal', 'Normal'],
    ['additive', 'Additive'],
  ]);
  toggle(b, 'Color over time', 'block.colorOverTime');
  const cs = color(b, 'Start', 'block.colorStart');
  const ce = color(b, 'End', 'block.colorEnd');
  showIf(cs.row, () => p().block.colorOverTime);
  showIf(ce.row, () => p().block.colorOverTime);
  const feather = slider(b, 'Feather', 'block.feather', { min: 0, max: 20, step: 1, fmt: (v) => `${v}px` });
  disable(feather.row, '배경 Off 전용 — M4에서 연결됩니다');
  toggle(b, 'Highlight current', 'block.highlight');
  toggle(b, 'Bounding box', 'block.bbox');
  const bc = color(b, 'Box color', 'block.bboxColor');
  showIf(bc.row, () => p().block.bbox);

  // ── Camera ────────────────────────────────────────────────
  const cam = section(root, 'Camera');
  seg(cam, 'Projection', 'camera.projection', [
    ['perspective', 'Persp'],
    ['orthographic', 'Ortho'],
  ]);
  const fov = slider(cam, 'FOV', 'camera.fov', { min: 15, max: 90, step: 1, fmt: (v) => `${v}°` });
  showIf(fov.row, () => p().camera.projection === 'perspective');
  select(cam, 'View', 'camera.view', [
    ['front', '정면'],
    ['side', '측면'],
    ['oblique', '사선 45°'],
    ['top', '탑'],
    ['free', '자유'],
  ]);
  select(cam, 'Animation', 'camera.animation', [
    ['none', 'None'],
    ['orbit', 'Orbit'],
    ['dolly', 'Dolly'],
    ['orbit+dolly', 'Orbit + Dolly'],
  ]);
  const orbit = slider(cam, 'Orbit angle', 'camera.orbitAngle', { min: 0, max: 360, step: 1, fmt: (v) => `${v}°` });
  showIf(orbit.row, () => p().camera.animation.includes('orbit'));
  seg(cam, 'Playback', 'camera.playback', [
    ['buildup', 'Build-up'],
    ['static', 'Static'],
  ]);

  // ── Export ────────────────────────────────────────────────
  const ex = section(root, 'Export');
  select(ex, 'Format', 'export.format', [
    ['mp4', 'MP4 (H.264)'],
    ['webm', 'WebM'],
  ]);
  seg(ex, 'FPS', 'export.fps', [
    [24, '24'],
    [30, '30'],
    [60, '60'],
  ]);
  slider(ex, 'Duration', 'export.duration', {
    min: 1,
    max: 60,
    step: 0.1,
    fmt: (v) => `${v.toFixed(1)}s`,
    onUser: () => store.set('export.durationAuto', false),
  });
  select(ex, 'Bitrate', 'export.bitrate', [
    ['low', 'Low'],
    ['medium', 'Medium'],
    ['high', 'High'],
    ['custom', 'Custom'],
  ]);
  const mbps = number(ex, 'Mbps', 'export.customMbps', 1, 200);
  showIf(mbps.row, () => p().export.bitrate === 'custom');
  text(ex, 'File name', 'export.fileName', 'timeblock_YYYYMMDD_HHMM.mp4');
}
