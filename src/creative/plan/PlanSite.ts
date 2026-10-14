import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import type { PlacedObject, Vec3 } from '@/construction/PlacedObject';
import { boundsOfPlaced, boundsOverlap, computeBounds, type Bounds } from '@/construction/bounds';
import { findInvalidReason, type PlacementRulesContext } from '@/construction/PlacementResolver';
import type { TemplateObjectSpec } from '@/creative/Template';
import { SHORE_WOBBLE_MAX, type WorldLake, type WorldRect } from '@/world/WorldSpace';
import { rotateAroundY } from '@/utils/math';
import type { PlanSite, SiteSide } from './ConstructionPlan';
import type { LocalRect } from './LayoutKit';

const QUARTER = Math.PI / 2;
const UNIT_SCALE: Vec3 = { x: 1, y: 1, z: 1 };
/** Clearance kept around the whole site (house, garden, driveway), metres - room to walk round it. */
export const SITE_MARGIN = 1.5;
/** Clearance for a creation meant to join the child's house (a garden behind it, benches in front). */
export const CONNECTED_MARGIN = 0.5;
/** How far from the house a "behind / in front of / beside the house" site may go, metres. */
const BESIDE_GAPS = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 13, 16, 20, 25];
/** Closest a site may come to a lake's shoreline, and how far out the search goes, metres. */
const LAKE_GAP = { min: 2, max: 90, step: 3 };
const LAKE_ANGLE_STEP = Math.PI / 30;
/** Spiral search around a point: ring spacing and reach, metres. */
const SPIRAL = { step: 4, reach: 140, reachAt: 30 };

export interface SiteContext {
  registry: ObjectRegistry;
  rules: PlacementRulesContext;
  placedObjects: PlacedObject[];
  lakes: readonly WorldLake[];
  /** The home plot (where a new world's building starts). */
  home: WorldRect;
  /** Where the camera looks; azimuth in degrees (0 = looking from +Z towards -Z). */
  view: { x: number; z: number; azimuth: number };
  /** The child's house, for sites beside it: the ground its pieces cover (world) and the way it faces. */
  anchor?: { rect: LocalRect; rotationY: number } | null;
  /** Clearance round the whole site, metres (SITE_MARGIN unless the creation joins the house). */
  margin?: number;
}

export interface SiteChoice {
  /** Template origin on the ground. */
  origin: Vec3;
  /** Quarter-turn rotation of the whole creation. */
  rotationY: number;
}

/**
 * Find where a planned creation can stand: every ground piece inside the
 * build area, off the water and the world's own scenery, and clear of
 * everything already built - checked with the same `findInvalidReason`
 * the placement actions use, so a chosen site is one `instantiateTemplate`
 * accepts. Returns null when nothing nearby is free.
 *
 *   near lake  closest free spot to the largest lake's shore, preferring the
 *              side facing the home plot; the back (garden) faces the water
 *   near home  closest free spot to the home plot's centre
 *   near view  closest free spot to where the camera looks, front facing it
 *   at x,z     closest free spot to that point (within 30 m)
 *   beside     behind, in front of or beside the child's house (context.anchor),
 *              entrance facing the house, as close as the clearance allows;
 *              where the camera looks when there is no house
 */
export function chooseSite(site: PlanSite, extent: LocalRect, objects: TemplateObjectSpec[], context: SiteContext): SiteChoice | null {
  const ground = objects.filter((spec) => !spec.hostRef && !spec.supportRef);
  const placed = placedBounds(context);
  for (const candidate of candidates(site, extent, context)) {
    if (fits(candidate, extent, ground, context, placed)) return candidate;
  }
  return null;
}

/** Why a site could not be used: water, something already built, the town's own scenery, or the edge of the world. */
export type SiteConflict = 'water' | 'built' | 'scenery' | 'edge';

/**
 * Why the place the child asked for is not free, judged at the nearest spot
 * there (straight behind the house for "behind the house"). Null when that
 * spot itself is free and something further out stopped the search.
 */
export function siteConflict(site: PlanSite, extent: LocalRect, context: SiteContext): SiteConflict | null {
  const first = candidates(site, extent, context).next();
  if (first.done) return null;
  const box = worldRect(extent, first.value);
  const margin = context.margin ?? SITE_MARGIN;
  const whole = { minX: box.minX - margin, maxX: box.maxX + margin, minY: 0, maxY: 3, minZ: box.minZ - margin, maxZ: box.maxZ + margin };
  const cx = (whole.minX + whole.maxX) / 2;
  const cz = (whole.minZ + whole.maxZ) / 2;
  const reach = Math.hypot(whole.maxX - whole.minX, whole.maxZ - whole.minZ) / 2;
  // (Being by the water is the point of a lakeside site, so there the lake is never the obstacle.)
  const lakeside = 'near' in site && site.near === 'lake';
  if (!lakeside && context.lakes.some((lake) => Math.hypot(cx - lake.x, cz - lake.z) < lake.radius * SHORE_WOBBLE_MAX + reach)) return 'water';
  const reason = findInvalidReason(whole, context.placedObjects, context.registry, context.rules);
  if (reason === 'outside-area') return 'edge';
  if (reason === 'overlap') return 'built';
  if (reason === 'blocked') return 'scenery';
  return null;
}

