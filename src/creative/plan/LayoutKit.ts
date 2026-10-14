import type { ConstructionObjectDefinition } from '@/construction/ConstructionObjectDefinition';
import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import type { TemplateObjectSpec } from '@/creative/Template';
import type { RoomType } from './ConstructionPlan';

/**
 * Shared vocabulary of the plan layouts (houses, gardens and parks,
 * treehouses, neighbourhoods, loose objects). Every layout is pure and
 * deterministic, works in whole decimetres so runs add up exactly, and only
 * names catalogue pieces - its result is an ordinary template object list
 * that `instantiateTemplate` validates like any hand-made template.
 *
 * Local frame of every layout: origin at the centre of the creation on the
 * ground, front (entrance, front door) towards +Z, width along X.
 */

export const DM = 10;
export const QUARTER = Math.PI / 2;

export interface LocalRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RoomLayout {
  type: RoomType;
  /** Clear floor inside the room's walls, house-local metres. */
  rect: LocalRect;
}

/**
 * Measured facts about what a layout really contains - the "I understood"
 * chips and the design tips read these, never the request, so EAVARA can
 * only ever describe something that is actually there.
 */
export interface LayoutFacts {
  /** Pieces by catalogue `type` (bed, tree, bench, slide...). */
  counts: Record<string, number>;
  /** Kind-specific measurements, metres where they are lengths (e.g. pathWidth, minHouseGap, deckHeight). */
  measures: Record<string, number>;
  /** Kind-specific yes/no facts (e.g. benchFacesFlowers, gate). */
  flags: Record<string, boolean>;
}

export interface PlanLayout {
  objects: TemplateObjectSpec[];
  /**
   * A stable name for each object (same index), e.g. "wall:wb3", "tree:back#1",
   * "h2/furn:kitchen#0:1". The same plan always gives the same keys, so a revised
   * plan can tell which pieces the child has since moved or removed.
   */
  keys: string[];
  /** Rooms laid out (houses; empty for other kinds). */
  rooms: RoomLayout[];
  /**
   * Where each house of a neighbourhood stands in the creation's frame: its
   * key prefix ("h2"), the house-local origin in creation-local metres and the
   * extra turn. A house's own layout (layoutHouse of neighborhoodHouse) placed
   * with this gives exactly the pieces under that prefix. Absent for other kinds.
   */
  houses?: Array<{ index: number; prefix: string; origin: { x: number; z: number }; rotationY: number }>;
  /** The creation's main size, metres (a house's outer walls, a garden's ground, a treehouse deck). */
  footprint: { width: number; depth: number };
  /** Ground covered by everything in the creation, local metres. */
  extent: LocalRect;
  /** Child-friendly notes about anything that could not be built as asked. */
  notes: string[];
  facts: LayoutFacts;
}

/**
 * Keys of a creation's contents - furniture, plants, benches, play equipment,
 * the car - as opposed to its structure (walls, floors, fences, paths, decks).
 * A changed version keeps contents the child moved and leaves out contents
 * they removed; structure always follows the new plan. Neighbourhood keys
 * carry a house prefix ("h1/furn:...").
 */
export function isContentKey(key: string): boolean {
  const own = key.slice(key.lastIndexOf('/') + 1);
  return /^(furn:|tree:|bush:|flower:|drive:|path:|car$|bed:|bench:|play:|lamp:|bin:|item:|plant:)/.test(own);
}

/** Catalogue lookups in decimetres, failing loudly if a piece a layout relies on is missing. */
export interface PieceKit {
  get(id: string): ConstructionObjectDefinition;
  /** Rotated footprint (width along X, depth along Z), dm. */
  footprint(id: string, rotationY: number, scale?: { x: number; z: number }): [number, number];
  /** Height, metres. */
  height(id: string): number;
}

export function pieceKit(registry: ObjectRegistry, required: readonly string[]): PieceKit {
  const get = (id: string): ConstructionObjectDefinition => {
    const definition = registry.get(id);
    if (!definition) throw new Error(`Piece "${id}" is missing from objects.json`);
    return definition;
  };
  for (const id of required) get(id);
  return {
    get,
    footprint: (id, rotationY, scale = { x: 1, z: 1 }) => {
      // Rounded up to whole decimetres, so a 0.42 m piece is planned as 0.5 m and never clashes.
      const { width, depth } = get(id).dimensions;
      const w = Math.ceil(width * scale.x * DM - 1e-6);
      const d = Math.ceil(depth * scale.z * DM - 1e-6);
      return isQuarterTurned(rotationY) ? [d, w] : [w, d];
    },
    height: (id) => get(id).dimensions.height,
  };
}

