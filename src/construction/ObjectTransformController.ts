import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { GameStore } from '@/state/GameStore';
import type { GameActions } from '@/state/actions';
import type { GameState } from '@/state/GameState';
import type { World } from '@/world/World';
import type { ObjectRegistry } from './ObjectRegistry';
import type { ConstructionRenderer } from './ConstructionRenderer';
import { PlacementResolver, type PlacementRulesContext } from './PlacementResolver';
import { PLACEMENT_ROTATION_STEP } from './constants';
import { transformCapabilitiesOf, hasAnyCapability } from './TransformCapabilities';

type GizmoMode = 'translate' | 'rotate';

/**
 * Drives one reusable three.js `TransformControls` gizmo for the selected
 * placed object. The gizmo never owns gameplay truth:
 *
 *   drag (objectChange) ──▶ live validity check (resolveMove/resolveRotate)
 *                              │                        │
 *                        tint the outline          (no state write)
 *
 *   release (dragging-changed) ──▶ actions.move/rotateSelectedPlacedObject
 *                                     │                       │
 *                              store updated            rejected: renderer
 *                              (renderer re-syncs           .resync() snaps
 *                               the mesh from state)         the mesh back
 *
 * Only 'move' and 'rotate' use the 3D gizmo, restricted to the horizontal
 * plane / yaw ring since nothing in the catalogue currently permits vertical
 * movement or tilt (see TransformCapabilities). Scale has no 3D handle: it
 * is a stepped +/- control in the HUD, safer for small hands and for a
 * uniform, collision-checked multiplier than a freeform drag handle.
 */
export class ObjectTransformController {
  private readonly controls: TransformControls;
  /** Own resolver for read-only validity checks while dragging; never writes state. */
  private readonly resolver: PlacementResolver;
  private currentInstanceId: string | null = null;
  private appliedMode: GizmoMode | null = null;
  /** Consumed by ConstructionController so a drag-ending click never re-selects. */
  private suppressNextClick = false;

  constructor(
    private readonly store: GameStore,
    private readonly actions: GameActions,
    private readonly registry: ObjectRegistry,
    private readonly renderer: ConstructionRenderer,
    private readonly world: World,
    placementRules: PlacementRulesContext,
  ) {
    this.resolver = new PlacementResolver(registry, placementRules);
    this.controls = new TransformControls(world.camera, world.renderer.domElement);
    this.controls.rotationSnap = PLACEMENT_ROTATION_STEP;
    this.controls.size = 0.9;
    world.overlayRoot.add(this.controls.getHelper());

    this.controls.addEventListener('dragging-changed', (event) => {
      this.world.cameraController.setEnabled(!event.value);
      if (!event.value) {
        this.commit();
        this.suppressNextClick = true;
      }
    });
    this.controls.addEventListener('objectChange', this.onObjectChange);
  }

  /** True once per drag end; callers should skip the next click-to-select. */
  consumeSuppressClick(): boolean {
    const value = this.suppressNextClick;
    this.suppressNextClick = false;
    return value;
  }

  /** Re-evaluate what the gizmo should attach to and how, from the latest state. */
  sync(state: GameState): void {
    if (state.mode !== 'playing' || state.selectedObjectId !== null || !state.selectedInstanceId) {
      this.detach();
      return;
    }
    const placed = state.placedObjects.find((p) => p.id === state.selectedInstanceId);
    const definition = placed ? this.registry.get(placed.definitionId) : undefined;
    if (!placed || !definition) {
      this.detach();
      return;
    }

    const hostsOpenings = state.placedObjects.some((p) => p.hostId === placed.id);
    const caps = transformCapabilitiesOf(definition, state.challenge ? 'challenge' : 'freeplay', hostsOpenings);

    const gizmoMode: GizmoMode | null =
      state.transformMode === 'move' && caps.movable
        ? 'translate'
        : state.transformMode === 'rotate' && caps.rotatableY
          ? 'rotate'
          : null;

    if (!gizmoMode || !hasAnyCapability(caps)) {
      this.detach();
      return;
    }

    const object3D = this.renderer.getObject3D(placed.id);
    if (!object3D) {
      this.detach();
      return;
    }

    this.currentInstanceId = placed.id;
    if (this.controls.object !== object3D) this.controls.attach(object3D);
    if (this.appliedMode !== gizmoMode) {
      this.controls.mode = gizmoMode;
      this.applyAxisVisibility(gizmoMode);
      this.appliedMode = gizmoMode;
    }
  }

  dispose(): void {
    this.controls.removeEventListener('objectChange', this.onObjectChange);
    this.controls.dispose();
    this.world.overlayRoot.remove(this.controls.getHelper());
  }

  private detach(): void {
    if (this.currentInstanceId) this.renderer.setSelectionValid(this.currentInstanceId, true);
    this.controls.detach();
    this.currentInstanceId = null;
    this.appliedMode = null;
  }

  /** Only translate along the ground plane, or only spin around Y: no tilt, no free vertical drag. */
  private applyAxisVisibility(mode: GizmoMode): void {
    if (mode === 'translate') {
      this.controls.showX = true;
      this.controls.showY = false;
      this.controls.showZ = true;
      this.controls.showXY = false;
      this.controls.showYZ = false;
      this.controls.showXZ = true;
    } else {
      this.controls.showX = false;
      this.controls.showY = true;
      this.controls.showZ = false;
      this.controls.showE = false;
      this.controls.showXYZE = false;
    }
  }

  /** Live, read-only feedback while dragging: never writes to the store. */
  private readonly onObjectChange = (): void => {
    const id = this.currentInstanceId;
    const object = this.controls.object;
    if (!id || !object || !this.controls.dragging) return;
    const state = this.store.getState();
    const placed = state.placedObjects.find((p) => p.id === id);
    const definition = placed ? this.registry.get(placed.definitionId) : undefined;
    if (!placed || !definition) return;

    let valid: boolean;
    if (this.appliedMode === 'translate') {
      const candidate = this.resolver.resolveMove(placed, definition, { x: object.position.x, z: object.position.z }, placed.rotationY, state.placedObjects);
      valid = candidate?.status.valid ?? false;
    } else {
      const candidate = this.resolver.resolveRotate(placed, definition, object.rotation.y, state.placedObjects);
      valid = candidate?.status.valid ?? false;
    }
    this.renderer.setSelectionValid(id, valid);
  };

  /** Drag finished: commit the final transform, or snap the mesh back if invalid. */
  private commit(): void {
    const id = this.currentInstanceId;
    const object = this.controls.object as THREE.Object3D | undefined;
    if (!id || !object) return;

    let status = null;
    if (this.appliedMode === 'translate') {
      status = this.actions.moveSelectedPlacedObject(object.position.x, object.position.z);
    } else if (this.appliedMode === 'rotate') {
      status = this.actions.rotateSelectedPlacedObject(object.rotation.y);
    }
    if (!status?.valid) this.renderer.resync(id);
    this.renderer.setSelectionValid(id, true);
  }
}
