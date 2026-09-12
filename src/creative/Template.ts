import type { Vec3 } from '@/construction/PlacedObject';

/**
 * One piece of a creative template, positioned relative to the template's
 * own origin (placed at wherever the template is instantiated in the
 * world). This is intentionally the bare minimum needed to place a normal
 * object: a template is a *list of placements*, not a second way to
 * describe the world. `instantiateTemplate` turns each entry into a real
 * `placedObjects` entry through the exact same validation a manual click
 * goes through - see `GameActions.instantiateTemplate`.
 */
export interface TemplateObjectSpec {
  /** References ConstructionObjectDefinition.id in the registry. */
  definitionId: string;
  /** Position relative to the template's origin, in metres. */
  position: Vec3;
  /** Rotation around the vertical axis, in radians. Defaults to 0. */
  rotationY?: number;
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
  if (!Array.isArray(d.objects) || d.objects.length === 0) return 'template has no objects';
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
  }
  return null;
}
