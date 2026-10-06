import './style.css';
import * as THREE from 'three';
import { clamp01, outputSize, store } from './state';
import { openSource, type FrameStack, type VideoSource } from './io/decode';
import { defaultFileName, download, encodeSupport, exportQuality, exportVideo } from './io/exportMp4';
import type { MaskStack } from './vision/segment';
import { anchorOffsets, computeStats, type SubjectStats } from './vision/align';
import { TimeStack } from './scene/stack';
import { CameraRig } from './scene/camera';
import { Pip } from './scene/pip';
import { buildPanel } from './ui/panel';
import { Timeline } from './ui/timeline';
import { slider, toggle } from './ui/controls';
import { bindPresetMenu } from './ui/presets';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;

// ── Scene ───────────────────────────────────────────────────
const canvas = $<HTMLCanvasElement>('#gl');
const overlay = $<HTMLCanvasElement>('#overlay');
const overlayCtx = overlay.getContext('2d')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const gl = renderer.getContext() as WebGL2RenderingContext;
const MAX_LAYERS: number = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);

const scene = new THREE.Scene();
const stack = new TimeStack();
scene.add(stack.group);
const rig = new CameraRig(canvas);
rig.controls.addEventListener('start', () => store.set('camera.view', 'free'));
const pip = new Pip();

const refs = buildPanel($('#right'));
const timeline = new Timeline($('#timeline'));
toggle($('#tl-pip'), '원본 PIP', 'pip.enabled');

// ── Viewport: largest box of the output aspect that fits the stage (WYSIWYG) ──
const stage = $('#stage');
const viewport = $('#viewport');
function layout() {
  const { w, h } = outputSize(store.p.canvas);
  const pad = 32;
  const s = Math.min((stage.clientWidth - pad * 2) / w, (stage.clientHeight - pad * 2) / h);
  const vw = Math.max(1, Math.floor(w * s));
  const vh = Math.max(1, Math.floor(h * s));
  viewport.style.width = `${vw}px`;
  viewport.style.height = `${vh}px`;
  renderer.setSize(vw, vh, false);
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  rig.setAspect(w / h);
}
new ResizeObserver(() => !exporting && layout()).observe(stage);

let gradTex: THREE.CanvasTexture | null = null;
function applyBackground() {
  const c = store.p.canvas;
  gradTex?.dispose();
  gradTex = null;
  if (!c.gradient) {
    scene.background = new THREE.Color(c.bgColor);
    return;
  }
  const g = document.createElement('canvas');
  g.width = 2;
  g.height = 256;
  const ctx = g.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, c.gradTop);
  grad.addColorStop(1, c.gradBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  gradTex = new THREE.CanvasTexture(g);
  gradTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = gradTex;
}

// ── Progress overlay (one job at a time owns it) ────────────
const progressEl = $('#progress');
const progressBar = $('#progress-bar');
const progressLabel = $('#progress-label');
let progressOwner: AbortController | null = null;
const progress = {
  show(owner: AbortController, label: string) {
    progressOwner = owner;
    progressLabel.textContent = label;
    progressBar.style.width = '0%';
    progressEl.classList.remove('hidden');
  },
  set(owner: AbortController, r: number, label?: string) {
    if (owner !== progressOwner) return;
    progressBar.style.width = `${(r * 100).toFixed(1)}%`;
    if (label) progressLabel.textContent = label;
  },
  hide(owner: AbortController) {
    if (owner !== progressOwner) return;
    progressOwner = null;
    progressEl.classList.add('hidden');
  },
};
$('#progress-cancel').addEventListener('click', () => {
  progressOwner?.abort();
  if (progressOwner) progress.hide(progressOwner);
});

// ── Source panel ────────────────────────────────────────────
const fileInput = $<HTMLInputElement>('#file');
const srcInfo = $('#src-info');
const sampleInfo = $('#sample-info');
const t2 = (v: number) => `${v.toFixed(2)}s`;
const inCtl = slider($('#range-ctrls'), 'In', 'block.inT', { min: 0, max: 1, step: 0.01, fmt: t2 });
const outCtl = slider($('#range-ctrls'), 'Out', 'block.outT', { min: 0, max: 1, step: 0.01, fmt: t2 });
const matchFps = $<HTMLButtonElement>('#match-fps');

let source: VideoSource | null = null;
let fs: FrameStack | null = null;
let masks: MaskStack | null = null;
let stats: (SubjectStats | null)[] | null = null;
let sampleAbort: AbortController | null = null;
let sampling: Promise<unknown> | null = null;
let maskAbort: AbortController | null = null;
let fitOnNextSample = true;
let resampleTimer = 0;
let exporting = false;

