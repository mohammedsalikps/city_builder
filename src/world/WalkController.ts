import * as THREE from 'three';
import type { CameraDriver } from '@/world/World';
import { clamp } from '@/utils/math';

/**
 * Where the walker stands and looks. Rotation order is 'YXZ' (yaw, then
 * pitch): yaw 0 looks toward -Z and grows turning left, so
 *   forward = (-sin(yaw), 0, -cos(yaw)),  right = (cos(yaw), 0, -sin(yaw)).
 * Pitch 0 is level, negative looks down; it is kept within +/-0.95 rad.
 * `y` is the eye height above the ground.
 */
export interface WalkPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** Anything that knows which keys are held (KeyboardInput, or a stub in tests). */
export interface WalkInputSource {
  isDown(code: string): boolean;
}

/** Turns a wanted step into an allowed one (e.g. stops at walls); both points on the ground plane. */
export type WalkCollisionResolver = (from: { x: number; z: number }, to: { x: number; z: number }) => { x: number; z: number };

type WalkDom = Pick<HTMLElement, 'addEventListener' | 'removeEventListener'> & { clientWidth?: number; clientHeight?: number };

/** Up/down look limit, radians: enough to see the floor and the ceiling, never upside down. */
const PITCH_LIMIT = 0.95;
/**
 * Pixels a press may move (at its furthest) and still be a tap (object
 * selection) rather than a look-drag. PointerInput's click test is the
 * press's *final* distance (5 px or less), so a drag that comes back to its
 * start both looks and clicks: see `didLookSinceDown`.
 */
const DRAG_THRESHOLD_PX = 6;
/** Longest frame step simulated at once, so a hitch never teleports the walker. */
const MAX_STEP_SECONDS = 0.05;
/** Time to reach full walking speed from standing still. */
const ACCELERATION_SECONDS = 0.15;
/** Time to come to rest once nothing is pressed (a soft stop, not a skid). */
const STOP_SECONDS = 0.12;
/** The eye is this far above the floor; the focus point sits on the floor. */
const EYE_ABOVE_FLOOR = 1.45;
/** How far ahead of the walker the focus point sits. */
const FOCUS_AHEAD = 2.5;

const TAU = Math.PI * 2;

interface Ease {
  from: WalkPose;
  to: WalkPose;
  /** Signed shortest turn from `from.yaw` to `to.yaw`. */
  turn: number;
  elapsed: number;
  duration: number;
  resolve: () => void;
}

interface TrackedPointer {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  /** Moved past the tap threshold: this press is a look-drag now. */
  looking: boolean;
  /** Left the canvas meanwhile: the next move only sets a new starting point (no jump in the view). */
  rebase: boolean;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** The signed smallest angle that turns `from` into `to` (-PI..PI). */
export function shortestAngle(from: number, to: number): number {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) delta -= TAU;
  else if (delta < -Math.PI) delta += TAU;
  return delta;
}

