import * as THREE from 'three';
import type { GameStore } from '@/state/GameStore';
import type { GameActions, TemplateInstantiateResult } from '@/state/actions';
import type { Vec3 } from '@/construction/PlacedObject';
import type { GameState } from '@/state/GameState';
import type { World } from '@/world/World';
import type { InputManager } from '@/input/InputManager';
import type { PointerClick, PointerPosition } from '@/input/PointerInput';
import type { KeyPress } from '@/input/KeyboardInput';
import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import { roleOf } from '@/construction/ConstructionObjectDefinition';
import { ConstructionRaycaster } from '@/construction/ConstructionRaycaster';
import { computeBounds } from '@/construction/bounds';
import { findInvalidReason, objectsNear, unionBounds, type PlacementRulesContext } from '@/construction/PlacementResolver';
import { rotateAroundY } from '@/utils/math';
import type { TemplateObjectSpec, TemplateRegistry } from './Template';
import type { GhostKit } from './Ghosts';

interface GhostPiece {
  spec: TemplateObjectSpec;
  object: THREE.Object3D;
}

/**
 * Drives positioning a creative template (a Build Intent style or a
 * browsed template) before it becomes real objects: a translucent 3D ghost
 * of the whole arrangement follows the pointer, Rotate turns it, a tap
 * confirms it through `actions.instantiateTemplate` exactly like any other
 * placement, and the result is selected so World Studio can offer "Make it
 * yours" right away.
 *
 * Deliberately separate from `ConstructionController`, which keeps owning
 * single-object placement; the two are mutually exclusive via
 * `state.templatePlacement` (see actions.ts).
 */
export class TemplatePlacementController {
  private readonly group = new THREE.Group();
  private readonly raycaster: ConstructionRaycaster;
  private pieces: GhostPiece[] = [];
  private currentTemplateId: string | null = null;
  private lastGround: { x: number; y: number; z: number } | null = null;
  private allFit = true;
  private readonly disposers: Array<() => void> = [];

  /** Called after a template is placed, with its world centre and rough size - lets Game.ts frame it. */
  onPlaced: ((center: { x: number; y: number; z: number }, radius: number) => void) | null = null;
  /** Called after a template is placed, with where it went and what was made (see src/creative/plan). */
  onBuilt: ((templateId: string, at: { origin: Vec3; rotationY: number }, result: TemplateInstantiateResult) => void) | null = null;

  constructor(
    private readonly store: GameStore,
    private readonly actions: GameActions,
    private readonly registry: ObjectRegistry,
    private readonly templates: TemplateRegistry,
    private readonly ghosts: GhostKit,
    private readonly world: World,
    private readonly input: InputManager,
    private readonly placementRules: PlacementRulesContext,
  ) {
    this.group.visible = false;
    this.group.name = 'templateGhost';
    this.world.overlayRoot.add(this.group);
    this.raycaster = new ConstructionRaycaster(world.camera);
  }

  /** Whether every piece of the ghost currently fits where it is (soft guidance only). */
  get fits(): boolean {
    return this.allFit;
  }

  /** Whether the ghost has a spot under the pointer yet (the "Place here" button needs one); a pinned ghost always has. */
  get hasSpot(): boolean {
    return this.lastGround !== null || !!this.store.getState().templatePlacement?.origin;
  }

  start(): void {
    this.disposers.push(
      this.store.subscribe((state) => this.onStateChanged(state)),
      this.input.pointer.on('click', this.onClick),
      this.input.keyboard.on('keydown', this.onKeyDown),
    );
    this.onStateChanged(this.store.getState());
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    this.disposers.length = 0;
    this.clearGhost();
    this.world.overlayRoot.remove(this.group);
  }

  /** Called every frame; keeps the ghost glued to the ground under the pointer (unless it is pinned). */
  update(): void {
    const state = this.store.getState();
    if (!state.templatePlacement || state.templatePlacement.origin) return;
    const pointer = this.input.pointer.position;
    if (pointer) this.moveTo(pointer, state);
  }