function setStatus(msg: string, warn = false) {
  srcInfo.textContent = msg;
  srcInfo.classList.toggle('warn', warn);
  srcInfo.classList.remove('hidden');
}

/** Frame count that samples every source frame in [In, Out]. */
function sourceFrameCount() {
  if (!source?.fps) return 0;
  const { inT, outT } = store.p.block;
  return Math.round((outT - inT) * source.fps) + 1;
}

async function openFile(file: File) {
  if (!file.type.startsWith('video/') && !/\.(mp4|m4v|mov|webm)$/i.test(file.name)) {
    setStatus('영상 파일(MP4)만 지원합니다.', true);
    return;
  }
  sampleAbort?.abort();
  maskAbort?.abort();
  await sampling?.catch(() => {});
  source?.dispose();
  source = null;
  try {
    source = await openSource(file);
  } catch (e) {
    setStatus((e as Error).message, true);
    return;
  }
  const d = source.duration;
  setStatus(
    `${file.name}\n${source.width} × ${source.height} · ${d.toFixed(2)}s` +
      (source.fps ? ` · ${source.fps.toFixed(2)}fps` : '') +
      ` · ${(file.size / 1048576).toFixed(1)} MB\n디코더: ${source.decoder === 'webcodecs' ? 'WebCodecs' : '<video> 시크 (느림)'}`,
  );
  for (const c of [inCtl, outCtl]) {
    c.input.max = String(d);
    c.input.step = source.fps ? String(1 / source.fps) : '0.01';
  }
  store.set('block.inT', 0);
  store.set('block.outT', d);
  matchFps.classList.toggle('hidden', !source.fps);
  $('#range-section').classList.remove('hidden');
  fitOnNextSample = true;
  clearTimeout(resampleTimer);
  resample();
}

function scheduleResample() {
  clearTimeout(resampleTimer);
  resampleTimer = window.setTimeout(resample, 350);
}

async function resample() {
  if (!source) return;
  sampleAbort?.abort();
  maskAbort?.abort();
  await sampling?.catch(() => {}); // never run two decoders over the same source
  const ac = (sampleAbort = new AbortController());
  const b = store.p.block;
  const count = Math.min(b.frameCount, MAX_LAYERS);

  progress.show(ac, `Sampling ${count} frames…`);
  const job = source.sample({ inT: b.inT, outT: b.outT, count }, (r) => progress.set(ac, r), ac.signal);
  sampling = job;
  try {
    const next = await job;
    fs = next;
    masks = null;
    stats = null;
    stack.setFrames(next);
    pip.setFrames(next);
    stack.apply(store.p);
    if (fitOnNextSample) {
      fitOnNextSample = false;
      const view = store.p.camera.view;
      rig.fit(view === 'free' ? 'oblique' : view, stack.size());
      if (view === 'free') store.set('camera.view', 'oblique');
    }
    $('#empty').classList.add('hidden');
    $('#thumb-section').classList.remove('hidden');
    $('#thumbs').replaceChildren(...next.thumbs);
    const mb = next.data.byteLength / 1048576;
    const srcFrames = sourceFrameCount();
    sampleInfo.textContent =
      `${next.count} frames · ${next.width}×${next.height} · ${mb.toFixed(0)} MB` +
      (srcFrames ? `\n구간 내 원본 프레임 ${srcFrames}장` : '') +
      (next.downscaled ? '\n메모리 상한으로 작업 해상도를 낮췄습니다' : '') +
      (count < b.frameCount ? `\nGPU 한도로 ${count}프레임까지만 적층합니다` : '');
    sampleInfo.classList.toggle('warn', next.downscaled || count < b.frameCount);
    refreshExportState();
  } catch (e) {
    if ((e as Error).name !== 'AbortError') setStatus(`샘플링 실패: ${(e as Error).message}`, true);
    return;
  } finally {
    progress.hide(ac);
  }
  ensureMasks();
}

matchFps.addEventListener('click', () => {
  const n = sourceFrameCount();
  if (n) store.set('block.frameCount', Math.max(4, Math.min(600, n)));
});

// ── Masks & anchor ──────────────────────────────────────────
function needMasks() {
  const p = store.p;
  return !p.canvas.sourceBg || p.subject.anchor !== 'none' || (p.pip.enabled && p.pip.trackBox);
}

