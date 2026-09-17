import * as THREE from 'three';
import type { AssetLibrary } from '../assets/AssetLibrary';
import type { AssetRegistry } from '../assets/AssetRegistry';
import { cloneMaterial, type MaterialLibrary } from '../materials/MaterialLibrary';
import { Terrain } from '../environment/Terrain';
import { SceneryBatcher } from './SceneryBatcher';
import { WorldComposer, type ComposedWorld } from './WorldComposer';
import { rectsOverlap, type WorldRect, type WorldSpace } from '@/world/WorldSpace';

const CLEAR_CELL = 16;

/**
 * My World's large valley, as presentation: its terrain (flat valley floor,
 * lake basin, hills and mountains), water, and the composed starting
 * scenery drawn through a SceneryBatcher. Shown only in My World; the
 * challenge site and the home screen keep their own surroundings.
 *
 * Built lazily the first time My World opens. Composition is deterministic,
 * so nothing here is ever saved: the child's own objects stay in
 * `placedObjects` and the scenery is regenerated from world.json.
 */
export class LivingWorld {
  readonly root = new THREE.Group();
  readonly terrain: Terrain;
  private readonly batcher: SceneryBatcher;
  private composed: ComposedWorld | null = null;
  private building: Promise<void> | null = null;
  private buildMs = 0;
  /** Clearable piece indices by grid cell. */
  private readonly softCells = new Map<string, number[]>();
  private cleared = new Set<number>();
  private pendingFootprints: WorldRect[] | null = null;

  constructor(
    private readonly space: WorldSpace,
    private readonly assets: AssetLibrary,
    private readonly registry: AssetRegistry,
    materials: MaterialLibrary,
  ) {
    this.root.name = 'living-world';
    this.root.visible = false;
    this.terrain = new Terrain(space.spec.terrain, materials);
    this.root.add(this.terrain.mesh);
    // The valley's water: clearer and more reflective than the site's pond.
    const water = cloneMaterial(materials.water());
    water.color.set('#2c86a8');
    water.roughness = 0.1;
    water.envMapIntensity = 1.8;
    water.opacity = 0.92;
    for (const lake of space.spec.water) {
      // Wider than any shore: the terrain draws the (wobbly) waterline.
      const geometry = new THREE.CircleGeometry(lake.radius * 1.2, 96);
      geometry.rotateX(-Math.PI / 2);
      const surface = new THREE.Mesh(geometry, water);
      surface.name = 'lake';
      surface.position.set(lake.x, lake.level, lake.z);
      surface.receiveShadow = true;
      surface.raycast = () => {};
      this.root.add(surface);
    }
    this.terrain.mesh.raycast = () => {};
    this.batcher = new SceneryBatcher(assets, registry);
    this.root.add(this.batcher.root);
  }

  get ready(): boolean {
    return this.composed !== null && this.building === null;
  }

  /** What was composed (for the map): road tiles and piece counts. */
  get world(): ComposedWorld | null {
    return this.composed;
  }

  get stats(): { pieces: number; blockers: number; assets: number; buildMs: number; batches: number; instances: number; cleared: number } {
    const b = this.batcher.stats;
    return {
      cleared: this.cleared.size,
      pieces: this.composed?.pieces.length ?? 0,
      blockers: this.composed?.blockers.length ?? 0,
      assets: this.composed?.assetIds.length ?? 0,
      buildMs: Math.round(this.buildMs),
      batches: b.batches,
      instances: b.instances,
    };
  }

  heightAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  /** Compose and build once. Construction blockers are published as soon as they are known. */
  build(): Promise<void> {
    if (this.composed) return this.building ?? Promise.resolve();
    const started = performance.now();
    this.composed = new WorldComposer(this.space.spec, this.registry, (x, z) => this.terrain.heightAt(x, z)).compose();
    this.space.setBlockers(this.composed.blockers);
    const composed = this.composed;
    composed.pieces.forEach((piece, index) => {
      if (!piece.clearable) return;
      for (const key of cellKeys(piece.clearable)) {
        let list = this.softCells.get(key);
        if (!list) this.softCells.set(key, (list = []));
        list.push(index);
      }
    });
    this.building = this.assets.preload(composed.assetIds).then(() => {
      this.batcher.build(composed.pieces);
      this.buildMs = performance.now() - started;
      this.building = null;
      if (this.pendingFootprints) this.clearUnder(this.pendingFootprints);
    });
    return this.building;
  }

  /**
   * Hide the trees, plants and small props standing where the child has
   * built, and bring them back when that building goes away (undo, remove).
   */
  clearUnder(footprints: WorldRect[]): void {
    if (!this.composed || this.building) {
      this.pendingFootprints = footprints;
      return;
    }
    this.pendingFootprints = null;
    const pieces = this.composed.pieces;
    const next = new Set<number>();
    for (const rect of footprints) {
      for (const key of cellKeys(rect)) {
        for (const index of this.softCells.get(key) ?? []) {
          if (!next.has(index) && rectsOverlap(rect, pieces[index].clearable!, -0.05)) next.add(index);
        }
      }
    }
    for (const index of this.cleared) if (!next.has(index)) this.batcher.setCleared(index, false);
    for (const index of next) if (!this.cleared.has(index)) this.batcher.setCleared(index, true);
    this.cleared = next;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  update(camera: THREE.Camera): void {
    if (this.root.visible) this.batcher.update(camera);
  }

  dispose(): void {
    this.batcher.dispose();
    this.terrain.mesh.geometry.dispose();
  }
}

function* cellKeys(rect: WorldRect): Generator<string> {
  for (let x = Math.floor(rect.minX / CLEAR_CELL); x <= Math.floor(rect.maxX / CLEAR_CELL); x++) {
    for (let z = Math.floor(rect.minZ / CLEAR_CELL); z <= Math.floor(rect.maxZ / CLEAR_CELL); z++) yield `${x},${z}`;
  }
}
