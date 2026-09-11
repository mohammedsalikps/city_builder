import type { ChallengeMatchResult } from '@/challenges/ChallengeMatcher';
import type { StarRating } from './Progression';

/**
 * How well a completed challenge was built, from the matcher's result.
 *
 * The matcher says what was built; this says how well. Deterministic and
 * explainable:
 *
 *   3 stars  completed with nothing misplaced and nothing extra
 *   2 stars  completed with a few stray pieces (misplaced + extra, but fewer
 *            than the number of required pieces)
 *   1 star   completed with as many stray pieces as required pieces, or more
 *   0 stars  not completed
 */
export function calculateStars(match: ChallengeMatchResult): StarRating {
  if (!match.completed) return 0;
  const stray = match.wrongCount + match.extraCount;
  if (stray === 0) return 3;
  if (stray < match.required) return 2;
  return 1;
}

/** Child-friendly one-liner for the result panel. */
export function describeStars(stars: StarRating): string {
  switch (stars) {
    case 3:
      return 'Perfect build!';
    case 2:
      return 'Great! A few extra pieces got left behind.';
    case 1:
      return 'Done! Try building it tidier for more stars.';
    default:
      return 'Keep building!';
  }
}

/** Visual stars, e.g. "★★☆" for 2. */
export function starString(stars: StarRating, max = 3): string {
  return '★'.repeat(stars) + '☆'.repeat(Math.max(0, max - stars));
}
