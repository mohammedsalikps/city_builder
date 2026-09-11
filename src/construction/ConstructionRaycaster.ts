import * as THREE from 'three';
import type { PointerPosition } from '@/input/PointerInput';
import { INSTANCE_ID_KEY } from './ConstructionRenderer';
import type { SurfaceHit } from './PlacementResolver';

/**
 * Converts a pointer position into world-space hits.
 *
 * All raycasting for construction goes through here so the camera/pointer
 * maths lives in one place. Reusable vectors avoid per-frame allocation.
 */
/** Shared empty set: the default "see through nothing". */
const NO_IDS: ReadonlySet<string> = new Set();

export class ConstructionRaycaster {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly normal = new THREE.Vector3();
  private targets: THREE.Object3D[] = [];

  constructor(private readonly camera: THREE.Camera) {}

  /**
   * Nearest surface under the pointer: either the ground or a placed object
   * together with the world-space normal of the face that was hit.
   *
   * `seeThroughIds` lets the ray pass objects the caller names (the faded
   * walls that hide the active placement target): hits on them are skipped
   * and the next surface along the same ray is used. Only the ray changes;
   * the objects themselves are untouched and still count for validation.
   */
  hitSurface(
    pointer: PointerPosition,
    ground: THREE.Object3D,
    meshes: THREE.Object3D[],
    seeThroughIds: ReadonlySet<string> = NO_IDS,
  ): SurfaceHit | null {
    this.prepare(pointer);
    this.targets.length = 0;
    this.targets.push(ground, ...meshes);
    // Non-recursive: edge overlays are children of the meshes and must not count.
    const hits = this.raycaster.intersectObjects(this.targets, false);

    let hit: THREE.Intersection | null = null;
    for (const candidate of hits) {
      const id = candidate.object.userData[INSTANCE_ID_KEY];
      if (typeof id === 'string' && seeThroughIds.has(id)) continue;
      hit = candidate;
      break;
    }
    if (!hit) return null;
    const point = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
    const instanceId = hit.object.userData[INSTANCE_ID_KEY];

    if (typeof instanceId !== 'string') return { kind: 'ground', point };
    if (!hit.face) return null;

    this.normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    return {
      kind: 'object',
      instanceId,
      point,
      normal: { x: this.normal.x, y: this.normal.y, z: this.normal.z },
    };
  }

  /** Instance id of the nearest placed object under the pointer, or null. */
  hitPlacedObject(pointer: PointerPosition, meshes: THREE.Object3D[]): string | null {
    if (meshes.length === 0) return null;
    this.prepare(pointer);
    const hits = this.raycaster.intersectObjects(meshes, false);
    for (const hit of hits) {
      const id = hit.object.userData[INSTANCE_ID_KEY];
      if (typeof id === 'string') return id;
    }
    return null;
  }

  private prepare(pointer: PointerPosition): void {
    this.ndc.set(pointer.ndcX, pointer.ndcY);
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }
}
