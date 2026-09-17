import type { Bounds } from '@/construction/bounds';
import type { TerrainConfig } from '@/visual/environment/Terrain';

/**
 * The large My World valley (src/data/world.json): how big it is, where the
 * child may build, the districts that give it its starting character, and
 * the road network its scenery is composed around.
 *
 * Four separate ideas live here and nowhere else:
 *   world size      the playable valley (`size`, metres per side)
 *   build area      `buildHalfSize` around the origin - the placement rules'
 *                   outer limit, never drawn
 *   camera area     `cameraHalfSize` - how far the camera target may roam
 *   local snapping  unchanged: the construction engine snaps and validates
 *                   in world-space metres, wherever the child builds
 */

export interface WorldRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type DistrictKind = 'home' | 'residential' | 'town' | 'city' | 'industrial' | 'lake' | 'nature';

export interface DistrictDefinition {
  id: string;
  name: string;
  kind: DistrictKind;
  /** Icon id (ui/studio/icons.ts). */
  icon: string;
  /** Map colour. */
  color: string;
  rect: WorldRect;
}

export interface WorldLake {
  x: number;
  z: number;
  radius: number;
  level: number;
}

export interface WorldSpec {
  id: string;
  name: string;
  seed: number;
  size: number;
  buildHalfSize: number;
  /** Scenery road tile size (Kenney road tiles), metres. */
  tile: number;
  /** Kept free of scenery: where a new world's own building starts. */
  homePlot: WorldRect;
  terrain: TerrainConfig;
  water: WorldLake[];
  districts: DistrictDefinition[];
  /**
   * Straight road runs in tile coordinates (tile centre = index * tile).
   * `class` sets how a road is dressed, which is what makes the network
   * read as avenues, town and city streets, works roads and quiet lanes.
   */
  roads: Array<{ from: [number, number]; to: [number, number]; class?: RoadClass }>;
  /** Memorable places, each composed by its kind (see WorldComposer). */
  landmarks: Landmark[];
  /** Lots kept open inside busy districts, so there is room to build everywhere. */
  openPlots: WorldRect[];
  /** Flat zone beyond the valley rim holding the distant skyline. */
  skyline: WorldRect;
}

/** Visual road hierarchy, highest first. */
export const ROAD_CLASSES = ['avenue', 'city', 'town', 'industrial', 'street', 'lane'] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

export type LandmarkKind = 'plaza' | 'city-center' | 'park' | 'viewpoint' | 'construction' | 'wind-farm' | 'crossing';

export interface Landmark {
  id: string;
  name: string;
  kind: LandmarkKind;
  rect: WorldRect;
}

/**
 * Axis-aligned footprint of solid scenery (a house, a road, a factory yard)
 * that construction must not overlap. Soft scenery (plants, small props)
 * is not a blocker: it makes way instead (see LivingWorld.clearUnder).
 */
export type Blocker = WorldRect;

const CELL = 16;
/** Water keeps this much shore free as well. */
const SHORE_MARGIN = 1.5;
/** Shorelines wander up to this factor of a lake's radius (see Terrain.shoreRadius). */
export const SHORE_WOBBLE_MAX = 1.12;

export function rectContains(rect: WorldRect, x: number, z: number): boolean {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

export function rectsOverlap(a: WorldRect, b: WorldRect, margin = 0): boolean {
  return a.minX < b.maxX + margin && b.minX < a.maxX + margin && a.minZ < b.maxZ + margin && b.minZ < a.maxZ + margin;
}

export class WorldSpace {
  private readonly cells = new Map<string, Blocker[]>();
  private blockerCount = 0;

  constructor(readonly spec: WorldSpec) {}

  get buildHalfSize(): number {
    return this.spec.buildHalfSize;
  }

  /** How far the camera's focus point may travel from the origin. */
  get cameraHalfSize(): number {
    return this.spec.buildHalfSize + 40;
  }

  get blockers(): number {
    return this.blockerCount;
  }

  /** The landmark at (or within `margin` metres of) a point, if any. */
  landmarkAt(x: number, z: number, margin = 0): Landmark | null {
    return (
      this.spec.landmarks.find(
        (l) => x >= l.rect.minX - margin && x <= l.rect.maxX + margin && z >= l.rect.minZ - margin && z <= l.rect.maxZ + margin,
      ) ?? null
    );
  }

  districtAt(x: number, z: number): DistrictDefinition | null {
    return this.spec.districts.find((d) => rectContains(d.rect, x, z)) ?? null;
  }

  district(id: string): DistrictDefinition | undefined {
    return this.spec.districts.find((d) => d.id === id);
  }

  inWater(x: number, z: number, margin = 0): boolean {
    return this.spec.water.some((lake) => Math.hypot(x - lake.x, z - lake.z) < lake.radius + margin);
  }

  /** Replace the scenery footprints (called once the world is composed). */
  setBlockers(blockers: Blocker[]): void {
    this.cells.clear();
    this.blockerCount = blockers.length;
    for (const b of blockers) {
      for (const key of this.keys(b)) {
        let list = this.cells.get(key);
        if (!list) this.cells.set(key, (list = []));
        list.push(b);
      }
    }
  }

  /**
   * Whether a construction footprint would sit in water or on top of the
   * world's own solid scenery.
   */
  isBlocked(bounds: Bounds): boolean {
    const rect = { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ };
    const cx = (rect.minX + rect.maxX) / 2;
    const cz = (rect.minZ + rect.maxZ) / 2;
    const reach = Math.hypot(rect.maxX - rect.minX, rect.maxZ - rect.minZ) / 2;
    for (const lake of this.spec.water) {
      if (Math.hypot(cx - lake.x, cz - lake.z) < lake.radius * SHORE_WOBBLE_MAX + SHORE_MARGIN + reach * 0.7) return true;
    }
    for (const key of this.keys(rect)) {
      for (const b of this.cells.get(key) ?? []) {
        if (rectsOverlap(rect, b, -0.02)) return true;
      }
    }
    return false;
  }

  private *keys(rect: WorldRect): Generator<string> {
    const x0 = Math.floor(rect.minX / CELL);
    const x1 = Math.floor(rect.maxX / CELL);
    const z0 = Math.floor(rect.minZ / CELL);
    const z1 = Math.floor(rect.maxZ / CELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) yield `${x},${z}`;
  }
}
