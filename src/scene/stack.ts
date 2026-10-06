// §5.3 — Time stacking: frame i sits on a plane at z = (i − center) × spacing.
// Ghost frames are a single instanced draw sampling a DataArrayTexture; the highlighted
// current frame is a second, opaque draw that writes depth so ghosts behind it are hidden.
import * as THREE from 'three';
import type { FrameStack } from '../io/decode';
import { intensityScale, type Params } from '../state';
import vert from './shaders/stack.vert?raw';
import frag from './shaders/stack.frag?raw';

/** Hex → sRGB triple; colors are blended in display space like the frame pixels. */
export function hexToVec3(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function arrayTexture(data: Uint8Array, w: number, h: number, depth: number, format: THREE.AnyPixelFormat) {
  const tex = new THREE.DataArrayTexture(data, w, h, depth);
  tex.format = format;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

function instancedPlane(count: number) {
  const plane = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = plane.index;
  g.setAttribute('position', plane.getAttribute('position'));
  g.setAttribute('uv', plane.getAttribute('uv'));
  const idx = new Float32Array(Math.max(1, count));
  idx.forEach((_, i) => (idx[i] = i));
  g.setAttribute('aIndex', new THREE.InstancedBufferAttribute(idx, 1));
  g.instanceCount = count;
  return g;
}

export class TimeStack {
  readonly group = new THREE.Group();
  count = 0;
  frameAspect = 1;
  spacing = 0.02; // effective world spacing after Intensity

  private uniforms = {
    uFrames: { value: null as THREE.DataArrayTexture | null },
    uMasks: { value: arrayTexture(new Uint8Array([255]), 1, 1, 1, THREE.RedFormat) },
    uUseMask: { value: 0 },
    uSize: { value: new THREE.Vector2(1, 1) },
    uCount: { value: 1 },
    uSpacing: { value: 0.02 },
    uCurrent: { value: 0 },
    uBuildUp: { value: 1 },
    uOpacity: { value: 0.15 },
    uFalloff: { value: 0.5 },
    uSkip: { value: -1 },
    uTint: { value: 0 },
    uTintStart: { value: new THREE.Vector3() },
    uTintEnd: { value: new THREE.Vector3() },
  };
  private ghostMat: THREE.ShaderMaterial;
  private heroMat: THREE.ShaderMaterial;
  private ghosts: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private hero: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private box: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  private drawAscending = true;
  private highlight = true;

  constructor() {
    const shared = { vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide };
    this.ghostMat = new THREE.ShaderMaterial({
      ...shared,
      uniforms: { ...this.uniforms, uHero: { value: 0 } },
      transparent: true,
      depthWrite: false,
    });
    this.heroMat = new THREE.ShaderMaterial({
      ...shared,
      uniforms: { ...this.uniforms, uHero: { value: 1 } },
    });
    this.ghosts = new THREE.Mesh(instancedPlane(0), this.ghostMat);
    this.hero = new THREE.Mesh(instancedPlane(1), this.heroMat);
    // Vertex shader displaces planes along z, so bounds from the base geometry are wrong.
    this.ghosts.frustumCulled = this.hero.frustumCulled = false;
    this.ghosts.renderOrder = 1;

    this.box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ transparent: true, opacity: 0.8 }),
    );
    this.box.visible = false;
    this.group.add(this.hero, this.ghosts, this.box);
    this.group.visible = false;
  }

  setFrames(fs: FrameStack) {
    this.uniforms.uFrames.value?.dispose();
    this.uniforms.uFrames.value = arrayTexture(fs.data, fs.width, fs.height, fs.count, THREE.RGBAFormat);
    this.count = fs.count;
    this.frameAspect = fs.width / fs.height;
    this.uniforms.uCount.value = fs.count;
    this.uniforms.uSize.value.set(this.frameAspect, 1);
    this.ghosts.geometry.dispose();
    this.ghosts.geometry = instancedPlane(fs.count);
    this.drawAscending = true;
    this.group.visible = true;
    this.layoutBox();
  }

  /** Push panel parameters into uniforms / material state. */
  apply(p: Params) {
    const k = intensityScale(p);
    const b = p.block;
    this.spacing = (b.spacing / 100) * k;
    this.uniforms.uSpacing.value = this.spacing;
    this.uniforms.uOpacity.value = Math.min(1, b.opacity * k);
    this.uniforms.uFalloff.value = b.falloff;
    this.uniforms.uBuildUp.value = p.camera.playback === 'buildup' ? 1 : 0;
    this.uniforms.uTint.value = b.colorOverTime ? 1 : 0;
    this.uniforms.uTintStart.value.copy(hexToVec3(b.colorStart));
    this.uniforms.uTintEnd.value.copy(hexToVec3(b.colorEnd));
    this.uniforms.uUseMask.value = p.canvas.sourceBg ? 0 : 1;
    this.ghostMat.blending = b.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.highlight = b.highlight;
    this.hero.visible = b.highlight;
    this.box.visible = b.bbox;
    this.box.material.color.set(b.bboxColor);
    this.layoutBox();
  }

  /** Per-frame state: playhead position and draw order for Normal blending. */
  update(current: number, camera: THREE.Camera) {
    const cur = Math.max(0, Math.min(this.count - 1, current));
    this.uniforms.uCurrent.value = cur;
    const heroIdx = Math.floor(cur + 1e-4);
    this.uniforms.uSkip.value = this.highlight ? heroIdx : -1;
    (this.hero.geometry.getAttribute('aIndex') as THREE.InstancedBufferAttribute).array[0] = heroIdx;
    this.hero.geometry.getAttribute('aIndex').needsUpdate = true;

    // Back-to-front instance order matters for Normal blending only, but is cheap to keep.
    const local = this.group.worldToLocal(camera.position.clone());
    const ascending = local.z >= 0;
    if (ascending !== this.drawAscending && this.count > 0) {
      this.drawAscending = ascending;
      const attr = this.ghosts.geometry.getAttribute('aIndex') as THREE.InstancedBufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < this.count; i++) arr[i] = ascending ? i : this.count - 1 - i;
      attr.needsUpdate = true;
    }
  }

  /** Extents of the full stack in local space, for camera fitting. */
  size() {
    return new THREE.Vector3(this.frameAspect, 1, Math.max(0, this.count - 1) * this.spacing);
  }

  private layoutBox() {
    const s = this.size();
    this.box.scale.set(s.x, s.y, Math.max(s.z, 1e-3));
  }
}
