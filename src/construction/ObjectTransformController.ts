import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { GameStore } from '@/state/GameStore';
import type { GameActions } from '@/state/actions';
import type { GameState } from '@/state/GameState';
import type { World } from '@/world/World';
import type { ObjectRegistry } from './ObjectRegistry';
import type { ConstructionRenderer } from './ConstructionRenderer';
import { SELECTED_EDGE_COLOR, INVALID_EDGE_COLOR } from './ConstructionRenderer';
import { PlacementResolver, type PlacementRulesContext } from './PlacementResolver';
import { PLACEMENT_ROTATION_STEP } from './constants';
import { transformCapabilitiesOf, hasAnyCapability } from './TransformCapabilities';

type GizmoMode = 'translate' | 'rotate';

/** Base tone for the gizmo's handles at rest; matches the CSS `--ev-sun` token. */
const GIZMO_GOLD = 0xffb238;
/** Bigger overall gizmo (handles + their hit regions scale together) than three.js's raw default. */
const GIZMO_SIZE = 1.3;
/** Radius of the decorative "track" ring, just outside the native yaw handle (0.5). */
const RING_RADIUS = 0.62;

/**
 * Mirrors TransformControls' own `factor = distance * min(1.9 tan(fov/2) / zoom, 7)`
 * (see the vendored gizmo's `updateMatrixWorld`) so our custom accessories grow and
 * shrink in lockstep with the native handles at every camera distance.
 */
