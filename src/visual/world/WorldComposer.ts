import { fbm, seededRandom } from '../noise';
import { forestDensity, shoreWobble, WATERLINE } from '../environment/Terrain';
import { DISPLAY_SCALE } from '../assets/scalePolicy';
import type { AssetDefinition, AssetRegistry } from '../assets/AssetRegistry';
import type { SceneryDetail, SceneryPiece } from './SceneryBatcher';
import {
  rectContains,
  rectsOverlap,
  ROAD_CLASSES,
  type Blocker,
  type DistrictDefinition,
  type Landmark,
  type RoadClass,
  type WorldRect,
  type WorldSpec,
} from '@/world/WorldSpace';

/**
 * Composes a new world's starting scenery from world.json - deterministic
 * for a given seed, so it is regenerated on every load and never saved.
 *
 *   road runs -> road tiles (straight / bend / T / cross / end)
 *   road class -> how a road is dressed (sidewalks, lamps, trees, lights)
 *   landmarks -> town square, city center, central park, lake viewpoint,
 *                building site, wind farm, grand crossing
 *   each straight run -> lots on both sides, styled by the district
 *     residential: houses, driveways, parked cars, fences, gardens
 *     town:        shops, parasols, planters, street parking
 *     city:        towers and tall offices on a paved core
 *     industrial:  warehouses in yards with trucks, containers, tanks
 *   district fills -> parks, forests, plazas, yards
 *   lake shore, outer forests on the hills, windmills, distant skyline
 *
 * Every piece is checked against an occupancy grid so nothing overlaps, and
 * the home plot and the water are always left free. Pieces inside the build
 * area also become construction blockers (see WorldSpace).
 */

export interface RoadTile {
  x: number;
  z: number;
}

export interface ComposedWorld {
  pieces: SceneryPiece[];
  blockers: Blocker[];
  roadTiles: RoadTile[];
  assetIds: string[];
}

type Vec2 = { x: number; z: number };

/** A colour-atlas mix: [palette file or null for the model's own, weight]. */
type PaletteMix = Array<[string | null, number]>;

/**
 * Each district's architectural character, so neighbourhoods read apart:
 * Maple Grove's blue and dark roofs, Sunny Lane's warm terracotta, a town of
 * sand and brick, a mostly glass city, brick works.
 */
const PALETTES: Record<string, PaletteMix> = {
  maple: [[null, 0.4], ['variation-c.png', 0.35], ['variation-a.png', 0.25]],
  sunny: [[null, 0.25], ['variation-b.png', 0.45], ['variation-c.png', 0.3]],
  town: [[null, 0.3], ['variation-a.png', 0.4], ['variation-b.png', 0.3]],
  city: [[null, 0.62], ['variation-a.png', 0.2], ['variation-b.png', 0.18]],
  industrial: [[null, 0.3], ['variation-b.png', 0.7]],
  skyline: [[null, 0.35], ['variation-a.png', 0.35], ['variation-b.png', 0.3]],
};

const ROAD_HALF = 3.5;
/** Kenney tile-low paving slab height. */
const PAVING_HEIGHT = 0.14;
/** Scenery vehicles follow the visual scale policy, like the ones the child places. */
const VEHICLE_SCALE = DISPLAY_SCALE.vehicle ?? 1;

/**
 * How a road CLASS is dressed - the one thing that actually varies by
 * hierarchy. The paved tile itself stays a fixed 7m (`ROAD_HALF*2`) for
 * every class: that tile is also this road's construction-collision
 * blocker (see `place()`), so widening it would mean widening what a
 * child's building is kept clear of. Hierarchy reads instead through
 * furniture grandeur, junction marking, sidewalk continuity and (for
 * avenues) a planted median - all decorative-only placements that never
 * touch the occupancy/blocker system.
 */
interface RoadProfile {
  /** Street lamp fixture for this class. */
  lampAsset: string;
  /** Extra scale on the lamp fixture - a taller, grander fixture for busier roads. */
  lampScale: number;
  /** Distance between lamps along the road, in metres. */
  lampSpacing: number;
  /** Chance (0-1) a kerb spot along this road gets a parked vehicle. */
  parkingChance: number;
  /** Whether this class gets the paved footpath strip, tree line/planters. */
  pedestrian: boolean;
  /** Spacing between footpath paving pieces - denser reads as a stronger sidewalk. */
  pathSpacing: number;
  /** Utility pole style, for classes with overhead lines instead of pedestrian dressing. */
  poleAsset?: string;
  /** Use the painted line-marked junction tile where a matching asset exists. */
  markedJunctions: boolean;
  /** A line of low planters down the centreline - only where nothing else needs that space. */
  median: boolean;
}

const ROAD_PROFILES: Record<RoadClass, RoadProfile> = {
  lane: { lampAsset: 'kenney_road_light', lampScale: 0.85, lampSpacing: 48, parkingChance: 0, pedestrian: false, pathSpacing: 2.8, markedJunctions: false, median: false },
  street: { lampAsset: 'kenney_road_light', lampScale: 1, lampSpacing: 24, parkingChance: 0.06, pedestrian: false, pathSpacing: 2.8, markedJunctions: false, median: false },
  town: { lampAsset: 'kenney_road_light_square', lampScale: 1, lampSpacing: 18, parkingChance: 0.32, pedestrian: true, pathSpacing: 2.8, markedJunctions: true, median: false },
  avenue: { lampAsset: 'kenney_road_light_square_double', lampScale: 1.1, lampSpacing: 16, parkingChance: 0.12, pedestrian: true, pathSpacing: 2.8, markedJunctions: true, median: true },
  city: { lampAsset: 'kenney_road_light_square_double', lampScale: 1.15, lampSpacing: 18, parkingChance: 0.24, pedestrian: true, pathSpacing: 2.0, markedJunctions: true, median: false },
  industrial: { lampAsset: 'kenney_road_light', lampScale: 1, lampSpacing: 30, parkingChance: 0.12, pedestrian: false, pathSpacing: 2.8, poleAsset: 'kenney_road_electricity_pole_wide', markedJunctions: false, median: false },
};
const CELL = 12;

/** Kenney road tile yaw (degrees) by the sides a tile connects to (N = -Z, E = +X, S = +Z, W = -X). */
const STRAIGHT_EW = 0;
const STRAIGHT_NS = 90;
const T_BY_MISSING: Record<string, number> = { N: 180, E: 270, S: 0, W: 90 };
const BEND_BY_SIDES: Record<string, number> = { NE: 180, ES: 90, SW: 0, NW: 270 };
const END_BY_SIDE: Record<string, number> = { N: 180, E: 90, S: 0, W: 270 };

const deg = (d: number): number => (d * Math.PI) / 180;

/** Kinds of scenery that make way for the child's own building. */
const SOFT_KINDS = new Set(['tree', 'bush', 'rock', 'decoration', 'street-furniture', 'vehicle', 'water']);

function defaultBlock(asset: AssetDefinition): 'hard' | 'soft' {
  if (asset.tags?.includes('landmark')) return 'hard';
  if (asset.kind === 'rock' && asset.bounds.height >= 3) return 'hard';
  if (asset.kind === 'construction' && asset.tags?.includes('crate')) return 'soft';
  return SOFT_KINDS.has(asset.kind) ? 'soft' : 'hard';
}

class Occupancy {
  private readonly cells = new Map<string, WorldRect[]>();

  free(rect: WorldRect, margin: number): boolean {
    for (const key of this.keys(rect, margin)) {
      for (const other of this.cells.get(key) ?? []) if (rectsOverlap(rect, other, margin)) return false;
    }
    return true;
  }

  add(rect: WorldRect): void {
    for (const key of this.keys(rect, 0)) {
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(rect);
    }
  }

  private *keys(rect: WorldRect, margin: number): Generator<string> {
    for (let x = Math.floor((rect.minX - margin) / CELL); x <= Math.floor((rect.maxX + margin) / CELL); x++) {
      for (let z = Math.floor((rect.minZ - margin) / CELL); z <= Math.floor((rect.maxZ + margin) / CELL); z++) yield `${x},${z}`;
    }
  }
}

interface PlaceOptions {
  scale?: number;
  y?: number;
  detail?: SceneryDetail;
  /**
   * 'hard': construction may never overlap it (buildings, roads, yards).
   * 'soft': it gives way when the child builds there (plants, small props).
   * null: ignored (it sits on something hard). Default: by the asset's kind.
   */
  block?: 'hard' | 'soft' | null;
  margin?: number;
  /** Skip the occupancy test (a car on a driveway, a lamp on a sidewalk). */
  force?: boolean;
  /** Record the footprint so later pieces avoid it. Default true. */
  occupy?: boolean;
  /** Alternative colour atlas (ignored for models that don't offer it). */
  palette?: string | null;
}

export class WorldComposer {
  private readonly rand: () => number;
  private readonly occupancy = new Occupancy();
  private readonly pieces: SceneryPiece[] = [];
  private readonly blockers: Blocker[] = [];
  private readonly tiles = new Map<string, { i: number; j: number }>();
  private readonly tileClass = new Map<string, RoadClass>();
  /** Tile keys ("i,j") covered by paving. */
  private readonly paved = new Set<string>();
  private readonly pools: Record<string, AssetDefinition[]>;

