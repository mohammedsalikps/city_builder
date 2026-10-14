import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { motion } from '@/accessibility/motion';

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
/** Default limits: the construction site and challenge levels. */
const SITE_LIMITS: CameraLimits = { minDistance: 1.5, maxDistance: 240, halfSize: null };
/** Default polar range: never straight top-down, always a little above the ground plane. */
const DEFAULT_MIN_POLAR = 0.05;
const DEFAULT_MAX_POLAR = Math.PI / 2 - 0.08;

export interface CameraLimits {
  minDistance: number;
  maxDistance: number;
  /** The focus point stays within this many metres of the origin (null = anywhere). */
  halfSize: number | null;
}

/**
 * Everything needed to put the orbit camera back exactly where it was, e.g.
 * after a first-person walk or an explorer fly-over borrowed the camera.
 * Plain data (no three.js objects), so it can be stored or compared freely.
 */
export interface CameraSnapshot {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  limits: CameraLimits;
  /** Polar angle limits in radians (0 = straight down from above). */
  minPolar: number;
  maxPolar: number;
}

interface Transition {
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  elapsed: number;
  duration: number;
  /** Extra height at the middle of the move (a gentle arc for long trips). */
  lift: number;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** `value` when it is a real number; otherwise (null, undefined, NaN, Infinity) the fallback. */
function finiteOr(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * A safe polar range: each end within 0..PI and the maximum never below the
 * minimum. A missing or broken end (null, NaN) means that end's default.
 */
function polarRange(minPolar: number | null | undefined, maxPolar: number | null | undefined): { min: number; max: number } {
  const min = THREE.MathUtils.clamp(finiteOr(minPolar, DEFAULT_MIN_POLAR), 0, Math.PI);
  const max = THREE.MathUtils.clamp(finiteOr(maxPolar, DEFAULT_MAX_POLAR), min, Math.PI);
  return { min, max };
}

/**
 * Limits read back from stored data, made safe: a broken distance falls
 * back to the site default (the maximum never below the minimum), and a
 * broken roaming size means "anywhere".
 */
function safeLimits(limits: Partial<CameraLimits> | null | undefined): CameraLimits {
  const minDistance = Math.max(0, finiteOr(limits?.minDistance, SITE_LIMITS.minDistance));
  const maxDistance = Math.max(minDistance, finiteOr(limits?.maxDistance, SITE_LIMITS.maxDistance));
  const halfSize = finiteOr(limits?.halfSize, -1);
  return { minDistance, maxDistance, halfSize: halfSize >= 0 ? halfSize : null };
}

/** A stored point, or `fallback` when any of its coordinates is broken. */
function safePoint(point: Partial<CameraFocusPoint> | null | undefined, fallback: THREE.Vector3): CameraFocusPoint {
  const x = finiteOr(point?.x, NaN);
  const y = finiteOr(point?.y, NaN);
  const z = finiteOr(point?.z, NaN);
  return Number.isNaN(x + y + z) ? { x: fallback.x, y: fallback.y, z: fallback.z } : { x, y, z };
}

interface TouchGestureBase {
  midX: number;
  midY: number;
  /** Screen-pixel distance between the two touches. */
  distance: number;
  /** Screen-space angle between the two touches, radians. */
  angle: number;
  targetX: number;
  targetZ: number;
  cameraDistance: number;
  azimuthDeg: number;
}

/**
 * City-builder camera: orbit (left drag), pan along the ground (right drag),
 * zoom towards the cursor (wheel), with limits that keep it above the ground
 * and between a close-up and a town-wide view. Programmatic moves either
 * jump (`frame`) or ease (`transitionTo`, presets); any player input cancels
 * an easing move.
 *
 * Touch is a separate, custom gesture layer rather than OrbitControls' own
 * (its default touch mapping is one-finger-orbits, which would fight with
 * one-finger object manipulation - see ObjectTransformController). Native
 * touch handling is disabled entirely (`touches: { ONE: null, TWO: null }`);
 * a single touch is then free for tap-to-select/place and gizmo dragging
 * exactly as today, and two touches drive pan, pinch-zoom and twist-rotate
 * together here, decomposed from the same two touch points every frame.
 * Mouse input is untouched by any of this.
 */
export class CameraController {
  private readonly controls: OrbitControls;
  private transition: Transition | null = null;
  private readonly scratch = new THREE.Vector3();
  private limits: CameraLimits = SITE_LIMITS;
  private polar = { min: DEFAULT_MIN_POLAR, max: DEFAULT_MAX_POLAR };
  /**
   * True while an animated `restore` runs: OrbitControls' distance and polar
   * clamps are opened wide so the eased path (which may start somewhere the
   * limits forbid, like a walker's eye) is never snapped mid-flight. The
   * real limits apply again the moment the move ends, however it ends.
   */
  private looseClamps = false;
  /** What the game asked for with `setEnabled`. */
  private wantsEnabled = true;
  /** Another camera driver (see World.setCameraDriver) owns the camera; ignore all player input. */
  private suspended = false;
  /** What the game asked for with `setAutoRotate` (the orbit stays still while motion is reduced). */
  private wantsAutoRotate = false;
  private readonly offMotion: () => void;

  private readonly activeTouches = new Map<number, { x: number; y: number }>();
  private touchGestureBase: TouchGestureBase | null = null;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly domElement: HTMLElement,
  ) {
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = SITE_LIMITS.minDistance;
    this.controls.maxDistance = SITE_LIMITS.maxDistance;
    // Keep the camera above the ground plane and out of straight top-down.
    this.controls.maxPolarAngle = DEFAULT_MAX_POLAR;
    this.controls.minPolarAngle = DEFAULT_MIN_POLAR;
    this.controls.screenSpacePanning = false;
    this.controls.zoomToCursor = true;
    this.controls.rotateSpeed = 0.7;
    this.controls.target.set(0, 0, 0);
    // Our own gesture layer owns every touch; OrbitControls keeps handling mouse/wheel only.
    this.controls.touches = { ONE: null, TWO: null };
    this.controls.addEventListener('start', () => {
      this.cancelTransition();
    });
    this.controls.update();

    domElement.addEventListener('pointerdown', this.onTouchDown);
    domElement.addEventListener('pointermove', this.onTouchMove);
    domElement.addEventListener('pointerup', this.onTouchEnd);
    domElement.addEventListener('pointercancel', this.onTouchEnd);
    this.offMotion = motion.onChange(() => {
      this.controls.autoRotate = this.wantsAutoRotate && !motion.reduced;
    });
  }

  /** The point the camera orbits around. */
  get target(): THREE.Vector3 {
    return this.controls.target;
  }

  get isTransitioning(): boolean {
    return this.transition !== null;
  }

  /** Zoom range and how far the view may roam; `null` restores the site defaults. */
  setLimits(limits: CameraLimits | null): void {
    this.limits = limits ?? SITE_LIMITS;
    this.applyClamps();
  }

  /**
   * How far the camera may tilt, in radians from straight above (polar
   * angle). `null` restores the default for that end: 0.05 (never exactly
   * top-down) and PI/2 - 0.08 (never down at ground level). Raising the
   * maximum past PI/2 lets the camera look up, e.g. at a tall tower.
   */
  setPolarLimits(minPolar: number | null, maxPolar: number | null): void {
    this.polar = polarRange(minPolar, maxPolar);
    this.applyClamps();
  }

  setEnabled(enabled: boolean): void {
    this.wantsEnabled = enabled;
    this.controls.enabled = enabled && !this.suspended;
  }

  /**
   * Hand the camera to another driver (true) or take it back (false). While
   * suspended the orbit controls and the touch gestures ignore every input -
   * OrbitControls would otherwise re-aim the camera at its own target on each
   * drag - and calls to `setEnabled` (e.g. from a gizmo drag ending) are
   * remembered but cannot wake the controls until the suspension ends.
   * Suspending also stops any easing move, so it cannot resume later from a
   * stale point.
   */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    this.controls.enabled = this.wantsEnabled && !suspended;
    if (suspended) this.cancelTransition();
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  /** Slow showcase orbit (menus). Player input or a new move stops nothing else. */
  setAutoRotate(on: boolean, speed = 0.35): void {
    this.wantsAutoRotate = on;
    this.controls.autoRotate = on && !motion.reduced;
    this.controls.autoRotateSpeed = speed;
  }

  /** Look at a world point from the default three-quarter angle, immediately. */
  focusOn(point: CameraFocusPoint, distance = 4): void {
    this.frame(point, { distance });
  }

  /** Jump the camera to look at `point` from the given view. */
  frame(point: CameraFocusPoint, view: CameraView = {}): void {
    this.cancelTransition();
    this.controls.target.set(point.x, point.y, point.z);
    this.camera.position.copy(this.positionFor(point, view, this.scratch));
    this.controls.update();
  }

  /** Ease the camera to look at `point` from the given view. */
  transitionTo(point: CameraFocusPoint, view: CameraView = {}, duration = TRANSITION_SECONDS, lift = 0): void {
    const toTarget = new THREE.Vector3(point.x, point.y, point.z);
    this.startTransition({
      fromPosition: this.camera.position.clone(),
      toPosition: this.positionFor(point, view, new THREE.Vector3()),
      fromTarget: this.controls.target.clone(),
      toTarget,
      elapsed: 0,
      // Reduced motion: the move happens at once (one frame) instead of gliding.
      duration: Math.max(0.01, motion.duration(duration)),
      lift,
    });
  }

  /**
   * Ease to an explicit eye position looking at an explicit target. The move
   * starts from where the camera is actually looking right now (its view
   * direction, at the current focus distance), so it is seamless even when
   * another driver - a first-person walk - was aiming the camera elsewhere.
   * In the normal orbit state that point is exactly the current target.
   */
  transitionToPose(position: CameraFocusPoint, target: CameraFocusPoint, duration = TRANSITION_SECONDS): void {
    const lookDistance = Math.max(0.5, this.camera.position.distanceTo(this.controls.target));
    const fromTarget = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(this.camera.quaternion)
      .multiplyScalar(lookDistance)
      .add(this.camera.position);
    this.startTransition({
      fromPosition: this.camera.position.clone(),
      toPosition: new THREE.Vector3(position.x, position.y, position.z),
      fromTarget,
      toTarget: new THREE.Vector3(target.x, target.y, target.z),
      elapsed: 0,
      duration: Math.max(0.01, motion.duration(duration)),
      lift: 0,
    });
  }

  /** The current view as plain data, to hand back to `restore` later. Take it before another driver moves the camera. */
  snapshot(): CameraSnapshot {
    const { position } = this.camera;
    const { target } = this.controls;
    return {
      position: { x: position.x, y: position.y, z: position.z },
      target: { x: target.x, y: target.y, z: target.z },
      limits: { ...this.limits },
      minPolar: this.polar.min,
      maxPolar: this.polar.max,
    };
  }

  /**
   * Put the camera back to a `snapshot`: its limits, polar limits, eye and
   * target. With `animate` it eases there (default 0.9 s) through the normal
   * transition machinery - player input still interrupts it - otherwise it
   * jumps. Call it after clearing a camera driver so the orbit view resumes
   * from exactly where the player left it.
   *
   * A snapshot that went through storage is checked like `setPolarLimits`
   * input: a broken (NaN, null) polar end falls back to its default, a broken
   * limit to the site default, and a broken eye or target keeps the current one.
   */
  restore(snapshot: CameraSnapshot, opts: { animate?: boolean; duration?: number } = {}): void {
    this.limits = safeLimits(snapshot.limits);
    this.polar = polarRange(snapshot.minPolar, snapshot.maxPolar);
    const position = safePoint(snapshot.position, this.camera.position);
    const target = safePoint(snapshot.target, this.controls.target);
    if (opts.animate) {
      this.transitionToPose(position, target, finiteOr(opts.duration, TRANSITION_SECONDS));
      this.looseClamps = true;
      this.applyClamps();
      return;
    }
    this.cancelTransition();
    this.applyClamps();
    this.controls.target.set(target.x, target.y, target.z);
    this.camera.position.set(position.x, position.y, position.z);
    this.controls.update();
  }

  /** Stop an easing move where it is (no jump to its end). */
  cancelTransition(): void {
    this.transition = null;
    if (!this.looseClamps) return;
    this.looseClamps = false;
    this.applyClamps();
  }

  /**
   * Travel across the world to `point`: longer trips take a little longer
   * and rise in a soft arc, so the child sees where they are going.
   */
  flyTo(point: CameraFocusPoint, view: CameraView = {}): void {
    const travel = Math.hypot(point.x - this.controls.target.x, point.z - this.controls.target.z);
    const duration = THREE.MathUtils.clamp(0.9 + travel / 320, 0.9, 2.4);
    this.transitionTo(point, view, duration, Math.min(travel * 0.3, 140));
  }

  /** Current heading in degrees (see CameraView.azimuth). */
  get azimuth(): number {
    const offset = this.scratch.copy(this.camera.position).sub(this.controls.target);
    return THREE.MathUtils.radToDeg(Math.atan2(offset.x, offset.z));
  }

  /** Distance from the camera to its focus point. */
  get distance(): number {
    return this.camera.position.distanceTo(this.controls.target);
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
    this.keepInside();
  }

  /** Pull the focus point (and the camera with it) back inside the world. */
  private keepInside(): void {
    const half = this.limits.halfSize;
    if (half === null || this.looseClamps) return;
    const target = this.controls.target;
    const x = THREE.MathUtils.clamp(target.x, -half, half);
    const z = THREE.MathUtils.clamp(target.z, -half, half);
    if (x === target.x && z === target.z) return;
    const dx = x - target.x;
    const dz = z - target.z;
    target.x = x;
    target.z = z;
    this.camera.position.x += dx;
    this.camera.position.z += dz;
  }

  dispose(): void {
    this.offMotion();
    this.domElement.removeEventListener('pointerdown', this.onTouchDown);
    this.domElement.removeEventListener('pointermove', this.onTouchMove);
    this.domElement.removeEventListener('pointerup', this.onTouchEnd);
    this.domElement.removeEventListener('pointercancel', this.onTouchEnd);
    this.controls.dispose();
  }

  // ------------------------------------------------------------ touch gestures

  private readonly onTouchDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    this.activeTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.activeTouches.size === 2) this.beginTouchGesture();
  };

  private readonly onTouchMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' || !this.activeTouches.has(event.pointerId)) return;
    this.activeTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.activeTouches.size === 2 && this.touchGestureBase) this.applyTouchGesture();
  };

  private readonly onTouchEnd = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    this.activeTouches.delete(event.pointerId);
    if (this.activeTouches.size < 2) this.touchGestureBase = null;
    // A third finger lifting can leave exactly two still down - start fresh from here rather than jumping.
    else if (this.activeTouches.size === 2) this.beginTouchGesture();
  };

  /**
   * Two fingers down: snapshot their configuration and the camera's current
   * spherical position, so every subsequent move is a delta from here (never
   * absolute), which is what keeps the gesture from jumping.
   */
  private beginTouchGesture(): void {
    // A gizmo drag (or anything else) already disabled the camera - touch input defers to it, exactly like a mouse would.
    if (!this.controls.enabled) return;
    this.cancelTransition();
    const [a, b] = [...this.activeTouches.values()];
    this.touchGestureBase = {
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      targetX: this.controls.target.x,
      targetZ: this.controls.target.z,
      cameraDistance: this.distance,
      azimuthDeg: this.azimuth,
    };
  }

  /** Pinch to zoom, drag the midpoint to pan, twist to orbit - all three read from the same two touch points every frame. */
  private applyTouchGesture(): void {
    const base = this.touchGestureBase;
    if (!base || !this.controls.enabled) return;
    const points = [...this.activeTouches.values()];
    if (points.length < 2) return;
    const [a, b] = points;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const angle = Math.atan2(b.y - a.y, b.x - a.x);

    const newDistance = THREE.MathUtils.clamp(
      base.cameraDistance * (base.distance / dist),
      this.limits.minDistance,
      this.limits.maxDistance,
    );
    const azimuthDeg = base.azimuthDeg - THREE.MathUtils.radToDeg(angle - base.angle);
    const elevationDeg = this.elevationDeg();

    const azRad = THREE.MathUtils.degToRad(azimuthDeg);
    const forward = { x: -Math.sin(azRad), z: -Math.cos(azRad) };
    const right = { x: Math.cos(azRad), z: -Math.sin(azRad) };
    const dx = midX - base.midX;
    const dy = midY - base.midY;
    const viewportHeight = Math.max(1, this.domElement.clientHeight);
    const worldPerPixel = (2 * newDistance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / viewportHeight;

    const targetX = base.targetX - (right.x * dx + forward.x * dy) * worldPerPixel;
    const targetZ = base.targetZ - (right.z * dx + forward.z * dy) * worldPerPixel;

    this.controls.target.set(targetX, this.controls.target.y, targetZ);
    this.camera.position.copy(
      this.positionFor(
        { x: targetX, y: this.controls.target.y, z: targetZ },
        { distance: newDistance, azimuth: azimuthDeg, elevation: elevationDeg },
        this.scratch,
      ),
    );
    this.controls.update();
  }

  private elevationDeg(): number {
    const offset = this.scratch.copy(this.camera.position).sub(this.controls.target);
    const horizontalDistance = Math.max(0.0001, offset.length());
    return THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(offset.y / horizontalDistance, -1, 1)));
  }

  private stepTransition(deltaSeconds: number): void {
    const t = this.transition;
    if (!t) return;
    t.elapsed = Math.min(t.duration, t.elapsed + deltaSeconds);
    const k = easeInOutCubic(t.elapsed / t.duration);
    this.camera.position.lerpVectors(t.fromPosition, t.toPosition, k);
    if (t.lift > 0) this.camera.position.y += Math.sin(Math.PI * k) * t.lift;
    this.controls.target.lerpVectors(t.fromTarget, t.toTarget, k);
    if (t.elapsed >= t.duration) this.cancelTransition();
    this.controls.update();
  }

  /** Begin an easing move; a new move replaces the old one and its loosened clamps. */
  private startTransition(transition: Transition): void {
    this.cancelTransition();
    this.transition = transition;
  }

  /** Push the zoom and tilt limits to OrbitControls (wide open during an animated restore). */
  private applyClamps(): void {
    const loose = this.looseClamps;
    this.controls.minDistance = loose ? 0 : this.limits.minDistance;
    this.controls.maxDistance = loose ? Infinity : this.limits.maxDistance;
    this.controls.minPolarAngle = loose ? 0 : this.polar.min;
    this.controls.maxPolarAngle = loose ? Math.PI : this.polar.max;
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
