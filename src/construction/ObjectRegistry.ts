import { DISTINCT_ORIENTATION_COUNTS } from './ConstructionObjectDefinition';
import {
  OBJECT_CATEGORIES,
  OBJECT_ROLES,
  SHAPE_IDS,
  type ConstructionObjectDefinition,
  type ObjectCategory,
  type ObjectRole,
  type ShapeId,
} from './ConstructionObjectDefinition';

/**
 * In-memory catalogue of every construction object definition.
 * Definitions are validated on registration so bad data fails fast at boot
 * instead of producing broken objects during play.
 */
export class ObjectRegistry {
  private definitions = new Map<string, ConstructionObjectDefinition>();

  register(definition: ConstructionObjectDefinition): void {
    const error = validateDefinition(definition);
    if (error) {
      const id = definition && typeof definition.id === 'string' ? definition.id : 'unknown';
      throw new Error(`Invalid construction object "${id}": ${error}`);
    }
    if (this.definitions.has(definition.id)) {
      throw new Error(`Duplicate construction object id: ${definition.id}`);
    }
    this.definitions.set(definition.id, definition);
  }

  registerAll(definitions: ConstructionObjectDefinition[]): void {
    definitions.forEach((d) => this.register(d));
  }

  get(id: string): ConstructionObjectDefinition | undefined {
    return this.definitions.get(id);
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  list(): ConstructionObjectDefinition[] {
    return [...this.definitions.values()];
  }

  listByCategory(category: ObjectCategory): ConstructionObjectDefinition[] {
    return this.list().filter((d) => d.category === category);
  }

  get size(): number {
    return this.definitions.size;
  }
}

function validateDefinition(d: ConstructionObjectDefinition): string | null {
  if (!d || typeof d !== 'object') return 'definition is not an object';
  if (typeof d.id !== 'string' || d.id.length === 0) return 'missing id';
  if (typeof d.name !== 'string' || d.name.length === 0) return 'missing name';
  if (!OBJECT_CATEGORIES.includes(d.category as ObjectCategory)) return `unknown category "${d.category}"`;
  if (typeof d.type !== 'string' || d.type.length === 0) return 'missing type';
  if (typeof d.material !== 'string' || d.material.length === 0) return 'missing material';
  if (typeof d.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(d.color)) return 'color must be a #rrggbb hex string';
  if (d.colors !== undefined) {
    for (const [part, value] of Object.entries(d.colors)) {
      if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) return `colors.${part} must be a #rrggbb hex string`;
    }
  }
  if (d.shape !== undefined && !SHAPE_IDS.includes(d.shape as ShapeId)) return `unknown shape "${d.shape}"`;
  if (d.role !== undefined && !OBJECT_ROLES.includes(d.role as ObjectRole)) return `unknown role "${d.role}"`;
  const { dimensions } = d;
  if (!dimensions) return 'missing dimensions';
  for (const key of ['width', 'height', 'depth'] as const) {
    const v = dimensions[key];
    if (typeof v !== 'number' || !(v > 0)) return `dimensions.${key} must be a positive number`;
  }
  if (!d.unlock || typeof d.unlock.type !== 'string') return 'missing unlock requirement';
  if (!d.cost || typeof d.cost.coins !== 'number' || d.cost.coins < 0) return 'invalid cost';
  if (!d.reward || typeof d.reward.xpOnFirstUse !== 'number') return 'invalid reward';
  if (!d.gameplay || typeof d.gameplay.stackable !== 'boolean') return 'invalid gameplay properties';
  if (d.distinctOrientations !== undefined && !DISTINCT_ORIENTATION_COUNTS.some((n) => n === d.distinctOrientations)) {
    return 'distinctOrientations must be 1, 2 or 4';
  }
  if (d.visual !== undefined) {
    if (typeof d.visual.asset !== 'string') return 'visual.asset must be an asset id';
    if (d.visual.fit !== undefined && !['contain', 'height', 'stretch'].includes(d.visual.fit)) return 'visual.fit must be "contain", "height" or "stretch"';
  }
  if (d.placement !== undefined) {
    const { horizontalSnap, snapDivisions } = d.placement;
    if (
      horizontalSnap !== undefined &&
      horizontalSnap !== 'footprint' &&
      !(typeof horizontalSnap === 'number' && horizontalSnap > 0)
    ) {
      return 'placement.horizontalSnap must be "footprint" or a positive number';
    }
    if (snapDivisions !== undefined && !(Number.isInteger(snapDivisions) && snapDivisions >= 1)) {
      return 'placement.snapDivisions must be a positive integer';
    }
    const { sillHeight, support } = d.placement;
    if (sillHeight !== undefined && !(typeof sillHeight === 'number' && sillHeight >= 0)) {
      return 'placement.sillHeight must be a non-negative number';
    }
    if (support !== undefined) {
      if (support.ground !== undefined && typeof support.ground !== 'boolean') return 'placement.support.ground must be boolean';
      if (support.types !== undefined && !(Array.isArray(support.types) && support.types.every((t) => typeof t === 'string'))) {
        return 'placement.support.types must be an array of strings';
      }
      if (
        support.categories !== undefined &&
        !(Array.isArray(support.categories) && support.categories.every((c) => OBJECT_CATEGORIES.includes(c)))
      ) {
        return 'placement.support.categories must be known categories';
      }
      if (
        support.surfaces !== undefined &&
        !(Array.isArray(support.surfaces) && support.surfaces.every((s) => s === 'top' || s === 'side'))
      ) {
        return 'placement.support.surfaces must contain only "top" / "side"';
      }
      if (support.hint !== undefined && typeof support.hint !== 'string') return 'placement.support.hint must be a string';
    }
  }
  if (d.role === 'opening' && (d.placement?.sillHeight === undefined)) return 'openings must declare placement.sillHeight';
  return null;
}
