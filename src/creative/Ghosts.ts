import * as THREE from 'three';
import type { ConstructionObjectDefinition } from '@/construction/ConstructionObjectDefinition';
import type { ConstructionResources } from '@/construction/ConstructionResources';
import type { AssetLibrary } from '@/visual/assets/AssetLibrary';

const VALID_COLOR = 0xffcf70;
const VALID_EMISSIVE = 0x8a520c;
const VALID_EDGE = 0xf2a541;
const INVALID_COLOR = 0xff8a7a;
const INVALID_EMISSIVE = 0x4a0a06;
const INVALID_EDGE = 0xff5a4a;

/**
 * Translucent "blueprint" previews for World Studio (template placement,
 * street drawing). A ghost shows the object's real 3D model when it has
 * one, tinted warm gold (or soft red where it would not fit), and the
 * procedural shape otherwise. Presentation only: ghosts live under the
 * overlay root, are never raycast, and never touch game state.
 *
 * Materials are shared by every ghost of a kit; geometry comes from the
 * shared construction resources / cached GLBs, so a 24-piece neighbourhood
 * preview allocates no new GPU buffers.
 */
export class GhostKit {
  private readonly validMaterial = new THREE.MeshStandardMaterial({
    color: VALID_COLOR,
    emissive: new THREE.Color(VALID_EMISSIVE),
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    roughness: 0.6,
  });
  private readonly invalidMaterial = new THREE.MeshStandardMaterial({
    color: INVALID_COLOR,
    emissive: new THREE.Color(INVALID_EMISSIVE),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    roughness: 0.6,
  });
  private readonly validEdge = new THREE.LineBasicMaterial({ color: VALID_EDGE, transparent: true, opacity: 0.85 });
  private readonly invalidEdge = new THREE.LineBasicMaterial({ color: INVALID_EDGE, transparent: true, opacity: 0.85 });

  constructor(
    private readonly resources: ConstructionResources,
    private readonly assets: AssetLibrary | null,
  ) {}

  /**
   * A ghost for one definition. Starts as the procedural shape; swaps to the
   * real model as soon as it is loaded, unless the ghost was discarded first.
   */
  create(definition: ConstructionObjectDefinition): THREE.Object3D {
    const holder = new THREE.Group();
    holder.userData.ghostValid = true;
    const proxy = new THREE.Mesh(this.resources.getGeometry(definition), this.validMaterial);
    proxy.add(new THREE.LineSegments(this.resources.getEdges(definition), this.validEdge));
    proxy.renderOrder = 10;
    holder.add(proxy);

    const visual = definition.visual;
    if (visual && this.assets) {
      const assets = this.assets;
      assets.whenReady(visual.asset, () => {
        if (holder.userData.discarded) return;
        const model = assets.instantiateFitted(visual.asset, definition.dimensions, visual.fit ?? 'contain');
        model.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.renderOrder = 10;
          }
        });
        holder.remove(proxy);
        holder.add(model);
        holder.userData.model = model;
        this.paint(holder, holder.userData.ghostValid !== false);
      });
    }
    this.paint(holder, true);
    return holder;
  }

  /** Tint a ghost valid (gold) or invalid (soft red). Cheap: material swaps only when it changes. */
  setValid(ghost: THREE.Object3D, valid: boolean): void {
    if (ghost.userData.ghostValid === valid) return;
    this.paint(ghost, valid);
  }

  /** Stop a pending model swap and release animation state of a ghost being removed. */
  discard(ghost: THREE.Object3D): void {
    ghost.userData.discarded = true;
    const model = ghost.userData.model as THREE.Object3D | undefined;
    if (model) this.assets?.release(model);
  }

  dispose(): void {
    this.validMaterial.dispose();
    this.invalidMaterial.dispose();
    this.validEdge.dispose();
    this.invalidEdge.dispose();
  }

  private paint(ghost: THREE.Object3D, valid: boolean): void {
    ghost.userData.ghostValid = valid;
    const material = valid ? this.validMaterial : this.invalidMaterial;
    const edge = valid ? this.validEdge : this.invalidEdge;
    ghost.traverse((node) => {
      if ((node as THREE.LineSegments).isLineSegments) (node as THREE.LineSegments).material = edge;
      else if ((node as THREE.Mesh).isMesh) (node as THREE.Mesh).material = material;
    });
  }
}
