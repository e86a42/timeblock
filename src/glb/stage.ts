// GLB mode scene: ① ROM.VIZ-style ghost stack with TimeBlock styling → ② a sweep plane draws
// joint paths and grows a lofted surface → ③ the surface dissolves into a breathing point tube
// on paper (reference look). Everything is a pure function of t, so preview == export.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { intensityScales, type Params } from '../state';
import { hexToVec3 } from '../scene/stack';
import { GlbRig, type Chain, type ChainId, type GhostBake, type GlbInfo } from './rig';
import ghostVert from './shaders/ghost.vert?raw';
import ghostFrag from './shaders/ghost.frag?raw';
import surfVert from './shaders/surface.vert?raw';
import surfFrag from './shaders/surface.frag?raw';
import linesVert from './shaders/lines.vert?raw';
import linesFrag from './shaders/lines.frag?raw';
import pointsVert from './shaders/points.vert?raw';
import pointsFrag from './shaders/points.frag?raw';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (u: number) => u * u * (3 - 2 * u);
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

/** Stage weights at time t (exposed so main can blend background and grain). */
export interface StageState {
  build: number; // ghost build-up 0–1
  sweep: number; // sweep plane progress 0–1
  morph: number; // surface → points 0–1
}

export function stageState(t: number, p: Params): StageState {
  const g = p.glb;
  const buildup = p.camera.playback === 'buildup';
  const seqBuild = buildup ? clamp01(t / Math.max(0.01, g.buildEnd)) : clamp01(t / p.export.duration);
  switch (g.stage) {
    case 'ghost':
      return { build: seqBuild, sweep: 0, morph: 0 };
    case 'surface':
      return { build: 1, sweep: 1, morph: 0 };
    case 'points':
      return { build: 1, sweep: 1, morph: 1 };
    default:
      return {
        build: seqBuild,
        sweep: clamp01((t - g.sweepStart) / Math.max(0.01, g.sweepDur)),
        morph: clamp01((t - g.morphStart) / Math.max(0.01, g.morphDur)),
      };
  }
}

export class GlbStage {
  readonly root = new THREE.Group(); // spun by the camera orbit
  private tilt = new THREE.Group(); // stands the time axis upright in the points stage
  private content = new THREE.Group(); // model units, scaled to figure height 1, centred
  rig: GlbRig | null = null;

  private bake: GhostBake | null = null;
  private anchors: THREE.Vector3[] = [];
  private anchorTex = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  private ref = new THREE.Vector3();
  private t0 = 0;
  private t1 = 1;
  private axis = new THREE.Vector3();
  private len = 0;
  private center = new THREE.Vector3();
  private bounds = new THREE.Box3();
  private drawAscending = true;

  private ghostU = {
    uCount: { value: 1 },
    uAxis: { value: new THREE.Vector3() },
    uLen: { value: 0 },
    uAnchor: { value: this.anchorTex as THREE.Texture },
    uCur: { value: 0 },
    uBuildUp: { value: 1 },
    uOpacity: { value: 0.2 },
    uFalloff: { value: 0.5 },
    uCurve: { value: 1 },
    uSkip: { value: 1 },
    uStep: { value: 1 },
    uFront: { value: -1 },
    uShade: { value: 0.6 },
    uTint: { value: 0 },
    uBase: { value: new THREE.Vector3() },
    uTintStart: { value: new THREE.Vector3() },
    uTintEnd: { value: new THREE.Vector3() },
  };
  private surfU = {
    uColor: { value: new THREE.Vector3() },
    uLine: { value: new THREE.Vector3() },
    uOpacity: { value: 0.35 },
    uFront: { value: 0 },
    uFade: { value: 1 },
    uGrid: { value: new THREE.Vector2(12, 24) },
  };
  private lineU = { uColor: { value: new THREE.Vector3() }, uFront: { value: 0 }, uFade: { value: 0 } };
  private pointU = {
    uTime: { value: 0 },
    uAmp: { value: 0.18 },
    uSpeed: { value: 1.2 },
    uFreq: { value: 3 },
    uSize: { value: 0.012 },
    uFocal: { value: 1000 },
    uOrthoPx: { value: 0 },
    uMorph: { value: 0 },
    uInk: { value: new THREE.Vector3() },
  };