/** Collects template objects and their keys; positions in dm (x, z) and metres (y). */
export class LayoutWriter {
  readonly objects: TemplateObjectSpec[] = [];
  readonly keys: string[] = [];

  add(
    key: string,
    definitionId: string,
    x: number,
    y: number,
    z: number,
    rotationY = 0,
    links: Pick<TemplateObjectSpec, 'localId' | 'hostRef' | 'supportRef' | 'surface' | 'scale'> = {},
  ): void {
    this.objects.push({ definitionId, position: { x: x / DM, y, z: z / DM }, ...(rotationY ? { rotationY } : {}), ...links });
    this.keys.push(key);
  }
}

/**
 * Ground bookkeeping: rectangles (dm) already taken, so nothing a layout puts
 * on the ground ever overlaps anything else it put there. `pad` keeps a
 * clear margin round the new piece (walking room, play safety space).
 */
export class GroundPlan {
  readonly taken: Array<{ rect: LocalRect; tag: string }> = [];

  constructor(private readonly bounds: LocalRect | null = null) {}

  fits(rect: LocalRect, pad = 0): boolean {
    if (this.bounds && (rect.minX < this.bounds.minX || rect.maxX > this.bounds.maxX || rect.minZ < this.bounds.minZ || rect.maxZ > this.bounds.maxZ)) {
      return false;
    }
    const grown = grow(rect, pad);
    return !this.taken.some((t) => rectsOverlap(t.rect, grown));
  }

  take(rect: LocalRect, tag: string): void {
    this.taken.push({ rect, tag });
  }

  /** Closest distance (dm) from `rect` to anything taken with one of `tags` (Infinity when none). */
  distanceTo(rect: LocalRect, tags: readonly string[]): number {
    let best = Infinity;
    for (const t of this.taken) {
      if (!tags.includes(t.tag) || t.rect === rect) continue;
      best = Math.min(best, rectDistance(rect, t.rect));
    }
    return best;
  }
}

export function rectAt(x: number, z: number, footprint: [number, number]): LocalRect {
  const [w, d] = footprint;
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
}

export function grow(rect: LocalRect, pad: number): LocalRect {
  return { minX: rect.minX - pad, maxX: rect.maxX + pad, minZ: rect.minZ - pad, maxZ: rect.maxZ + pad };
}

export function rectsOverlap(a: LocalRect, b: LocalRect): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
}

export function rectDistance(a: LocalRect, b: LocalRect): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dz = Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ);
  return Math.hypot(dx, dz);
}

export function unionRect(rects: LocalRect[]): LocalRect {
  return rects.reduce(
    (e, r) => ({ minX: Math.min(e.minX, r.minX), maxX: Math.max(e.maxX, r.maxX), minZ: Math.min(e.minZ, r.minZ), maxZ: Math.max(e.maxZ, r.maxZ) }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
  );
}

/** A dm rectangle in metres. */
export function toMetres(rect: LocalRect): LocalRect {
  return { minX: rect.minX / DM, maxX: rect.maxX / DM, minZ: rect.minZ / DM, maxZ: rect.maxZ / DM };
}

/** Ground rectangle (dm) of a template object, from its spec. */
export function specRect(spec: TemplateObjectSpec, kit: PieceKit): LocalRect {
  const scale = spec.scale ? { x: spec.scale.x, z: spec.scale.z } : undefined;
  return rectAt(spec.position.x * DM, spec.position.z * DM, kit.footprint(spec.definitionId, spec.rotationY ?? 0, scale));
}

/** Pieces counted by catalogue type. */
export function countTypes(objects: TemplateObjectSpec[], kit: PieceKit): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const spec of objects) {
    const type = kit.get(spec.definitionId).type;
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

/**
 * Lengths of `piece`-long sections covering exactly `length` (dm): whole
 * pieces, and one shorter piece (scaled down) for the remainder.
 */
export function sections(length: number, piece: number): number[] {
  if (length <= 0) return [];
  const whole = Math.floor(length / piece);
  const rest = length - whole * piece;
  const out = Array<number>(whole).fill(piece);
  if (rest > 0) out.push(rest);
  return out;
}

export function isQuarterTurned(rotationY: number): boolean {
  return Math.abs(Math.round(rotationY / QUARTER)) % 2 === 1;
}

export function toDm(metres: number): number {
  return Math.round(metres * DM);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
