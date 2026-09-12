/**
 * Data-driven description of a construction element (brick, wall, door, tree...).
 * Definitions are loaded from `src/data/objects.json` and validated by the
 * ObjectRegistry. Gameplay systems read these; they never hard-code objects.
 */

export const OBJECT_CATEGORIES = [
  'structures',
  'openings',
  'buildings',
  'furniture',
  'nature',
  'decoration',
  'roads',
  'vehicles',
  'utilities',
] as const;

export type ObjectCategory = (typeof OBJECT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ObjectCategory, string> = {
  structures: 'Structures',
  openings: 'Openings',
  buildings: 'Buildings',
  furniture: 'Furniture',
  nature: 'Nature',
  decoration: 'Decoration',
  roads: 'Roads',
  vehicles: 'Vehicles',
  utilities: 'Utilities',
};

/**
 * Procedural geometry recipe used to render a definition. Every shape is
 * built from the definition's dimensions and colours by
 * `src/construction/shapes`, so adding a shape means adding one builder.
 * Shapes must fit inside the dimensions box (bottom-centre origin).
 */
export const SHAPE_IDS = [
  'box',
  'cylinder',
  'roof-gable',
  'stairs',
  'door',
  'window',
  'tree',
  'bush',
  'flower',
  'fence',
  'streetlight',
  'road',
  'sidewalk',
  'car',
  'chair',
  'table',
  'bed',
  'sofa',
] as const;

export type ShapeId = (typeof SHAPE_IDS)[number];

/**
 * Architectural behaviour of a definition. Placement and rendering branch on
 * the role (never on the id), so any number of wall or door variants share
 * one implementation.
 *
 * - wall:    has endpoints, snaps into corners, can host openings.
 * - opening: sets into a wall's plane (door, window) and is cut out of it.
 * - floor:   tiles on the footprint lattice and is pushed clear of walls.
 * - roof:    rests on top of structural surfaces only.
 */
export const OBJECT_ROLES = ['wall', 'opening', 'floor', 'roof'] as const;

export type ObjectRole = (typeof OBJECT_ROLES)[number];

export interface Dimensions {
  /** Size along X in metres. */
  width: number;
  /** Size along Y (up) in metres. */
  height: number;
  /** Size along Z in metres. */
  depth: number;
}

export type UnlockRequirement =
  | { type: 'none' }
  | { type: 'rank'; rank: number }
  | { type: 'challenge'; challengeId: string }
  | { type: 'level'; levelId: string };

export interface CostInfo {
  /** Coins spent when placing one unit. */
  coins: number;
}

export interface RewardInfo {
  /** XP granted the first time the object is used correctly. */
  xpOnFirstUse: number;
}

export interface GameplayProperties {
  /** Whether other objects can be stacked on top. */
  stackable: boolean;
  /** Approximate weight in kg; used later for structural checks. */
  weightKg: number;
  /** Free-form tags for filtering, search and future rules. */
  tags: string[];
}

export type SupportSurface = 'top' | 'side';

/**
 * What an object may rest on or attach to. Everything is optional so the
 * default is "anywhere"; rules only remove obviously silly placements.
 *
 * - ground:     may stand directly on the ground (default true).
 * - types:      definition `type`s that may support it. Undefined = any
 *               object; empty array = no object at all (ground only).
 * - categories: alternative filter by category. Both filters, if given,
 *               must pass.
 * - surfaces:   which faces of a support may be used (default both).
 * - hint:       child-friendly reason shown when the rule rejects.
 */
export interface SupportRules {
  ground?: boolean;
  types?: string[];
  categories?: ObjectCategory[];
  surfaces?: SupportSurface[];
  hint?: string;
}

/**
 * How an object snaps while being placed.
 *
 * - `horizontalSnap: 'footprint'` snaps X/Z by the object's own rotated
 *   width/depth divided by `snapDivisions`, so identical objects line up edge
 *   to edge (divisions = 1) or in half offsets for running bond (divisions = 2).
 * - A number is a fixed step in metres.
 * - Omitted: the world placement grid (PLACEMENT_SNAP_STEP) is used.
 * - `sillHeight`: for openings, how high above the wall's bottom the opening
 *   starts (0 for doors, ~0.9 for windows).
 * - `support`: see SupportRules.
 */
export interface PlacementRules {
  horizontalSnap?: 'footprint' | number;
  /** Subdivisions of the footprint step. Defaults to 1. */
  snapDivisions?: number;
  sillHeight?: number;
  support?: SupportRules;
}

export interface ConstructionObjectDefinition {
  id: string;
  name: string;
  category: ObjectCategory;
  /** Sub-type within the category, e.g. brick, wall, door, tree. */
  type: string;
  /** Architectural behaviour; undefined = plain object. */
  role?: ObjectRole;
  dimensions: Dimensions;
  /** Material id, e.g. clay, concrete, timber. */
  material: string;
  /** Primary hex colour: swatch, preview tint and the main body of the shape. */
  color: string;
  /** Optional secondary colours by part name (trunk, glass, frame...). */
  colors?: Record<string, string>;
  /** Geometry recipe. Defaults to 'box' when omitted. */
  shape?: ShapeId;
  unlock: UnlockRequirement;
  cost: CostInfo;
  reward: RewardInfo;
  gameplay: GameplayProperties;
  /** Optional snapping / support behaviour. Missing = world grid, any support. */
  placement?: PlacementRules;
  /**
   * How many of the four quarter-turn orientations look different, i.e.
   * whether the object has a front:
   *   4 = every quarter turn is distinct (sofa, bed, chair, car, stairs);
   *   2 = a half turn looks the same (a plain table, a fence);
   *   1 = rotation never matters.
   * Omitted = derived from the footprint: square -> 1, otherwise 2.
   * The challenge matcher uses it when comparing rotations.
   */
  distinctOrientations?: DistinctOrientations;
  /**
   * Optional 3D model for the look (src/data/assets.json). Presentation only:
   * the dimensions above stay the gameplay box for placement, collision,
   * support and matching. 'contain' fits the model inside that box; 'height'
   * matches its height and lets thin details overhang visually; 'stretch'
   * scales each axis to the box (walls, floors, tiles).
   */
  visual?: { asset: string; fit?: 'contain' | 'height' | 'stretch' };
}

export const DISTINCT_ORIENTATION_COUNTS = [1, 2, 4] as const;
export type DistinctOrientations = (typeof DISTINCT_ORIENTATION_COUNTS)[number];

/** Declared orientation count, or the footprint-derived default. */
export function distinctOrientationsOf(definition: ConstructionObjectDefinition): DistinctOrientations {
  if (definition.distinctOrientations !== undefined) return definition.distinctOrientations;
  const { width, depth } = definition.dimensions;
  return Math.abs(width - depth) < 1e-9 ? 1 : 2;
}

/**
 * Whether two quarter-turn steps (0..3) look the same for this object:
 * with 4 orientations every step differs, with 2 a half turn is the same,
 * with 1 rotation never matters. Used by the matcher and by target snapping.
 */
export function orientationsEquivalent(definition: ConstructionObjectDefinition, a: number, b: number): boolean {
  const orientations = distinctOrientationsOf(definition);
  if (orientations === 1) return true;
  const difference = (((a - b) % 4) + 4) % 4;
  return orientations === 2 ? difference % 2 === 0 : difference === 0;
}

/** Colour for a named part, falling back to the primary colour. */
export function partColor(definition: ConstructionObjectDefinition, part: string, fallback?: string): string {
  return definition.colors?.[part] ?? fallback ?? definition.color;
}

export function shapeOf(definition: ConstructionObjectDefinition): ShapeId {
  return definition.shape ?? 'box';
}

export function roleOf(definition: ConstructionObjectDefinition): ObjectRole | null {
  return definition.role ?? null;
}