  constructor(
    private readonly spec: WorldSpec,
    private readonly registry: AssetRegistry,
    private readonly heightAt: (x: number, z: number) => number,
  ) {
    this.rand = seededRandom(spec.seed);
    const real = (a: AssetDefinition) => !a.placeholder;
    const idStarts = (prefix: string) => (a: AssetDefinition) => a.id.startsWith(prefix);
    const kind = (k: Parameters<AssetRegistry['ofKind']>[0], tag?: string) => registry.ofKind(k, tag).filter(real);
    this.pools = {
      houses: kind('residential').filter(idStarts('kenney_sub_house')),
      shops: kind('commercial', '!distant').filter((a) => !a.tags?.includes('tower') && a.bounds.height < 13),
      offices: kind('commercial', '!distant').filter((a) => !a.tags?.includes('tower') && a.bounds.height >= 13),
      towers: kind('commercial', '!distant').filter((a) => a.tags?.includes('tower') || a.id.includes('skyscraper')),
      distant: kind('commercial', 'distant'),
      factories: kind('industrial').filter(idStarts('kenney_ind_building')),
      silos: kind('industrial', 'silo'),
      containers: kind('utility', 'container'),
      tanks: registry.ofKind('utility').filter((a) => a.id.includes('tank')),
      chimneys: registry.ofKind('utility').filter((a) => a.id.includes('chimney')),
      solar: kind('utility', 'solar'),
      crates: kind('construction', 'crate'),
      trees: ['kenney_nat_tree_fat', 'kenney_nat_tree_simple', 'kenney_nat_tree_tall', 'kenney_nat_tree_default_dark', 'kenney_nat_tree_blocks', 'kenney_nat_tree_cone', 'kenney_nat_tree_small', 'kenney_nat_tree_fat', 'kenney_nat_tree_default_dark', 'kenney_nat_tree_fat_fall']
        .map((id) => registry.get(id))
        .filter((a): a is AssetDefinition => !!a),
      pines: ['kenney_nat_tree_pine_tall_b', 'kenney_nat_tree_pine_ground_a', 'kenney_nat_tree_pine_tall_a_detailed']
        .map((id) => registry.get(id))
        .filter((a): a is AssetDefinition => !!a),
      streetTrees: kind('tree', '!pine').filter((a) => a.id.startsWith('kenney_sub_tree') || a.id.includes('tree_oak_dark')),
      farTrees: ['kenney_nat_tree_pine_tall_b', 'kenney_nat_tree_pine_ground_a', 'kenney_nat_tree_fat', 'kenney_nat_tree_simple', 'kenney_nat_tree_tall', 'kenney_nat_tree_pine_tall_b', 'kenney_nat_tree_default_dark']
        .map((id) => registry.get(id))
        .filter((a): a is AssetDefinition => !!a),
      bushes: kind('bush').filter((a) => a.bounds.height >= 0.7 && !a.id.includes('flower') && !a.id.includes('grass')),
      flowers: kind('bush').filter((a) => a.id.includes('flower')),
      grass: kind('bush').filter((a) => a.id.includes('grass')),
      rocks: kind('rock').filter((a) => a.bounds.height >= 0.8 && !a.id.includes('cliff')),
      bigRocks: kind('rock').filter((a) => a.bounds.height >= 3 && !a.id.includes('cliff')),
      cars: ['kenney_car_sedan', 'kenney_car_suv', 'kenney_car_taxi', 'kenney_car_van', 'kenney_car_hatchback', 'kenney_car_suv_luxury', 'kenney_car_sedan_sports', 'kenney_car_police']
        .map((id) => registry.get(id))
        .filter((a): a is AssetDefinition => !!a),
      trucks: ['kenney_car_truck', 'kenney_car_truck_flat', 'kenney_car_delivery', 'kenney_car_delivery_flat', 'kenney_car_garbage_truck']
        .map((id) => registry.get(id))
        .filter((a): a is AssetDefinition => !!a),
    };
  }

  compose(): ComposedWorld {
    this.occupy(this.spec.homePlot, 0);
    for (const lake of this.spec.water) {
      this.occupy({ minX: lake.x - lake.radius, maxX: lake.x + lake.radius, minZ: lake.z - lake.radius, maxZ: lake.z + lake.radius }, 0);
    }
    for (const plot of this.spec.openPlots) this.occupy(plot, 0);
    this.homeGarden();
    this.layRoads();
    this.dressJunctions();
    this.markOpenPlots();
    this.paveCity();
    for (const landmark of this.spec.landmarks) this.composeLandmark(landmark);
    this.lotsAlongRoads();
    for (const district of this.spec.districts) this.fillDistrict(district);
    this.lakeShore();
    this.outerLandscape();
    this.skyline();
    const assetIds = [...new Set(this.pieces.map((p) => p.asset))];
    const roadTiles = [...this.tiles.values()].map(({ i, j }) => ({ x: i * this.spec.tile, z: j * this.spec.tile }));
    return { pieces: this.pieces, blockers: this.blockers, roadTiles, assetIds };
  }

  // ------------------------------------------------------------------ core

  private pick<T>(list: T[]): T {
    return list[Math.floor(this.rand() * list.length) % list.length];
  }

  private chance(p: number): boolean {
    return this.rand() < p;
  }

  private palette(mix: PaletteMix | undefined): string | null {
    if (!mix) return null;
    let roll = this.rand();
    for (const [palette, weight] of mix) {
      if ((roll -= weight) <= 0) return palette;
    }
    return mix[mix.length - 1][0];
  }

  private asset(id: string): AssetDefinition | undefined {
    return this.registry.get(id);
  }

  /** Ground height offset for something standing in a paved area. */
  private pavedLift(x: number, z: number): number {
    const t = this.spec.tile;
    return this.paved.has(`${Math.round(x / t)},${Math.round(z / t)}`) ? PAVING_HEIGHT : 0;
  }

  private inBuildArea(x: number, z: number): boolean {
    const h = this.spec.buildHalfSize + 2;
    return Math.abs(x) <= h && Math.abs(z) <= h;
  }

  private occupy(rect: WorldRect, margin: number): void {
    this.occupancy.add({ minX: rect.minX - margin, maxX: rect.maxX + margin, minZ: rect.minZ - margin, maxZ: rect.maxZ + margin });
  }

  /** Footprint of an asset at a yaw, as an axis-aligned rectangle. */
  private rectOf(asset: AssetDefinition, x: number, z: number, rotationY: number, scale: number): WorldRect {
    const w = asset.footprint.width * scale;
    const d = asset.footprint.depth * scale;
    const c = Math.abs(Math.cos(rotationY));
    const s = Math.abs(Math.sin(rotationY));
    const hx = (c * w + s * d) / 2;
    const hz = (s * w + c * d) / 2;
    return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
  }

  private place(asset: AssetDefinition | undefined, x: number, z: number, rotationY: number, options: PlaceOptions = {}): boolean {
    if (!asset) return false;
    const scale = options.scale ?? 1;
    const rect = this.rectOf(asset, x, z, rotationY, scale);
    const inside = this.inBuildArea(x, z);
    if (!options.force) {
      if (!this.occupancy.free(rect, options.margin ?? 0.4)) return false;
      if (rectsOverlap(rect, this.spec.homePlot, 1)) return false;
    }
    if (options.occupy !== false) this.occupancy.add(rect);
    const ground = inside ? 0 : this.heightAt(x, z);
    const block = options.block === undefined ? defaultBlock(asset) : options.block;
    this.pieces.push({
      asset: asset.id,
      x,
      y: ground + (options.y ?? 0),
      z,
      rotationY,
      scale,
      detail: options.detail ?? 'mid',
      ...(options.palette && asset.palettes?.includes(options.palette) ? { palette: options.palette } : {}),
      ...(block === 'soft' && inside ? { clearable: rect } : {}),
    });
    if (block === 'hard' && inside) this.blockers.push(rect);
    return true;
  }

  /**
   * The home plot is kept for the child, but not bare: a few trees along its
   * edges and flower patches, all soft, so they give way to the first build.
   */
  private homeGarden(): void {
    const plot = this.spec.homePlot;
    const place = (asset: AssetDefinition | undefined, x: number, z: number, scale: number, detail: SceneryDetail) =>
      this.place(asset, x, z, this.rand() * 6.28, { force: true, block: 'soft', detail, scale });
    for (let x = plot.minX + 4; x < plot.maxX - 3; x += 9 + this.rand() * 8) {
      if (this.chance(0.6)) place(this.pick(this.pools.trees), x, plot.maxZ - 2.5 - this.rand() * 3, 0.9 + this.rand() * 0.4, 'mid');
    }
    for (let z = plot.minZ + 8; z < plot.maxZ - 6; z += 10 + this.rand() * 8) {
      if (this.chance(0.55)) place(this.pick(this.pools.trees), plot.minX + 2.5 + this.rand() * 2, z, 0.9 + this.rand() * 0.4, 'mid');
      if (this.chance(0.55)) place(this.pick(this.pools.trees), plot.maxX - 2.5 - this.rand() * 2, z, 0.9 + this.rand() * 0.4, 'mid');
    }
    // Low hedges along the plot's street edges, with gaps for paths.
    const hedge = this.asset('kenney_nat_plant_bush_detailed');
    for (let x = plot.minX + 1.5; x < plot.maxX - 1; x += 2.1) {
      if (Math.abs(x - (plot.minX + plot.maxX) / 2) < 5) continue;
      if (Math.floor((x - plot.minX) / 24) % 2 === 1 && (x - plot.minX) % 24 < 4) continue;
      place(hedge, x, plot.minZ + 1.2, 0.75, 'near');
    }
    for (let z = plot.minZ + 1.5; z < plot.maxZ - 1; z += 2.1) {
      if (Math.abs(z - (plot.minZ + plot.maxZ) / 2) < 4) continue;
      place(hedge, plot.minX + 1.2, z, 0.75, 'near');
      place(hedge, plot.maxX - 1.2, z, 0.75, 'near');
    }
    // Wildflower meadows in drifts.
    for (let k = 0; k < 10; k++) {
      const mx = plot.minX + 10 + this.rand() * (plot.maxX - plot.minX - 20);
      const mz = plot.minZ + 10 + this.rand() * (plot.maxZ - plot.minZ - 20);
      for (let n = 0; n < 9; n++) {
        place(this.pick(this.pools.flowers), mx + (this.rand() - 0.5) * 7, mz + (this.rand() - 0.5) * 5, 0.9, 'near');
      }
    }
    for (let k = 0; k < 16; k++) {
      const x = plot.minX + 6 + this.rand() * (plot.maxX - plot.minX - 12);
      const z = plot.minZ + 6 + this.rand() * (plot.maxZ - plot.minZ - 12);
      const cluster = this.chance(0.5) ? this.pools.flowers : this.pools.grass;
      for (let n = 0; n < 3; n++) place(this.pick(cluster), x + (this.rand() - 0.5) * 3, z + (this.rand() - 0.5) * 3, 0.8, 'near');
    }
    for (let k = 0; k < 4; k++) {
      const x = plot.minX + 8 + this.rand() * (plot.maxX - plot.minX - 16);
      const z = plot.minZ + 8 + this.rand() * (plot.maxZ - plot.minZ - 16);
      place(this.pick(this.pools.rocks), x, z, 0.5 + this.rand() * 0.3, 'near');
    }
  }

