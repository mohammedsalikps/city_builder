import type { GameStore } from '@/state/GameStore';
import type { GameActions } from '@/state/actions';
import type { GameState } from '@/state/GameState';
import type { ProgressStorage } from './ProgressStorage';
import { calculateStars } from './stars';

/**
 * Turns match results into lasting progress.
 *
 *   ChallengeMatchResult (completed) ──▶ calculateStars ──▶ actions.recordChallengeResult
 *                                                                │
 *                                                     ProgressStorage.save
 *
 * Runs only when the match result object changes (never per frame). While an
 * attempt is completed its stars follow the current build (adding junk lowers
 * them, tidying up raises them) so the result panel is always honest; the
 * stored best for the level only ever rises.
 */
export class ProgressionService {
  private unsubscribe: (() => void) | null = null;
  private lastMatch: GameState['challengeMatch'] = null;
  private lastProgress: GameState['progress'] | null = null;

  constructor(
    private readonly store: GameStore,
    private readonly actions: GameActions,
    private readonly storage: ProgressStorage,
  ) {}

  start(): void {
    this.lastProgress = this.store.getState().progress;
    this.unsubscribe = this.store.subscribe((state) => this.onStateChanged(state));
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private onStateChanged(state: GameState): void {
    // Persist whenever progress changes, whoever changed it (results, resets).
    if (state.progress !== this.lastProgress) {
      this.lastProgress = state.progress;
      this.storage.save(state.progress);
    }

    const { challenge, challengeMatch } = state;
    if (challengeMatch === this.lastMatch) return;
    this.lastMatch = challengeMatch;
    if (!challenge || !challengeMatch || !challengeMatch.completed) return;

    const stars = calculateStars(challengeMatch);
    const current = state.challengeResult;
    if (current && current.attemptStartedAt === challenge.startedAt && current.stars === stars) return;

    this.actions.recordChallengeResult(challenge.challengeId, stars, challenge.startedAt);
  }
}
