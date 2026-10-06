// §6 — Right-side parameter panel: Canvas · Time Block · Subject · Camera · PIP · Export.
import { outputSize, store } from '../state';
import { bind, color, el, note, number, section, seg, select, showIf, slider, subhead, text, toggle } from './controls';

const f2 = (v: number) => v.toFixed(2);
const deg = (v: number) => `${v}°`;
const sec = (v: number) => `${v.toFixed(1)}s`;
const p = () => store.p;

export interface PanelRefs {
  maskNote: HTMLElement;
  exportNote: HTMLElement;
  exportBtn: HTMLButtonElement;
  formatSelect: HTMLSelectElement;
}

export function buildPanel(root: HTMLElement): PanelRefs {
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
  toggle(c, 'Source background', 'canvas.sourceBg');
  const maskNote = note(c, 'note');

  // ── Time Block ────────────────────────────────────────────
  const b = section(root, 'Time Block');
  slider(b, 'Intensity', 'block.intensity', { min: 0, max: 1, step: 0.01, fmt: f2 });
  slider(b, 'Frames', 'block.frameCount', { min: 4, max: 600, step: 1 });
  slider(b, 'Interpolate', 'block.subframes', { min: 1, max: 8, step: 1, fmt: (v) => `×${v}` });
  const sliceInfo = note(b, 'note mono');
  bind(() => {
    const n = p().block.frameCount;
    const s = p().block.subframes;
    sliceInfo.textContent = `슬라이스 ${(n - 1) * s + 1}장 (프레임 사이 ${s - 1}장 보간)`;
  });
  slider(b, 'Spacing', 'block.spacing', { min: 0, max: 50, step: 0.1, fmt: (v) => `${v.toFixed(1)}%` });
  seg(b, 'Blend', 'block.blend', [
    ['normal', 'Normal'],
    ['additive', 'Additive'],
  ]);

  subhead(b, 'Opacity');
  slider(b, 'Opacity', 'block.opacity', { min: 0, max: 1, step: 0.01, fmt: f2 });
  slider(b, 'Falloff', 'block.falloff', { min: 0, max: 1, step: 0.01, fmt: f2 });
  slider(b, 'Curve', 'block.falloffCurve', { min: 0.2, max: 4, step: 0.05, fmt: f2 });
  slider(b, 'Int→Opacity', 'block.intensityToOpacity', { min: 0, max: 1, step: 0.01, fmt: f2 });
  slider(b, 'Int→Spacing', 'block.intensityToSpacing', { min: 0, max: 1, step: 0.01, fmt: f2 });

  subhead(b, 'Current frame');
  toggle(b, 'Highlight current', 'block.highlight');
  const ho = slider(b, 'Opacity', 'block.heroOpacity', { min: 0, max: 1, step: 0.01, fmt: f2 });
  const hf = toggle(b, 'Keep its background', 'block.heroFullFrame');
  showIf(ho.row, () => p().block.highlight);
  showIf(hf.row, () => p().block.highlight && !p().canvas.sourceBg);

  subhead(b, 'Look');
  toggle(b, 'Color over time', 'block.colorOverTime');
  const cs = color(b, 'Start', 'block.colorStart');
  const ce = color(b, 'End', 'block.colorEnd');
  showIf(cs.row, () => p().block.colorOverTime);
  showIf(ce.row, () => p().block.colorOverTime);
  toggle(b, 'Bounding box', 'block.bbox');
  const bc = color(b, 'Box color', 'block.bboxColor');
  showIf(bc.row, () => p().block.bbox);

  // ── Subject (mask · anchor) ───────────────────────────────
  const s = section(root, 'Subject');
  select(s, 'Model', 'subject.model', [
    ['general', 'General (DeepLab v3)'],
    ['person', 'Person (Selfie multiclass)'],
  ]);
  slider(s, 'Feather', 'block.feather', { min: 0, max: 20, step: 1, fmt: (v) => `${v}px` });
  select(s, 'Anchor', 'subject.anchor', [
    ['none', 'None'],
    ['center', 'Subject center'],
    ['ground', 'Ground'],
  ]);
  const as = slider(s, 'Strength', 'subject.anchorStrength', { min: 0, max: 1, step: 0.01, fmt: f2 });
  showIf(as.row, () => p().subject.anchor !== 'none');
  note(s).textContent = '배경 Off · Anchor · 추적 박스를 처음 켤 때 마스크를 한 번 계산합니다.';

  // ── Camera ────────────────────────────────────────────────
  const cam = section(root, 'Camera');
  seg(cam, 'Projection', 'camera.projection', [
    ['perspective', 'Persp'],
    ['orthographic', 'Ortho'],
  ]);
  const fov = slider(cam, 'FOV', 'camera.fov', { min: 15, max: 90, step: 1, fmt: deg });
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
  const orbitRows = [
    slider(cam, 'Orbit start', 'camera.orbitStart', { min: -180, max: 180, step: 1, fmt: deg }).row,
    slider(cam, 'Orbit angle', 'camera.orbitAngle', { min: 0, max: 360, step: 1, fmt: deg }).row,
    seg(cam, 'Direction', 'camera.orbitDir', [
      ['ccw', '↺ CCW'],
      ['cw', '↻ CW'],
    ]).row,
    seg(cam, 'Easing', 'camera.orbitEase', [
      ['linear', 'Linear'],
      ['ease', 'Ease'],
    ]).row,
  ];
  orbitRows.forEach((r) => showIf(r, () => p().camera.animation.includes('orbit')));
  const dollyRows = [
    slider(cam, 'Dolly from', 'camera.dollyFrom', { min: 0.3, max: 2, step: 0.01, fmt: (v) => `×${v.toFixed(2)}` }).row,
    slider(cam, 'Dolly to', 'camera.dollyTo', { min: 0.3, max: 2, step: 0.01, fmt: (v) => `×${v.toFixed(2)}` }).row,
  ];
  dollyRows.forEach((r) => showIf(r, () => p().camera.animation.includes('dolly')));
  seg(cam, 'Playback', 'camera.playback', [
    ['buildup', 'Build-up'],
    ['static', 'Static'],
  ]);
  const bt = slider(cam, 'Build-up', 'camera.buildTime', {
    min: 0.5,
    max: 60,
    step: 0.1,
    fmt: sec,
    onUser: () => store.set('camera.buildAuto', false),
  });
  const btNote = note(cam, 'note');
  showIf(bt.row, () => p().camera.playback === 'buildup');
  bind(() => {
    const { buildTime, buildAuto, playback } = p().camera;
    const dur = p().export.duration;
    btNote.classList.toggle('hidden', playback !== 'buildup');
    btNote.classList.toggle('warn', buildTime > dur);
    btNote.textContent =
      buildTime > dur
        ? `Duration(${dur.toFixed(1)}s)보다 길어 끝까지 완성되지 않습니다`
        : `${buildTime.toFixed(1)}s에 완성 후 ${(dur - buildTime).toFixed(1)}s 유지${buildAuto ? ' · Duration 연동' : ''}`;
  });

  // ── PIP ───────────────────────────────────────────────────
  const pip = section(root, 'Source PIP');
  toggle(pip, 'Show source', 'pip.enabled');
  const pipRows = [
    seg(pip, 'Corner', 'pip.corner', [
      ['tl', '↖'],
      ['tr', '↗'],
      ['bl', '↙'],
      ['br', '↘'],
    ]).row,
    slider(pip, 'Size', 'pip.size', { min: 0.12, max: 0.6, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` }).row,
    toggle(pip, 'Tracking box', 'pip.trackBox').row,
  ];
  pipRows.forEach((r) => showIf(r, () => p().pip.enabled));
  const pc = color(pip, 'Box color', 'pip.boxColor');
  showIf(pc.row, () => p().pip.enabled && p().pip.trackBox);

  // ── Export ────────────────────────────────────────────────
  const ex = section(root, 'Export');
  const fmt = select(ex, 'Format', 'export.format', [
    ['mp4', 'MP4 (H.264)'],
    ['webm', 'WebM (VP9)'],
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
    fmt: sec,
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
  const exportNote = note(ex, 'note');
  const exportBtn = el('button', 'btn btn--accent btn--block', ex);
  exportBtn.type = 'button';
  exportBtn.textContent = 'Export ▶';

  return { maskNote, exportNote, exportBtn, formatSelect: fmt.input };
}
