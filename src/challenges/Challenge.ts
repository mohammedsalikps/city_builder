import type { Reward } from '@/progression/Progression';
import type { Vec3 } from '@/construction/PlacedObject';
import type { ChallengeBlueprint } from './Blueprint';

/**
 * A campaign world: a named group of levels shown together on one map.
 * Worlds are pure grouping data; unlocking still follows the global level
 * order (`ChallengeDefinition.index`).
 */
export interface WorldDefinition {
  id: string;
  /** 1-based order of the world in the campaign. */
  index: number;
  title: string;
  description: string;
}

/**
 * What the player is shown to understand the target. Separate from the
 * blueprint on purpose: the reference is for understanding, the blueprint
 * is what gets evaluated. A picture is never the source of truth.
 */
export interface ChallengeReference {
  /** 'ghost' renders the blueprint as translucent objects in the world. */
  kind: 'ghost' | 'image';
  /** Short, child-friendly instruction. */
  caption: string;
  /** For kind 'image': asset path. */
  image?: string;
}

/**
 * Optional camera framing for a level. All fields are optional; a level
 * without a hint uses the default three-quarter view centred on the origin.
 * `target` is relative to the build origin. Angles are in degrees:
 * azimuth 0 looks from +Z (in front), 90 from +X; elevation 90 is top-down.
 */
export interface ChallengeCameraHint {
  target?: Vec3;
  distance?: number;
  azimuth?: number;
  elevation?: number;
}

/**
 * A level in Challenge Mode: a blueprint anchored at a build origin, plus
 * the rules and (future) rewards around it. Loaded from
 * `src/data/challenges.json`; never hand-written in TypeScript.
 */
export interface ChallengeDefinition {
  id: string;
  /** Level number shown to the player (1-based, global across worlds). */
  index: number;
  /** World this level belongs to (see `src/data/worlds.json`). */
  worldId: string;
  title: string;
  description: string;
  reference: ChallengeReference;
  /** Optional camera framing for the level (see ChallengeCameraHint). */
  camera?: ChallengeCameraHint;
  /** Where the blueprint's (0,0,0) sits in the world. */
  buildOrigin: Vec3;
  /** Half the side length of the square build area centred on the origin. */
  buildAreaHalfSize: number;
  blueprint: ChallengeBlueprint;
  /** Object ids the player may use. Empty = every unlocked object. */
  allowedObjectIds: string[];
  /** Declared now for data completeness; nothing is awarded yet. */
  rewards: Reward[];
}

export type ChallengeStatus = 'in-progress' | 'completed';

/** Outcome recorded for the current attempt once it is completed. */
export interface ChallengeAttemptResult {
  challengeId: string;
  /** Stars earned in this attempt. */
  stars: 0 | 1 | 2 | 3;
  /** Best stars ever for this challenge, after recording this attempt. */
  bestStars: 0 | 1 | 2 | 3;
  /** True when this attempt raised the stored best. */
  isNewBest: boolean;
  /** Attempt identity (`ChallengeState.startedAt`). */
  attemptStartedAt: string;
}

/** Runtime state of the challenge currently being played. */
export interface ChallengeState {
  challengeId: string;
  status: ChallengeStatus;
  /** ISO timestamp. */
  startedAt: string;
}