  /** A little wooden sign at each open plot's corner: "you can build here". */
  private markOpenPlots(): void {
    const sign = this.registry.get('kenney_nat_sign');
    for (const plot of this.spec.openPlots) {
      this.place(sign, plot.minX + 1.5, plot.maxZ - 1.2, 0.3, { force: true, occupy: false, detail: 'near', scale: 0.8 });
      this.place(this.pick(this.pools.flowers), plot.minX + 3.2, plot.maxZ - 1.1, 0, { force: true, occupy: false, detail: 'near', scale: 0.8 });
    }
  }

  // ----------------------------------------------------------------- roads

  private layRoads(): void {
    for (const run of this.spec.roads) {
      const [i0, j0] = run.from;
      const [i1, j1] = run.to;
      const steps = Math.max(Math.abs(i1 - i0), Math.abs(j1 - j0));
      const cls = run.class ?? 'street';
      for (let k = 0; k <= steps; k++) {
        const i = i0 + Math.sign(i1 - i0) * k;
        const j = j0 + Math.sign(j1 - j0) * k;
        const key = `${i},${j}`;
        this.tiles.set(key, { i, j });
        const current = this.tileClass.get(key);
        if (!current || ROAD_CLASSES.indexOf(cls) < ROAD_CLASSES.indexOf(current)) this.tileClass.set(key, cls);
      }
    }
    const t = this.spec.tile;
    for (const { i, j } of this.tiles.values()) {
      const n = this.hasTile(i, j - 1);
      const e = this.hasTile(i + 1, j);
      const s = this.hasTile(i, j + 1);
      const w = this.hasTile(i - 1, j);
      const count = +n + +e + +s + +w;
      const cls = this.tileClass.get(`${i},${j}`) ?? 'street';
      const marked = ROAD_PROFILES[cls].markedJunctions;
      let asset = 'kenney_road_straight';
      let yaw = STRAIGHT_EW;
      if (count === 4) asset = 'kenney_road_road_crossroad';
      else if (count === 3) {
        asset = marked ? 'kenney_road_road_intersection_line' : 'kenney_road_intersection';
        yaw = T_BY_MISSING[!n ? 'N' : !e ? 'E' : !s ? 'S' : 'W'];
      } else if (count === 2 && n && s) yaw = STRAIGHT_NS;
      else if (count === 2 && e && w) yaw = STRAIGHT_EW;
      else if (count === 2) {
        asset = 'kenney_road_road_bend';
        yaw = BEND_BY_SIDES[(n ? 'N' : '') + (e ? 'E' : '') + (s ? 'S' : '') + (w ? 'W' : '')] ?? 0;
      } else if (count === 1) {
        asset = 'kenney_road_road_end';
        yaw = END_BY_SIDE[n ? 'N' : e ? 'E' : s ? 'S' : 'W'];
      } else asset = 'kenney_road_road_square';
      // Zebra crossings next to busy junctions on avenues, town and city streets.
      if (count === 2 && marked && (n && s ? this.junction(i, j - 1) || this.junction(i, j + 1) : this.junction(i - 1, j) || this.junction(i + 1, j))) {
        asset = 'kenney_road_crossing';
      }
      this.place(this.registry.get(asset), i * t, j * t, deg(yaw), { force: true, detail: 'far' });
    }
  }

  private hasTile(i: number, j: number): boolean {
    return this.tiles.has(`${i},${j}`);
  }

  private junction(i: number, j: number): boolean {
    if (!this.hasTile(i, j)) return false;
    return +this.hasTile(i, j - 1) + +this.hasTile(i + 1, j) + +this.hasTile(i, j + 1) + +this.hasTile(i - 1, j) >= 3;
  }

  /**
   * Traffic lights on the corners of busy junctions, stop signs where a
   * quiet street meets a busy road, planters on the big ones.
   */
  private dressJunctions(): void {
    const t = this.spec.tile;
    const light = this.asset('kenney_road_traffic_light');
    const stop = this.asset('kenney_road_sign_stop');
    const rank = (i: number, j: number) => {
      const c = this.tileClass.get(`${i},${j}`);
      return c ? ROAD_CLASSES.indexOf(c) : 99;
    };
    for (const { i, j } of this.tiles.values()) {
      if (!this.junction(i, j)) continue;
      const cls = this.tileClass.get(`${i},${j}`)!;
      const busy = ROAD_PROFILES[cls].markedJunctions;
      const x = i * t;
      const z = j * t;
      const corners: Array<[number, number]> = [[1, 1], [-1, -1], [1, -1], [-1, 1]];
      corners.forEach(([sx, sz], k) => {
        const cx = x + sx * (ROAD_HALF + 0.7);
        const cz = z + sz * (ROAD_HALF + 0.7);
        if (busy && k < 2) {
          this.place(light, cx, cz, Math.atan2(-sx, -sz), { force: true, occupy: false, detail: 'small' });
        }
      });
      // A stop sign on each quiet street that joins a busier road here.
      const neighbours: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      for (const [di, dj] of neighbours) {
        if (!this.hasTile(i + di, j + dj)) continue;
        if (rank(i + di, j + dj) <= rank(i, j)) continue;
        const px = x + di * (ROAD_HALF + 2) - dj * (ROAD_HALF + 0.6);
        const pz = z + dj * (ROAD_HALF + 2) + di * (ROAD_HALF + 0.6);
        this.place(stop, px, pz, Math.atan2(di, dj), { force: true, occupy: false, detail: 'near' });
      }
    }
  }

  /** Maximal straight stretches between junctions, bends and ends. */
  private straightRuns(): Array<{ start: Vec2; end: Vec2; along: Vec2; cls: RoadClass }> {
    const t = this.spec.tile;
    const runs: Array<{ start: Vec2; end: Vec2; along: Vec2; cls: RoadClass }> = [];
    const straight = (i: number, j: number, ew: boolean) =>
      this.hasTile(i, j) &&
      (ew
        ? this.hasTile(i - 1, j) && this.hasTile(i + 1, j) && !this.hasTile(i, j - 1) && !this.hasTile(i, j + 1)
        : this.hasTile(i, j - 1) && this.hasTile(i, j + 1) && !this.hasTile(i - 1, j) && !this.hasTile(i + 1, j));
    for (const ew of [true, false]) {
      const seen = new Set<string>();
      for (const { i, j } of this.tiles.values()) {
        const key = `${i},${j}`;
        if (seen.has(key) || !straight(i, j, ew)) continue;
        // Walk to the start of this run, then to its end.
        let a = ew ? i : j;
        while (straight(ew ? a - 1 : i, ew ? j : a - 1, ew)) a--;
        let b = a;
        while (straight(ew ? b + 1 : i, ew ? j : b + 1, ew)) b++;
        for (let k = a; k <= b; k++) seen.add(ew ? `${k},${j}` : `${i},${k}`);
        const along = ew ? { x: 1, z: 0 } : { x: 0, z: 1 };
        const start = ew ? { x: a * t - t / 2, z: j * t } : { x: i * t, z: a * t - t / 2 };
        const end = ew ? { x: b * t + t / 2, z: j * t } : { x: i * t, z: b * t + t / 2 };
        runs.push({ start, end, along, cls: this.tileClass.get(key) ?? 'street' });
      }
    }
    // Stable order so the seed always gives the same world.
    return runs.sort((p, q) => p.start.x - q.start.x || p.start.z - q.start.z);
  }

  // ------------------------------------------------------------------ lots

  private lotsAlongRoads(): void {
    for (const run of this.straightRuns()) {
      const length = Math.hypot(run.end.x - run.start.x, run.end.z - run.start.z);
      for (const side of [-1, 1]) {
        const normal = run.along.x !== 0 ? { x: 0, z: side } : { x: side, z: 0 };
        const mid = { x: (run.start.x + run.end.x) / 2 + normal.x * 12, z: (run.start.z + run.end.z) / 2 + normal.z * 12 };
        const district = this.districtAt(mid.x, mid.z);
        const at = (a: number, perp: number): Vec2 => ({
          x: run.start.x + run.along.x * a + normal.x * perp,
          z: run.start.z + run.along.z * a + normal.z * perp,
        });
        const facing = Math.atan2(-normal.x, -normal.z);
        this.streetFurniture(length, at, facing, run.cls, side, run.along);
        switch (district?.kind) {
          case 'residential':
            this.residentialLots(length, at, facing, district);
            break;
          case 'town':
            this.townLots(length, at, facing);
            break;
          case 'city':
            this.cityLots(length, at, facing);
            break;
          case 'industrial':
            this.industrialLots(length, at, facing);
            break;
          default:
            this.verge(length, at, facing);
        }
      }
    }
  }

  private districtAt(x: number, z: number): DistrictDefinition | undefined {
    return this.spec.districts.find((d) => rectContains(d.rect, x, z));
  }