  private ghostMat = new THREE.ShaderMaterial({
    vertexShader: ghostVert,
    fragmentShader: ghostFrag,
    uniforms: this.ghostU,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private ghosts = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMat);
  private surface = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.ShaderMaterial({
      vertexShader: surfVert,
      fragmentShader: surfFrag,
      uniforms: this.surfU,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  private lines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.ShaderMaterial({ vertexShader: linesVert, fragmentShader: linesFrag, uniforms: this.lineU, transparent: true, depthWrite: false }),
  );
  private points = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.ShaderMaterial({ vertexShader: pointsVert, fragmentShader: pointsFrag, uniforms: this.pointU, transparent: true, depthWrite: false }),
  );
  private sweepPlane = new THREE.Group();
  private sweepFill = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }),
  );
  private sweepEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
    new THREE.LineBasicMaterial({ transparent: true, opacity: 0.7 }),
  );
  private box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({ transparent: true, opacity: 0.8 }),
  );
  private hero: THREE.Object3D | null = null;
  private heroMixer: THREE.AnimationMixer | null = null;
  private heroMats: THREE.Material[] = [];
  private heroPlain = new THREE.MeshLambertMaterial({ transparent: true });

  constructor() {
    this.root.add(this.tilt);
    this.tilt.add(this.content);
    this.sweepPlane.add(this.sweepFill, this.sweepEdge);
    for (const o of [this.ghosts, this.surface, this.lines, this.points, this.sweepPlane, this.box]) {
      o.frustumCulled = false;
      this.content.add(o);
    }
    this.ghosts.renderOrder = 1;
    this.surface.renderOrder = 2;
    this.lines.renderOrder = 3;
    this.points.renderOrder = 4;
    this.sweepPlane.renderOrder = 5;
    this.box.renderOrder = 6;
    const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 1.6);
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 4, 3);
    this.root.add(hemi, key);
    this.root.visible = false;
  }

  get info(): GlbInfo | null {
    return this.rig?.info ?? null;
  }

  async load(file: File) {
    const rig = await GlbRig.load(file);
    this.rig = rig;
    if (this.hero) this.content.remove(this.hero);
    this.hero = SkeletonUtils.clone(rig.source);
    this.heroMixer = new THREE.AnimationMixer(this.hero);
    this.heroMixer.clipAction(rig.clip).play();
    this.heroMats = [];
    this.hero.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      // FBX-converted materials are often metallic with no environment map → near black.
      const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      const mat = new THREE.MeshStandardMaterial({ map: src.map ?? null, color: src.color ?? 0xffffff, roughness: 0.85, metalness: 0, transparent: true });
      m.userData.textured = mat;
      m.material = mat;
      this.heroMats.push(mat);
    });
    this.content.add(this.hero);
    this.root.visible = true;
    return rig.info;
  }

  /** Heavy: re-sample and bake the ghost poses (count or clip range changed). */
  rebake(p: Params) {
    const rig = this.rig;
    if (!rig) return;
    const dur = rig.clip.duration;
    this.t0 = Math.max(0, Math.min(dur, p.block.inT));
    this.t1 = Math.max(this.t0 + 1e-3, Math.min(dur, p.block.outT || dur));
    this.ghosts.geometry.dispose();
    this.bake = rig.bake(Math.max(2, Math.round(p.glb.ghosts)), this.t0, this.t1);
    this.ghosts.geometry = this.bake.geometry;
    this.drawAscending = true;
    this.relayout(p);
  }

  private clipTime(u: number) {
    return this.t0 + (this.t1 - this.t0) * u;
  }

  private unfoldAt(u: number, out = new THREE.Vector3()) {
    return out.copy(this.axis).multiplyScalar((u - 0.5) * this.len);
  }

  /** Cheap: anchors, unfold, rows → surface / paths / points, bounds. */
  relayout(p: Params) {
    const rig = this.rig;
    const bake = this.bake;
    if (!rig || !bake) return;
    const g = p.glb;
    const H = rig.info.height;
    this.axis.copy(g.unfold === 'linear' ? AXES[g.axis] : new THREE.Vector3());
    this.len = g.length * H;
    this.ref = rig.anchorRef(this.t0);

    // Ghost anchors → texture.
    const K = bake.count;
    const data = new Float32Array(K * 4);
    this.anchors = [];
    for (let i = 0; i < K; i++) {
      rig.pose(this.clipTime(i / (K - 1)));
      const a = rig.anchorOffset(g.anchor, this.ref);
      this.anchors.push(a);
      data.set([a.x, a.y, a.z, 0], i * 4);
    }
    this.anchorTex.dispose();
    this.anchorTex = new THREE.DataTexture(data, K, 1, THREE.RGBAFormat, THREE.FloatType);
    this.anchorTex.needsUpdate = true;
    this.ghostU.uAnchor.value = this.anchorTex;
    this.ghostU.uCount.value = K;
    this.ghostU.uStep.value = 1 / (K - 1);
    this.ghostU.uAxis.value.copy(this.axis);
    this.ghostU.uLen.value = this.len;

    this.buildRows(p);

    // Bounds: every ghost box moved to its slot, plus the rows.
    const b = new THREE.Box3();
    const off = new THREE.Vector3();
    bake.boxes.forEach((box, i) => {
      this.unfoldAt(i / (K - 1), off).sub(this.anchors[i]);
      b.union(box.clone().translate(off));
    });
    const pos = this.surface.geometry.getAttribute('position');
    if (pos) b.union(new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute));
    this.bounds.copy(b);
    b.getCenter(this.center);
    const S = 1 / H;
    this.content.scale.setScalar(S);
    this.content.position.copy(this.center).multiplyScalar(-S);
    const size = b.getSize(new THREE.Vector3());
    this.box.position.copy(this.center);
    this.box.scale.copy(size).max(new THREE.Vector3(1e-3, 1e-3, 1e-3));

    // Sweep plane: perpendicular to the unfold axis, covering the cross-section.
    const n = this.axis.lengthSq() ? this.axis : AXES.x;
    this.sweepPlane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const cross = size.clone().multiply(new THREE.Vector3(1, 1, 1).sub(new THREE.Vector3(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z))));
    const dims = [cross.x, cross.y, cross.z].filter((v) => v > 0).sort((a, c) => c - a);
    this.sweepPlane.scale.set((dims[0] ?? H) * 1.08, (dims[1] ?? H) * 1.08, 1);
    this.apply(p);
  }

  private chainsFor(id: Params['glb']['chain']): Chain[] {
    const rig = this.rig!;
    const ids: ChainId[] = id === 'all' ? ['arms', 'legs', 'spine'] : [id];
    return ids.map((c) => rig.chains[c]).filter((c) => c.bones.length >= 3);
  }

  private buildRows(p: Params) {
    const rig = this.rig!;
    const g = p.glb;
    const R = Math.max(2, Math.round(g.rows));
    const C = Math.max(4, Math.round(g.cols));
    const chains = this.chainsFor(g.chain);

    // rows[c][r] = resampled points (C + 1), raw[c][r] = bone points
    const rows: THREE.Vector3[][][] = chains.map(() => []);
    const raw: THREE.Vector3[][][] = chains.map(() => []);
    const off = new THREE.Vector3();
    for (let r = 0; r < R; r++) {
      const u = r / (R - 1);
      rig.pose(this.clipTime(u));
      this.unfoldAt(u, off).sub(rig.anchorOffset(g.anchor, this.ref));
      chains.forEach((ch, c) => {
        const pts = rig.chainPoints(ch).map((v) => v.add(off));
        raw[c].push(pts);
        const curve = new THREE.CatmullRomCurve3(pts, ch.closed, 'centripetal');
        rows[c].push(curve.getSpacedPoints(C));
      });
    }

    // Surface grid (R × (C + 1) per chain).
    const sPos: number[] = [];
    const sUV: number[] = [];
    const sIdx: number[] = [];
    // Points: per row, C points (closed loops drop the duplicate seam point).
    const pPos: number[] = [];
    const pCen: number[] = [];
    const pV: number[] = [];
    const pRand: number[] = [];
    let base = 0;
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    chains.forEach((ch, c) => {
      const W = C + 1;
      for (let r = 0; r < R; r++) {
        const row = rows[c][r];
        const v = r / (R - 1);
        row.forEach((pt, k) => {
          sPos.push(pt.x, pt.y, pt.z);
          sUV.push(k / C, v);
        });
        const n = ch.closed ? C : W;
        const cen = row.slice(0, n).reduce((s, q) => s.add(q), new THREE.Vector3()).multiplyScalar(1 / n);
        for (let k = 0; k < n; k++) {
          const q = row[k];
          pPos.push(q.x, q.y, q.z);
          pCen.push(cen.x, cen.y, cen.z);
          pV.push(v);
          pRand.push(rand());
        }
      }
      for (let r = 0; r < R - 1; r++) {
        for (let k = 0; k < C; k++) {
          const a = base + r * W + k;
          sIdx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
        }
      }
      base += R * W;
    });
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
    sg.setAttribute('aUV', new THREE.Float32BufferAttribute(sUV, 2));
    sg.setIndex(sIdx);
    sg.computeVertexNormals();
    this.surface.geometry.dispose();
    this.surface.geometry = sg;
    this.surfU.uGrid.value.set(Math.max(4, Math.round(C / 6)), Math.max(6, Math.round(R / 10)));

    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
    pg.setAttribute('aCenter', new THREE.Float32BufferAttribute(pCen, 3));
    pg.setAttribute('aV', new THREE.Float32BufferAttribute(pV, 1));
    pg.setAttribute('aRand', new THREE.Float32BufferAttribute(pRand, 1));
    this.points.geometry.dispose();
    this.points.geometry = pg;

    // Joint paths: one polyline per bone, as segments.
    const lPos: number[] = [];
    const lV: number[] = [];
    chains.forEach((_, c) => {
      const nb = raw[c][0].length;
      for (let b = 0; b < nb; b++) {
        for (let r = 0; r < R - 1; r++) {
          const a = raw[c][r][b];
          const z = raw[c][r + 1][b];
          lPos.push(a.x, a.y, a.z, z.x, z.y, z.z);
          lV.push(r / (R - 1), (r + 1) / (R - 1));
        }
      }
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lPos, 3));
    lg.setAttribute('aV', new THREE.Float32BufferAttribute(lV, 1));
    this.lines.geometry.dispose();
    this.lines.geometry = lg;
  }

  /** Static parameters → uniforms / materials. */
  apply(p: Params) {
    const g = p.glb;
    const b = p.block;
    const k = intensityScales(p);
    const u = this.ghostU;
    u.uOpacity.value = Math.min(1, b.opacity * k.opacity);
    u.uFalloff.value = b.falloff;
    u.uCurve.value = b.falloffCurve;
    u.uBuildUp.value = p.camera.playback === 'buildup' ? 1 : 0;
    u.uSkip.value = b.highlight ? 1 : 0;
    u.uShade.value = g.shading;
    u.uTint.value = b.colorOverTime ? 1 : 0;
    u.uBase.value.copy(hexToVec3(g.ghostColor));
    u.uTintStart.value.copy(hexToVec3(b.colorStart));
    u.uTintEnd.value.copy(hexToVec3(b.colorEnd));
    this.ghostMat.blending = b.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;

    this.surfU.uColor.value.copy(hexToVec3(g.surfaceColor));
    this.surfU.uLine.value.copy(hexToVec3(g.lineColor));
    this.surfU.uOpacity.value = g.surfaceOpacity;
    this.lineU.uColor.value.copy(hexToVec3(g.lineColor));
    this.sweepFill.material.color.set(g.lineColor);
    this.sweepEdge.material.color.set(g.lineColor);

    const pu = this.pointU;
    pu.uAmp.value = g.breathAmp;
    pu.uSpeed.value = g.breathSpeed;
    pu.uFreq.value = g.breathFreq;
    pu.uSize.value = g.dotSize;
    pu.uInk.value.copy(hexToVec3(g.inkColor));

    this.box.material.color.set(b.bboxColor);
    this.heroPlain.color.set(g.ghostColor);
    this.hero?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = g.heroTextured ? (m.userData.textured as THREE.Material) : this.heroPlain;
    });
  }

  /** Per-frame state at time t. Returns stage weights for background/grain blending. */
  update(
    t: number,
    p: Params,
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    viewH: number,
    target: THREE.Vector3,
  ): StageState {
    const s = stageState(t, p);
    if (!this.rig || !this.bake) return s;
    const g = p.glb;
    const b = p.block;
    const u = p.camera.playback === 'buildup' ? s.build : clamp01(t / p.export.duration);

    // ① ghosts + hero
    this.ghostU.uCur.value = u;
    const lineFront = clamp01(s.sweep / 0.6);
    const surfFront = clamp01((s.sweep - 0.25) / 0.75);
    this.ghostU.uFront.value = s.sweep > 0 ? surfFront * 1.12 : -1;
    this.ghosts.visible = s.morph < 1;

    const heroAlpha = b.heroOpacity * (1 - smooth(clamp01(s.sweep / 0.15)));
    if (this.hero && this.heroMixer) {
      this.hero.visible = b.highlight && heroAlpha > 0.01;
      const ct = Math.min(this.rig.clip.duration - 1e-4, this.clipTime(u));
      this.heroMixer.setTime(ct);
      this.rig.pose(ct);
      this.hero.position.copy(this.unfoldAt(u)).sub(this.rig.anchorOffset(g.anchor, this.ref));
      for (const m of [...this.heroMats, this.heroPlain]) {
        m.opacity = heroAlpha;
        m.depthWrite = heroAlpha > 0.99;
      }
    }

    // ② sweep, paths, surface
    this.lineU.uFront.value = lineFront;
    this.lineU.uFade.value = s.sweep > 0 ? 1 - s.morph : 0;
    this.surfU.uFront.value = surfFront;
    this.surfU.uFade.value = 1 - s.morph;
    this.surface.visible = s.sweep > 0 && s.morph < 1;
    this.lines.visible = s.sweep > 0 && s.morph < 1;
    const sweepVis = Math.sin(Math.PI * s.sweep);
    this.sweepPlane.visible = sweepVis > 0.01;
    this.sweepPlane.position.copy(this.center).add(this.unfoldAt(surfFront)).sub(this.axis.clone().multiplyScalar(this.axis.dot(this.center)));
    this.sweepFill.material.opacity = 0.1 * sweepVis;
    this.sweepEdge.material.opacity = 0.8 * sweepVis;
    this.box.visible = b.bbox && s.morph < 1;
    this.box.material.opacity = 0.8 * (1 - s.morph);

    // ③ points + upright tilt
    const m = smooth(s.morph);
    this.points.visible = s.morph > 0;
    this.pointU.uMorph.value = m;
    this.pointU.uTime.value = t;
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const pc = camera as THREE.PerspectiveCamera;
      this.pointU.uFocal.value = (viewH / (2 * Math.tan(THREE.MathUtils.degToRad(pc.fov / 2)))) * pc.zoom;
      this.pointU.uOrthoPx.value = 0;
    } else {
      const oc = camera as THREE.OrthographicCamera;
      this.pointU.uOrthoPx.value = (viewH / (oc.top - oc.bottom)) * oc.zoom;
    }
    const upright =
      g.vertical && g.unfold === 'linear'
        ? new THREE.Quaternion().setFromUnitVectors(this.axis, AXES.y)
        : new THREE.Quaternion();
    this.tilt.quaternion.identity().slerp(upright, m);
    // Reframe while standing up: grow the content so the upright tube fills ~80% of the frame.
    this.tilt.scale.setScalar(1 + (this.uprightZoom(camera, target, g.vertical && g.unfold === 'linear') - 1) * m);

    // Back-to-front pose order for Normal blending.
    this.root.updateMatrixWorld(true);
    const cam = this.content.worldToLocal(camera.position.clone());
    const asc = cam.sub(this.center).dot(this.axis) >= 0;
    if (asc !== this.drawAscending) {
      this.drawAscending = asc;
      this.bake.geometry.setIndex(asc ? this.bake.indexAsc : this.bake.indexDesc);
    }
    return s;
  }

  /** Scale that makes the points-stage shape fill the view (1 = keep the fitted framing). */
  private uprightZoom(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, target: THREE.Vector3, upright: boolean) {
    const size = this.size();
    const n = upright ? this.axis : AXES.y;
    const along = Math.abs(size.dot(new THREE.Vector3(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z))));
    const across = Math.max(...[size.x, size.y, size.z].filter((v) => v !== along), 1e-3);
    let visH: number;
    let visW: number;
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const pc = camera as THREE.PerspectiveCamera;
      visH = (2 * camera.position.distanceTo(target) * Math.tan(THREE.MathUtils.degToRad(pc.fov / 2))) / pc.zoom;
      visW = visH * pc.aspect;
    } else {
      const oc = camera as THREE.OrthographicCamera;
      visH = (oc.top - oc.bottom) / oc.zoom;
      visW = (oc.right - oc.left) / oc.zoom;
    }
    return Math.max(0.2, Math.min((0.8 * visH) / Math.max(along, 1e-3), (0.6 * visW) / across));
  }

  /** Extents (figure height = 1) for camera fitting. */
  size() {
    return this.bounds.getSize(new THREE.Vector3()).multiplyScalar(this.rig ? 1 / this.rig.info.height : 1);
  }
}
