import * as THREE from 'three';
import type { ConstructionResources } from '@/construction/ConstructionResources';
import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import { PLACEMENT_ROTATION_STEP } from '@/construction/constants';
import { roleOf } from '@/construction/ConstructionObjectDefinition';
import type { AssetLibrary } from '@/visual/assets/AssetLibrary';
import type { ChallengeDefinition } from './Challenge';
import { blueprintWorldPosition, type BlueprintObject } from './Blueprint';

const TARGET_COLOR = 0x4fa8ff;
const TARGET_EDGE_COLOR = 0xbfe0ff;
const MATCHED_COLOR = 0x4ade80;
const MATCHED_EDGE_COLOR = 0xbbf7d0;
const AREA_COLOR = 0xffffff;
/** How far a door/window ghost pokes out of each face of its host wall. */
const OPENING_GHOST_PROTRUSION = 0.015;

interface GhostInstance {
  blueprintObjectId: string;
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  /** Translucent copy of the object's 3D model, when it has one. */
  visual: THREE.Object3D | null;
  matched: boolean;
}

/**
 * Draws the challenge target as translucent blue ghosts, plus the build-area
 * outline. Lives under the world's overlay root, so it is never raycast for
 * placement or selection, never collides, and never enters `placedObjects`.
 *
 * Geometry is shared with the player's construction through
 * ConstructionResources; only four small materials belong to this renderer.
 * Matched targets turn green so the player can see progress in the world.
 */
export class BlueprintRenderer {
  private readonly group = new THREE.Group();
  private readonly ghosts: GhostInstance[] = [];
  private areaOutline: THREE.LineLoop | null = null;
  private sitePad: THREE.Mesh | null = null;
  /** Bumped on every setChallenge so late model loads never attach to old ghosts. */
  private generation = 0;
  /** Hides the procedural ghost body while a model silhouette stands in for it. */
  private readonly hiddenMaterial = new THREE.MeshBasicMaterial({ visible: false });

  private readonly targetMaterial = new THREE.MeshStandardMaterial({
    color: TARGET_COLOR,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    emissive: new THREE.Color(0x0a2a4a),
  });
  private readonly matchedMaterial = new THREE.MeshStandardMaterial({
    color: MATCHED_COLOR,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });
  private readonly targetEdgeMaterial = new THREE.LineBasicMaterial({
    color: TARGET_EDGE_COLOR,
    transparent: true,
    opacity: 0.9,
  });
  private readonly matchedEdgeMaterial = new THREE.LineBasicMaterial({
    color: MATCHED_EDGE_COLOR,
    transparent: true,
    opacity: 0.6,
  });
  private readonly areaMaterial = new THREE.LineBasicMaterial({
    color: AREA_COLOR,
    transparent: true,
    opacity: 0.5,
  });

  constructor(
    private readonly root: THREE.Object3D,
    private readonly resources: ConstructionResources,
    private readonly registry: ObjectRegistry,
    /** Optional ground material marking the level's building site. */
    private readonly siteMaterial: THREE.Material | null = null,
    /** Optional model library: ghosts of model-drawn objects use the model's silhouette. */
    private readonly assets: AssetLibrary | null = null,
  ) {
    this.group.name = 'blueprint';
    this.root.add(this.group);
  }

  get count(): number {
    return this.ghosts.length;
  }

  /** Show a challenge's blueprint and build area, or clear with `null`. */
  setChallenge(challenge: ChallengeDefinition | null): void {
    this.clear();
    this.generation++;
    if (!challenge) return;

    for (const target of challenge.blueprint.objects) {
      const definition = this.registry.get(target.definitionId);
      if (!definition) continue;

      const mesh = new THREE.Mesh(this.resources.getGeometry(definition), this.targetMaterial);
      mesh.name = `blueprint:${target.id}`;
      mesh.renderOrder = 5;
      const position = blueprintWorldPosition(challenge.buildOrigin, target);
      mesh.position.set(position.x, position.y, position.z);
      mesh.rotation.set(0, target.rotationStep * PLACEMENT_ROTATION_STEP, 0);
      // A door or window sits inside its host wall, so a ghost exactly as
      // thick as the opening disappears once the wall is built. Draw it a
      // little thicker than the wall (presentation only; the target position
      // and the evaluation are unchanged) so it shows on both wall faces.
      if (roleOf(definition) === 'opening') {
        const hostDepth = hostWallDepth(challenge, target, this.registry);
        const needed = hostDepth + 2 * OPENING_GHOST_PROTRUSION;
        if (hostDepth > 0 && needed > definition.dimensions.depth) mesh.scale.z = needed / definition.dimensions.depth;
      }

      const edges = new THREE.LineSegments(this.resources.getEdges(definition), this.targetEdgeMaterial);
      mesh.add(edges);

      this.group.add(mesh);
      const ghost: GhostInstance = { blueprintObjectId: target.id, mesh, edges, visual: null, matched: false };
      this.ghosts.push(ghost);
      this.attachVisual(ghost, definition);
    }

    this.areaOutline = createAreaOutline(challenge, this.areaMaterial);
    this.group.add(this.areaOutline);

    if (this.siteMaterial) {
      const size = challenge.buildAreaHalfSize * 2;
      const geometry = new THREE.PlaneGeometry(size, size);
      geometry.rotateX(-Math.PI / 2);
      this.sitePad = new THREE.Mesh(geometry, this.siteMaterial);
      this.sitePad.name = 'buildSite';
      this.sitePad.position.set(challenge.buildOrigin.x, challenge.buildOrigin.y + 0.002, challenge.buildOrigin.z);
      this.sitePad.receiveShadow = true;
      this.group.add(this.sitePad);
    }
  }