  /**
   * How a road is dressed is what makes the hierarchy readable (see
   * `ROAD_PROFILES`):
   *   avenue      wide paved sidewalks, grand double lamps, a tree line, a planted median
   *   city        paved sidewalks, grand double lamps (downtown skyline core)
   *   town        paved sidewalks, square lamps, planters, busy parking
   *   industrial  wide poles and wires, plain lamps, parked trucks
   *   street      curved lamps, the odd parked car (gardens do the rest)
   *   lane        almost nothing: a quiet road through the green
   */
  private streetFurniture(length: number, at: (a: number, p: number) => Vec2, facing: number, cls: RoadClass, side: number, along: Vec2): void {
    const profile = ROAD_PROFILES[cls];
    if (profile.pedestrian) {
      const strip = this.asset('kenney_sub_path_long');
      const yaw = Math.atan2(along.x, along.z);
      for (let a = 1.4; a < length - 1.2; a += profile.pathSpacing) {
        const p = at(a, ROAD_HALF + 0.7);
        this.place(strip, p.x, p.z, yaw, { force: true, occupy: false, block: 'soft', detail: 'mid' });
      }
    }
    const lamp = this.asset(profile.lampAsset);
    const squareStyle = profile.lampAsset.startsWith('kenney_road_light_square');
    for (let a = 6 + (side > 0 ? profile.lampSpacing / 2 : 0); a < length - 4; a += profile.lampSpacing) {
      const p = at(a, ROAD_HALF - 0.95);
      this.place(lamp, p.x, p.z, facing - Math.PI / 2 + (squareStyle ? Math.PI / 2 : 0), { force: true, detail: 'small', occupy: false, scale: profile.lampScale });
    }
    if (cls === 'avenue') {
      for (let a = 14 + (side > 0 ? 8 : 0); a < length - 6; a += 16) {
        const p = at(a, ROAD_HALF + 2.4);
        this.place(this.pick(this.pools.streetTrees), p.x, p.z, this.rand() * 6.28, { detail: 'mid', scale: 1.05, margin: 0.1 });
      }
    } else if (cls === 'city' || cls === 'town') {
      for (let a = 10; a < length - 6; a += 21) {
        const p = at(a, ROAD_HALF + 0.75);
        this.place(this.asset('kenney_sub_planter'), p.x, p.z, facing, { force: true, occupy: false, detail: 'near', scale: 0.6 });
      }
    } else if (profile.poleAsset) {
      const pole = this.asset(profile.poleAsset);
      for (let a = 10; a < length - 6; a += 30) {
        const p = at(a, ROAD_HALF + 1.4);
        this.place(pole, p.x, p.z, facing, { detail: 'small', margin: 0.2 });
      }
    }
    // Parked cars at the kerb (never in a quiet lane).
    for (let a = 5; a < length - 5; a += 7.5) {
      if (!this.chance(profile.parkingChance)) continue;
      const p = at(a, ROAD_HALF - 1.55);
      const pool = cls === 'industrial' ? this.pools.trucks : this.pools.cars;
      const yaw = facing + (side > 0 ? Math.PI / 2 : -Math.PI / 2) + (this.chance(0.15) ? Math.PI : 0);
      this.place(this.pick(pool), p.x, p.z, yaw, { force: true, occupy: false, scale: VEHICLE_SCALE, detail: 'small' });
    }
    // A planted median down the centreline - an avenue's boulevard feel.
    // Only one side's call does this, or it would be placed twice on the same spot.
    if (profile.median && side > 0) {
      for (let a = 5 + this.rand() * 3; a < length - 4; a += 9 + this.rand() * 2) {
        const p = at(a, 0);
        this.place(this.asset('kenney_sub_planter'), p.x, p.z, facing, { force: true, occupy: false, detail: 'near', scale: 0.5 });
      }
    }
  }

  private residentialLots(length: number, at: (a: number, p: number) => Vec2, facing: number, district: DistrictDefinition): void {
    const driveway = this.registry.get('kenney_sub_driveway');
    const fence = this.registry.get('kenney_sub_fence');
    // Sunny Lane: roomier plots and the larger homes; Maple Grove: a tighter street.
    const roomy = district.id === 'sunny';
    const pool = roomy ? this.pools.houses.filter((h) => h.footprint.width >= 8.8) : this.pools.houses;
    let a = 3 + this.rand() * 3;
    while (a < length - 4) {
      const house = this.pick(pool);
      const w = house.footprint.width;
      const d = house.footprint.depth;
      if (a + w + 3.5 > length) break;
      const setback = (roomy ? 6 : 4.2) + this.rand() * 2.5;
      const c = at(a + w / 2, ROAD_HALF + setback + d / 2);
      // Slight turns and jitter so rows don't read as copies.
      const yaw = facing + (this.rand() - 0.5) * 0.08;
      if (!this.place(house, c.x, c.z, yaw, { detail: 'far', margin: 0.6, palette: this.palette(PALETTES[district.id]) })) {
        a += 3;
        continue;
      }
      // Driveway beside the house, and often a car on it.
      const driveAt = a + w + 1.5;
      const pieces = Math.max(1, Math.round((setback + d * 0.6) / 2.8));
      for (let k = 0; k < pieces; k++) {
        const p = at(driveAt, ROAD_HALF + 1.4 + k * 2.8);
        this.place(driveway, p.x, p.z, facing, { force: true, detail: 'mid' });
      }
      if (this.chance(0.4)) {
        const p = at(driveAt, ROAD_HALF + 1.4 + Math.min(pieces - 1, 1) * 2.8 + 0.6);
        this.place(this.pick(this.pools.cars), p.x, p.z, facing + (this.chance(0.5) ? Math.PI : 0), { force: true, y: 0.07, scale: VEHICLE_SCALE * 0.9, detail: 'small' });
      }
      // Front garden: a tree or bushes, flowers by the door.
      const g = at(a + this.rand() * w * 0.5 + 0.8, ROAD_HALF + 1.3 + this.rand() * (setback - 2));
      if (this.chance(0.55)) this.place(this.pick(this.pools.streetTrees), g.x, g.z, this.rand() * 6.28, { detail: 'mid', scale: 0.85 + this.rand() * 0.3, margin: 0.2 });
      else this.place(this.pick(this.pools.bushes), g.x, g.z, this.rand() * 6.28, { detail: 'near', block: 'soft', margin: 0.1 });
      const f = at(a + w * (0.2 + this.rand() * 0.6), ROAD_HALF + setback - 0.7);
      this.place(this.pick(this.pools.flowers), f.x, f.z, this.rand() * 6.28, { detail: 'near', block: 'soft', margin: 0, scale: 0.8 });
      // Back fence and a garden tree.
      const back = ROAD_HALF + setback + d + 1.6;
      for (let s = a - 0.5; s < a + w + 3; s += 3.3) {
        const p = at(s + 1.65, back);
        this.place(fence, p.x, p.z, facing, { detail: 'near', block: 'soft', margin: 0 });
      }
      if (this.chance(0.7)) {
        const p = at(a + this.rand() * w, back + 3 + this.rand() * 3);
        this.place(this.pick(this.pools.trees), p.x, p.z, this.rand() * 6.28, { detail: 'mid', scale: 0.9 + this.rand() * 0.4, margin: 0.3 });
      }
      a += w + 3.2 + (roomy ? 3 : 1.2) + this.rand() * 3;
      // Now and then a pocket park between the houses.
      if (this.chance(roomy ? 0.12 : 0.07) && a + 14 < length) {
        const p = at(a + 6, ROAD_HALF + 7);
        this.place(this.pick(this.pools.trees), p.x - 3, p.z, this.rand() * 6.28, { detail: 'mid', scale: 1.1 });
        this.place(this.pick(this.pools.trees), p.x + 3, p.z + 2, this.rand() * 6.28, { detail: 'mid', scale: 0.95 });
        const b = at(a + 6, ROAD_HALF + 2.6);
        this.place(this.asset('kenney_furn_bench'), b.x, b.z, facing + Math.PI, { detail: 'near', margin: 0.1 });
        this.place(this.pick(this.pools.flowers), b.x + 1.8, b.z + 1.2, 0, { detail: 'near', margin: 0 });
        a += 14;
      }
    }
  }

  private townLots(length: number, at: (a: number, p: number) => Vec2, facing: number): void {
    let a = 2.5;
    while (a < length - 3) {
      if (this.chance(0.18)) {
        // A little square between shops: parasols, a planter, a tree, benches.
        const p = at(a + 3, ROAD_HALF + 3.5);
        this.place(this.pick([this.registry.get('kenney_com_detail_parasol_a'), this.registry.get('kenney_com_detail_parasol_b')]), p.x, p.z, facing, { detail: 'near', block: 'soft' });
        const q = at(a + 3, ROAD_HALF + 7.5);
        this.place(this.pick(this.pools.streetTrees), q.x, q.z, 0, { detail: 'mid' });
        const b = at(a + 1, ROAD_HALF + 1.4);
        this.place(this.registry.get('kenney_furn_bench'), b.x, b.z, facing + Math.PI, { detail: 'near', block: 'soft', margin: 0.1 });
        const pot = at(a + 5.2, ROAD_HALF + 1.5);
        this.place(this.registry.get('kenney_nat_pot_large'), pot.x, pot.z, 0, { detail: 'near', block: 'soft', scale: 0.55, margin: 0.1 });
        a += 7;
        continue;
      }
      const shop = this.pick(this.chance(0.3) ? this.pools.offices : this.pools.shops);
      const w = shop.footprint.width;
      const d = shop.footprint.depth;
      if (a + w > length - 1) break;
      const c = at(a + w / 2, ROAD_HALF + 1.6 + d / 2);
      if (this.place(shop, c.x, c.z, facing, { detail: 'far', margin: 0.2, palette: this.palette(PALETTES.town) })) {
        if (this.chance(0.4)) {
          const p = at(a + w / 2, ROAD_HALF + 1.9);
          this.place(this.asset('kenney_com_detail_awning_wide'), p.x, p.z, facing, { force: true, occupy: false, detail: 'near', block: null });
        }
        if (this.chance(0.35)) {
          const p = at(a + w / 2, ROAD_HALF + 0.9);
          this.place(this.registry.get('kenney_furn_potted_plant'), p.x, p.z, 0, { detail: 'near', block: 'soft', force: true, occupy: false });
        }
        a += w + 0.4 + this.rand() * 1.4;
      } else a += 2;
    }
  }

