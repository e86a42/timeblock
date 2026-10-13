// GLB source: load an animated, skinned model and sample it deterministically.
// Unlike ROM.VIZ (real-time, motion-gated recording), poses are taken on a fixed time grid
// so ghosts, rows and the export all agree frame for frame.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export type ChainId = 'loop' | 'arms' | 'legs' | 'spine';
export interface Chain {
  id: ChainId;
  closed: boolean;
  bones: THREE.Object3D[];
}

export interface GlbInfo {
  name: string;
  verts: number;
  tris: number;
  joints: number;
  clips: { name: string; duration: number }[];
  height: number; // bind-pose figure height, model units
}

const loader = new GLTFLoader()
  .setDRACOLoader(new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`))
  .setMeshoptDecoder(MeshoptDecoder);

/** Bone lookup by loose naming (Mixamo "mixamorig:LeftArm", "l_arm_JNT", "upperarm_l", …). */
function boneFinder(bones: THREE.Object3D[]) {
  const norm = (n: string) => n.toLowerCase().replace(/^mixamorig\d*[:_]?/, '');
  const sideOf = (n: string): 'l' | 'r' | '' => {
    if (/(^|[^a-z])l(eft)?([^a-z]|$)|^left|_l$|\.l$/.test(n)) return 'l';
    if (/(^|[^a-z])r(ight)?([^a-z]|$)|^right|_r$|\.r$/.test(n)) return 'r';
    return '';
  };
  const entries = bones.map((b) => ({ b, n: norm(b.name), side: sideOf(norm(b.name)) }));
  return (side: 'l' | 'r' | '', include: RegExp, exclude?: RegExp) =>
    entries
      .filter((e) => (side ? e.side === side : true) && include.test(e.n) && !(exclude && exclude.test(e.n)))
      .sort((a, b) => a.n.length - b.n.length)[0]?.b ?? null;
}

const FINGER = /thumb|index|middle|ring|pinky|finger/;

function resolveChains(bones: THREE.Object3D[]): Record<ChainId, Chain> {
  const find = boneFinder(bones);
  const side = (s: 'l' | 'r') => ({
    upperArm: find(s, /(upper)?arm/, /fore|lower|twist|shoulder/),
    forearm: find(s, /forearm|lowerarm/),
    hand: find(s, /hand/, FINGER),
    thigh: find(s, /upleg|thigh|upperleg/),
    calf: find(s, /leg|calf|shin/, /up|upper|thigh/),
    foot: find(s, /foot|ankle/, /toe/),
  });
  const L = side('l');
  const R = side('r');
  const head = find('', /head/, /end|top|nub/);
  const neck = find('', /neck/);
  const hips = find('', /hips|pelvis/);
  const spines = bones.filter((b) => /spine|chest/i.test(b.name) && !/l_|r_/i.test(b.name));
  const ok = (list: (THREE.Object3D | null)[]) => list.filter((b): b is THREE.Object3D => !!b);
  return {
    // Closed silhouette loop: swept along time it becomes a tube (the reference's cylinder).
    loop: {
      id: 'loop',
      closed: true,
      bones: ok([head, L.upperArm, L.forearm, L.hand, L.thigh, L.calf, L.foot, R.foot, R.calf, R.thigh, R.hand, R.forearm, R.upperArm]),
    },
    arms: { id: 'arms', closed: false, bones: ok([L.hand, L.forearm, L.upperArm, neck, R.upperArm, R.forearm, R.hand]) },
    legs: { id: 'legs', closed: false, bones: ok([L.foot, L.calf, L.thigh, hips, R.thigh, R.calf, R.foot]) },
    spine: { id: 'spine', closed: false, bones: ok([head, neck, ...spines.reverse(), hips]) },
  };
}

/** Baked ghost poses merged into one geometry (one draw call). */
export interface GhostBake {
  geometry: THREE.BufferGeometry; // position, normal, aFrame; index in ascending pose order
  indexAsc: THREE.BufferAttribute;
  indexDesc: THREE.BufferAttribute;
  count: number;
  boxes: THREE.Box3[]; // per pose, before anchor/unfold
}

export class GlbRig {
  readonly info: GlbInfo;
  readonly chains: Record<ChainId, Chain>;
  private root: THREE.Object3D; // sampling copy, never rendered
  private mixer: THREE.AnimationMixer;
  private clips: THREE.AnimationClip[];
  private action: THREE.AnimationAction | null = null;
  private meshes: THREE.Mesh[];
  private hips: THREE.Object3D | null;
  private feet: THREE.Object3D[];
  readonly source: THREE.Object3D; // pristine scene for cloning the hero

  private constructor(name: string, scene: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.source = scene;
    this.root = scene;
    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.meshes = [];
    const bones: THREE.Object3D[] = [];
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) this.meshes.push(o as THREE.Mesh);
      if ((o as THREE.Bone).isBone) bones.push(o);
    });
    this.chains = resolveChains(bones);
    const find = boneFinder(bones);
    this.hips = find('', /hips|pelvis/) ?? bones[0] ?? null;
    this.feet = [find('l', /foot|ankle/, /toe/), find('r', /foot|ankle/, /toe/)].filter((b): b is THREE.Object3D => !!b);

    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.root, true);
    let verts = 0;
    let tris = 0;
    for (const m of this.meshes) {
      verts += m.geometry.getAttribute('position').count;
      tris += (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3;
    }
    this.info = {
      name,
      verts,
      tris,
      joints: bones.length,
      clips: clips.map((c) => ({ name: c.name || 'clip', duration: c.duration })),
      height: Math.max(1e-3, box.max.y - box.min.y),
    };
    this.setClip(0);
  }

  static async load(file: File) {
    const gltf = await loader.parseAsync(await file.arrayBuffer(), '');
    if (!gltf.animations.length) throw new Error('애니메이션 클립이 없는 GLB입니다 (리깅 + 애니메이션 필요)');
    return new GlbRig(file.name, gltf.scene, gltf.animations);
  }

  setClip(i: number) {
    this.action?.stop();
    this.action = this.mixer.clipAction(this.clips[Math.min(i, this.clips.length - 1)]);
    this.action.play();
  }

  get clip() {
    return this.action!.getClip();
  }

  /** Pose the sampling copy at clip time t (seconds, clamped inside the clip). */
  pose(t: number) {
    this.mixer.setTime(Math.max(0, Math.min(this.clip.duration - 1e-4, t)));
    this.root.updateMatrixWorld(true);
  }

  /** Root-motion offset at the current pose relative to clip start `ref` (call after pose()). */
  anchorOffset(mode: 'none' | 'hips' | 'ground', ref: THREE.Vector3, out = new THREE.Vector3()) {
    out.set(0, 0, 0);
    if (mode === 'none' || !this.hips) return out;
    const p = this.hips.getWorldPosition(new THREE.Vector3());
    if (mode === 'hips') return out.set(p.x - ref.x, 0, p.z - ref.z); // strip travel, keep crouch/lean
    let minY = Infinity;
    for (const f of this.feet) minY = Math.min(minY, f.getWorldPosition(p).y);
    return out.set(0, Number.isFinite(minY) ? minY - ref.y : 0, 0);
  }

  /** Reference point at clip start for anchorOffset(): hips xz + lowest foot y. */
  anchorRef(t0: number) {
    this.pose(t0);
    const ref = this.hips ? this.hips.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    let minY = Infinity;
    const p = new THREE.Vector3();
    for (const f of this.feet) minY = Math.min(minY, f.getWorldPosition(p).y);
    if (Number.isFinite(minY)) ref.y = minY;
    return ref;
  }

  /** World positions of a chain's bones at the current pose. */
  chainPoints(chain: Chain) {
    return chain.bones.map((b) => b.getWorldPosition(new THREE.Vector3()));
  }

  /**
   * Bake `count` poses over [t0, t1] into one geometry. Skinning is evaluated here with all
   * influence sets (JOINTS_0/1 …), which three.js' GPU skinning would truncate to four.
   */
  bake(count: number, t0: number, t1: number): GhostBake {
    const parts = this.meshes.map((m) => {
      const g = m.geometry;
      const sets: { idx: THREE.BufferAttribute; w: THREE.BufferAttribute }[] = [];
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
        for (let k = 0; ; k++) {
          const idx = g.getAttribute(k === 0 ? 'skinIndex' : `joints_${k}`) as THREE.BufferAttribute | undefined;
          const w = g.getAttribute(k === 0 ? 'skinWeight' : `weights_${k}`) as THREE.BufferAttribute | undefined;
          if (!idx || !w) break;
          sets.push({ idx, w });
        }
      }
      return { m, g, sets, V: g.getAttribute('position').count };
    });
    const V = parts.reduce((s, p) => s + p.V, 0);
    const T = parts.reduce((s, p) => s + (p.g.index?.count ?? p.V), 0);

    const pos = new Float32Array(count * V * 3);
    const nor = new Float32Array(count * V * 3);
    const frame = new Float32Array(count * V);
    const idxAsc = new Uint32Array(count * T);
    const boxes: THREE.Box3[] = [];
    const M = new THREE.Matrix4();
    const tmp = new THREE.Matrix4();

    for (let f = 0; f < count; f++) {
      this.pose(count === 1 ? t0 : t0 + ((t1 - t0) * f) / (count - 1));
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      let vBase = f * V;
      let iBase = f * T;
      for (const { m, g, sets, V: pv } of parts) {
        const P = g.getAttribute('position') as THREE.BufferAttribute;
        const N = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
        // Per-bone matrices mapping bind-space vertices straight to world space.
        let mats: Float32Array;
        if (sets.length) {
          const sm = m as THREE.SkinnedMesh;
          sm.skeleton.update();
          const nb = sm.skeleton.bones.length;
          mats = new Float32Array(nb * 16);
          const pre = new THREE.Matrix4().multiplyMatrices(sm.matrixWorld, sm.bindMatrixInverse);
          for (let b = 0; b < nb; b++) {
            tmp.fromArray(sm.skeleton.boneMatrices!, b * 16);
            M.multiplyMatrices(pre, tmp).multiply(sm.bindMatrix);
            M.toArray(mats, b * 16);
          }
        } else {
          mats = new Float32Array(m.matrixWorld.elements);
        }
        for (let v = 0; v < pv; v++) {
          const px = P.getX(v), py = P.getY(v), pz = P.getZ(v);
          const nx = N ? N.getX(v) : 0, ny = N ? N.getY(v) : 1, nz = N ? N.getZ(v) : 0;
          let ox = 0, oy = 0, oz = 0, qx = 0, qy = 0, qz = 0;
          const add = (o: number, w: number) => {
            const e = mats;
            ox += w * (e[o] * px + e[o + 4] * py + e[o + 8] * pz + e[o + 12]);
            oy += w * (e[o + 1] * px + e[o + 5] * py + e[o + 9] * pz + e[o + 13]);
            oz += w * (e[o + 2] * px + e[o + 6] * py + e[o + 10] * pz + e[o + 14]);
            qx += w * (e[o] * nx + e[o + 4] * ny + e[o + 8] * nz);
            qy += w * (e[o + 1] * nx + e[o + 5] * ny + e[o + 9] * nz);
            qz += w * (e[o + 2] * nx + e[o + 6] * ny + e[o + 10] * nz);
          };
          if (sets.length) {
            for (const { idx, w } of sets) {
              for (let c = 0; c < idx.itemSize; c++) {
                const wt = w.getComponent(v, c);
                if (wt > 0) add(idx.getComponent(v, c) * 16, wt);
              }
            }
          } else add(0, 1);
          const o = (vBase + v) * 3;
          pos[o] = ox;
          pos[o + 1] = oy;
          pos[o + 2] = oz;
          const l = Math.hypot(qx, qy, qz) || 1;
          nor[o] = qx / l;
          nor[o + 1] = qy / l;
          nor[o + 2] = qz / l;
          frame[vBase + v] = f;
          if (ox < lo[0]) lo[0] = ox;
          if (oy < lo[1]) lo[1] = oy;
          if (oz < lo[2]) lo[2] = oz;
          if (ox > hi[0]) hi[0] = ox;
          if (oy > hi[1]) hi[1] = oy;
          if (oz > hi[2]) hi[2] = oz;
        }
        const index = g.index;
        const n = index?.count ?? pv;
        for (let i = 0; i < n; i++) idxAsc[iBase + i] = (index ? index.getX(i) : i) + vBase;
        vBase += pv;
        iBase += n;
      }
      boxes.push(new THREE.Box3(new THREE.Vector3(...lo), new THREE.Vector3(...hi)));
    }

    // Same triangles, poses in reverse order — swapped in for back-to-front Normal blending.
    const idxDesc = new Uint32Array(count * T);
    for (let f = 0; f < count; f++) idxDesc.set(idxAsc.subarray(f * T, (f + 1) * T), (count - 1 - f) * T);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geometry.setAttribute('aFrame', new THREE.BufferAttribute(frame, 1));
    const indexAsc = new THREE.BufferAttribute(idxAsc, 1);
    geometry.setIndex(indexAsc);
    return { geometry, indexAsc, indexDesc: new THREE.BufferAttribute(idxDesc, 1), count, boxes };
  }
}
