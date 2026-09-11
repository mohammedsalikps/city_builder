import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface CameraFocusPoint {
  x: number;
  y: number;
  z: number;
}

export interface CameraView {
  distance?: number;
  /** Degrees around the vertical axis; 0 looks from +Z, 90 from +X. */
  azimuth?: number;
  /** Degrees above the ground; 90 is top-down. */
  elevation?: number;
}

/** Named presentation views, from a close-up to the whole neighbourhood. */
export type CameraPreset = 'close' | 'build' | 'area' | 'town';

const PRESETS: Record<CameraPreset, { distance: number; elevation: number }> = {
  close: { distance: 6, elevation: 26 },
  build: { distance: 14, elevation: 42 },
  area: { distance: 34, elevation: 38 },
  town: { distance: 95, elevation: 36 },
};

const TRANSITION_SECONDS = 0.9;

interface Transition {
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  elapsed: number;
  duration: number;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * City-builder camera: orbit (left drag), pan along the ground (right drag),
 * zoom towards the cursor (wheel), with limits that keep it above the ground
 * and between a close-up and a town-wide view. Programmatic moves either
 * jump (`frame`) or ease (`transitionTo`, presets); any player input cancels
 * an easing move.
 */
export class CameraController {
  private readonly controls: OrbitControls;
  private transition: Transition | null = null;
  private readonly scratch = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
  ) {
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 240;
    // Keep the camera above the ground plane and out of straight top-down.
    this.controls.maxPolarAngle = Math.PI / 2 - 0.08;
    this.controls.minPolarAngle = 0.05;
    this.controls.screenSpacePanning = false;
    this.controls.zoomToCursor = true;
    this.controls.rotateSpeed = 0.7;
    this.controls.target.set(0, 0, 0);
    this.controls.addEventListener('start', () => {
      this.transition = null;
    });
    this.controls.update();
  }

  /** The point the camera orbits around. */
  get target(): THREE.Vector3 {
    return this.controls.target;
  }

  get isTransitioning(): boolean {
    return this.transition !== null;
  }

  setEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
  }

  /** Slow showcase orbit (menus). Player input or a new move stops nothing else. */
  setAutoRotate(on: boolean, speed = 0.35): void {
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = speed;
  }

  /** Look at a world point from the default three-quarter angle, immediately. */
  focusOn(point: CameraFocusPoint, distance = 4): void {
    this.frame(point, { distance });
  }

  /** Jump the camera to look at `point` from the given view. */
  frame(point: CameraFocusPoint, view: CameraView = {}): void {
    this.transition = null;
    this.controls.target.set(point.x, point.y, point.z);
    this.camera.position.copy(this.positionFor(point, view, this.scratch));
    this.controls.update();
  }

  /** Ease the camera to look at `point` from the given view. */
  transitionTo(point: CameraFocusPoint, view: CameraView = {}, duration = TRANSITION_SECONDS): void {
    const toTarget = new THREE.Vector3(point.x, point.y, point.z);
    this.transition = {
      fromPosition: this.camera.position.clone(),
      toPosition: this.positionFor(point, view, new THREE.Vector3()),
      fromTarget: this.controls.target.clone(),
      toTarget,
      elapsed: 0,
      duration: Math.max(0.01, duration),
    };
  }

  /** Ease to a named view around the current target, keeping the current heading. */
  setPreset(preset: CameraPreset): void {
    const offset = this.scratch.copy(this.camera.position).sub(this.controls.target);
    const azimuth = THREE.MathUtils.radToDeg(Math.atan2(offset.x, offset.z));
    const { distance, elevation } = PRESETS[preset];
    this.transitionTo(this.controls.target, { distance, azimuth, elevation });
  }

  /** Complete an easing move now (tests, or when the tab was hidden). */
  finishTransition(): void {
    if (!this.transition) return;
    this.transition.elapsed = this.transition.duration;
    this.stepTransition(0);
  }

  update(deltaSeconds: number): void {
    if (this.transition) this.stepTransition(deltaSeconds);
    this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }

  private stepTransition(deltaSeconds: number): void {
    const t = this.transition;
    if (!t) return;
    t.elapsed = Math.min(t.duration, t.elapsed + deltaSeconds);
    const k = easeInOutCubic(t.elapsed / t.duration);
    this.camera.position.lerpVectors(t.fromPosition, t.toPosition, k);
    this.controls.target.lerpVectors(t.fromTarget, t.toTarget, k);
    if (t.elapsed >= t.duration) this.transition = null;
    this.controls.update();
  }

  private positionFor(point: CameraFocusPoint, view: CameraView, out: THREE.Vector3): THREE.Vector3 {
    const distance = view.distance ?? 4;
    const azimuth = THREE.MathUtils.degToRad(view.azimuth ?? 45);
    const elevation = THREE.MathUtils.degToRad(view.elevation ?? 29);
    const horizontal = Math.cos(elevation);
    return out.set(
      point.x + Math.sin(azimuth) * horizontal * distance,
      point.y + Math.sin(elevation) * distance,
      point.z + Math.cos(azimuth) * horizontal * distance,
    );
  }
}