  /** Confirm at the last spot the ghost was shown at (the on-screen "Place here" button). */
  confirm(): boolean {
    // A pinned preview is confirmed where it is pinned, even before this controller has seen the state change.
    const spot = this.store.getState().templatePlacement?.origin ?? this.lastGround;
    if (!spot) return false;
    return this.placeAt(spot);
  }

  private moveTo(pointer: PointerPosition, state: GameState): void {
    const point = this.groundPoint(pointer);
    if (!point) return;
    this.lastGround = point;
    this.group.visible = state.templatePlacement !== null;
    this.group.position.set(point.x, point.y, point.z);
    this.group.rotation.set(0, state.templatePlacement?.rotationY ?? 0, 0);
    this.updateValidity(state, point);
  }

  /** The ground point under the pointer, snapped to a half-metre grid so arrangements line up with each other and with drawn streets. */
  private groundPoint(pointer: PointerPosition): { x: number; y: number; z: number } | null {
    const hit = this.raycaster.hitSurface(pointer, this.world.ground, []);
    if (!hit) return null;
    return { x: Math.round(hit.point.x * 2) / 2, y: 0, z: Math.round(hit.point.z * 2) / 2 };
  }

  private onStateChanged(state: GameState): void {
    const templateId = state.templatePlacement?.templateId ?? null;
    if (templateId !== this.currentTemplateId) {
      this.currentTemplateId = templateId;
      this.rebuildGhost(templateId);
      if (templateId === null) this.lastGround = null;
    }
    const pinned = state.templatePlacement?.origin;
    if (pinned) {
      this.lastGround = { ...pinned };
      this.group.position.set(pinned.x, pinned.y, pinned.z);
    }
    this.group.visible = templateId !== null && this.lastGround !== null;
    if (state.templatePlacement) {
      this.group.rotation.set(0, state.templatePlacement.rotationY, 0);
      if (this.lastGround) this.updateValidity(state, this.lastGround);
    }
  }

  private rebuildGhost(templateId: string | null): void {
    this.clearGhost();
    if (!templateId) return;
    const template = this.templates.get(templateId);
    if (!template) return;
    for (const spec of template.objects) {
      const definition = this.registry.get(spec.definitionId);
      if (!definition) continue;
      const object = this.ghosts.create(definition);
      object.position.set(spec.position.x, spec.position.y, spec.position.z);
      object.rotation.set(0, spec.rotationY ?? 0, 0);
      if (spec.scale) object.scale.set(spec.scale.x, spec.scale.y, spec.scale.z);
      this.group.add(object);
      this.pieces.push({ spec, object });
    }
  }

  private clearGhost(): void {
    for (const piece of this.pieces) {
      this.ghosts.discard(piece.object);
      this.group.remove(piece.object);
    }
    this.pieces = [];
  }

  /** Each piece is tinted on its own: the child sees exactly which part will not fit. */
  private updateValidity(state: GameState, origin: { x: number; y: number; z: number }): void {
    const rotationY = state.templatePlacement?.rotationY ?? 0;
    // A new version of a creation is judged without the version it replaces.
    const revise = state.templatePlacement?.revise;
    const ignore = revise ? [...revise.replace, ...revise.carry] : [];
    let allFit = true;
    // Openings and stacked pieces follow their host; the ground pieces are judged.
    const ground = this.pieces.flatMap((piece) => {
      const { spec } = piece;
      const definition = this.registry.get(spec.definitionId);
      if (!definition || spec.hostRef || spec.supportRef) return [];
      const offset = rotateAroundY(spec.position.x, spec.position.z, rotationY);
      const position = { x: origin.x + offset.x, y: origin.y + spec.position.y, z: origin.z + offset.z };
      return [{ piece, bounds: computeBounds(definition, position, (spec.rotationY ?? 0) + rotationY, spec.scale ?? { x: 1, y: 1, z: 1 }) }];
    });
    // Only what stands within the ghost's footprint can clash with it.
    const area = unionBounds(ground.map((g) => g.bounds));
    const near = area ? objectsNear(area, state.placedObjects, this.registry) : [];
    for (const { piece, bounds } of ground) {
      const fits = findInvalidReason(bounds, near, this.registry, this.placementRules, ignore) === null;
      this.ghosts.setValid(piece.object, fits);
      if (!fits) allFit = false;
    }
    for (const piece of this.pieces) {
      const dependsOn = piece.spec.hostRef ?? piece.spec.supportRef;
      if (!dependsOn) continue;
      const host = this.pieces.find((p) => p.spec.localId === dependsOn);
      if (host) this.ghosts.setValid(piece.object, host.object.userData.ghostValid !== false);
    }
    this.allFit = allFit;
  }