  /** Recolour ghosts whose target has been matched by the player. */
  setMatched(matchedBlueprintObjectIds: ReadonlySet<string>): void {
    for (const ghost of this.ghosts) {
      ghost.matched = matchedBlueprintObjectIds.has(ghost.blueprintObjectId);
      this.applyGhostMaterials(ghost);
    }
  }

  /**
   * Swap the ghost body for a translucent copy of the object's 3D model once
   * it is loaded. Overlay only: never raycast, no shadows, gameplay unchanged.
   */
  private attachVisual(ghost: GhostInstance, definition: { visual?: { asset: string; fit?: 'contain' | 'height' | 'stretch' }; dimensions: { width: number; height: number; depth: number } }): void {
    const visual = definition.visual;
    if (!visual || !this.assets) return;
    const assets = this.assets;
    const generation = this.generation;
    assets.whenReady(visual.asset, () => {
      if (generation !== this.generation || !this.ghosts.includes(ghost) || ghost.visual) return;
      const object = assets.instantiateFitted(visual.asset, definition.dimensions, visual.fit ?? 'contain');
      object.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.renderOrder = 5;
      });
      ghost.mesh.add(object);
      ghost.visual = object;
      this.applyGhostMaterials(ghost);
    });
  }

  private applyGhostMaterials(ghost: GhostInstance): void {
    const body = ghost.matched ? this.matchedMaterial : this.targetMaterial;
    ghost.edges.material = ghost.matched ? this.matchedEdgeMaterial : this.targetEdgeMaterial;
    if (!ghost.visual) {
      ghost.mesh.material = body;
      return;
    }
    ghost.mesh.material = this.hiddenMaterial;
    ghost.visual.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) mesh.material = body;
    });
  }

  clear(): void {
    for (const ghost of this.ghosts) {
      ghost.mesh.remove(ghost.edges);
      this.group.remove(ghost.mesh);
    }
    this.ghosts.length = 0;
    if (this.areaOutline) {
      this.group.remove(this.areaOutline);
      this.areaOutline.geometry.dispose();
      this.areaOutline = null;
    }
    if (this.sitePad) {
      this.group.remove(this.sitePad);
      this.sitePad.geometry.dispose();
      this.sitePad = null;
    }
  }

  dispose(): void {
    this.clear();
    this.root.remove(this.group);
    this.targetMaterial.dispose();
    this.matchedMaterial.dispose();
    this.targetEdgeMaterial.dispose();
    this.matchedEdgeMaterial.dispose();
    this.areaMaterial.dispose();
    this.hiddenMaterial.dispose();
  }
}

/** Thickness of the blueprint wall an opening target is set into, or 0. */
function hostWallDepth(challenge: ChallengeDefinition, target: BlueprintObject, registry: ObjectRegistry): number {
  if (!target.host) return 0;
  const host = challenge.blueprint.objects.find((o) => o.id === target.host);
  const definition = host ? registry.get(host.definitionId) : undefined;
  return definition ? definition.dimensions.depth : 0;
}

function createAreaOutline(challenge: ChallengeDefinition, material: THREE.LineBasicMaterial): THREE.LineLoop {
  const { buildOrigin: o, buildAreaHalfSize: h } = challenge;
  const y = o.y + 0.003;
  const points = [
    new THREE.Vector3(o.x - h, y, o.z - h),
    new THREE.Vector3(o.x + h, y, o.z - h),
    new THREE.Vector3(o.x + h, y, o.z + h),
    new THREE.Vector3(o.x - h, y, o.z + h),
  ];
  const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material);
  outline.name = 'buildArea';
  return outline;
}