function refreshMaskNote() {
  const n = refs.maskNote;
  if (masks) n.textContent = `피사체 마스크 준비됨 (${masks.count}프레임)`;
  else if (maskAbort && !maskAbort.signal.aborted) n.textContent = '피사체 마스크 계산 중…';
  else if (!store.p.canvas.sourceBg && fs) n.textContent = '마스크가 없어 원본 프레임을 표시 중 — 토글을 다시 켜면 재계산';
  else n.textContent = 'Off: MediaPipe 마스크로 피사체만 남깁니다 (첫 전환 시 1회 계산).';
}

function updateOffsets() {
  const s = store.p.subject;
  stack.setOffsets(stats ? anchorOffsets(stats, s.anchor, s.anchorStrength, stack.frameAspect) : null);
}

async function ensureMasks() {
  if (!fs || masks || !needMasks() || (maskAbort && !maskAbort.signal.aborted)) return;
  const target = fs;
  const model = store.p.subject.model;
  const ac = (maskAbort = new AbortController());
  progress.show(ac, '피사체 마스크 준비 중…');
  refreshMaskNote();
  try {
    const { computeMasks } = await import('./vision/segment'); // MediaPipe loads on first use
    const m = await computeMasks(target, model, (r, label) => progress.set(ac, r, label), ac.signal);
    if (target !== fs || model !== store.p.subject.model) return; // stale result
    masks = m;
    stats = computeStats(m);
    stack.setMasks(m);
    updateOffsets();
    stack.apply(store.p);
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      console.error(e);
      setStatus(`마스크 계산 실패: ${(e as Error).message}`, true);
    }
  } finally {
    progress.hide(ac);
    ac.abort(); // mark finished so a later ensureMasks() may start
    refreshMaskNote();
  }
}

// ── Rendering (shared by preview and export, deterministic in t) ──
function playhead(t: number) {
  const p = store.p;
  const u = clamp01(t / p.export.duration);
  const n = Math.max(0, stack.count - 1);
  const build = p.camera.playback === 'buildup' ? clamp01(t / p.camera.buildTime) : u;
  return { u, cur: build * n };
}

function renderAt(t: number) {
  const { u, cur } = playhead(t);
  const restore = rig.animate(u, store.p, stack.group);
  stack.group.updateMatrixWorld();
  stack.update(cur, rig.camera);
  renderer.render(scene, rig.camera);
  restore();
  return cur;
}

function previewLoop() {
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    timeline.tick(dt);
    rig.controls.update();
    const cur = renderAt(timeline.t);
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    pip.draw(overlayCtx, overlay.width, overlay.height, store.p, cur, stats);
  });
}

// ── Export (§7) ─────────────────────────────────────────────
const exportButtons = [$<HTMLButtonElement>('#export-btn'), refs.exportBtn];
let supportTimer = 0;

function refreshExportState() {
  clearTimeout(supportTimer);
  supportTimer = window.setTimeout(async () => {
    const p = store.p;
    const { w, h } = outputSize(p.canvas);
    const sup = await encodeSupport(w, h, p.export.fps);
    const mp4Opt = [...refs.formatSelect.options].find((o) => o.value === 'mp4')!;
    mp4Opt.disabled = !!sup.mp4;
    const frames = Math.round(p.export.duration * p.export.fps);
    const reason = sup[p.export.format];
    const fallback = p.export.format === 'mp4' && reason && !sup.webm;
    refs.exportNote.textContent = reason
      ? fallback
        ? `${reason} → WebM으로 대체 출력합니다`
        : reason
      : `${w}×${h} · ${p.export.fps}fps · ${p.export.duration.toFixed(1)}s · ${frames}프레임`;
    refs.exportNote.classList.toggle('warn', !!reason);
    const blocked = !!reason && !fallback;
    for (const b of exportButtons) {
      b.disabled = !fs || exporting || blocked;
      b.title = blocked ? reason : !fs ? '먼저 영상을 불러오세요' : '';
    }
  }, 120);
}

