import './style.css';
import * as THREE from 'three';
import { outputSize, store } from './state';
import { loadVideo, sampleFrames } from './io/decode';
import { TimeStack } from './scene/stack';
import { CameraRig } from './scene/camera';
import { buildPanel } from './ui/panel';
import { Timeline } from './ui/timeline';
import { slider } from './ui/controls';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;

// ── Scene ───────────────────────────────────────────────────
const canvas = $<HTMLCanvasElement>('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const gl = renderer.getContext() as WebGL2RenderingContext;
const MAX_LAYERS: number = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);

const scene = new THREE.Scene();
const stack = new TimeStack();
scene.add(stack.group);
const rig = new CameraRig(canvas);
rig.controls.addEventListener('start', () => store.set('camera.view', 'free'));

buildPanel($('#right'));
const timeline = new Timeline($('#timeline'));

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
  rig.setAspect(w / h);
}
new ResizeObserver(layout).observe(stage);

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

// ── Source panel ────────────────────────────────────────────
const fileInput = $<HTMLInputElement>('#file');
const srcInfo = $('#src-info');
const sampleInfo = $('#sample-info');
const progress = $('#progress');
const progressBar = $('#progress-bar');
const progressLabel = $('#progress-label');
const t2 = (v: number) => `${v.toFixed(2)}s`;
const inCtl = slider($('#range-ctrls'), 'In', 'block.inT', { min: 0, max: 1, step: 0.01, fmt: t2 });
const outCtl = slider($('#range-ctrls'), 'Out', 'block.outT', { min: 0, max: 1, step: 0.01, fmt: t2 });

let video: HTMLVideoElement | null = null;
let abort: AbortController | null = null;
let running: Promise<unknown> | null = null;
let fitOnNextSample = true;
let resampleTimer = 0;

function setStatus(msg: string, warn = false) {
  srcInfo.textContent = msg;
  srcInfo.classList.toggle('warn', warn);
  srcInfo.classList.remove('hidden');
}

async function openFile(file: File) {
  if (!file.type.startsWith('video/') && !/\.(mp4|m4v|mov|webm)$/i.test(file.name)) {
    setStatus('영상 파일(MP4)만 지원합니다.', true);
    return;
  }
  abort?.abort();
  if (video) URL.revokeObjectURL(video.src);
  try {
    video = await loadVideo(file);
  } catch (e) {
    video = null;
    setStatus((e as Error).message, true);
    return;
  }
  const d = video.duration;
  setStatus(
    `${file.name}\n${video.videoWidth} × ${video.videoHeight} · ${d.toFixed(2)}s · ${(file.size / 1048576).toFixed(1)} MB`,
  );
  for (const c of [inCtl, outCtl]) c.input.max = String(d);
  store.set('block.inT', 0);
  store.set('block.outT', d);
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
  if (!video) return;
  abort?.abort();
  await running?.catch(() => {}); // never let two samplers seek the same <video>
  const ac = (abort = new AbortController());
  const b = store.p.block;
  const count = Math.min(b.frameCount, MAX_LAYERS);

  progress.classList.remove('hidden');
  progressLabel.textContent = `Sampling ${count} frames…`;
  progressBar.style.width = '0%';
  const job = sampleFrames(
    video,
    { inT: b.inT, outT: b.outT, count },
    (r) => (progressBar.style.width = `${(r * 100).toFixed(1)}%`),
    ac.signal,
  );
  running = job;
  try {
    const fs = await job;
    stack.setFrames(fs);
    stack.apply(store.p);
    if (fitOnNextSample) {
      fitOnNextSample = false;
      const view = store.p.camera.view;
      rig.fit(view === 'free' ? 'oblique' : view, stack.size());
      if (view === 'free') store.set('camera.view', 'oblique');
    }
    $('#empty').classList.add('hidden');
    $('#thumb-section').classList.remove('hidden');
    $('#thumbs').replaceChildren(...fs.thumbs);
    const mb = fs.data.byteLength / 1048576;
    sampleInfo.textContent =
      `${fs.count} frames · ${fs.width}×${fs.height} · ${mb.toFixed(0)} MB` +
      (fs.downscaled ? '\n메모리 상한으로 작업 해상도를 낮췄습니다' : '') +
      (count < b.frameCount ? `\nGPU 한도로 ${count}프레임까지만 적층합니다` : '');
    sampleInfo.classList.toggle('warn', fs.downscaled || count < b.frameCount);
  } catch (e) {
    if ((e as Error).name !== 'AbortError') setStatus(`샘플링 실패: ${(e as Error).message}`, true);
  } finally {
    if (abort === ac) progress.classList.add('hidden');
  }
}

$('#progress-cancel').addEventListener('click', () => {
  abort?.abort();
  progress.classList.add('hidden');
});

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
  if (f) openFile(f);
});

// ── Store → scene ───────────────────────────────────────────
store.on((path) => {
  const p = store.p;
  if (/^canvas\.(aspect|custom|resolution)/.test(path)) layout();
  if (/^canvas\.(bgColor|grad)/.test(path)) applyBackground();
  if (path === 'camera.projection' || path === 'camera.fov') rig.setProjection(p.camera.projection, p.camera.fov);
  if (path === 'camera.view' && p.camera.view !== 'free' && stack.count) rig.fit(p.camera.view, stack.size());

  if (path === 'block.inT' && p.block.inT > p.block.outT - 0.05) store.set('block.outT', p.block.inT + 0.05);
  if (path === 'block.outT' && p.block.outT < p.block.inT + 0.05) store.set('block.inT', Math.max(0, p.block.outT - 0.05));
  if ((path === 'block.inT' || path === 'block.outT' || path === 'export.durationAuto') && p.export.durationAuto) {
    store.set('export.duration', Math.round(Math.min(60, Math.max(1, p.block.outT - p.block.inT)) * 10) / 10);
  }
  if (path === 'block.frameCount' || ((path === 'block.inT' || path === 'block.outT') && video)) scheduleResample();

  stack.apply(p);
});

// ── Loop ────────────────────────────────────────────────────
layout();
applyBackground();
stack.apply(store.p);
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  timeline.tick(dt);
  rig.controls.update();
  const u = timeline.u;
  const restore = rig.animate(u, store.p, stack.group);
  stack.group.updateMatrixWorld();
  stack.update(u * Math.max(0, stack.count - 1), rig.camera);
  renderer.render(scene, rig.camera);
  restore();
});

// Dev handle for debugging in the console.
Object.assign(window, { __tb: { store, stack, rig, renderer, openFile } });
