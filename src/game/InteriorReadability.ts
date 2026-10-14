import type { Camera } from 'three';
import type { GameStore } from '@/state/GameStore';
import { isPlacementMode, type GameState } from '@/state/GameState';
import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import type { ConstructionRenderer } from '@/construction/ConstructionRenderer';
import type { PlacedObject, Vec3 } from '@/construction/PlacedObject';
import { roleOf } from '@/construction/ConstructionObjectDefinition';
import { boundsOfPlaced, computeBounds, type Bounds } from '@/construction/bounds';
import { PLACEMENT_ROTATION_STEP } from '@/construction/constants';
import { findOccluders, type OccluderBox } from '@/construction/wallOcclusion';
import type { ChallengeRegistry } from '@/challenges/ChallengeRegistry';
import { blueprintWorldPosition } from '@/challenges/Blueprint';

const UNIT_SCALE: Vec3 = { x: 1, y: 1, z: 1 };
/** Camera movement below this (metres) does not trigger a recompute. */
const CAMERA_EPSILON = 1e-4;
/** Roles that can stand between the camera and an interior target. */
const OCCLUDER_ROLES: ReadonlySet<string> = new Set(['wall', 'roof']);

/**
 * Presentation-only interior readability ("cutaway").
 *
 * While the player is placing an object in a challenge, the unmatched
 * blueprint targets of that object are the focus; a selected placed object
 * is a focus too. Any wall or roof whose box lies on the line from the camera
 * to a focus point is drawn faded by the renderer, together with the doors
 * and windows set into it. The occluders of the placement targets are also
 * handed to the placement ray, which sees through them so a target the
 * player can see is a target the player can click. Nothing else changes:
 * the objects stay in state, keep their geometry, still count for overlap,
 * support and matching, and still catch selection clicks.
 *
 * Work happens only when the camera has moved or when the relevant state
 * changed (placed objects, selection, tool, match, level, mode); otherwise
 * `update()` is a handful of comparisons and returns.
 */
export class InteriorReadability {
  /** Focus points of the active placement targets (they drive see-through). */
  private readonly placementFocus: Vec3[] = [];
  /** Focus points of the selected placed object (fade only, never see-through). */
  private readonly selectionFocus: Vec3[] = [];
  /** Every focus point: a wall holding any of them is a host and never fades. */
  private readonly allFocus: Vec3[] = [];
  /** Occluders of the active placement target: faded AND see-through for the placement ray. */
  private readonly placementOccluders = new Set<string>();
  private readonly occluders: OccluderBox[] = [];
  private occludersSource: PlacedObject[] | null = null;
  private readonly faded = new Set<string>();
  private lastX = Number.NaN;
  private lastY = Number.NaN;
  private lastZ = Number.NaN;
  private lastState: GameState | null = null;
  private lastPlacing = false;
  private recomputeCount = 0;

  constructor(
    private readonly store: GameStore,
    private readonly registry: ObjectRegistry,
    private readonly challenges: ChallengeRegistry,
    private readonly camera: Camera,
    private readonly renderer: ConstructionRenderer,
  ) {}

  private peeking = false;
  /** Interior Explorer's dollhouse cutaway: one house's roof and outer walls. */
  private cutaway: ReadonlySet<string> = new Set();

  /**
   * My World "peek inside": roofs are drawn see-through and taps pass
   * through them to the rooms below. Presentation only - the roofs stay in
   * the world, unchanged.
   */
  setPeekInside(on: boolean): void {
    if (on === this.peeking) return;
    this.peeking = on;
    this.lastState = null; // recompute on the next frame
  }

  get peekInside(): boolean {
    return this.peeking;
  }

  /**
   * Interior Explorer's dollhouse view: the given pieces (one house's roof
   * and outer walls) are drawn faded, with the doors and windows set into
   * them, and taps pass through them to the rooms. Null or empty: none.
   * My World only; presentation only, like peek inside.
   */
  setInteriorCutaway(ids: Iterable<string> | null): void {
    this.cutaway = new Set(ids ?? []);
    this.lastState = null; // recompute on the next frame
  }

  /** Ids currently drawn faded (diagnostics and tests). */
  get fadedIds(): ReadonlySet<string> {
    return this.faded;
  }

  /** How many times the fade set was recomputed (diagnostics). */
  get recomputations(): number {
    return this.recomputeCount;
  }

  /**
   * Walls/roofs (and the openings set into them) that hide the unmatched
   * targets of the object being placed, for the current camera. The
   * placement ray sees through exactly these; empty when not placing.
   */
  get placementOccluderIds(): ReadonlySet<string> {
    return this.placementOccluders;
  }

  /** Current focus points (diagnostics). */
  get focusPoints(): readonly Vec3[] {
    return [...this.placementFocus, ...this.selectionFocus];
  }

