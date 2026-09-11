import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import type { ChallengeDefinition, WorldDefinition } from './Challenge';

/**
 * Catalogue of every world and challenge definition, validated at boot
 * against the construction object registry so a level can never reference an
 * object that does not exist, and against itself so relationships always
 * point at real blueprint objects and levels at real worlds.
 */
export class ChallengeRegistry {
  private definitions = new Map<string, ChallengeDefinition>();
  private worldDefinitions = new Map<string, WorldDefinition>();

  constructor(private readonly objects: ObjectRegistry) {}

  registerWorld(world: WorldDefinition): void {
    const error = validateWorld(world);
    if (error) throw new Error(`Invalid world "${world?.id ?? 'unknown'}": ${error}`);
    if (this.worldDefinitions.has(world.id)) throw new Error(`Duplicate world id: ${world.id}`);
    this.worldDefinitions.set(world.id, world);
  }

  registerWorlds(worlds: WorldDefinition[]): void {
    worlds.forEach((w) => this.registerWorld(w));
  }

  register(definition: ChallengeDefinition): void {
    const error = validateChallenge(definition, this.objects, this.worldDefinitions);
    if (error) {
      const id = definition && typeof definition.id === 'string' ? definition.id : 'unknown';
      throw new Error(`Invalid challenge "${id}": ${error}`);
    }
    if (this.definitions.has(definition.id)) {
      throw new Error(`Duplicate challenge id: ${definition.id}`);
    }
    this.definitions.set(definition.id, definition);
  }

  registerAll(definitions: ChallengeDefinition[]): void {
    definitions.forEach((d) => this.register(d));
  }

  get(id: string): ChallengeDefinition | undefined {
    return this.definitions.get(id);
  }

  /** Challenges in level order (global play order). */
  list(): ChallengeDefinition[] {
    return [...this.definitions.values()].sort((a, b) => a.index - b.index);
  }

  /** Challenges of one world, in level order. */
  listByWorld(worldId: string): ChallengeDefinition[] {
    return this.list().filter((c) => c.worldId === worldId);
  }

  getWorld(id: string): WorldDefinition | undefined {
    return this.worldDefinitions.get(id);
  }

  /** Worlds in campaign order. */
  worlds(): WorldDefinition[] {
    return [...this.worldDefinitions.values()].sort((a, b) => a.index - b.index);
  }

  get size(): number {
    return this.definitions.size;
  }
}

function isVec3(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return ['x', 'y', 'z'].every((k) => typeof o[k] === 'number' && Number.isFinite(o[k]));
}

function validateWorld(w: WorldDefinition): string | null {
  if (!w || typeof w !== 'object') return 'definition is not an object';
  if (typeof w.id !== 'string' || w.id.length === 0) return 'missing id';
  if (!Number.isInteger(w.index) || w.index < 1) return 'index must be a positive integer';
  if (typeof w.title !== 'string' || w.title.length === 0) return 'missing title';
  if (typeof w.description !== 'string') return 'description must be a string';
  return null;
}

function validateChallenge(
  c: ChallengeDefinition,
  objects: ObjectRegistry,
  worlds: Map<string, WorldDefinition>,
): string | null {
  if (!c || typeof c !== 'object') return 'definition is not an object';
  if (typeof c.id !== 'string' || c.id.length === 0) return 'missing id';
  if (!Number.isInteger(c.index) || c.index < 1) return 'index must be a positive integer';
  if (typeof c.worldId !== 'string' || !worlds.has(c.worldId)) return `worldId "${c.worldId}" is not a registered world`;
  if (typeof c.title !== 'string' || c.title.length === 0) return 'missing title';
  if (!c.reference || (c.reference.kind !== 'ghost' && c.reference.kind !== 'image')) {
    return 'reference.kind must be "ghost" or "image"';
  }
  if (typeof c.reference.caption !== 'string') return 'reference.caption must be a string';
  if (c.reference.kind === 'image' && typeof c.reference.image !== 'string') return 'reference.image is required for image references';
  if (!isVec3(c.buildOrigin)) return 'buildOrigin must be {x,y,z}';
  if (c.camera !== undefined) {
    const cam = c.camera;
    if (!cam || typeof cam !== 'object') return 'camera must be an object';
    if (cam.target !== undefined && !isVec3(cam.target)) return 'camera.target must be {x,y,z}';
    if (cam.distance !== undefined && !(typeof cam.distance === 'number' && cam.distance > 0)) return 'camera.distance must be positive';
    if (cam.azimuth !== undefined && typeof cam.azimuth !== 'number') return 'camera.azimuth must be a number';
    if (cam.elevation !== undefined && !(typeof cam.elevation === 'number' && cam.elevation > 0 && cam.elevation < 90)) {
      return 'camera.elevation must be between 0 and 90 degrees';
    }
  }
  if (!(typeof c.buildAreaHalfSize === 'number' && c.buildAreaHalfSize > 0)) return 'buildAreaHalfSize must be positive';
  if (!Array.isArray(c.allowedObjectIds)) return 'allowedObjectIds must be an array';
  for (const id of c.allowedObjectIds) {
    if (!objects.has(id)) return `allowedObjectIds references unknown object "${id}"`;
  }

  const bp = c.blueprint;
  if (!bp || typeof bp !== 'object') return 'missing blueprint';
  if (typeof bp.id !== 'string' || bp.id.length === 0) return 'blueprint missing id';
  if (!bp.rules) return 'blueprint missing rules';
  if (!(typeof bp.rules.positionTolerance === 'number' && bp.rules.positionTolerance > 0)) {
    return 'blueprint.rules.positionTolerance must be positive';
  }
  if (typeof bp.rules.rotationMatters !== 'boolean') return 'blueprint.rules.rotationMatters must be boolean';
  if (typeof bp.rules.allowExtraObjects !== 'boolean') return 'blueprint.rules.allowExtraObjects must be boolean';
  if (bp.rules.rotationMode !== undefined && bp.rules.rotationMode !== 'fixed' && bp.rules.rotationMode !== 'anyQuarterTurn') {
    return 'blueprint.rules.rotationMode must be "fixed" or "anyQuarterTurn"';
  }
  if (!Array.isArray(bp.objects) || bp.objects.length === 0) return 'blueprint must have at least one object';

  const ids = new Set<string>();
  for (const o of bp.objects) {
    if (typeof o.id !== 'string' || o.id.length === 0) return 'blueprint object missing id';
    if (ids.has(o.id)) return `duplicate blueprint object id "${o.id}"`;
    ids.add(o.id);
  }
  for (const o of bp.objects) {
    if (!objects.has(o.definitionId)) return `blueprint object "${o.id}" references unknown definition "${o.definitionId}"`;
    if (!isVec3(o.position)) return `blueprint object "${o.id}" position must be {x,y,z}`;
    if (!Number.isInteger(o.rotationStep) || o.rotationStep < 0 || o.rotationStep > 3) {
      return `blueprint object "${o.id}" rotationStep must be 0..3`;
    }
    if (o.rules?.positionTolerance !== undefined && !(o.rules.positionTolerance > 0)) {
      return `blueprint object "${o.id}" positionTolerance must be positive`;
    }
    if (o.host !== undefined && (o.host === o.id || !ids.has(o.host))) {
      return `blueprint object "${o.id}" host must reference another blueprint object`;
    }
    if (o.support !== undefined) {
      if (!Array.isArray(o.support) || o.support.some((s) => s === o.id || !ids.has(s))) {
        return `blueprint object "${o.id}" support must list other blueprint objects`;
      }
    }
  }
  return null;
}
