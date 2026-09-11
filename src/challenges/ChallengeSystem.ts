import type { GameStore } from '@/state/GameStore';
import type { GameActions } from '@/state/actions';
import type { GameState } from '@/state/GameState';
import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import type { World } from '@/world/World';
import type { ChallengeRegistry } from './ChallengeRegistry';
import type { BlueprintRenderer } from './BlueprintRenderer';
import { matchBlueprint } from './ChallengeMatcher';

/**
 * Keeps the active challenge evaluated and visible.
 *
 *   placedObjects / challenge change ──▶ matchBlueprint ──▶ actions.setChallengeMatch
 *                                                             │
 *                                        BlueprintRenderer ◀──┘ (ghosts, matched tint)
 *
 * Matching runs only when the placed-object list or the active challenge
 * actually changes (reference comparison), never per frame.
 */
export class ChallengeSystem {
  private unsubscribe: (() => void) | null = null;
  private lastChallengeId: string | null = null;
  private lastPlaced: GameState['placedObjects'] | null = null;
  private lastMatch: GameState['challengeMatch'] = null;

  constructor(
    private readonly store: GameStore,
    private readonly actions: GameActions,
    private readonly challenges: ChallengeRegistry,
    private readonly registry: ObjectRegistry,
    private readonly renderer: BlueprintRenderer,
    private readonly world: World,
  ) {}

  start(): void {
    this.unsubscribe = this.store.subscribe((state) => this.onStateChanged(state));
    this.onStateChanged(this.store.getState());
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.renderer.dispose();
  }

  private onStateChanged(state: GameState): void {
    const challengeId = state.challenge?.challengeId ?? null;
    const challengeChanged = challengeId !== this.lastChallengeId;

    if (challengeChanged) {
      this.lastChallengeId = challengeId;
      const definition = challengeId ? this.challenges.get(challengeId) ?? null : null;
      this.renderer.setChallenge(definition);
      if (definition) {
        const hint = definition.camera ?? {};
        const o = definition.buildOrigin;
        const t = hint.target ?? { x: 0, y: 0, z: 0 };
        this.world.cameraController.transitionTo(
          { x: o.x + t.x, y: o.y + t.y, z: o.z + t.z },
          {
            distance: hint.distance ?? definition.buildAreaHalfSize * 2,
            azimuth: hint.azimuth,
            elevation: hint.elevation,
          },
        );
      }
    }

    if (!challengeId) {
      if (state.challengeMatch !== null) this.actions.setChallengeMatch(null);
      this.lastPlaced = null;
      this.lastMatch = null;
      return;
    }

    const placedChanged = state.placedObjects !== this.lastPlaced;
    if (challengeChanged || placedChanged) {
      this.lastPlaced = state.placedObjects;
      const definition = this.challenges.get(challengeId);
      if (!definition) return;
      const result = matchBlueprint(definition, state.placedObjects, this.registry);
      this.actions.setChallengeMatch(result);
      return; // the resulting state change re-enters and updates the renderer below
    }

    if (state.challengeMatch !== this.lastMatch) {
      this.lastMatch = state.challengeMatch;
      const matched = new Set(state.challengeMatch?.matches.map((m) => m.blueprintObjectId) ?? []);
      this.renderer.setMatched(matched);
    }
  }
}
