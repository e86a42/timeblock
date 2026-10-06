// §6.3 — Camera rig: perspective/orthographic pair sharing one OrbitControls,
// view presets that fit the stack, and a deterministic animation of playhead u ∈ [0, 1].
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Params, ViewPreset } from '../state';

const VIEW_DIRS: Record<Exclude<ViewPreset, 'free'>, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0, 1),
  side: new THREE.Vector3(1, 0, 0),
  oblique: new THREE.Vector3(1, 0.35, 1).normalize(),
  top: new THREE.Vector3(0, 1, 1e-4).normalize(),
};

const smooth = (u: number) => u * u * (3 - 2 * u);

export class CameraRig {
  readonly persp = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
  readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 200);
  readonly controls: OrbitControls;
  private aspect = 1;
  private orthoHalf = 1; // half frustum height at zoom 1

  constructor(dom: HTMLElement) {
    this.controls = new OrbitControls(this.persp, dom);
    // Same mapping as ROM.VIZ: right-drag orbit, middle-drag pan, wheel zoom.
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    this.persp.position.set(2, 0.7, 2);
  }

  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.controls.object as THREE.PerspectiveCamera | THREE.OrthographicCamera;
  }

  setAspect(aspect: number) {
    this.aspect = aspect;
    this.persp.aspect = aspect;
    this.persp.updateProjectionMatrix();
    this.updateOrtho();
  }

  setProjection(kind: Params['camera']['projection'], fov: number) {
    this.persp.fov = fov;
    this.persp.updateProjectionMatrix();
    const next = kind === 'perspective' ? this.persp : this.ortho;
    if (next === this.camera) return;
    // Keep framing roughly equal: ortho height ≈ perspective height at the target distance.
    const dist = this.camera.position.distanceTo(this.controls.target);
    if (next === this.ortho) {
      this.orthoHalf = dist * Math.tan(THREE.MathUtils.degToRad(fov / 2)) / this.persp.zoom;
      this.ortho.zoom = 1;
      this.updateOrtho();
    }
    next.position.copy(this.camera.position);
    next.quaternion.copy(this.camera.quaternion);
    this.controls.object = next;
    this.controls.update();
  }

  /** Place the camera along a preset direction at a distance that fits `size`. */
  fit(view: ViewPreset, size: THREE.Vector3) {
    const dir =
      view === 'free'
        ? this.camera.position.clone().sub(this.controls.target).normalize()
        : VIEW_DIRS[view].clone();
    const r = 0.5 * size.length();
    const vHalf = THREE.MathUtils.degToRad(this.persp.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * this.aspect);
    const dist = (r / Math.sin(Math.min(vHalf, hHalf))) * 1.04;

    this.controls.target.set(0, 0, 0);
    this.persp.position.copy(dir).multiplyScalar(dist);
    this.persp.zoom = 1;
    this.persp.updateProjectionMatrix();
    this.ortho.position.copy(this.persp.position);
    this.ortho.zoom = 1;
    this.orthoHalf = r * Math.max(1, 1 / this.aspect) * 1.04;
    this.updateOrtho();
    this.controls.update();
  }

  /**
   * Apply the animation for playhead u. Orbit spins the stack group (so user orbit stays
   * untouched); dolly temporarily moves the camera — call the returned fn after rendering.
   */
  animate(u: number, p: Params, group: THREE.Object3D): () => void {
    const a = p.camera.animation;
    const orbit = a === 'orbit' || a === 'orbit+dolly';
    // Sweep centred on the chosen view; from 사선 45° this opens on the frame face and ends side-on.
    group.rotation.y = orbit ? THREE.MathUtils.degToRad((0.5 - u) * p.camera.orbitAngle) : 0;
    if (a !== 'dolly' && a !== 'orbit+dolly') return () => {};

    const factor = THREE.MathUtils.lerp(1.12, 0.78, smooth(u));
    const cam = this.camera;
    const saved = cam.position.clone();
    const savedZoom = cam.zoom;
    if (cam === this.persp) {
      cam.position.sub(this.controls.target).multiplyScalar(factor).add(this.controls.target);
    } else {
      cam.zoom = savedZoom / factor;
      cam.updateProjectionMatrix();
    }
    return () => {
      cam.position.copy(saved);
      cam.zoom = savedZoom;
      cam.updateProjectionMatrix();
    };
  }

  private updateOrtho() {
    const h = this.orthoHalf;
    Object.assign(this.ortho, { top: h, bottom: -h, left: -h * this.aspect, right: h * this.aspect });
    this.ortho.updateProjectionMatrix();
  }
}
