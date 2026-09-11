import type { GameStore } from '@/state/GameStore';
import type { GameActions } from '@/state/actions';
import { isPlacementMode, type GameState } from '@/state/GameState';
import type { World } from '@/world/World';
import type { InputManager } from '@/input/InputManager';
import type { PointerClick, PointerPosition } from '@/input/PointerInput';
import type { KeyPress } from '@/input/KeyboardInput';
import type { ObjectRegistry } from './ObjectRegistry';
import { ConstructionResources } from './ConstructionResources';
import { ConstructionRenderer } from './ConstructionRenderer';
import { PlacementPreview } from './PlacementPreview';
import { ConstructionRaycaster } from './ConstructionRaycaster';
import { PlacementResolver, type PlacementCandidate, type PlacementRulesContext } from './PlacementResolver';
import type { AssetLibrary } from '@/visual/assets/AssetLibrary';
import { ObjectTransformController } from './ObjectTransformController';

/**
 * Glue between input, game state and the 3D construction visuals.
 *
 *   input ──▶ raycast ──▶ PlacementResolver ──▶ candidate
 *                                                 │
 *                       preview (every frame) ◀───┤
 *                       actions.placeObject (on click) ──▶ store
 *                                                            │
 *                       ConstructionRenderer ◀── state change┘
 *
 * The controller decides *what a click means* (place vs. select) based on
 * state; it never edits state directly and never builds meshes itself.
 */
const NO_SEE_THROUGH: ReadonlySet<string> = new Set();

export class ConstructionController {
  readonly resources: ConstructionResources;
  readonly renderer: ConstructionRenderer;
  readonly preview: PlacementPreview;
  readonly transform: ObjectTransformController;
  private readonly raycaster: ConstructionRaycaster;
  private readonly resolver: PlacementResolver;

  private readonly disposers: Array<() => void> = [];
  /**
   * Ids the placement ray may see through, read on every resolve. Supplied
   * by the interior readability system (the occluders of the active
   * placement target); empty unless an object is being placed. Selection
   * rays never use it.
   */
  private placementSeeThrough: () => ReadonlySet<string> = () => NO_SEE_THROUGH;
  private lastSynced: { placed: GameState['placedObjects']; selected: string | null } | null = null;

  constructor(
    private readonly store: GameStore,
    private readonly actions: GameActions,
    private readonly registry: ObjectRegistry,
    private readonly world: World,
    private readonly input: InputManager,
    placementRules: PlacementRulesContext,
    assets: AssetLibrary | null = null,
  ) {
    this.resources = new ConstructionResources(world.materials);
    this.renderer = new ConstructionRenderer(world.placementRoot, registry, this.resources, assets);
    this.preview = new PlacementPreview(world.overlayRoot, this.resources);
    this.raycaster = new ConstructionRaycaster(world.camera);
    this.resolver = new PlacementResolver(registry, placementRules);
    this.transform = new ObjectTransformController(store, actions, registry, this.renderer, world, placementRules);
  }

  start(): void {
    this.disposers.push(
      this.store.subscribe((state) => this.onStateChanged(state)),
      this.input.pointer.on('click', this.onClick),
      this.input.pointer.on('leave', () => this.clearPreview()),
      this.input.keyboard.on('keydown', this.onKeyDown),
    );
    this.onStateChanged(this.store.getState());
  }

  /**
   * Called every frame. The preview is re-resolved each frame rather than
   * only on pointer move, so it stays glued to surfaces while the camera is
   * still easing after an orbit.
   */
  update(): void {
    const state = this.store.getState();
    if (!isPlacementMode(state)) {
      this.clearPreview();
      return;
    }
    const pointer = this.input.pointer.position;
    const candidate = pointer ? this.resolveCandidate(pointer, state) : null;
    if (candidate) {
      this.preview.show(candidate.position, candidate.rotationY, candidate.status.valid);
      this.actions.setPlacementStatus(candidate.status);
    } else {
      this.clearPreview();
    }
  }

  /** Wire the source of see-through ids for the placement ray (see field doc). */
  setPlacementSeeThrough(source: () => ReadonlySet<string>): void {
    this.placementSeeThrough = source;
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    this.disposers.length = 0;
    this.transform.dispose();
    this.preview.dispose();
    this.renderer.dispose();
    this.resources.dispose();
  }

  // ------------------------------------------------------------ state sync

  private onStateChanged(state: GameState): void {
    const placedChanged = this.lastSynced?.placed !== state.placedObjects;
    const selectionChanged = this.lastSynced?.selected !== state.selectedInstanceId;
    if (placedChanged || selectionChanged) {
      this.renderer.sync(state.placedObjects, state.selectedInstanceId);
      this.lastSynced = { placed: state.placedObjects, selected: state.selectedInstanceId };
    }

    const definition = isPlacementMode(state) && state.selectedObjectId
      ? this.registry.get(state.selectedObjectId) ?? null
      : null;
    this.preview.setDefinition(definition);
    this.transform.sync(state);
  }

  // ----------------------------------------------------------------- input

  private readonly onClick = (click: PointerClick): void => {
    if (click.button !== 0) return;
    if (this.transform.consumeSuppressClick()) return;
    const state = this.store.getState();
    if (state.mode !== 'playing') return;

    if (isPlacementMode(state)) {
      const candidate = this.resolveCandidate(click, state);
      if (candidate?.status.valid) {
        this.actions.placeObject(candidate.position, {
          supportId: candidate.status.supportId,
          hostId: candidate.hostId,
          rotationY: candidate.rotationY,
          surface: candidate.status.surface,
        });
      }
      return;
    }

    const hitId = this.raycaster.hitPlacedObject(click, this.renderer.selectableMeshes);
    this.actions.selectPlacedObject(hitId);
  };

  private readonly onKeyDown = (key: KeyPress): void => {
    const state = this.store.getState();
    if (state.mode !== 'playing') return;

    switch (key.code) {
      case 'KeyR':
        if (isPlacementMode(state)) this.actions.rotatePlacement(key.shift ? -1 : 1);
        break;
      case 'KeyW':
        if (!isPlacementMode(state) && state.selectedInstanceId) this.actions.setTransformMode('move');
        break;
      case 'KeyE':
        if (!isPlacementMode(state) && state.selectedInstanceId) this.actions.setTransformMode('rotate');
        break;
      case 'KeyS':
        if (!isPlacementMode(state) && state.selectedInstanceId) this.actions.setTransformMode('scale');
        break;
      case 'Delete':
      case 'Backspace':
        this.actions.removeSelectedPlacedObject();
        break;
      case 'Escape':
        if (isPlacementMode(state)) this.actions.cancelPlacement();
        else this.actions.selectPlacedObject(null);
        break;
    }
  };

  // --------------------------------------------------------------- helpers

  /** Raycast the pointer and resolve where the selected object would land. */
  private resolveCandidate(pointer: PointerPosition, state: GameState): PlacementCandidate | null {
    if (!state.selectedObjectId) return null;
    const definition = this.registry.get(state.selectedObjectId);
    if (!definition) return null;

    const hit = this.raycaster.hitSurface(
      pointer,
      this.world.ground,
      this.renderer.selectableMeshes,
      this.placementSeeThrough(),
    );
    if (!hit) return null;

    // Validation below always sees every placed object, see-through or not.
    return this.resolver.resolve(hit, definition, this.actions.getPlacementRotation(), state.placedObjects);
  }

  private clearPreview(): void {
    this.preview.hide();
    this.actions.setPlacementStatus(null);
  }
}
