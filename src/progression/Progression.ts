/**
 * Progression data types: experience, unlocks, rewards and Challenge Mode
 * results. This file only defines shapes and defaults; the rules that change
 * them live in `stars.ts`, `levelState.ts` and `ProgressionService.ts`.
 */

/** 0 = not completed; 1..3 = completed with that many stars. */
export type StarRating = 0 | 1 | 2 | 3;

export interface PlayerProgress {
  /** Total experience earned. (Not awarded yet.) */
  xp: number;
  /** Player rank derived from xp; 1 at start. */
  rank: number;
  /** Challenge ids the player has completed at least once. */
  completedChallengeIds: string[];
  /** Best star rating per challenge id. Never decreases. */
  bestStars: Record<string, StarRating>;
}

export interface Unlocks {
  /** Construction object definition ids the player may use. */
  objectIds: string[];
  /** Construction categories the player has access to. */
  categoryIds: string[];
}

export type RewardType = 'coins' | 'xp' | 'unlock-object' | 'unlock-category';

export interface Reward {
  type: RewardType;
  /** Numeric amount for coins/xp; ignored for unlock rewards. */
  amount?: number;
  /** Target id for unlock rewards. */
  targetId?: string;
}

export interface RewardWallet {
  coins: number;
  /** Rewards granted but not yet presented to the player. */
  pending: Reward[];
}

export function createInitialProgress(): PlayerProgress {
  return { xp: 0, rank: 1, completedChallengeIds: [], bestStars: {} };
}

/** Objects/categories available before any challenge is completed. */
export function createInitialUnlocks(): Unlocks {
  return {
    objectIds: [
      'brick_standard',
      'block_concrete',
      'wall_plain',
      'wall_long',
      'wall_short',
      'floor_slab',
      'floor_large',
      'pillar_round',
      'door_single',
      'window_square',
    ],
    categoryIds: ['structures', 'openings'],
  };
}

export function createEmptyWallet(): RewardWallet {
  return { coins: 0, pending: [] };
}
