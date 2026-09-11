import type { GameStore } from '@/state/GameStore';
import type { PlacementTarget, PlacementTargetSet } from '@/construction/PlacementResolver';
import { PLACEMENT_ROTATION_STEP } from '@/construction/constants';
import type { ChallengeRegistry } from './ChallengeRegistry';
import { blueprintWorldPosition } from './Blueprint';

const NONE: PlacementTargetSet = { targets: [], requiredSupport: null };

/**
 * What the active challenge's blueprint says about placing one kind of
 * object: where its targets are (the ghost transforms) and which objects
 * those targets must rest on. It feeds the placement rules (first-wall ghost
 * snap, challenge support); outside a challenge it is empty, so free building
 * keeps the plain catalogue rules.
 *
 * Memoised per challenge and definition: a blueprint never changes while a
 * level runs, so the per-frame preview only reads a cached list.
 */
export class ChallengePlacementTargets {
  private challengeId: string | null = null;
  private readonly cache = new Map<string, PlacementTargetSet>();

  constructor(
    private readonly store: GameStore,
    private readonly challenges: ChallengeRegistry,
  ) {}

  get(definitionId: string): PlacementTargetSet {
    const challengeId = this.store.getState().challenge?.challengeId ?? null;
    if (challengeId !== this.challengeId) {
      this.cache.clear();
      this.challengeId = challengeId;
    }
    if (!challengeId) return NONE;

    let set = this.cache.get(definitionId);
    if (!set) {
      set = this.build(challengeId, definitionId);
      this.cache.set(definitionId, set);
    }
    return set;
  }

  private build(challengeId: string, definitionId: string): PlacementTargetSet {
    const challenge = this.challenges.get(challengeId);
    if (!challenge) return NONE;

    const byId = new Map(challenge.blueprint.objects.map((o) => [o.id, o]));
    const targets: PlacementTarget[] = [];
    const support = new Set<string>();
    let everyTargetNeedsSupport = true;

    for (const object of challenge.blueprint.objects) {
      if (object.definitionId !== definitionId) continue;
      const supportDefinitions = (object.support ?? [])
        .map((id) => byId.get(id)?.definitionId)
        .filter((id): id is string => id !== undefined);
      if (supportDefinitions.length === 0) everyTargetNeedsSupport = false;
      supportDefinitions.forEach((id) => support.add(id));
      targets.push({
        position: blueprintWorldPosition(challenge.buildOrigin, object),
        rotationY: object.rotationStep * PLACEMENT_ROTATION_STEP,
      });
    }

    return {
      targets,
      requiredSupport: targets.length > 0 && everyTargetNeedsSupport ? support : null,
    };
  }
}
