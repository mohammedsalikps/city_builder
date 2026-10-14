import { createPlayer, type PlayerProfile } from '@/player/Player';
import type { PlacedObject, Vec3 } from '@/construction/PlacedObject';
import { DEFAULT_WORLD_NAME, type MyWorldIdentity } from './GameState';

/** What gets persisted for My World: who built it, what they called it, and what they built. */
export interface MyWorldSave {
  player: PlayerProfile;
  placedObjects: PlacedObject[];
  identity: MyWorldIdentity;
}

/**
 * Where My World's build is kept between sessions - the sandbox counterpart
 * to `ProgressStorage` (Challenge Mode's stars/unlocks). Deliberately a
 * separate small file: the two slices are unrelated (resetting one must
 * never touch the other) but the storage *shape* - a versioned JSON file in
 * localStorage, validated on every read - is the same pattern, so this is
 * the existing save architecture applied to a second slice, not a second
 * architecture.
 */
export interface MyWorldStorage {
  /** Saved world, or null when nothing valid is stored. */
  load(): MyWorldSave | null;
  save(save: MyWorldSave): void;
  clear(): void;
}

interface WorldSaveObjectV1 {
  id: string;
  definitionId: string;
  position: Vec3;
  rotationY: number;
  scale: Vec3;
  materialOverrides: { color?: string };
  supportId: string | null;
  hostId: string | null;
  createdAt: string;
  /** Added in Step 25; optional (older saves have no creation groups). */
  group?: { id: string; creation: string };
}

interface WorldSaveFileV1 {
  version: 1;
  player: { id: string; name: string; createdAt: string };
  placedObjects: WorldSaveObjectV1[];
  /** Added in Step 24; optional so earlier saves still load (defaults apply). */
  worldName?: string;
  worldStory?: string | null;
}

export const MY_WORLD_SAVE_VERSION = 1;
export const MY_WORLD_SAVE_KEY = 'city-builder.world';

/**
 * localStorage-backed storage, following LocalProgressStorage exactly:
 * every read is validated; anything missing, malformed or from an unknown
 * version yields null so a fresh sandbox starts instead of crashing.
 */
export class LocalMyWorldStorage implements MyWorldStorage {
  constructor(private readonly key: string = MY_WORLD_SAVE_KEY) {}

  load(): MyWorldSave | null {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(this.key);
    } catch (error) {
      console.warn('[my-world] localStorage unavailable, starting fresh', error);
      return null;
    }
    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[my-world] Saved world is not valid JSON, starting fresh');
      return null;
    }
    const save = parseWorldSave(parsed);
    if (!save) console.warn('[my-world] Saved world failed validation, starting fresh');
    return save;
  }

  save(save: MyWorldSave): void {
    const file: WorldSaveFileV1 = {
      version: MY_WORLD_SAVE_VERSION,
      player: { id: save.player.id, name: save.player.name, createdAt: save.player.createdAt },
      placedObjects: save.placedObjects.map(toSaveObject),
      worldName: save.identity.name,
      worldStory: save.identity.story,
    };
    try {
      window.localStorage.setItem(this.key, JSON.stringify(file));
    } catch (error) {
      console.warn('[my-world] Could not save world', error);
    }
  }

  clear(): void {
    try {
      window.localStorage.removeItem(this.key);
    } catch (error) {
      console.warn('[my-world] Could not clear saved world', error);
    }
  }
}

function toSaveObject(p: PlacedObject): WorldSaveObjectV1 {
  return {
    id: p.id,
    definitionId: p.definitionId,
    position: { ...p.position },
    rotationY: p.rotationY,
    scale: { ...p.scale },
    materialOverrides: { ...p.materialOverrides },
    supportId: p.supportId,
    hostId: p.hostId,
    createdAt: p.createdAt,
    ...(p.group ? { group: { ...p.group } } : {}),
  };
}

function isVec3(v: unknown): v is Vec3 {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.x === 'number' && typeof c.y === 'number' && typeof c.z === 'number';
}

function parsePlacedObject(data: unknown): PlacedObject | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0) return null;
  if (typeof o.definitionId !== 'string' || o.definitionId.length === 0) return null;
  if (!isVec3(o.position)) return null;
  if (typeof o.rotationY !== 'number') return null;
  if (!isVec3(o.scale)) return null;
  if (o.supportId !== null && typeof o.supportId !== 'string') return null;
  if (o.hostId !== null && typeof o.hostId !== 'string') return null;
  if (typeof o.createdAt !== 'string') return null;
  const overridesRaw = o.materialOverrides;
  const materialOverrides: PlacedObject['materialOverrides'] = {};
  if (overridesRaw && typeof overridesRaw === 'object') {
    const color = (overridesRaw as Record<string, unknown>).color;
    // Only a '#rrggbb' colour is kept; anything else is dropped (never the whole save).
    if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) materialOverrides.color = color;
  }
  return {
    id: o.id,
    definitionId: o.definitionId,
    position: { ...(o.position as Vec3) },
    rotationY: o.rotationY,
    scale: { ...(o.scale as Vec3) },
    materialOverrides,
    supportId: (o.supportId as string | null) ?? null,
    hostId: (o.hostId as string | null) ?? null,
    createdAt: o.createdAt,
    ...(parseGroup(o.group) ?? {}),
  };
}

function parseGroup(raw: unknown): { group: PlacedObject['group'] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>;
  if (typeof g.id !== 'string' || g.id.length === 0 || typeof g.creation !== 'string') return null;
  return { group: { id: g.id, creation: g.creation } };
}

/** Strict validation of a parsed save file. Returns null on any problem. */
export function parseWorldSave(data: unknown): MyWorldSave | null {
  if (!data || typeof data !== 'object') return null;
  const file = data as Record<string, unknown>;
  if (file.version !== MY_WORLD_SAVE_VERSION) return null;

  const p = file.player;
  if (!p || typeof p !== 'object') return null;
  const playerRaw = p as Record<string, unknown>;
  if (typeof playerRaw.id !== 'string' || typeof playerRaw.name !== 'string') return null;
  const player: PlayerProfile = {
    id: playerRaw.id,
    name: playerRaw.name.length > 0 ? playerRaw.name : createPlayer('Builder').name,
    createdAt: typeof playerRaw.createdAt === 'string' ? playerRaw.createdAt : new Date().toISOString(),
  };

  const objectsRaw = file.placedObjects;
  if (!Array.isArray(objectsRaw)) return null;
  const placedObjects: PlacedObject[] = [];
  for (const entry of objectsRaw) {
    const parsedObject = parsePlacedObject(entry);
    if (!parsedObject) return null; // one corrupt entry - don't guess, start fresh
    placedObjects.push(parsedObject);
  }

  const identity: MyWorldIdentity = {
    name: typeof file.worldName === 'string' && file.worldName.trim().length > 0 ? file.worldName.slice(0, 32) : DEFAULT_WORLD_NAME,
    story: typeof file.worldStory === 'string' ? file.worldStory : null,
  };

  return { player, placedObjects, identity };
}