/**
 * The closest free spot to a given placement, keeping its rotation - for a
 * changed version of a creation that should stay (about) where it is.
 */
export function chooseSiteNear(
  around: SiteChoice,
  reach: number,
  extent: LocalRect,
  objects: TemplateObjectSpec[],
  context: SiteContext,
): SiteChoice | null {
  const ground = objects.filter((spec) => !spec.hostRef && !spec.supportRef);
  const placed = placedBounds(context);
  for (const candidate of spiral(around.origin.x, around.origin.z, around.rotationY, reach)) {
    if (fits(candidate, extent, ground, context, placed)) return candidate;
  }
  return null;
}

/**
 * Whether every ground piece fits exactly at this spot, with no clearance
 * round the whole site - for one house of a neighbourhood, rebuilt on its
 * own plot between its neighbours.
 */
export function fitsExactly(at: SiteChoice, extent: LocalRect, objects: TemplateObjectSpec[], context: SiteContext): boolean {
  const ground = objects.filter((spec) => !spec.hostRef && !spec.supportRef);
  return fits(at, extent, ground, { ...context, margin: 0 }, placedBounds(context));
}

/** Bounds of everything already built, worked out once per search rather than once per candidate spot. */
function placedBounds(context: SiteContext): Bounds[] {
  const out: Bounds[] = [];
  for (const placed of context.placedObjects) {
    const definition = context.registry.get(placed.definitionId);
    if (definition) out.push(boundsOfPlaced(definition, placed));
  }
  return out;
}

function* candidates(site: PlanSite, extent: LocalRect, context: SiteContext): Generator<SiteChoice> {
  if ('at' in site) {
    yield* spiral(site.at.x, site.at.z, 0, SPIRAL.reachAt);
    return;
  }
  if ('beside' in site) {
    if (context.anchor) {
      yield* beside(site.beside, extent, context.anchor);
      return;
    }
    site = { near: 'view' };
  }
  if (site.near === 'lake') {
    const lake = [...context.lakes].sort((a, b) => b.radius - a.radius)[0];
    if (lake) {
      yield* lakeside(lake, extent, context.home);
      return;
    }
  }
  if (site.near === 'home') {
    const { home } = context;
    yield* spiral((home.minX + home.maxX) / 2, (home.minZ + home.maxZ) / 2, 0, SPIRAL.reach);
    return;
  }
  // The front faces the camera: local +Z turned by a quarter-turn heading.
  const facing = Math.round(context.view.azimuth / 90) * QUARTER;
  yield* spiral(context.view.x, context.view.z, facing, SPIRAL.reach);
}

function* lakeside(lake: WorldLake, extent: LocalRect, home: WorldRect): Generator<SiteChoice> {
  const shore = lake.radius * SHORE_WOBBLE_MAX;
  const towardHome = Math.atan2((home.minZ + home.maxZ) / 2 - lake.z, (home.minX + home.maxX) / 2 - lake.x);
  for (let gap = LAKE_GAP.min; gap <= LAKE_GAP.max; gap += LAKE_GAP.step) {
    for (let step = 0; step * LAKE_ANGLE_STEP <= Math.PI; step++) {
      for (const sign of step === 0 ? [1] : [1, -1]) {
        const angle = towardHome + sign * step * LAKE_ANGLE_STEP;
        const out = { x: Math.cos(angle), z: Math.sin(angle) };
        // Back of the house (local -Z) towards the water.
        const rotationY = quarterTurnFacing(0, -1, -out.x, -out.z);
        // Slide out until the site's lake-side edge is `gap` metres past the shore.
        const reach = Math.max(...corners(extent).map((c) => {
          const p = rotateAroundY(c.x, c.z, rotationY);
          return -(p.x * out.x + p.z * out.z);
        }));
        const distance = shore + gap + reach;
        yield {
          origin: { x: snapHalf(lake.x + out.x * distance), y: 0, z: snapHalf(lake.z + out.z * distance) },
          rotationY,
        };
      }
    }
  }
}

/**
 * Spots along one side of the house, nearest first: the creation's front
 * (entrance) faces the house, its near edge `gap` metres from the ground the
 * house covers, slid along that side from the middle outwards.
 */