  private placeAt(origin: { x: number; y: number; z: number }): boolean {
    const state = this.store.getState();
    const placement = state.templatePlacement;
    if (!placement) return false;
    const template = this.templates.get(placement.templateId);
    if (!template) return false;

    // Drop the ghost first: otherwise every piece placed below would re-check
    // the whole (about to vanish) ghost against the growing world.
    this.actions.cancelTemplatePlacement();
    const revise = placement.revise;
    const result = this.actions.instantiateTemplate(
      template,
      origin,
      placement.rotationY,
      placement.creationId ?? template.id,
      revise ? { replace: revise.replace, carry: { ids: revise.carry, from: revise.from } } : {},
    );
    this.onBuilt?.(placement.templateId, { origin: { ...origin }, rotationY: placement.rotationY }, result);
    if (result.ids.length === 0) return false;

    const primary = this.primaryOf(result.ids);
    if (primary) this.actions.focusCreation(placement.creationId ?? template.id, primary, placement.label ?? template.name);
    const radius = template.objects.reduce((r, spec) => Math.max(r, Math.hypot(spec.position.x, spec.position.z)), 0);
    this.onPlaced?.(origin, radius + 4);
    return true;
  }

  /** The piece that best stands for the whole creation: a building, else the roof, the floor, the first piece. */
  private primaryOf(ids: string[]): string | null {
    const placed = this.store.getState().placedObjects.filter((p) => ids.includes(p.id));
    const rank = (definitionId: string): number => {
      const definition = this.registry.get(definitionId);
      if (!definition) return 9;
      if (definition.category === 'buildings') return 0;
      const role = roleOf(definition);
      if (role === 'roof') return 1;
      if (role === 'floor') return 2;
      if (definition.category === 'nature') return 3;
      if (definition.category === 'roads') return 4;
      return 5;
    };
    placed.sort((a, b) => rank(a.definitionId) - rank(b.definitionId));
    return placed[0]?.id ?? null;
  }

  private readonly onClick = (click: PointerClick): void => {
    if (click.button !== 0) return;
    const state = this.store.getState();
    if (!state.templatePlacement) return;
    // A pinned preview is never built by a stray tap: the tap moves it, and
    // only the explicit confirm (button / Enter) builds it.
    if (state.templatePlacement.origin) {
      const point = this.groundPoint(click);
      if (point) this.actions.moveTemplatePlacement(point);
      return;
    }
    // Use the click's own coordinates, not the last hover frame: a tap can
    // arrive without any preceding move (touch, or enter-and-click).
    this.moveTo(click, state);
    if (this.lastGround) this.placeAt(this.lastGround);
  };

  private readonly onKeyDown = (key: KeyPress): void => {
    const state = this.store.getState();
    if (!state.templatePlacement) return;
    if (key.code === 'KeyR') this.actions.rotateTemplatePlacement(key.shift ? -1 : 1);
    else if (key.code === 'Escape') this.actions.cancelTemplatePlacement();
    else if (key.code === 'Enter') this.confirm();
  };
}
