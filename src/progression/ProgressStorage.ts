import { createInitialProgress, type PlayerProgress, type StarRating } from './Progression';

/**
 * Where player progress is kept between sessions. The game only talks to
 * this interface, so the local implementation can be swapped for a backend
 * without touching progression logic.
 */
export interface ProgressStorage {
  /** Saved progress, or null when nothing valid is stored. */
  load(): PlayerProgress | null;
  save(progress: PlayerProgress): void;
  clear(): void;
}

/** Versioned on-disk shape. Bump the version when the shape changes. */
interface SaveFileV1 {
  version: 1;
  completedChallengeIds: string[];
  bestStars: Record<string, StarRating>;
  xp: number;
  rank: number;
}

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'city-builder.progress';

/**
 * localStorage-backed storage. Every read is validated; anything missing,
 * malformed or from an unknown version yields null so the game starts from
 * clean progress instead of crashing.
 */
export class LocalProgressStorage implements ProgressStorage {
  constructor(private readonly key: string = SAVE_KEY) {}

  load(): PlayerProgress | null {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(this.key);
    } catch (error) {
      console.warn('[progress] localStorage unavailable, starting fresh', error);
      return null;
    }
    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[progress] Saved progress is not valid JSON, starting fresh');
      return null;
    }
    const progress = parseSave(parsed);
    if (!progress) console.warn('[progress] Saved progress failed validation, starting fresh');
    return progress;
  }

  save(progress: PlayerProgress): void {
    const file: SaveFileV1 = {
      version: SAVE_VERSION,
      completedChallengeIds: [...progress.completedChallengeIds],
      bestStars: { ...progress.bestStars },
      xp: progress.xp,
      rank: progress.rank,
    };
    try {
      window.localStorage.setItem(this.key, JSON.stringify(file));
    } catch (error) {
      console.warn('[progress] Could not save progress', error);
    }
  }

  clear(): void {
    try {
      window.localStorage.removeItem(this.key);
    } catch (error) {
      console.warn('[progress] Could not clear progress', error);
    }
  }
}

/** Strict validation of a parsed save file. Returns null on any problem. */
export function parseSave(data: unknown): PlayerProgress | null {
  if (!data || typeof data !== 'object') return null;
  const file = data as Record<string, unknown>;
  if (file.version !== SAVE_VERSION) return null;

  const ids = file.completedChallengeIds;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return null;

  const stars = file.bestStars;
  if (!stars || typeof stars !== 'object' || Array.isArray(stars)) return null;
  const bestStars: Record<string, StarRating> = {};
  for (const [id, value] of Object.entries(stars as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 3) return null;
    bestStars[id] = value as StarRating;
  }

  const base = createInitialProgress();
  return {
    xp: typeof file.xp === 'number' && Number.isFinite(file.xp) ? file.xp : base.xp,
    rank: typeof file.rank === 'number' && Number.isInteger(file.rank) && file.rank >= 1 ? file.rank : base.rank,
    completedChallengeIds: [...new Set(ids as string[])],
    bestStars,
  };
}