function* beside(side: SiteSide, extent: LocalRect, anchor: { rect: LocalRect; rotationY: number }): Generator<SiteChoice> {
  const { rect } = anchor;
  const directions = side === 'back' ? [{ x: 0, z: -1 }] : side === 'front' ? [{ x: 0, z: 1 }] : [{ x: 1, z: 0 }, { x: -1, z: 0 }];
  const centre = { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 };
  for (const gap of BESIDE_GAPS) {
    for (const local of directions) {
      const out = rotateAroundY(local.x, local.z, anchor.rotationY);
      const rotationY = quarterTurnFacing(0, 1, -out.x, -out.z);
      const e = worldRect(extent, { origin: { x: 0, y: 0, z: 0 }, rotationY });
      const alongX = Math.abs(out.z) > 0.5;
      const reach = (alongX ? rect.maxX - rect.minX + e.maxX - e.minX : rect.maxZ - rect.minZ + e.maxZ - e.minZ) / 2;
      for (let offset = 0; offset <= reach; offset += 2) {
        for (const sign of offset === 0 ? [1] : [1, -1]) {
          let x: number;
          let z: number;
          if (alongX) {
            x = centre.x - (e.minX + e.maxX) / 2 + sign * offset;
            z = out.z < 0 ? rect.minZ - gap - e.maxZ : rect.maxZ + gap - e.minZ;
          } else {
            z = centre.z - (e.minZ + e.maxZ) / 2 + sign * offset;
            x = out.x < 0 ? rect.minX - gap - e.maxX : rect.maxX + gap - e.minX;
          }
          yield { origin: { x: snapHalf(x), y: 0, z: snapHalf(z) }, rotationY };
        }
      }
    }
  }
}

function* spiral(x: number, z: number, rotationY: number, reach: number): Generator<SiteChoice> {
  for (let radius = 0; radius <= reach; radius += radius < SPIRAL.step ? 1 : SPIRAL.step) {
    const count = radius === 0 ? 1 : Math.ceil((2 * Math.PI * radius) / Math.min(6, radius * 2));
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      yield {
        origin: { x: snapHalf(x + Math.cos(angle) * radius), y: 0, z: snapHalf(z + Math.sin(angle) * radius) },
        rotationY,
      };
    }
  }
}

/**
 * Quick whole-site box first, then every ground piece exactly as placement
 * will check it: the same build-area and scenery test (`findInvalidReason`
 * with no objects) and the same overlap test against everything built
 * (`boundsOverlap`, as `findInvalidReason` uses), on precomputed bounds.
 */
function fits(candidate: SiteChoice, extent: LocalRect, ground: TemplateObjectSpec[], context: SiteContext, placed: Bounds[]): boolean {
  const { registry, rules } = context;
  const box = worldRect(extent, candidate);
  const margin = context.margin ?? SITE_MARGIN;
  const whole = {
    minX: box.minX - margin,
    maxX: box.maxX + margin,
    minY: 0,
    maxY: 3,
    minZ: box.minZ - margin,
    maxZ: box.maxZ + margin,
  };
  if (findInvalidReason(whole, [], registry, rules) !== null || placed.some((b) => boundsOverlap(whole, b))) return false;
  // Only things standing over the site's ground (at any height) can clash with its pieces.
  const near = placed.filter((b) => b.minX < box.maxX && b.maxX > box.minX && b.minZ < box.maxZ && b.maxZ > box.minZ);
  return ground.every((spec) => {
    const definition = registry.get(spec.definitionId);
    if (!definition) return false;
    const offset = rotateAroundY(spec.position.x, spec.position.z, candidate.rotationY);
    const position = { x: candidate.origin.x + offset.x, y: candidate.origin.y + spec.position.y, z: candidate.origin.z + offset.z };
    const bounds = computeBounds(definition, position, (spec.rotationY ?? 0) + candidate.rotationY, spec.scale ?? UNIT_SCALE);
    return findInvalidReason(bounds, [], registry, rules) === null && !near.some((b) => boundsOverlap(bounds, b));
  });
}

/** A house-local rectangle placed in the world at a candidate site. */
export function worldRect(rect: LocalRect, at: SiteChoice): LocalRect {
  const points = corners(rect).map((c) => rotateAroundY(c.x, c.z, at.rotationY));
  return {
    minX: at.origin.x + Math.min(...points.map((p) => p.x)),
    maxX: at.origin.x + Math.max(...points.map((p) => p.x)),
    minZ: at.origin.z + Math.min(...points.map((p) => p.z)),
    maxZ: at.origin.z + Math.max(...points.map((p) => p.z)),
  };
}

function corners(rect: LocalRect): Array<{ x: number; z: number }> {
  return [
    { x: rect.minX, z: rect.minZ },
    { x: rect.maxX, z: rect.minZ },
    { x: rect.minX, z: rect.maxZ },
    { x: rect.maxX, z: rect.maxZ },
  ];
}

/** The quarter turn that points local direction (lx, lz) closest to world direction (wx, wz). */
function quarterTurnFacing(lx: number, lz: number, wx: number, wz: number): number {
  let best = 0;
  let bestDot = -Infinity;
  for (let step = 0; step < 4; step++) {
    const turned = rotateAroundY(lx, lz, step * QUARTER);
    const dot = turned.x * wx + turned.z * wz;
    if (dot > bestDot + 1e-9) {
      bestDot = dot;
      best = step * QUARTER;
    }
  }
  return best;
}

function snapHalf(value: number): number {
  return Math.round(value * 2) / 2;
}