  /** 1 at the city center landmark, falling to 0 towards the suburbs. */
  private cityCore(x: number, z: number): number {
    const center = this.spec.landmarks.find((l) => l.kind === 'city-center');
    if (!center) return 0.5;
    const cx = (center.rect.minX + center.rect.maxX) / 2;
    const cz = (center.rect.minZ + center.rect.maxZ) / 2;
    return Math.max(0, 1 - Math.hypot(x - cx, z - cz) / 150);
  }

  private cityLots(length: number, at: (a: number, p: number) => Vec2, facing: number): void {
    let a = 2;
    while (a < length - 3) {
      const probe = at(a, 10);
      const core = this.cityCore(probe.x, probe.z);
      const building = this.pick(this.chance(0.3 + core * 0.55) ? this.pools.towers : this.pools.offices);
      const scale = 1 + core * 0.35 * this.rand();
      const w = building.footprint.width * scale;
      const d = building.footprint.depth * scale;
      if (a + w > length - 1) break;
      const c = at(a + w / 2, ROAD_HALF + 2 + d / 2);
      if (this.place(building, c.x, c.z, facing, { detail: 'far', margin: 0.8, scale, y: this.pavedLift(c.x, c.z), palette: this.palette(PALETTES.city) })) {
        const t = at(a + w + 1.4, ROAD_HALF + 1.6);
        if (this.chance(0.5)) this.place(this.pick(this.pools.streetTrees), t.x, t.z, 0, { detail: 'mid', scale: 0.8, margin: 0.1 });
        a += w + 2.5 + this.rand() * 3;
      } else a += 2;
    }
  }

  private industrialLots(length: number, at: (a: number, p: number) => Vec2, facing: number): void {
    let a = 4;
    while (a < length - 6) {
      const factory = this.pick(this.pools.factories);
      const w = factory.footprint.width;
      const d = factory.footprint.depth;
      if (a + w > length - 3) break;
      const yard = 7 + this.rand() * 4;
      const c = at(a + w / 2, ROAD_HALF + yard + d / 2);
      if (!this.place(factory, c.x, c.z, facing, { detail: 'far', margin: 1, palette: this.palette(PALETTES.industrial) })) {
        a += 4;
        continue;
      }
      // Yard: a truck at the loading door, crates, a container stack.
      const truck = at(a + w * (0.25 + this.rand() * 0.5), ROAD_HALF + yard * 0.55);
      this.place(this.pick(this.pools.trucks), truck.x, truck.z, facing + (this.chance(0.5) ? Math.PI : 0), { scale: VEHICLE_SCALE, detail: 'small', margin: 0.3 });
      const crate = at(a + 1.5, ROAD_HALF + yard - 1.6);
      this.place(this.pick(this.pools.crates), crate.x, crate.z, this.rand() * 0.4, { detail: 'near', block: 'soft', margin: 0.2 });
      const side = a + w + 3.2;
      const stack = 1 + Math.floor(this.rand() * 3);
      for (let k = 0; k < stack; k++) {
        const p = at(side, ROAD_HALF + yard + 1 + k * 6.2);
        const container = this.pick(this.pools.containers);
        if (this.place(container, p.x, p.z, facing, { detail: 'mid', margin: 0.2 }) && this.chance(0.45)) {
          this.place(this.pick(this.pools.containers), p.x, p.z, facing, { force: true, occupy: false, y: container.bounds.height, detail: 'mid', block: null });
        }
      }
      if (this.chance(0.5)) {
        const p = at(a + w * this.rand(), ROAD_HALF + yard + d + 4);
        this.place(this.pick(this.chance(0.5) ? this.pools.tanks : this.pools.silos), p.x, p.z, facing, { detail: 'far', margin: 0.5, palette: 'variation-b.png' });
      }
      if (this.chance(0.35)) {
        const p = at(a + w - 1.5, ROAD_HALF + yard + d + 1.4);
        this.place(this.pick(this.pools.chimneys), p.x, p.z, 0, { detail: 'far', margin: 0.1, palette: this.palette(PALETTES.industrial) });
      }
      a += w + 9 + this.rand() * 5;
    }
  }

  /** Quiet roads through nature: a line of trees on the verge. */
  private verge(length: number, at: (a: number, p: number) => Vec2, facing: number): void {
    for (let a = 4; a < length - 3; a += 9 + this.rand() * 4) {
      const p = at(a, ROAD_HALF + 2 + this.rand() * 1.5);
      this.place(this.pick(this.pools.streetTrees), p.x, p.z, facing + this.rand(), { detail: 'mid', margin: 0.3, scale: 0.9 + this.rand() * 0.3 });
    }
  }

  // --------------------------------------------------------------- fills

  private fillDistrict(district: DistrictDefinition): void {
    const r = district.rect;
    const spacing = district.kind === 'nature' || district.kind === 'lake' ? 6.5 : district.kind === 'city' ? 13 : 10;
    for (let x = r.minX + spacing / 2; x < r.maxX; x += spacing) {
      for (let z = r.minZ + spacing / 2; z < r.maxZ; z += spacing) {
        const px = x + (this.rand() - 0.5) * spacing * 0.8;
        const pz = z + (this.rand() - 0.5) * spacing * 0.8;
        if (!this.inBuildArea(px, pz) || !rectContains(r, px, pz)) continue;
        switch (district.kind) {
          case 'residential':
            this.fillResidential(px, pz);
            break;
          case 'town':
            this.fillTown(px, pz);
            break;
          case 'city':
            this.fillCity(px, pz);
            break;
          case 'industrial':
            this.fillIndustrial(px, pz);
            break;
          case 'nature':
          case 'lake':
            this.fillNature(px, pz, district.kind === 'lake');
            break;
          default:
            break;
        }
      }
    }
  }

  private quarter(): number {
    return Math.floor(this.rand() * 4) * (Math.PI / 2);
  }

  private fillResidential(x: number, z: number): void {
    const roll = this.rand();
    const wood = fbm(x * 0.03, z * 0.03, this.spec.seed + 5, 3);
    if (roll < 0.22 + Math.max(0, wood) * 0.4) this.place(this.pick(this.pools.trees), x, z, this.rand() * 6.28, { detail: 'mid', scale: 0.9 + this.rand() * 0.5 });
    else if (roll < 0.32) this.place(this.pick(this.pools.bushes), x, z, this.rand() * 6.28, { detail: 'near', block: 'soft' });
    else if (roll < 0.36) this.place(this.pick(this.pools.flowers), x, z, this.rand() * 6.28, { detail: 'near', block: 'soft', margin: 0.1 });
  }

  /** Open lots: patches of districts left free for the child's own building. */
  private openLot(x: number, z: number): boolean {
    return fbm(x * 0.018, z * 0.018, this.spec.seed + 41, 3) < -0.08;
  }

  private fillTown(x: number, z: number): void {
    const roll = this.rand();
    if (roll < 0.3 && !this.openLot(x, z)) this.place(this.pick(this.pools.shops), x, z, this.quarter(), { detail: 'far', margin: 1.2, palette: this.palette(PALETTES.town) });
    else if (roll < 0.45) this.place(this.pick(this.pools.streetTrees), x, z, 0, { detail: 'mid' });
    else if (roll < 0.5) this.place(this.registry.get('kenney_furn_bench'), x, z, this.quarter(), { detail: 'near', block: 'soft' });
  }

  private fillCity(x: number, z: number): void {
    const roll = this.rand();
    const core = this.cityCore(x, z);
    const lift = this.pavedLift(x, z);
    if (roll < 0.3 + core * 0.3 && !this.openLot(x, z)) {
      const tall = this.chance(0.35 + core * 0.5);
      const scale = 1 + core * 0.3 * this.rand();
      this.place(this.pick(tall ? this.pools.towers : this.pools.offices), x, z, this.quarter(), {
        detail: 'far', margin: 1.5, scale, y: lift, palette: this.palette(PALETTES.city),
      });
    } else if (roll < 0.72) {
      // Street life on the paving: planted trees, benches, parasols.
      const pick = this.rand();
      if (pick < 0.5) this.place(this.pick(this.pools.streetTrees), x, z, 0, { detail: 'mid', scale: 0.85, y: lift });
      else if (pick < 0.75) this.place(this.asset('kenney_furn_bench'), x, z, this.quarter(), { detail: 'near', y: lift });
      else this.place(this.asset('kenney_com_detail_parasol_a'), x, z, 0, { detail: 'near', y: lift });
    }
  }

  // ------------------------------------------------------------- paving

  /** Pave a rect's tiles (not roads, not open plots) with paving slabs. */
  private pave(rect: WorldRect): void {
    const t = this.spec.tile;
    const slab = this.asset('kenney_road_tile');
    for (let i = Math.ceil(rect.minX / t); i <= Math.floor(rect.maxX / t); i++) {
      for (let j = Math.ceil(rect.minZ / t); j <= Math.floor(rect.maxZ / t); j++) {
        const key = `${i},${j}`;
        if (this.tiles.has(key) || this.paved.has(key)) continue;
        const x = i * t;
        const z = j * t;
        const cell = { minX: x - t / 2, maxX: x + t / 2, minZ: z - t / 2, maxZ: z + t / 2 };
        if (this.spec.openPlots.some((plot) => rectsOverlap(cell, plot, -0.5))) continue;
        if (rectsOverlap(cell, this.spec.homePlot, -0.5)) continue;
        this.paved.add(key);
        this.place(slab, x, z, 0, { force: true, occupy: false, block: 'soft', detail: 'far' });
      }
    }
  }

  /** The city core stands on paving, so it reads as downtown, not towers in a meadow. */
  private paveCity(): void {
    for (const district of this.spec.districts) {
      if (district.kind === 'city') this.pave(district.rect);
    }
  }