function wrapAngle(angle: number): number {
  return shortestAngle(0, angle);
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * First-person walking camera for exploring inside a house: keys or the
 * on-screen joystick walk at a calm 1.6 m/s, dragging looks around, and
 * `setPose` glides the visitor to a spot (the front door, a room).
 *
 * It plugs into World.setCameraDriver: the World then calls `update` every
 * frame instead of the orbit camera, and the sun's shadows follow `focus`.
 * Short taps are left alone (only a press that moves more than 6 px turns
 * into a look-drag) so the child can still tap furniture to select it.
 *
 * A new walker starts enabled. One built ahead of time (e.g. at game start)
 * should be switched off with `setEnabled(false)` until it is needed;
 * otherwise it keeps listening to canvas drags made in the orbit view.
 *
 * Pure three.js + DOM events: no rendering, no document access, so it runs
 * headless in tests with a fake event target.
 */
export class WalkController implements CameraDriver {
  /** A point on the floor about 2.5 m ahead of the walker (the sun's shadow box follows it). */
  readonly focus = new THREE.Vector3();

  /** Walking speed, metres per second. */
  speed = 1.6;
  /** Turning speed for ArrowLeft/ArrowRight and Q/E, radians per second. */
  turnSpeed = 1.8;
  /** Look-drag sensitivity, radians per pixel. */
  lookSensitivity = 0.005;

  private readonly pose: WalkPose;
  private readonly velocity = { x: 0, z: 0 };
  private readonly stick = { x: 0, y: 0 };
  private on = true;
  private ease: Ease | null = null;
  private pointer: TrackedPointer | null = null;
  private collide: WalkCollisionResolver | null = null;
  private lookBlocked: (() => boolean) | null = null;
  /** See `poseToken`. */
  private token = 0;
  /** See `didLookSinceDown`. */
  private looked = false;
  /** What the walker last wrote to the camera, to notice when something else moved it since. */
  private readonly written = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  /** The camera shows `pose` (apart from look-drags still waiting for the next frame). */
  private synced = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: WalkDom,
    private readonly keys: WalkInputSource,
  ) {
    this.pose = this.readCameraPose();
    this.pose.pitch = clamp(this.pose.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    this.updateFocus();
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerEnd);
    dom.addEventListener('pointercancel', this.onPointerEnd);
    dom.addEventListener('pointerleave', this.onPointerLeave);
  }

  get enabled(): boolean {
    return this.on;
  }

  /**
   * Switch walking on or off. While off, `update` does nothing and pointers,
   * keys and the joystick are ignored. Switching off stops any glide where it
   * is - the pose stays on what the camera shows, so nothing jumps - and
   * resolves its promise (as a cancel: `poseToken` changes) so nothing waits
   * on a walker that is paused.
   */
  setEnabled(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.velocity.x = 0;
    this.velocity.z = 0;
    this.pointer = null;
    if (!on) this.finishEase(false);
  }

  get isEasing(): boolean {
    return this.ease !== null;
  }

  /**
   * Changes on every `setPose` call and whenever a glide is cut short (by a
   * newer setPose, `setEnabled(false)` or `dispose`). setPose's promise
   * resolves for an arrival and a cancel alike, and a cancelled glide's
   * `.then` runs after its replacement has already started, so a caller that
   * chains glides should check the token before going on:
   *
   *   const arrived = walker.setPose(door, { duration: 1 });
   *   const token = walker.poseToken;
   *   void arrived.then(() => { if (walker.poseToken === token) walker.setPose(inside, { duration: 1 }); });
   */
  get poseToken(): number {
    return this.token;
  }

  /**
   * True once the current press (or, after release, the most recent one)
   * moved far enough to turn the view; reset when the next press starts. A
   * click handler running on release can use it to skip selecting whatever
   * lies under a look-drag that ended near where it began.
   */
  get didLookSinceDown(): boolean {
    return this.looked;
  }

  /** Stop at walls and furniture: every step goes through `resolve` (null = walk anywhere). */
  setCollision(resolve: WalkCollisionResolver | null): void {
    this.collide = resolve;
  }

  /** While `isBlocked()` is true (e.g. a gizmo drag) pointers never turn into a look-drag. */
  setLookBlocked(isBlocked: (() => boolean) | null): void {
    this.lookBlocked = isBlocked;
  }

  /** On-screen joystick: x = strafe right, y = forward, each -1..1. */
  setMoveInput(x: number, y: number): void {
    this.stick.x = clamp(finiteOr(x, 0), -1, 1);
    this.stick.y = clamp(finiteOr(y, 0), -1, 1);
  }

  /**
   * Move the visitor to `pose`. With a `duration` (seconds) it glides there -
   * position, the shortest way round for yaw, and pitch - with a soft
   * ease-in-out; walking and looking are ignored meanwhile. The glide starts
   * from the walker's own pose while it is driving the camera (so a look-drag
   * made since the last frame is kept), and otherwise from wherever the
   * camera is right now, so it can fly in from the orbit view. (A jump made
   * while disabled was never shown, so it is not a starting point.)
   * Without a duration (or while disabled) it jumps. A new call cancels a
   * running glide and resolves its promise. Resolves when the visitor has
   * arrived or the glide was cancelled; `poseToken` tells the two apart.
   */
  setPose(pose: WalkPose, opts: { duration?: number } = {}): Promise<void> {
    this.finishEase(false);
    this.token++;
    const target = this.sanitize(pose);
    this.velocity.x = 0;
    this.velocity.z = 0;
    const duration = finiteOr(opts.duration ?? 0, 0);
    if (duration <= 0 || !this.on) {
      Object.assign(this.pose, target);
      if (this.on) this.applyToCamera();
      else {
        this.synced = false;
        this.updateFocus();
      }
      return Promise.resolve();
    }
    const from = this.cameraShowsWalker() ? { ...this.pose } : this.readCameraPose();
    return new Promise<void>((resolve) => {
      this.ease = { from, to: target, turn: shortestAngle(from.yaw, target.yaw), elapsed: 0, duration, resolve };
    });
  }

  /** Where the visitor stands and looks right now (a copy). */
  getPose(): WalkPose {
    return { ...this.pose };
  }

  update(deltaSeconds: number): void {
    if (!this.on) return;
    const dt = clamp(finiteOr(deltaSeconds, 0), 0, MAX_STEP_SECONDS);
    if (this.ease) this.stepEase(dt);
    else {
      this.turn(dt);
      this.walk(dt);
    }
    this.applyToCamera();
  }

  /** Stop listening and switch off for good: a later `update` (e.g. a stale World driver) moves nothing. */
  dispose(): void {
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    this.dom.removeEventListener('pointermove', this.onPointerMove);
    this.dom.removeEventListener('pointerup', this.onPointerEnd);
    this.dom.removeEventListener('pointercancel', this.onPointerEnd);
    this.dom.removeEventListener('pointerleave', this.onPointerLeave);
    this.setEnabled(false);
    this.collide = null;
    this.lookBlocked = null;
    this.setMoveInput(0, 0);
  }

  // ------------------------------------------------------------------ motion

  /** ArrowLeft/Q turn left (yaw grows), ArrowRight/E turn right. */
  private turn(dt: number): void {
    let turn = 0;
    if (this.held('ArrowLeft') || this.held('KeyQ')) turn += 1;
    if (this.held('ArrowRight') || this.held('KeyE')) turn -= 1;
    if (turn !== 0) this.pose.yaw = wrapAngle(this.pose.yaw + turn * this.turnSpeed * dt);
  }

  /**
   * Keys plus joystick become a wanted velocity (diagonals no faster than
   * straight lines); the actual velocity eases toward it, reaching full
   * speed in 0.15 s and stopping in 0.12 s. The step then goes through the
   * collision resolver, and whatever part of it a wall took away is dropped
   * from the velocity too, so the walker slides along walls instead of
   * pushing into them.
   */
  private walk(dt: number): void {
    if (dt <= 0) return;
    let forward = this.stick.y;
    let strafe = this.stick.x;
    if (this.held('KeyW') || this.held('ArrowUp')) forward += 1;
    if (this.held('KeyS') || this.held('ArrowDown')) forward -= 1;
    if (this.held('KeyD')) strafe += 1;
    if (this.held('KeyA')) strafe -= 1;
    const amount = Math.hypot(forward, strafe);
    if (amount > 1) {
      forward /= amount;
      strafe /= amount;
    }

    const sin = Math.sin(this.pose.yaw);
    const cos = Math.cos(this.pose.yaw);
    const wantX = (-sin * forward + cos * strafe) * this.speed;
    const wantZ = (-cos * forward - sin * strafe) * this.speed;
    const seconds = amount > 0 ? ACCELERATION_SECONDS : STOP_SECONDS;
    this.approachVelocity(wantX, wantZ, (this.speed / seconds) * dt);
    if (this.velocity.x === 0 && this.velocity.z === 0) return;

    const from = { x: this.pose.x, z: this.pose.z };
    const wanted = { x: from.x + this.velocity.x * dt, z: from.z + this.velocity.z * dt };
    const allowed = this.collide ? this.collide(from, wanted) : wanted;
    const x = finiteOr(allowed.x, from.x);
    const z = finiteOr(allowed.z, from.z);
    if (x !== wanted.x || z !== wanted.z) this.keepAllowedVelocity((x - from.x) / dt, (z - from.z) / dt);
    this.pose.x = x;
    this.pose.z = z;
  }

  /**
   * After a wall changed the step, keep only the motion that really happened
   * - never faster than before, so a resolver that pushes the walker out of
   * a wall cannot fling them across the room on the next frames.
   */
  private keepAllowedVelocity(x: number, z: number): void {
    const before = Math.hypot(this.velocity.x, this.velocity.z);
    const after = Math.hypot(x, z);
    const scale = after > before ? before / after : 1;
    this.velocity.x = x * scale;
    this.velocity.z = z * scale;
  }

  /** Move the velocity toward the wanted one by at most `maxChange` (m/s), landing on it exactly. */
  private approachVelocity(wantX: number, wantZ: number, maxChange: number): void {
    const dx = wantX - this.velocity.x;
    const dz = wantZ - this.velocity.z;
    const gap = Math.hypot(dx, dz);
    if (gap <= maxChange) {
      this.velocity.x = wantX;
      this.velocity.z = wantZ;
      return;
    }
    this.velocity.x += (dx / gap) * maxChange;
    this.velocity.z += (dz / gap) * maxChange;
  }

  private stepEase(dt: number): void {
    const ease = this.ease;
    if (!ease) return;
    ease.elapsed = Math.min(ease.duration, ease.elapsed + dt);
    if (ease.elapsed >= ease.duration) {
      this.finishEase();
      return;
    }
    this.placeOnEase(ease);
  }

  /** Put the pose where the glide is after `ease.elapsed` seconds. */
  private placeOnEase(ease: Ease): void {
    const k = easeInOutCubic(ease.elapsed / ease.duration);
    const { from, to } = ease;
    this.pose.x = from.x + (to.x - from.x) * k;
    this.pose.y = from.y + (to.y - from.y) * k;
    this.pose.z = from.z + (to.z - from.z) * k;
    this.pose.yaw = from.yaw + ease.turn * k;
    this.pose.pitch = from.pitch + (to.pitch - from.pitch) * k;
  }

  /**
   * End a glide. By default (an arrival) the visitor lands exactly on its
   * target pose. `land = false` (cut short by a new setPose, by switching off
   * or by dispose) leaves them where the glide had got to - which is what the
   * camera shows - and changes `poseToken`. Either way the promise resolves.
   */
  private finishEase(land = true): void {
    const ease = this.ease;
    if (!ease) return;
    this.ease = null;
    if (land) Object.assign(this.pose, ease.to);
    else {
      this.placeOnEase(ease);
      this.token++;
    }
    this.updateFocus();
    ease.resolve();
  }

  // ------------------------------------------------------------------ camera

  private applyToCamera(): void {
    this.camera.position.set(this.pose.x, this.pose.y, this.pose.z);
    this.camera.rotation.set(this.pose.pitch, this.pose.yaw, 0, 'YXZ');
    this.written.position.copy(this.camera.position);
    this.written.quaternion.copy(this.camera.quaternion);
    this.synced = true;
    this.updateFocus();
  }

  /** The camera still shows the walker's pose: nothing else has moved it since the walker last did. */
  private cameraShowsWalker(): boolean {
    return this.synced && this.camera.position.equals(this.written.position) && this.camera.quaternion.equals(this.written.quaternion);
  }

  private updateFocus(): void {
    const { x, y, z, yaw } = this.pose;
    this.focus.set(x - Math.sin(yaw) * FOCUS_AHEAD, y - EYE_ABOVE_FLOOR, z - Math.cos(yaw) * FOCUS_AHEAD);
  }

  /** The camera's current eye and view direction as a pose (pitch not clamped). */
  private readCameraPose(): WalkPose {
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const level = Math.hypot(look.x, look.z);
    const { x, y, z } = this.camera.position;
    return {
      x,
      y,
      z,
      // Looking straight up or down has no heading: keep the walker's own.
      yaw: level > 1e-6 ? Math.atan2(-look.x, -look.z) : (this.pose?.yaw ?? 0),
      pitch: Math.asin(clamp(look.y, -1, 1)),
    };
  }

  private sanitize(pose: WalkPose): WalkPose {
    const current = this.pose;
    return {
      x: finiteOr(pose.x, current.x),
      y: finiteOr(pose.y, current.y),
      z: finiteOr(pose.z, current.z),
      yaw: finiteOr(pose.yaw, current.yaw),
      pitch: clamp(finiteOr(pose.pitch, current.pitch), -PITCH_LIMIT, PITCH_LIMIT),
    };
  }

  private held(code: string): boolean {
    return this.keys.isDown(code);
  }

  // ------------------------------------------------------------------ look-drag

  /**
   * Remember the first press only: a second finger is ignored. A new
   * *primary* pointer always starts afresh, though - the browser only calls
   * a pointer primary when no other pointer of its kind is down, so the one
   * being tracked must have ended without us hearing (a lost touch-up would
   * otherwise lock looking for good). The same pointer pressing again means
   * its last release happened off the canvas. Never prevents the default:
   * the same press may still become a tap that selects an object, or a
   * gizmo drag.
   */
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.pointer && this.pointer.id !== event.pointerId && event.isPrimary !== true) return;
    this.pointer = null;
    this.looked = false;
    if (!this.on || this.lookBlocked?.()) return;
    const isMouse = event.pointerType === 'mouse';
    if (isMouse && event.button !== 0) return;
    if (!isMouse && event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    this.pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      looking: false,
      rebase: false,
    };
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const pointer = this.pointer;
    if (!pointer || event.pointerId !== pointer.id) return;
    // A mouse whose buttons are all up was released somewhere we did not hear about.
    if (event.pointerType === 'mouse' && typeof event.buttons === 'number' && event.buttons === 0) {
      this.pointer = null;
      return;
    }
    // Something else (a gizmo) claimed this press: it is not a look-drag.
    if (!this.on || this.lookBlocked?.()) {
      this.pointer = null;
      return;
    }
    if (pointer.rebase) {
      // Back from over a HUD panel: carry on from here instead of turning by the whole trip at once.
      pointer.rebase = false;
      pointer.lastX = event.clientX;
      pointer.lastY = event.clientY;
      return;
    }
    if (!pointer.looking) {
      if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) <= DRAG_THRESHOLD_PX) return;
      // Past the tap threshold: the view follows the pointer from where it was pressed.
      pointer.looking = true;
      this.looked = true;
    }
    const dx = event.clientX - pointer.lastX;
    const dy = event.clientY - pointer.lastY;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    if (this.ease) return;
    this.pose.yaw = wrapAngle(this.pose.yaw - dx * this.lookSensitivity);
    this.pose.pitch = clamp(this.pose.pitch - dy * this.lookSensitivity, -PITCH_LIMIT, PITCH_LIMIT);
    this.updateFocus();
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (this.pointer && event.pointerId === this.pointer.id) this.pointer = null;
  };

  /**
   * The canvas has no pointer capture during a look-drag (the orbit controls,
   * which would capture, are suspended), so while the pointer is over a HUD
   * panel its moves never arrive. Note it, and restart the deltas from
   * wherever the pointer comes back.
   */
  private readonly onPointerLeave = (event: PointerEvent): void => {
    if (this.pointer && event.pointerId === this.pointer.id) this.pointer.rebase = true;
  };
}
