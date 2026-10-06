// §5.3 — Time stacking: sampled frame i sits at z = (i − center) × spacing, with `subframes`
// interpolated slices between neighbours so the volume reads as continuous.
// Ghost slices are one instanced draw over a DataArrayTexture; the highlighted current frame is a
// second draw that (when fully opaque) writes depth so ghosts behind it are hidden.
import * as THREE from 'three';
import type { FrameStack } from '../io/decode';
import type { MaskStack } from '../vision/segment';
import { intensityScales, type Params } from '../state';
import vert from './shaders/stack.vert?raw';
import frag from './shaders/stack.frag?raw';

/** Hex → sRGB triple; colors are blended in display space like the frame pixels. */
export function hexToVec3(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function arrayTexture(data: Uint8Array, w: number, h: number, depth: number, format: THREE.AnyPixelFormat, mips = false) {
  const tex = new THREE.DataArrayTexture(data, w, h, depth);
  tex.format = format;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = mips;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

function offsetTexture(data: Float32Array, count: number) {
  const tex = new THREE.DataTexture(data, Math.max(1, count), 1, THREE.RGBAFormat, THREE.FloatType);
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
  spacing = 0.01; // effective world spacing per sampled frame, after Intensity
  masksReady = false;

  private uniforms = {
    uFrames: { value: null as THREE.DataArrayTexture | null },
    uMasks: { value: arrayTexture(new Uint8Array([255]), 1, 1, 1, THREE.RedFormat) },
    uOffsets: { value: offsetTexture(new Float32Array(4), 1) },
    uUseMask: { value: 0 },
    uFeather: { value: 4 },
    uSize: { value: new THREE.Vector2(1, 1) },
    uCount: { value: 1 },
    uSub: { value: 1 },
    uSpacing: { value: 0.01 },
    uCurrent: { value: 0 },
    uBuildUp: { value: 1 },
    uOpacity: { value: 0.15 },
    uFalloff: { value: 0.5 },
    uCurve: { value: 1 },
    uHeroOpacity: { value: 1 },
    uHeroFull: { value: 0 },
    uSkip: { value: 1 },
    uTint: { value: 0 },
    uTintStart: { value: new THREE.Vector3() },
    uTintEnd: { value: new THREE.Vector3() },
  };
  private ghostMat: THREE.ShaderMaterial;
  private heroMat: THREE.ShaderMaterial;
  private ghosts: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private hero: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private box: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  private sub = 1;
  private slices = 0;
  private drawAscending = true;

  constructor() {
    const shared = { vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide, transparent: true };
    this.ghostMat = new THREE.ShaderMaterial({ ...shared, uniforms: { ...this.uniforms, uHero: { value: 0 } }, depthWrite: false });
    this.heroMat = new THREE.ShaderMaterial({ ...shared, uniforms: { ...this.uniforms, uHero: { value: 1 } } });
    this.ghosts = new THREE.Mesh(instancedPlane(0), this.ghostMat);
    this.hero = new THREE.Mesh(instancedPlane(1), this.heroMat);
    // Vertex shader displaces planes along z, so bounds from the base geometry are wrong.
    this.ghosts.frustumCulled = this.hero.frustumCulled = false;
    this.ghosts.renderOrder = 1;

    this.box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ transparent: true, opacity: 0.8 }),
    );
    this.box.renderOrder = 3;
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
    this.setMasks(null);
    this.setOffsets(null);
    this.slices = -1; // force geometry rebuild in apply()
    this.group.visible = true;
  }

  setMasks(m: MaskStack | null) {
    this.uniforms.uMasks.value.dispose();
    this.uniforms.uMasks.value = m
      ? arrayTexture(m.data, m.width, m.height, m.count, THREE.RedFormat, true)
      : arrayTexture(new Uint8Array([255]), 1, 1, 1, THREE.RedFormat);
    this.masksReady = !!m;
  }

  /** Anchor offsets, RGBA float per sampled frame (see vision/align.ts). */
  setOffsets(data: Float32Array | null) {
    this.uniforms.uOffsets.value.dispose();
    this.uniforms.uOffsets.value = offsetTexture(data ?? new Float32Array(this.count * 4 || 4), this.count);
  }

  /** Push panel parameters into uniforms / material state. */
  apply(p: Params) {
    const k = intensityScales(p);
    const b = p.block;
    this.spacing = (b.spacing / 100) * k.spacing;
    const u = this.uniforms;
    u.uSpacing.value = this.spacing;
    u.uOpacity.value = Math.min(1, b.opacity * k.opacity);
    u.uFalloff.value = b.falloff;
    u.uCurve.value = b.falloffCurve;
    u.uBuildUp.value = p.camera.playback === 'buildup' ? 1 : 0;
    u.uTint.value = b.colorOverTime ? 1 : 0;
    u.uTintStart.value.copy(hexToVec3(b.colorStart));
    u.uTintEnd.value.copy(hexToVec3(b.colorEnd));
    u.uUseMask.value = !p.canvas.sourceBg && this.masksReady ? 1 : 0;
    u.uFeather.value = b.feather;
    u.uHeroOpacity.value = b.heroOpacity;
    u.uHeroFull.value = b.heroFullFrame ? 1 : 0;
    u.uSkip.value = b.highlight ? 1 : 0;
    this.ghostMat.blending = b.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
    // An opaque hero occludes ghosts behind it; a translucent one is layered on top instead.
    const heroOpaque = b.heroOpacity >= 0.99;
    this.heroMat.depthWrite = heroOpaque;
    this.hero.renderOrder = heroOpaque ? 0 : 2;
    this.hero.visible = b.highlight;
    this.box.visible = b.bbox;
    this.box.material.color.set(b.bboxColor);

    const sub = Math.max(1, Math.round(b.subframes));
    const slices = this.count ? (this.count - 1) * sub + 1 : 0;
    if (sub !== this.sub || slices !== this.slices) {
      this.sub = sub;
      this.slices = slices;
      u.uSub.value = sub;
      this.ghosts.geometry.dispose();
      this.ghosts.geometry = instancedPlane(slices);
      this.drawAscending = true;
    }
    const s = this.size();
    this.box.scale.set(s.x, s.y, Math.max(s.z, 1e-3));
  }

  /** Per-frame state: playhead (fractional frame index) and draw order for Normal blending. */
  update(current: number, camera: THREE.Camera) {
    const cur = Math.max(0, Math.min(this.count - 1, current));
    this.uniforms.uCurrent.value = cur;
    const heroAttr = this.hero.geometry.getAttribute('aIndex') as THREE.InstancedBufferAttribute;
    heroAttr.array[0] = cur * this.sub;
    heroAttr.needsUpdate = true;

    // Back-to-front slice order matters for Normal blending only, but is cheap to keep.
    const local = this.group.worldToLocal(camera.position.clone());
    const ascending = local.z >= 0;
    if (ascending !== this.drawAscending && this.slices > 0) {
      this.drawAscending = ascending;
      const attr = this.ghosts.geometry.getAttribute('aIndex') as THREE.InstancedBufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < this.slices; i++) arr[i] = ascending ? i : this.slices - 1 - i;
      attr.needsUpdate = true;
    }
  }

  /** Extents of the full stack in local space, for camera fitting. */
  size() {
    return new THREE.Vector3(this.frameAspect, 1, Math.max(0, this.count - 1) * this.spacing);
  }
}