function billboardScale(camera: THREE.PerspectiveCamera, worldPosition: THREE.Vector3, size: number): number {
  const distance = camera.position.distanceTo(worldPosition);
  const factor = distance * Math.min((1.9 * Math.tan((Math.PI * camera.fov) / 360)) / camera.zoom, 7);
  return (factor * size) / 4;
}

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

  /** Eavara-styled accessories that sit alongside the (recoloured) native gizmo; purely decorative, never raycast. */
  private readonly moveAnchor: THREE.Group;
  private readonly turnRing: THREE.Group;
  /** Each accessory's own resting tone, so an invalid-drag tint can be reverted without flattening glow vs core accents. */
  private readonly accessoryMaterials: Array<{ material: THREE.MeshBasicMaterial; validColor: number }> = [];
  private readonly worldPositionScratch = new THREE.Vector3();

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
    this.controls.size = GIZMO_SIZE;
    world.overlayRoot.add(this.controls.getHelper());
    this.restyleGizmo();

    this.moveAnchor = this.buildMoveAnchor();
    this.turnRing = this.buildTurnRing();
    world.overlayRoot.add(this.moveAnchor, this.turnRing);

    this.controls.addEventListener('dragging-changed', (event) => {
      this.world.cameraController.setEnabled(!event.value);
      if (!event.value) {
        this.commit();
        this.suppressNextClick = true;
      }
    });
    this.controls.addEventListener('objectChange', this.onObjectChange);
  }

  /**
   * Recolour the vendored TransformControls gizmo to the Eavara palette using
   * its own public `setColors()` API (see the "materials... configurable via
   * setColors()" comment in three's TransformControls.js) — no reach into
   * private fields, no geometry surgery, so dragging/picking/highlighting
   * keep working exactly as three.js implements them.
   */
  private restyleGizmo(colors: { active: number } = { active: SELECTED_EDGE_COLOR }): void {
    this.controls.setColors(GIZMO_GOLD, GIZMO_GOLD, GIZMO_GOLD, colors.active);
  }

  /** A small glowing disc at the pivot: "drag this to move my object." */
  private buildMoveAnchor(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'eavara-move-anchor';
    group.visible = false;
    const glow = this.accessoryDisc(0.34, GIZMO_GOLD, 0.22, 900);
    const core = this.accessoryDisc(0.13, SELECTED_EDGE_COLOR, 0.95, 901);
    group.add(glow, core);
    return group;
  }

  /** A soft full ring "track" behind the native yaw handle: reads as one smooth circle. */
  private buildTurnRing(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'eavara-turn-ring';
    group.visible = false;
    const glowMaterial = this.accessoryMaterial(GIZMO_GOLD, 0.18);
    const coreMaterial = this.accessoryMaterial(GIZMO_GOLD, 0.85);
    const glow = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS, 0.045, 8, 64), glowMaterial);
    const core = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS, 0.014, 8, 64), coreMaterial);
    glow.rotation.x = Math.PI / 2;
    core.rotation.x = Math.PI / 2;
    glow.renderOrder = 900;
    core.renderOrder = 901;
    glow.raycast = () => {};
    core.raycast = () => {};
    this.attachBillboardScale(glow, GIZMO_SIZE * 1.05);
    this.attachBillboardScale(core, GIZMO_SIZE * 1.05);
    group.add(glow, core);
    return group;
  }

  private accessoryDisc(radius: number, color: number, opacity: number, renderOrder: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), this.accessoryMaterial(color, opacity));
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = renderOrder;
    mesh.raycast = () => {};
    this.attachBillboardScale(mesh, GIZMO_SIZE * 1.05);
    return mesh;
  }

  private accessoryMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.accessoryMaterials.push({ material, validColor: color });
    return material;
  }

  /** Keeps a decorative mesh sized in lockstep with the native handles at every zoom level (see `billboardScale`). */
  private attachBillboardScale(mesh: THREE.Mesh, size: number): void {
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      if (!(camera instanceof THREE.PerspectiveCamera)) return;
      const worldPosition = mesh.getWorldPosition(this.worldPositionScratch);
      mesh.scale.setScalar(billboardScale(camera, worldPosition, size));
    };
  }

  /** True once per drag end; callers should skip the next click-to-select. */
  consumeSuppressClick(): boolean {
    const value = this.suppressNextClick;
    this.suppressNextClick = false;
    return value;
  }

  /** Whether the gizmo is currently mid-drag - camera input should stay hands-off while this is true. */
  get isDragging(): boolean {
    return this.controls.dragging;
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
      this.restyleGizmo();
      this.setAccessoryTint(true);
    }
    this.moveAnchor.visible = gizmoMode === 'translate';
    this.turnRing.visible = gizmoMode === 'rotate';
    this.positionAccessories(object3D);
  }

  dispose(): void {
    this.controls.removeEventListener('objectChange', this.onObjectChange);
    this.controls.dispose();
    this.world.overlayRoot.remove(this.controls.getHelper(), this.moveAnchor, this.turnRing);
    this.moveAnchor.traverse((child) => {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    });
    this.turnRing.traverse((child) => {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    });
    this.accessoryMaterials.forEach(({ material }) => material.dispose());
  }

  private detach(): void {
    if (this.currentInstanceId) this.renderer.setSelectionValid(this.currentInstanceId, true);
    this.controls.detach();
    this.currentInstanceId = null;
    this.appliedMode = null;
    this.moveAnchor.visible = false;
    this.turnRing.visible = false;
    this.restyleGizmo();
    this.setAccessoryTint(true);
  }

  /** Track the gizmo's world position so the decorative anchor/ring never drift from the selection. */
  private positionAccessories(object3D: THREE.Object3D): void {
    const worldPosition = object3D.getWorldPosition(this.worldPositionScratch);
    this.moveAnchor.position.copy(worldPosition);
    this.turnRing.position.copy(worldPosition);
  }

  /** Recolour the gold accessories toward the shared invalid red, or back to each one's own resting gold tone. */
  private setAccessoryTint(valid: boolean): void {
    this.accessoryMaterials.forEach(({ material, validColor }) => {
      material.color.setHex(valid ? validColor : INVALID_EDGE_COLOR);
    });
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
    this.restyleGizmo({ active: valid ? SELECTED_EDGE_COLOR : INVALID_EDGE_COLOR });
    this.setAccessoryTint(valid);
    this.positionAccessories(object);
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
    this.restyleGizmo();
    this.setAccessoryTint(true);
    this.positionAccessories(object);
  }
}
