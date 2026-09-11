import * as THREE from 'three';
import { seededRandom } from '../noise';
import type { AssetLibrary } from '../assets/AssetLibrary';
import type { EnvironmentConfig, } from '../environment/Environment';
import type { FlatZone } from '../environment/Terrain';

/** One hand-placed asset. Angles in degrees. */
export interface ScenePlacement {
  asset: string;
  x: number;
  z: number;
  /** Added to the terrain height. */
  y?: number;
  rotationY?: number;
  scale?: number;
  variant?: string;
}

/** Repeated copies along a straight line (roads, sidewalks, fences, lamps). */
export interface SceneRow {
  asset: string;
  from: { x: number; z: number };
  to: { x: number; z: number };
  spacing: number;
  rotationY?: number;
  variant?: string;
}

/** Random copies on a ring around the site (forests, meadows). */
export interface SceneScatter {
  assets: string[];
  count: number;
  seed: number;
  ring: { inner: number; outer: number };
  scale: [number, number];
  avoid?: FlatZone[];
  maxHeight?: number;
}

export interface SceneryDefinition {
  environment: EnvironmentConfig;
  placements: ScenePlacement[];
  rows: SceneRow[];
  scatter: SceneScatter[];
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Composes the representative neighbourhood around the construction site
 * from data: hand-placed houses, cars and props, rows of road tiles and
 * lamps (instanced), and forest rings scattered on the hills (instanced).
 * Visual only: none of it is raycast, collides, or enters game state.
 */
export class Scenery {
  readonly root = new THREE.Group();
  private built = false;
  private counts = { placements: 0, instances: 0, drawGroups: 0 };

  constructor(
    private readonly definition: SceneryDefinition,
    private readonly assets: AssetLibrary,
    private readonly heightAt: (x: number, z: number) => number,
  ) {
    this.root.name = 'scenery';
  }

  get stats(): { placements: number; instances: number; drawGroups: number } {
    return { ...this.counts };
  }

  async build(): Promise<void> {
    if (this.built) return;
    this.built = true;
    const { placements, rows, scatter } = this.definition;
    await this.assets.preload([
      ...placements.map((p) => p.asset),
      ...rows.map((r) => r.asset),
      ...scatter.flatMap((s) => s.assets),
    ]);

    for (const p of placements) {
      const object = this.assets.instantiate(p.asset, { variant: p.variant });
      object.position.set(p.x, this.heightAt(p.x, p.z) + (p.y ?? 0), p.z);
      object.rotation.y = THREE.MathUtils.degToRad(p.rotationY ?? 0);
      if (p.scale) object.scale.setScalar(p.scale);
      this.root.add(object);
      this.counts.placements++;
    }

    // Rows and scatters become one InstancedMesh group per asset (and variant).
    const batches = new Map<string, { asset: string; variant?: string; matrices: THREE.Matrix4[] }>();
    const addInstance = (asset: string, variant: string | undefined, matrix: THREE.Matrix4) => {
      const key = `${asset}|${variant ?? ''}`;
      const batch = batches.get(key) ?? { asset, variant, matrices: [] };
      batch.matrices.push(matrix);
      batches.set(key, batch);
    };

    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    for (const row of rows) {
      const length = Math.hypot(row.to.x - row.from.x, row.to.z - row.from.z);
      const steps = Math.max(0, Math.round(length / row.spacing));
      quaternion.setFromAxisAngle(Y_AXIS, THREE.MathUtils.degToRad(row.rotationY ?? 0));
      for (let i = 0; i <= steps; i++) {
        const t = steps === 0 ? 0 : i / steps;
        const x = row.from.x + (row.to.x - row.from.x) * t;
        const z = row.from.z + (row.to.z - row.from.z) * t;
        position.set(x, this.heightAt(x, z), z);
        addInstance(row.asset, row.variant, new THREE.Matrix4().compose(position, quaternion, scale.set(1, 1, 1)));
      }
    }

    for (const s of scatter) {
      const rand = seededRandom(s.seed);
      let placed = 0;
      for (let attempt = 0; attempt < s.count * 12 && placed < s.count; attempt++) {
        const angle = rand() * Math.PI * 2;
        const radius = Math.sqrt(s.ring.inner ** 2 + rand() * (s.ring.outer ** 2 - s.ring.inner ** 2));
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        if (s.avoid?.some((zone) => x > zone.minX && x < zone.maxX && z > zone.minZ && z < zone.maxZ)) continue;
        const y = this.heightAt(x, z);
        if (y < 0.3) continue; // lake shores and basins
        if (s.maxHeight !== undefined && y > s.maxHeight) continue;
        const k = s.scale[0] + rand() * (s.scale[1] - s.scale[0]);
        quaternion.setFromAxisAngle(Y_AXIS, rand() * Math.PI * 2);
        position.set(x, y - 0.05, z);
        addInstance(s.assets[Math.floor(rand() * s.assets.length)], undefined, new THREE.Matrix4().compose(position, quaternion, scale.set(k, k, k)));
        placed++;
      }
    }

    for (const batch of batches.values()) {
      const group = this.assets.createInstanced(batch.asset, batch.matrices, { variant: batch.variant });
      this.root.add(group);
      this.counts.instances += batch.matrices.length;
      this.counts.drawGroups += group.children.length;
    }
  }
}
