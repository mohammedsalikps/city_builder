import * as THREE from 'three';
import { fbm, smoothstep } from '../noise';
import type { MaterialLibrary } from '../materials/MaterialLibrary';

export interface FlatZone {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface TerrainConfig {
  /** Side length in metres. */
  size: number;
  segments: number;
  seed: number;
  /** Areas kept perfectly flat at y = 0 (construction sites, streets). */
  flatZones: FlatZone[];
  /** Distance over which the flat zones rise into hills, metres. */
  blend: number;
  lakes: Array<{ x: number; z: number; radius: number; depth: number }>;
  /** Mountain ring: rises from `inner` to full height at `outer` metres. */
  mountains: { inner: number; outer: number; height: number };
}

const COLOURS = {
  lawn: new THREE.Color('#67a346'),
  lawnStripe: new THREE.Color('#5a9540'),
  grassA: new THREE.Color('#5a8d3a'),
  grassB: new THREE.Color('#77a24a'),
  dry: new THREE.Color('#9aa25a'),
  forest: new THREE.Color('#3f6f33'),
  rock: new THREE.Color('#7c7770'),
  rockDark: new THREE.Color('#5c5a57'),
  snow: new THREE.Color('#f1f4f7'),
  shore: new THREE.Color('#a89a72'),
};

/**
 * Stylised 3D terrain: flat construction plateaus (exactly y = 0, so every
 * challenge coordinate still holds), gentle rolling hills, a lake basin and
 * a distant mountain ring, with vertex colours for lawn, meadow, rock and
 * snow. Purely visual: it is never raycast for placement (the flat ground
 * plane in World stays the placement surface).
 */
export class Terrain {
  readonly mesh: THREE.Mesh;

  constructor(
    private readonly config: TerrainConfig,
    materials: MaterialLibrary,
  ) {
    const geometry = new THREE.PlaneGeometry(config.size, config.size, config.segments, config.segments);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      position.setY(i, this.heightAt(position.getX(i), position.getZ(i)));
    }
    geometry.computeVertexNormals();
    this.paint(geometry);
    geometry.computeBoundingSphere();

    this.mesh = new THREE.Mesh(geometry, materials.terrain());
    this.mesh.name = 'terrain';
    this.mesh.receiveShadow = true;
  }

  /** Height of the terrain surface at a world position. */
  heightAt(x: number, z: number): number {
    const { seed, blend, mountains } = this.config;
    const open = smoothstep(0, blend, this.distanceToFlat(x, z));
    const r = Math.hypot(x, z);

    const hills = Math.pow(fbm(x * 0.011, z * 0.011, seed) * 0.5 + 0.5, 1.4) * 24 + fbm(x * 0.05, z * 0.05, seed + 3, 3) * 1.6;
    const ridge = 1 - Math.abs(fbm(x * 0.0042, z * 0.0042, seed + 7, 5));
    const ring = smoothstep(mountains.inner, mountains.outer, r);
    const peaks = ring * (mountains.height * 0.2 + mountains.height * Math.pow(ridge, 2.2));
    let h = open * (hills * (0.35 + 0.65 * smoothstep(0, 140, r)) + peaks);

    for (const lake of this.config.lakes) {
      const t = Math.hypot(x - lake.x, z - lake.z) / lake.radius;
      if (t < 1.8) {
        h *= smoothstep(0.9, 1.8, t);
        h -= lake.depth * (1 - smoothstep(0.55, 1.05, t));
      }
    }
    return h;
  }

  /** True within a lake's basin and its immediate shore. */
  private nearLakeShore(x: number, z: number): boolean {
    return this.config.lakes.some((lake) => Math.hypot(x - lake.x, z - lake.z) < lake.radius * 1.25);
  }

  private distanceToFlat(x: number, z: number): number {
    let best = Infinity;
    for (const zone of this.config.flatZones) {
      const dx = Math.max(zone.minX - x, 0, x - zone.maxX);
      const dz = Math.max(zone.minZ - z, 0, z - zone.maxZ);
      best = Math.min(best, Math.hypot(dx, dz));
    }
    return best;
  }

  private paint(geometry: THREE.BufferGeometry): void {
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const colors = new Float32Array(position.count * 3);
    const c = new THREE.Color();
    const tmp = new THREE.Color();
    const { seed } = this.config;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const slope = 1 - normal.getY(i);
      const flat = this.distanceToFlat(x, z) < 0.5;

      c.copy(COLOURS.grassA).lerp(COLOURS.grassB, fbm(x * 0.02, z * 0.02, seed + 11, 3) * 0.5 + 0.5);
      c.lerp(COLOURS.dry, Math.max(0, fbm(x * 0.004, z * 0.004, seed + 12, 3)) * 0.8);
      c.lerp(COLOURS.forest, smoothstep(40, 120, y) * 0.6);
      if (flat) {
        // Mown lawn on the plateaus, with faint mowing stripes.
        tmp.copy(COLOURS.lawn).lerp(COLOURS.lawnStripe, Math.floor(x / 3) % 2 === 0 ? 0.5 : 0);
        c.lerp(tmp, 0.75);
      }
      const rocky = Math.max(smoothstep(0.28, 0.55, slope), smoothstep(90, 150, y));
      tmp.copy(COLOURS.rock).lerp(COLOURS.rockDark, fbm(x * 0.03, z * 0.03, seed + 13, 3) * 0.5 + 0.5);
      c.lerp(tmp, rocky);
      c.lerp(COLOURS.snow, smoothstep(150, 190, y + fbm(x * 0.02, z * 0.02, seed + 14, 3) * 18) * (1 - smoothstep(0.55, 0.8, slope)));
      if (this.nearLakeShore(x, z) && y < 0.6) c.lerp(COLOURS.shore, 0.75);

      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
}