  private fillIndustrial(x: number, z: number): void {
    const roll = this.rand();
    const pools = this.pools;
    if (this.openLot(x, z)) {
      if (roll < 0.15) this.place(this.pick(pools.crates), x, z, this.rand(), { detail: 'near', margin: 0.3 });
      return;
    }
    if (roll < 0.18) this.place(this.pick(pools.factories), x, z, this.quarter(), { detail: 'far', margin: 2, palette: this.palette(PALETTES.industrial) });
    else if (roll < 0.32) {
      const yaw = this.quarter();
      const c = this.pick(pools.containers);
      if (this.place(c, x, z, yaw, { detail: 'mid', margin: 0.3 })) {
        this.place(this.pick(pools.containers), x, z, yaw, { force: true, occupy: false, y: c.bounds.height, detail: 'mid', block: null });
        if (this.chance(0.4)) this.place(this.pick(pools.containers), x, z, yaw, { force: true, occupy: false, y: c.bounds.height * 2, detail: 'mid', block: null });
      }
    } else if (roll < 0.4) this.place(this.pick(pools.tanks), x, z, this.quarter(), { detail: 'far', margin: 0.8, palette: 'variation-b.png' });
    else if (roll < 0.46) this.place(this.pick(pools.silos), x, z, 0, { detail: 'far', margin: 0.6 });
    else if (roll < 0.5) this.place(this.pick(pools.solar), x, z, this.quarter(), { detail: 'mid', margin: 0.5 });
    else if (roll < 0.52) this.place(this.registry.get('kenney_fac_crane'), x, z, this.quarter(), { detail: 'far', margin: 1 });
    else if (roll < 0.55) this.place(this.registry.get('kenney_ind_water_tower'), x, z, 0, { detail: 'far', margin: 1 });
    else if (roll < 0.6) this.place(this.pick(pools.trucks), x, z, this.rand() * 6.28, { scale: VEHICLE_SCALE, detail: 'small', margin: 0.5 });
    else if (roll < 0.66) this.place(this.pick(pools.crates), x, z, this.rand(), { detail: 'near', block: 'soft', margin: 0.3 });
    else if (roll < 0.7) this.place(this.pick([this.registry.get('kenney_fac_machine'), this.registry.get('kenney_fac_pipe_large_long'), this.registry.get('kenney_fac_machine_fortified')]), x, z, this.quarter(), { detail: 'near', margin: 0.4 });
    else if (roll < 0.76) this.place(this.pick(this.pools.pines), x, z, this.rand() * 6.28, { detail: 'mid', scale: 0.8 });
  }

  private fillNature(x: number, z: number, lakeside: boolean): void {
    // Groves: trees gather where this field is high and leave real clearings
    // elsewhere, with only the odd lone tree - never an even sprinkle.
    const grove = fbm(x * 0.03, z * 0.03, this.spec.seed + 9, 4) + fbm(x * 0.009, z * 0.009, this.spec.seed + 19, 2) * 0.5;
    const roll = this.rand();
    const rot = this.rand() * 6.28;
    // Lawns stay open near the water for picnics and paths.
    const nearWater = this.spec.water.some((l) => Math.hypot(x - l.x, z - l.z) < l.radius + 16);
    if (nearWater) return;
    if (grove > 0.14 ? roll < 0.85 : roll < 0.035) {
      const tall = grove > 0.3;
      const pool = tall || lakeside ? (this.chance(0.55) ? this.pools.pines : this.pools.trees) : this.pools.trees;
      const scale = (tall ? 1.05 : 0.85) + this.rand() * 0.6;
      this.place(this.pick(pool), x, z, rot, { detail: 'mid', scale, margin: 0.2 });
    } else if (grove > 0.05 && roll < 0.3) {
      // Undergrowth at the edge of a grove.
      this.place(this.pick(this.pools.bushes), x, z, rot, { detail: 'near', margin: 0.1 });
    } else if (roll < 0.1) this.place(this.pick(this.pools.flowers), x, z, rot, { detail: 'near', block: 'soft', margin: 0 });
    else if (roll < 0.18) this.place(this.pick(this.pools.grass), x, z, rot, { detail: 'near', block: 'soft', margin: 0 });
    else if (roll < 0.22) this.place(this.pick(this.pools.bushes), x, z, rot, { detail: 'near', block: 'soft' });
    else if (roll < 0.245) this.place(this.pick(this.pools.rocks), x, z, rot, { detail: 'mid' });
    else if (roll < 0.255) this.place(this.pick([this.registry.get('kenney_nat_log'), this.registry.get('kenney_nat_stump_round'), this.registry.get('kenney_nat_mushroom_red_group')]), x, z, rot, { detail: 'near', block: 'soft' });
    else if (roll < 0.258) {
      // A campsite in a clearing.
      if (this.place(this.registry.get('kenney_nat_tent_detailed_open'), x, z, rot, { detail: 'mid', margin: 2 })) {
        this.place(this.registry.get('kenney_nat_campfire_stones'), x + Math.sin(rot) * 5, z + Math.cos(rot) * 5, 0, { detail: 'near', block: 'soft', margin: 0.2 });
        this.place(this.registry.get('kenney_nat_log'), x + Math.sin(rot) * 5 + 2.4, z + Math.cos(rot) * 5, Math.PI / 2, { detail: 'near', block: 'soft', margin: 0 });
      }
    }
  }

  // ---------------------------------------------------------- landmarks

  private landmarkIn(x: number, z: number): Landmark['kind'] | null {
    return this.spec.landmarks.find((l) => rectContains(l.rect, x, z))?.kind ?? null;
  }

  private composeLandmark(landmark: Landmark): void {
    const r = landmark.rect;
    const c = { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 };
    switch (landmark.kind) {
      case 'plaza':
        this.townSquare(r, c);
        break;
      case 'city-center':
        this.cityCenter(r, c);
        break;
      case 'park':
        this.centralPark(r);
        break;
      case 'viewpoint':
        this.lakeViewpoint(r, c);
        break;
      case 'construction':
        this.buildingSite(r, c);
        break;
      case 'wind-farm':
        this.windFarm(r);
        break;
      case 'crossing':
        this.grandCrossing(c);
        break;
    }
    // Nothing else is composed inside a landmark (the child can still build there).
    this.occupy(r, 0.5);
  }