  update(): void {
    const state = this.store.getState();
    const p = this.camera.position;
    const moved =
      !(Math.abs(p.x - this.lastX) <= CAMERA_EPSILON) ||
      !(Math.abs(p.y - this.lastY) <= CAMERA_EPSILON) ||
      !(Math.abs(p.z - this.lastZ) <= CAMERA_EPSILON);
    const placing = isPlacementMode(state);
    if (!moved && !this.inputsChanged(state, placing)) return;

    this.lastX = p.x;
    this.lastY = p.y;
    this.lastZ = p.z;
    this.lastState = state;
    this.lastPlacing = placing;
    this.recompute(state, placing, { x: p.x, y: p.y, z: p.z });
  }

  private inputsChanged(state: GameState, placing: boolean): boolean {
    const last = this.lastState;
    return (
      last === null ||
      placing !== this.lastPlacing ||
      last.mode !== state.mode ||
      last.placedObjects !== state.placedObjects ||
      last.selectedObjectId !== state.selectedObjectId ||
      last.selectedInstanceId !== state.selectedInstanceId ||
      last.challengeMatch !== state.challengeMatch ||
      last.challenge?.challengeId !== state.challenge?.challengeId
    );
  }

  private recompute(state: GameState, placing: boolean, camera: Vec3): void {
    this.recomputeCount++;
    this.collectFocus(state, placing);
    this.placementOccluders.clear();
    this.faded.clear();
    if (this.placementFocus.length > 0 || this.selectionFocus.length > 0) {
      this.refreshOccluders(state.placedObjects);
      this.allFocus.length = 0;
      this.allFocus.push(...this.placementFocus, ...this.selectionFocus);
      findOccluders(camera, this.placementFocus, this.occluders, this.placementOccluders, this.allFocus);
      this.addHostedOpenings(state.placedObjects, this.placementOccluders);
      this.placementOccluders.forEach((id) => this.faded.add(id));
      findOccluders(camera, this.selectionFocus, this.occluders, this.faded, this.allFocus);
      this.addHostedOpenings(state.placedObjects, this.faded);
    }
    const roofs = new Set<string>();
    if (this.peeking && state.challenge === null) {
      for (const placed of state.placedObjects) {
        const definition = this.registry.get(placed.definitionId);
        if (definition && roleOf(definition) === 'roof') roofs.add(placed.id);
      }
      roofs.forEach((id) => this.faded.add(id));
    }
    if (this.cutaway.size > 0 && state.challenge === null) {
      const cut = new Set(this.cutaway);
      this.addHostedOpenings(state.placedObjects, cut);
      cut.forEach((id) => {
        roofs.add(id);
        this.faded.add(id);
      });
    }
    this.renderer.setPassThrough(roofs);
    this.renderer.setFaded(this.faded);
  }

  /** A door or window set into a listed wall joins it (it sits inside the wall). */
  private addHostedOpenings(placedObjects: PlacedObject[], ids: Set<string>): void {
    if (ids.size === 0) return;
    for (const placed of placedObjects) {
      if (placed.hostId && ids.has(placed.hostId)) ids.add(placed.id);
    }
  }

  private collectFocus(state: GameState, placing: boolean): void {
    this.placementFocus.length = 0;
    this.selectionFocus.length = 0;
    if (state.mode !== 'playing') return;

    if (placing && state.selectedObjectId && state.challenge) {
      const challenge = this.challenges.get(state.challenge.challengeId);
      const definition = this.registry.get(state.selectedObjectId);
      if (challenge && definition) {
        const missing = state.challengeMatch ? new Set(state.challengeMatch.missing) : null;
        for (const target of challenge.blueprint.objects) {
          if (target.definitionId !== definition.id) continue;
          if (missing && !missing.has(target.id)) continue;
          const position = blueprintWorldPosition(challenge.buildOrigin, target);
          this.addFocusBox(
            this.placementFocus,
            computeBounds(definition, position, target.rotationStep * PLACEMENT_ROTATION_STEP, UNIT_SCALE),
          );
        }
      }
    }

    if (state.selectedInstanceId) {
      const placed = state.placedObjects.find((p) => p.id === state.selectedInstanceId);
      const definition = placed ? this.registry.get(placed.definitionId) : undefined;
      if (placed && definition) this.addFocusBox(this.selectionFocus, boundsOfPlaced(definition, placed));
    }
  }

  /** A target is looked at through its centre and just above its base (where it is placed). */
  private addFocusBox(into: Vec3[], b: Bounds): void {
    const x = (b.minX + b.maxX) / 2;
    const z = (b.minZ + b.maxZ) / 2;
    into.push({ x, y: (b.minY + b.maxY) / 2, z });
    into.push({ x, y: b.minY + Math.min(0.05, (b.maxY - b.minY) / 2), z });
  }

  private refreshOccluders(placedObjects: PlacedObject[]): void {
    if (this.occludersSource === placedObjects) return;
    this.occludersSource = placedObjects;
    this.occluders.length = 0;
    for (const placed of placedObjects) {
      const definition = this.registry.get(placed.definitionId);
      const role = definition ? roleOf(definition) : null;
      if (definition && role && OCCLUDER_ROLES.has(role)) {
        this.occluders.push({ id: placed.id, bounds: boundsOfPlaced(definition, placed) });
      }
    }
  }
}