async function runExport() {
  if (!fs || exporting) return;
  const p = store.p;
  const { w, h } = outputSize(p.canvas);
  const sup = await encodeSupport(w, h, p.export.fps);
  let format = p.export.format;
  if (sup[format]) {
    if (format === 'mp4' && !sup.webm) format = 'webm';
    else return refreshExportState();
  }
  let name = p.export.fileName || defaultFileName(format);
  name = name.replace(/\.(mp4|webm)$/i, '') + `.${format}`;

  exporting = true;
  document.body.classList.add('busy');
  timeline.playing = false;
  renderer.setAnimationLoop(null);
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  const ratio = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  rig.setAspect(w / h);

  const ac = new AbortController();
  progress.show(ac, 'Encoding…');
  const t0 = performance.now();
  try {
    const blob = await exportVideo({
      width: w,
      height: h,
      fps: p.export.fps,
      duration: p.export.duration,
      format,
      quality: exportQuality(p.export),
      renderFrame: (t, ctx) => {
        const cur = renderAt(t);
        ctx.drawImage(renderer.domElement, 0, 0, w, h); // same task as render: buffer still valid
        pip.draw(ctx, w, h, p, cur, stats);
      },
      onProgress: (k, n, eta) =>
        progress.set(ac, k / n, `Encoding ${Math.round((k / n) * 100)}% · ${k}/${n} · 남은 시간 ${Math.ceil(eta)}s`),
      signal: ac.signal,
    });
    download(blob, name);
    refs.exportNote.textContent = `완료: ${name} · ${(blob.size / 1048576).toFixed(1)} MB · ${((performance.now() - t0) / 1000).toFixed(1)}s`;
    refs.exportNote.classList.remove('warn');
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      console.error(e);
      refs.exportNote.textContent = `내보내기 실패: ${(e as Error).message}`;
      refs.exportNote.classList.add('warn');
    } else {
      refs.exportNote.textContent = '내보내기를 취소했습니다';
    }
  } finally {
    progress.hide(ac);
    renderer.setPixelRatio(ratio);
    exporting = false;
    document.body.classList.remove('busy');
    layout();
    previewLoop();
    setTimeout(refreshExportState, 1500); // keep the completion note readable briefly
  }
}
for (const b of exportButtons) b.addEventListener('click', runExport);

// ── File input & drag-and-drop ──────────────────────────────
fileInput.addEventListener('change', () => fileInput.files?.[0] && openFile(fileInput.files[0]));
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (++dragDepth === 1) document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => {
  if (--dragDepth === 0) document.body.classList.remove('dragging');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const f = e.dataTransfer?.files[0];
  if (f && !exporting) openFile(f);
});

bindPresetMenu($<HTMLSelectElement>('#preset'), (msg) => setStatus(msg, true));

// ── Store → scene ───────────────────────────────────────────
store.on((path) => {
  const p = store.p;
  if (/^canvas\.(aspect|custom|resolution)/.test(path)) layout();
  if (/^canvas\.(bgColor|grad)/.test(path)) applyBackground();
  if (path === 'camera.projection' || path === 'camera.fov') rig.setProjection(p.camera.projection, p.camera.fov);
  if (path === 'camera.view' && p.camera.view !== 'free' && stack.count) rig.fit(p.camera.view, stack.size());

  // Clip range: keep In < Out inside the source.
  const dur = source?.duration ?? Infinity;
  if (path === 'block.outT' && p.block.outT > dur) store.set('block.outT', dur);
  if (path === 'block.inT' && p.block.inT > p.block.outT - 0.05) store.set('block.outT', Math.min(dur, p.block.inT + 0.05));
  if (path === 'block.outT' && p.block.outT < p.block.inT + 0.05) store.set('block.inT', Math.max(0, p.block.outT - 0.05));
  if (/^block\.(inT|outT)$|^export\.durationAuto$/.test(path) && p.export.durationAuto) {
    store.set('export.duration', Math.round(Math.min(60, Math.max(1, p.block.outT - p.block.inT)) * 10) / 10);
  }
  if (/^export\.duration$|^camera\.buildAuto$/.test(path) && p.camera.buildAuto) {
    store.set('camera.buildTime', Math.min(60, p.export.duration));
  }
  if (path === 'block.frameCount' || (/^block\.(inT|outT)$/.test(path) && source)) scheduleResample();

  if (path === 'subject.model' && masks) {
    masks = null;
    stats = null;
    stack.setMasks(null);
    updateOffsets();
  }
  if (/^subject\.anchor/.test(path)) updateOffsets();
  if (/^(canvas\.sourceBg|subject\.|pip\.(enabled|trackBox))/.test(path)) {
    ensureMasks();
    refreshMaskNote();
  }
  if (/^(canvas\.(aspect|custom|resolution)|export\.)/.test(path)) refreshExportState();

  stack.apply(p);
});

// ── Start ───────────────────────────────────────────────────
layout();
applyBackground();
stack.apply(store.p);
refreshMaskNote();
refreshExportState();
previewLoop();

// Dev handle for debugging in the console.
Object.assign(window, { __tb: { store, stack, rig, renderer, openFile, runExport } });