  /** A paved square: a monument, benches around it, trees in planters, a café corner. */
  private townSquare(r: WorldRect, c: Vec2): void {
    this.pave(r);
    const y = PAVING_HEIGHT;
    const soft = { force: true, occupy: false, y, block: 'soft' as const };
    this.place(this.asset('kenney_nat_path_stone_circle'), c.x, c.z, 0, { ...soft, scale: 2.2, detail: 'far' });
    this.place(this.asset('kenney_nat_statue_obelisk'), c.x, c.z, 0, { force: true, occupy: false, y, scale: 1.8, detail: 'far' });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const bx = c.x + Math.cos(a) * 7.2;
      const bz = c.z + Math.sin(a) * 7.2;
      this.place(this.asset('kenney_furn_bench'), bx, bz, Math.atan2(c.x - bx, c.z - bz), { ...soft, detail: 'near' });
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const tx = c.x + sx * 10.5;
      const tz = c.z + sz * 10.5;
      this.place(this.asset('kenney_sub_planter'), tx, tz, 0, { ...soft, detail: 'mid' });
      this.place(this.pick(this.pools.streetTrees), tx, tz, this.rand() * 6.28, { ...soft, y: y + 0.9, scale: 1.05, detail: 'mid' });
      this.place(this.asset('kenney_road_light_square'), c.x + sx * 12.5, c.z + sz * 3, sx > 0 ? Math.PI : 0, { ...soft, detail: 'small' });
    }
    // Café corner with parasols and tables.
    for (let k = 0; k < 3; k++) {
      const px = r.maxX - 4 - k * 4.2;
      const pz = r.minZ + 3.5;
      this.place(this.asset(k % 2 ? 'kenney_com_detail_parasol_b' : 'kenney_com_detail_parasol_a'), px, pz, 0, { ...soft, detail: 'near' });
    }
    for (let k = 0; k < 6; k++) {
      const fx = r.minX + 2 + this.rand() * (r.maxX - r.minX - 4);
      const fz = r.maxZ - 2 - this.rand() * 3;
      this.place(this.pick(this.pools.flowers), fx, fz, 0, { ...soft, detail: 'near' });
    }
  }

  /** Downtown's heart: a paved plaza ringed by the tallest towers. */
  private cityCenter(r: WorldRect, c: Vec2): void {
    this.pave(r);
    const y = PAVING_HEIGHT;
    const soft = { force: true, occupy: false, y, block: 'soft' as const };
    const tallest = this.asset('kenney_com_skyscraper_d');
    const tall = this.asset('kenney_com_skyscraper_c');
    const corners: Array<[number, number, AssetDefinition | undefined, number]> = [
      [r.minX + 6, r.minZ + 6, tallest, 1.45],
      [r.maxX - 6, r.minZ + 6, tall, 1.3],
      [r.minX + 6, r.maxZ - 6, tall, 1.2],
      [r.maxX - 6, r.maxZ - 6, tallest, 1.3],
    ];
    corners.forEach(([x, z, asset, scale], k) => {
      this.place(asset, x, z, (k * Math.PI) / 2, { force: true, y, scale, detail: 'far', palette: k === 1 ? 'variation-a.png' : null });
    });
    this.place(this.asset('kenney_nat_path_stone_circle'), c.x, c.z, 0, { ...soft, scale: 2.6, detail: 'far' });
    this.place(this.asset('kenney_nat_statue_obelisk'), c.x, c.z, 0, { force: true, occupy: false, y, scale: 2.6, detail: 'far' });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const tx = c.x + Math.cos(a) * 10;
      const tz = c.z + Math.sin(a) * 10;
      this.place(this.asset('kenney_sub_planter'), tx, tz, a, { ...soft, detail: 'mid' });
      this.place(this.pick(this.pools.streetTrees), tx, tz, 0, { ...soft, y: y + 0.9, scale: 0.95, detail: 'mid' });
      const bx = c.x + Math.cos(a + 0.5) * 7;
      const bz = c.z + Math.sin(a + 0.5) * 7;
      this.place(this.asset('kenney_furn_bench'), bx, bz, Math.atan2(c.x - bx, c.z - bz), { ...soft, detail: 'near' });
    }
  }

  /** Central Park: a pond, a looping path with benches and lamps, groves and lawns. */
  private centralPark(r: WorldRect): void {
    const pond = this.spec.water.find((w) => rectContains(r, w.x, w.z));
    const cx = pond?.x ?? (r.minX + r.maxX) / 2;
    const cz = pond?.z ?? (r.minZ + r.maxZ) / 2;
    const path = this.asset('kenney_nat_path_stone');
    const loop = (a: number) => 30 + 5 * Math.sin(2 * a + 0.7) + 3 * Math.sin(3 * a);
    let step = 0;
    for (let a = 0; a < Math.PI * 2; a += 0.075) {
      const rad = loop(a);
      const x = cx + Math.cos(a) * rad * 1.25;
      const z = cz + Math.sin(a) * rad * 0.9;
      const nx = cx + Math.cos(a + 0.01) * loop(a + 0.01) * 1.25;
      const nz = cz + Math.sin(a + 0.01) * loop(a + 0.01) * 0.9;
      this.place(path, x, z, Math.atan2(-(nz - z), nx - x), { force: true, block: 'soft', detail: 'mid', scale: 0.55, y: 0.02 });
      step++;
      if (step % 11 === 0) {
        const bx = cx + Math.cos(a) * (rad - 2.4) * 1.25;
        const bz = cz + Math.sin(a) * (rad - 2.4) * 0.9;
        this.place(this.asset('kenney_furn_bench'), bx, bz, Math.atan2(cx - bx, cz - bz), { force: true, detail: 'near' });
      }
      if (step % 17 === 5) {
        const lx = cx + Math.cos(a) * (rad + 2) * 1.25;
        const lz = cz + Math.sin(a) * (rad + 2) * 0.9;
        this.place(this.asset('kenney_road_light'), lx, lz, Math.atan2(cx - lx, cz - lz) - Math.PI / 2, { force: true, detail: 'small', scale: 0.85 });
      }
    }
    // A straight entrance path from the street to the north.
    for (let z = r.minZ - 16; z < cz - 26; z += 2.8) {
      this.place(path, cx, z, Math.PI / 2, { force: true, block: 'soft', detail: 'mid', scale: 0.55, y: 0.02 });
    }
    this.place(this.asset('kenney_nat_sign'), cx + 2.4, r.minZ - 12, Math.PI, { force: true, detail: 'near' });
    // Flower beds along the path and groves beyond it.
    for (let k = 0; k < 40; k++) {
      const a = this.rand() * Math.PI * 2;
      const rad = loop(a) + (this.chance(0.5) ? -4 : 4);
      this.place(this.pick(this.pools.flowers), cx + Math.cos(a) * rad * 1.25, cz + Math.sin(a) * rad * 0.9, 0, { force: true, detail: 'near' });
    }
    for (let g = 0; g < 9; g++) {
      const a = (g / 9) * Math.PI * 2 + 0.3;
      const gx = cx + Math.cos(a) * (50 + this.rand() * 6);
      const gz = cz + Math.sin(a) * (34 + this.rand() * 4);
      for (let k = 0; k < 22; k++) {
        const x = gx + (this.rand() - 0.5) * 22;
        const z = gz + (this.rand() - 0.5) * 16;
        if (!rectContains(r, x, z)) continue;
        this.place(this.pick(this.chance(0.3) ? this.pools.pines : this.pools.trees), x, z, this.rand() * 6.28, { detail: 'mid', scale: 0.9 + this.rand() * 0.7, margin: 0.2 });
      }
    }
    // A picnic lawn with tables, and a tent for the adventurous.
    for (let k = 0; k < 4; k++) {
      this.place(this.asset('kenney_furn_table'), cx - 18 + k * 3.5, cz + 22 + (k % 2) * 2, 0, { force: true, detail: 'near', scale: 2.4 });
    }
    this.place(this.asset('kenney_nat_tent_detailed_open'), cx + 26, cz + 20, -0.6, { force: true, detail: 'mid' });
    this.place(this.asset('kenney_nat_campfire_stones'), cx + 22, cz + 17, 0, { force: true, detail: 'near' });
  }

  /** A wooden deck on the lake's south shore with benches and lamps, and a path from the avenue. */
  private lakeViewpoint(r: WorldRect, c: Vec2): void {
    const deck = this.asset('kenney_nat_platform_beach');
    for (let k = -1; k <= 1; k++) this.place(deck, c.x + k * 4.4, r.minZ + 2, 0, { force: true, detail: 'mid', y: -0.05 });
    for (let k = -1; k <= 1; k++) {
      this.place(this.asset('kenney_furn_bench'), c.x + k * 4.4, r.minZ + 4.4, Math.PI, { force: true, detail: 'near' });
    }
    this.place(this.asset('kenney_road_light'), r.minX + 2, r.minZ + 5, -Math.PI / 2, { force: true, detail: 'small' });
    this.place(this.asset('kenney_road_light'), r.maxX - 2, r.minZ + 5, Math.PI / 2, { force: true, detail: 'small' });
    this.place(this.asset('kenney_nat_sign'), c.x + 6, r.maxZ - 2, 0, { force: true, detail: 'near' });
    const path = this.asset('kenney_nat_path_stone');
    for (let z = r.minZ + 7; z < -53; z += 2.8) this.place(path, c.x, z, Math.PI / 2, { force: true, block: 'soft', detail: 'mid', scale: 0.55, y: 0.02 });
    for (let k = 0; k < 10; k++) {
      this.place(this.pick(this.pools.flowers), c.x + (this.rand() - 0.5) * 20, r.minZ + 7 + this.rand() * 6, 0, { force: true, detail: 'near' });
    }
    for (const sx of [-1, 1]) {
      this.place(this.pick(this.pools.trees), c.x + sx * 16, r.minZ + 4, this.rand() * 6.28, { force: true, detail: 'mid', scale: 1.3 });
      this.place(this.pick(this.pools.trees), c.x + sx * 19, r.minZ + 9, this.rand() * 6.28, { force: true, detail: 'mid', scale: 1.1 });
    }
  }

  /** A building going up: fenced site, crane, a steel frame, materials and machines. */
  private buildingSite(r: WorldRect, c: Vec2): void {
    const fence = this.asset('kenney_road_construction_fence');
    const gate = { from: c.x - 5, to: c.x + 5 };
    const edge = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const yaw = Math.atan2(x1 - x0, z1 - z0);
      for (let s = 1.3; s < len; s += 2.63) {
        const x = x0 + ((x1 - x0) * s) / len;
        const z = z0 + ((z1 - z0) * s) / len;
        if (z0 === z1 && z0 === r.maxZ && x > gate.from && x < gate.to) continue;
        this.place(fence, x, z, yaw, { force: true, detail: 'small', block: 'hard' });
      }
    };
    edge(r.minX, r.minZ, r.maxX, r.minZ);
    edge(r.minX, r.maxZ, r.maxX, r.maxZ);
    edge(r.minX, r.minZ, r.minX, r.maxZ);
    edge(r.maxX, r.minZ, r.maxX, r.maxZ);
    // Foundation slab and a two-storey frame of columns, a few walls up already.
    const fx = c.x - 6;
    const fz = c.z - 4;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      this.place(this.asset('kenney_road_tile'), fx - 3.5 + i * 7, fz - 3.5 + j * 7, 0, { force: true, detail: 'far' });
    }
    const column = this.asset('kenney_bk_column');
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const x = fx - 6 + i * 4;
      const z = fz - 6 + j * 4;
      this.place(column, x, z, 0, { force: true, occupy: false, y: PAVING_HEIGHT, scale: 1.25, detail: 'mid' });
      if ((i + j) % 2 === 0) this.place(column, x, z, 0, { force: true, occupy: false, y: PAVING_HEIGHT + 3, scale: 1.25, detail: 'mid' });
    }
    const wall = this.asset('kenney_bk_wall');
    for (let i = 0; i < 3; i++) {
      this.place(wall, fx - 4 + i * 4, fz - 6, Math.PI / 2, { force: true, occupy: false, y: PAVING_HEIGHT, scale: 1.25, detail: 'mid' });
    }
    this.place(this.asset('kenney_fac_crane'), c.x + 11, c.z - 6, Math.PI / 2, { force: true, detail: 'far', scale: 1.3 });
    // Materials, machines and the site office.
    for (let k = 0; k < 3; k++) {
      this.place(this.asset('kenney_fac_pipe_large_long'), c.x + 10, c.z + 6 + k * 2.1, 0, { force: true, detail: 'near' });
    }
    for (let k = 0; k < 4; k++) {
      this.place(this.pick(this.pools.crates), c.x - 16 + k * 2.6, c.z + 10, 0, { force: true, detail: 'near' });
    }
    this.place(this.asset('kenney_ind_shipping_container_a'), r.minX + 4, r.maxZ - 6, 0, { force: true, detail: 'mid', palette: 'variation-b.png' });
    this.place(this.asset('kenney_car_tractor_shovel'), c.x + 2, c.z + 9, 0.6, { force: true, detail: 'small', scale: VEHICLE_SCALE });
    this.place(this.asset('kenney_car_truck_flat'), c.x - 4, r.maxZ + 3, Math.PI / 2, { force: true, detail: 'small', scale: VEHICLE_SCALE });
    this.place(this.asset('kenney_road_dumpster'), r.maxX - 4, r.maxZ - 4, 0, { force: true, detail: 'near' });
    for (let k = 0; k < 5; k++) {
      this.place(this.asset(k % 2 ? 'kenney_road_cone' : 'kenney_road_construction_barrier'), gate.from + k * 2.5, r.maxZ + 1.5, 0, { force: true, detail: 'near' });
    }
    this.place(this.asset('kenney_road_construction_light'), gate.from - 1, r.maxZ + 1, 0, { force: true, detail: 'near' });
    this.place(this.asset('kenney_road_construction_light'), gate.to + 1, r.maxZ + 1, 0, { force: true, detail: 'near' });
  }

  /** Two staggered rows of turbines with a power line along them. */
  private windFarm(r: WorldRect): void {
    const turbine = this.asset('kenney_ind_windmill');
    let k = 0;
    for (let x = r.minX + 8; x <= r.maxX - 6; x += 22) {
      for (const [row, dz] of [[0, 14], [1, 42]] as const) {
        const z = r.minZ + dz + (row ? 0 : 6);
        const px = x + (row ? 11 : 0);
        if (px > r.maxX - 4) continue;
        this.place(turbine, px, z, 0.4 + k * 0.05, { force: true, detail: 'far', scale: 1.7 });
        k++;
      }
    }
    const pole = this.asset('kenney_road_electricity_pole');
    for (let x = r.minX + 2; x < r.maxX; x += 18) this.place(pole, x, r.maxZ - 3, Math.PI / 2, { force: true, detail: 'small' });
    for (let n = 0; n < 30; n++) {
      this.place(this.pick(this.pools.flowers.concat(this.pools.grass)), r.minX + this.rand() * (r.maxX - r.minX), r.minZ + this.rand() * (r.maxZ - r.minZ), 0, { detail: 'near', margin: 0 });
    }
  }

  /** Where the avenue meets the boulevard: signs over the road, planters, flags of green. */
  private grandCrossing(c: Vec2): void {
    const t = this.spec.tile;
    const x = Math.round(c.x / t) * t;
    const z = Math.round(c.z / t) * t;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      this.place(this.asset('kenney_sub_planter'), x + sx * 6.2, z + sz * 6.2, 0, { force: true, detail: 'mid' });
      this.place(this.pick(this.pools.streetTrees), x + sx * 6.2, z + sz * 6.2, 0, { force: true, occupy: false, y: 0.9, scale: 1.1, detail: 'mid' });
    }
    // Direction signs across the boulevard, like a real junction.
    this.place(this.asset('kenney_road_sign_highway'), x, z - t * 2, Math.PI / 2, { force: true, occupy: false, detail: 'far', block: null });
    this.place(this.asset('kenney_road_road_sign_street'), x + 5, z + 5, Math.PI / 4, { force: true, detail: 'near' });
  }

  private lakeShore(): void {
    for (const lake of this.spec.water) {
      const basin = this.spec.terrain.lakes.find((b) => Math.hypot(b.x - lake.x, b.z - lake.z) < 1) ?? { ...lake, radius: lake.radius, depth: 1 };
      const shore = (a: number) => basin.radius * WATERLINE * shoreWobble(basin.x, basin.z, a);
      const big = lake.radius > 25;
      // Reeds in clumps and rocks in little groups right at the waterline.
      for (let a = 0; a < Math.PI * 2; a += (big ? 0.07 : 0.2) + this.rand() * 0.06) {
        const clump = fbm(Math.cos(a) * 3, Math.sin(a) * 3, this.spec.seed + 61, 2);
        const r = shore(a) + (this.rand() - 0.3) * 2.2;
        const x = lake.x + Math.cos(a) * r;
        const z = lake.z + Math.sin(a) * r;
        if (clump > 0.1) this.place(this.pick(this.pools.grass), x, z, this.rand() * 6.28, { detail: 'near', force: true, occupy: false, block: null, scale: 1 + this.rand() * 0.5 });
        else if (clump < -0.2 && this.chance(0.6)) this.place(this.pick(this.pools.rocks), x, z, this.rand() * 6.28, { detail: 'mid', scale: 0.4 + this.rand() * 0.5, force: true, occupy: false, y: -0.25 });
      }
      if (!big) {
        for (let k = 0; k < 6; k++) {
          const a = this.rand() * Math.PI * 2;
          const r = shore(a) * (0.3 + this.rand() * 0.5);
          this.place(this.asset('kenney_nat_lily_large'), lake.x + Math.cos(a) * r, lake.z + Math.sin(a) * r, a, { force: true, occupy: false, block: null, y: lake.level + 0.02, detail: 'near' });
        }
        continue;
      }
      // A stone path around the lake, with benches looking over the water.
      const path = this.asset('kenney_nat_path_stone');
      let sinceBench = 0;
      for (let a = 0; a < Math.PI * 2; a += 0.052) {
        const r = shore(a) + 9;
        const x = lake.x + Math.cos(a) * r;
        const z = lake.z + Math.sin(a) * r;
        if (this.landmarkIn(x, z) === 'viewpoint') continue;
        const tx = -Math.sin(a);
        const tz = Math.cos(a);
        this.place(path, x, z, Math.atan2(-tz, tx), { force: true, block: 'soft', detail: 'mid', scale: 0.55, y: 0.02 });
        sinceBench += 1;
        if (sinceBench > 12 && this.chance(0.3)) {
          sinceBench = 0;
          const bx = lake.x + Math.cos(a) * (r - 2.2);
          const bz = lake.z + Math.sin(a) * (r - 2.2);
          this.place(this.asset('kenney_furn_bench'), bx, bz, Math.atan2(lake.x - bx, lake.z - bz), { force: true, detail: 'near' });
        }
      }
      // Lily pads and canoes on the water.
      const level = lake.level + 0.02;
      for (let k = 0; k < 18; k++) {
        const a = this.rand() * Math.PI * 2;
        const r = lake.radius * (0.55 + this.rand() * 0.35);
        this.place(this.registry.get(this.chance(0.5) ? 'kenney_nat_lily_large' : 'kenney_nat_lily_small'), lake.x + Math.cos(a) * r, lake.z + Math.sin(a) * r, a, {
          force: true, occupy: false, block: null, y: level, detail: 'near',
        });
      }
      for (const a of [0.7, 2.6]) {
        const r = lake.radius * 0.45;
        this.place(this.registry.get('kenney_nat_canoe'), lake.x + Math.cos(a) * r, lake.z + Math.sin(a) * r, a + 1.2, { force: true, occupy: false, block: null, y: level - 0.25, detail: 'small' });
      }
      // A jetty on the far shore.
      const jettyAngle = -0.4;
      const jr = shore(jettyAngle) - 1;
      this.place(this.asset('kenney_nat_bridge_wood'), lake.x + Math.cos(jettyAngle) * jr, lake.z + Math.sin(jettyAngle) * jr, -jettyAngle + Math.PI / 2, {
        force: true, y: -0.9, detail: 'mid',
      });
      // Woods behind the path, thicker away from the town side.
      for (let a = 0; a < Math.PI * 2; a += 0.05) {
        const r = shore(a) + 15 + this.rand() * 40;
        const x = lake.x + Math.cos(a) * r;
        const z = lake.z + Math.sin(a) * r;
        if (!this.chance(0.55)) continue;
        this.place(this.pick(this.chance(0.6) ? this.pools.trees : this.pools.pines), x, z, this.rand() * 6.28, { detail: 'mid', scale: 0.9 + this.rand() * 0.6, margin: 0.4 });
      }
    }
  }

  /** Forests on the hills around the valley, rocks, and windmills on the ridges. */
  private outerLandscape(): void {
    const half = this.spec.buildHalfSize;
    const outer = 900;
    let placed = 0;
    for (let attempt = 0; attempt < 30000 && placed < 4200; attempt++) {
      const x = (this.rand() * 2 - 1) * outer;
      const z = (this.rand() * 2 - 1) * outer;
      if (Math.abs(x) < half + 6 && Math.abs(z) < half + 6) continue;
      if (rectContains(this.spec.skyline, x, z)) continue;
      const r = Math.hypot(x, z);
      const forest = this.spec.terrain.forest;
      const density = forest ? forestDensity(forest, x, z) - forest.threshold : 0.1;
      if (density < 0 && !(r < 400 && this.chance(0.12))) continue;
      const h = this.heightAt(x, z);
      if (h > 160 || h < 0.5) continue;
      // Low-poly trees out here: they are many, and only ever seen from afar.
      const pool = r < 330 && h < 30 ? (this.chance(0.5) ? this.pools.pines : this.pools.trees) : this.pools.farTrees;
      const scale = (r > 500 ? 2 : 1.3) + this.rand() * 0.9;
      this.place(this.pick(pool), x, z, this.rand() * 6.28, { detail: 'mid', scale, force: true, occupy: false, y: -0.2 });
      placed++;
      if (this.chance(0.05)) this.place(this.pick(this.pools.bigRocks), x + 4, z + 3, this.rand() * 6.28, { detail: 'mid', scale: 1 + this.rand() * 2, force: true, occupy: false, y: -0.4 });
    }
    const windmill = this.registry.get('kenney_ind_windmill');
    for (const a of [0.3, 0.55, 0.8, 2.4, 2.65, 5.2, 5.45]) {
      const x = Math.cos(a) * 345;
      const z = Math.sin(a) * 345;
      this.place(windmill, x, z, a + Math.PI, { detail: 'far', force: true, occupy: false, scale: 1.4 });
    }
  }

  /** A distant skyline beyond the city: simple silhouettes, a few real towers. */
  private skyline(): void {
    const r = this.spec.skyline;
    for (let x = r.minX + 6; x < r.maxX; x += 9 + this.rand() * 5) {
      for (let z = r.minZ + 6; z < r.maxZ; z += 9 + this.rand() * 5) {
        const toward = 1 - (z - r.minZ) / (r.maxZ - r.minZ); // taller further away
        if (!this.chance(0.55)) continue;
        const tower = this.chance(0.25 + toward * 0.2);
        const asset = tower ? this.pick(this.pools.towers) : this.pick(this.pools.distant);
        // Tallest behind the city center, lower towards the edges.
        const central = Math.max(0, 1 - Math.abs(x - 140) / 190);
        const scale = (tower ? 1 + this.rand() * 0.5 + toward * 0.4 : 1 + this.rand() * 1.2 + toward) * (0.8 + central * 0.5);
        this.place(asset, x, z, this.quarter(), { detail: 'far', scale, block: null, margin: 1, palette: this.palette(PALETTES.skyline) });
      }
    }
  }
}
