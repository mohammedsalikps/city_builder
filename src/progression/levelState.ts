import type { ChallengeDefinition } from '@/challenges/Challenge';
import type { PlayerProgress, StarRating } from './Progression';

export type LevelStatus = 'locked' | 'available' | 'completed';

export interface LevelEntry {
  challenge: ChallengeDefinition;
  status: LevelStatus;
  bestStars: StarRating;
}

/**
 * Challenge Mode is a straight line for now: level N is available once
 * level N-1 is completed; the first level is always available. Worlds and
 * branches can replace this one function later without touching the UI.
 */
export function getLevelStatus(
  challenge: ChallengeDefinition,
  orderedChallenges: ChallengeDefinition[],
  progress: PlayerProgress,
): LevelStatus {
  if (progress.completedChallengeIds.includes(challenge.id)) return 'completed';
  const index = orderedChallenges.findIndex((c) => c.id === challenge.id);
  if (index <= 0) return 'available';
  const previous = orderedChallenges[index - 1];
  return progress.completedChallengeIds.includes(previous.id) ? 'available' : 'locked';
}

export function listLevels(orderedChallenges: ChallengeDefinition[], progress: PlayerProgress): LevelEntry[] {
  return orderedChallenges.map((challenge) => ({
    challenge,
    status: getLevelStatus(challenge, orderedChallenges, progress),
    bestStars: progress.bestStars[challenge.id] ?? 0,
  }));
}

/** The level after `challengeId` in play order, or null at the end. */
export function nextChallenge(
  challengeId: string,
  orderedChallenges: ChallengeDefinition[],
): ChallengeDefinition | null {
  const index = orderedChallenges.findIndex((c) => c.id === challengeId);
  if (index < 0 || index + 1 >= orderedChallenges.length) return null;
  return orderedChallenges[index + 1];
}

/** Why a level is locked, phrased for the player. */
export function lockedMessage(challenge: ChallengeDefinition, orderedChallenges: ChallengeDefinition[]): string {
  const index = orderedChallenges.findIndex((c) => c.id === challenge.id);
  const previous = index > 0 ? orderedChallenges[index - 1] : null;
  return previous
    ? `Complete Level ${previous.index} to unlock this level.`
    : 'This level is not available yet.';
}
