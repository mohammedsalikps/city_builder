import type { Vec3 } from '@/construction/PlacedObject';

/**
 * One piece of a creative template, positioned relative to the template's
 * own origin (placed wherever the template is instantiated in the world,
 * and rotated together with it). This is intentionally the bare minimum
 * needed to place a normal object: a template is a *list of placements*,
 * not a second way to describe the world. `instantiateTemplate` turns each
 * entry into a real `placedObjects` entry through the exact same validation
 * a manual click goes through - see `GameActions.instantiateTemplate`.
 *
 * A piece can rest on or set into another piece of the *same* template (a
 * door needs its wall, a roof needs a wall to sit on) via `hostRef`/
 * `supportRef` - a `localId` declared elsewhere in the same `objects` list.
 * `instantiateTemplate` places pieces in dependency order and resolves the
 * ref to the real placedObject id created for it, then discards the local
 * ids - they never appear outside the template.
 */
export interface TemplateObjectSpec {
  /** References ConstructionObjectDefinition.id in the registry. */
  definitionId: string;
  /** Position relative to the template's origin, in metres. */
  position: Vec3;
  /** Rotation around the vertical axis, in radians, before the template's own rotation is added. Defaults to 0. */
  rotationY?: number;
  /** Name other specs in this template can reference via hostRef/supportRef. */
  localId?: string;
  /** localId of the wall this opening (door/window) is set into. */
  hostRef?: string;
  /** localId of the piece this rests on (e.g. a roof on a wall). */
  supportRef?: string;
  /** Surface used when supportRef/hostRef is given. Defaults to 'top' for a support, 'side' for a host. */
  surface?: 'top' | 'side';
  /**
   * Size multiplier per axis (1 = the catalogue size), for pieces fitted to
   * a planned creation - e.g. one roof spanning a whole house. Defaults to 1.
   */
  scale?: Vec3;
}

/**
 * A small, fixed starting arrangement for My World - "Villa Street",
 * "Neighborhood"... These are NOT levels: no completion, no stars, no
 * locking. Loaded from `src/data/templates.json`, never hand-written here.
 */
export interface TemplateDefinition {
  id: string;
  name: string;
  /** Short, child-friendly description shown on the template's card. */
  description: string;
  /** One emoji shown on the Build Intent card. */
  icon: string;
  objects: TemplateObjectSpec[];
}

/**
 * In-memory catalogue of every creative template, mirroring ObjectRegistry's
 * shape. Deliberately separate from ObjectRegistry/ChallengeRegistry: a
 * template only ever produces normal objects (validated against
 * ObjectRegistry at use time by GameActions), it never needs its own
 * gameplay semantics.
 */
export class TemplateRegistry {
  private definitions = new Map<string, TemplateDefinition>();

  register(definition: TemplateDefinition): void {
    const error = validateTemplate(definition);
    if (error) {
      const id = definition && typeof definition.id === 'string' ? definition.id : 'unknown';
      throw new Error(`Invalid template "${id}": ${error}`);
    }
    if (this.definitions.has(definition.id)) {
      throw new Error(`Duplicate template id: ${definition.id}`);
    }
    this.definitions.set(definition.id, definition);
  }

  registerAll(definitions: TemplateDefinition[]): void {
    definitions.forEach((d) => this.register(d));
  }

  /**
   * Add or replace a template made at runtime (a planned creation being
   * previewed - see src/creative/plan). Validated exactly like the JSON ones.
   */
  upsert(definition: TemplateDefinition): void {
    const error = validateTemplate(definition);
    if (error) throw new Error(`Invalid template "${definition?.id ?? 'unknown'}": ${error}`);
    this.definitions.set(definition.id, definition);
  }

  remove(id: string): void {
    this.definitions.delete(id);
  }

  get(id: string): TemplateDefinition | undefined {
    return this.definitions.get(id);
  }

  list(): TemplateDefinition[] {
    return [...this.definitions.values()];
  }

  get size(): number {
    return this.definitions.size;
  }
}

function validateTemplate(d: TemplateDefinition): string | null {
  if (!d || typeof d !== 'object') return 'template is not an object';
  if (typeof d.id !== 'string' || d.id.length === 0) return 'missing id';
  if (typeof d.name !== 'string' || d.name.length === 0) return 'missing name';
  if (typeof d.description !== 'string') return 'missing description';
  if (typeof d.icon !== 'string' || d.icon.length === 0) return 'missing icon';
  if (!Array.isArray(d.objects) || d.objects.length === 0) return 'template has no objects';
  const localIds = new Set<string>();
  for (const spec of d.objects) {
    if (spec?.localId) localIds.add(spec.localId);
  }
  for (const [index, spec] of d.objects.entries()) {
    if (!spec || typeof spec.definitionId !== 'string' || spec.definitionId.length === 0) {
      return `objects[${index}] missing definitionId`;
    }
    const p = spec.position;
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.z !== 'number') {
      return `objects[${index}] has an invalid position`;
    }
    if (spec.rotationY !== undefined && typeof spec.rotationY !== 'number') {
      return `objects[${index}] has an invalid rotationY`;
    }
    const s = spec.scale;
    if (s !== undefined && ![s?.x, s?.y, s?.z].every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 20)) {
      return `objects[${index}] has an invalid scale`;
    }
    if (spec.hostRef !== undefined && !localIds.has(spec.hostRef)) {
      return `objects[${index}] hostRef "${spec.hostRef}" is not declared by any localId`;
    }
    if (spec.supportRef !== undefined && !localIds.has(spec.supportRef)) {
      return `objects[${index}] supportRef "${spec.supportRef}" is not declared by any localId`;
    }
  }
  return null;
}
