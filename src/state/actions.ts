import type { GameStore } from './GameStore';
import { createPlayer } from '@/player/Player';
import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import { roleOf } from '@/construction/ConstructionObjectDefinition';
import { createPlacedObject, type PlacedObject, type Vec3 } from '@/construction/PlacedObject';
import { PLACEMENT_ROTATION_STEP, PLACEMENT_ROTATION_STEPS } from '@/construction/constants';
import { computeBounds } from '@/construction/bounds';
import {
  checkSupportRules,
  checkTargetSupport,
  findInvalidReason,
  placementStatusEquals,
  type PlacementRulesContext,
  type PlacementStatus,
  type PlacementSurface,
} from '@/construction/PlacementResolver';
import type { ChallengeRegistry } from '@/challenges/ChallengeRegistry';
import type { ChallengeMatchResult } from '@/challenges/ChallengeMatcher';
import type { ChallengeStatus } from '@/challenges/Challenge';
import { createInitialProgress, type StarRating } from '@/progression/Progression';
import { getLevelStatus, lockedMessage, nextChallenge } from '@/progression/levelState';

/** How a placement was resolved; the action re-validates against it. */
export interface PlaceOptions {
  supportId?: string | null;
  /** Wall an opening is set into. Overlap with the host is expected and allowed. */
  hostId?: string | null;
  /** Explicit yaw; defaults to the pending placement rotation. */
  rotationY?: number;
  /** Surface used; defaults to 'top' when a support is given, else 'ground'. */
  surface?: PlacementSurface;
}

/**
 * The only sanctioned ways to change game state. UI and systems call these
 * instead of calling `store.setState` directly, so every transition is
 * named, discoverable and testable.
 */
export class GameActions {
  constructor(
    private readonly store: GameStore,
    private readonly registry: ObjectRegistry,
    private readonly challenges: ChallengeRegistry,
    private readonly placementRules: PlacementRulesContext,
  ) {}

  // ---------------------------------------------------------------- session

  /** Called once the app has booted and all systems are ready. */
  finishBoot(): void {
    this.store.setState({ mode: 'menu' });
  }

  /** Start a fresh free-building session in the sandbox world. */
  startNewGame(playerName = 'Builder'): void {
    this.store.setState({
      mode: 'playing',
      player: createPlayer(playerName),
      world: { id: 'sandbox', name: 'Sandbox' },
      level: { id: 'sandbox', index: 0 },
      challenge: null,
      challengeMatch: null,
      selectedObjectId: null,
      placementRotationStep: 0,
      placedObjects: [],
      selectedInstanceId: null,
      placementStatus: null,
    });
  }

  /** Re-enter the existing session from the menu. No-op if no session exists. */
  continueGame(): void {
    const { player, mode } = this.store.getState();
    if (player === null || mode !== 'menu') return;
    this.store.setState({ mode: 'playing' });
  }

  returnToMenu(): void {
    this.store.setState({
      mode: 'menu',
      selectedObjectId: null,
      selectedInstanceId: null,
      placementStatus: null,
    });
  }

  pause(): void {
    if (this.store.getState().mode === 'playing') {
      this.store.setState({ mode: 'paused' });
    }
  }

  resume(): void {
    if (this.store.getState().mode === 'paused') {
      this.store.setState({ mode: 'playing' });
    }
  }

  // -------------------------------------------------------------- campaign

  /** Open the campaign map (Challenge Mode's home). */
  openWorldMap(): void {
    this.store.setState({ mode: 'world-map', menuNotice: null });
  }

  /** Back from the map to the main menu. */
  closeWorldMap(): void {
    if (this.store.getState().mode !== 'world-map') return;
    this.store.setState({ mode: 'menu', menuNotice: null });
  }

  // -------------------------------------------------------------- challenge

  /**
   * Enter a challenge level with an empty build area. Creates a player
   * profile if none exists yet (entering straight from the main menu).
   */
  startChallenge(challengeId: string, playerName = 'Builder'): boolean {
    const definition = this.challenges.get(challengeId);
    if (!definition) {
      console.warn(`[actions] Unknown challenge: ${challengeId}`);
      return false;
    }
    const ordered = this.challenges.list();
    if (getLevelStatus(definition, ordered, this.store.getState().progress) === 'locked') {
      this.store.setState({ menuNotice: lockedMessage(definition, ordered) });
      return false;
    }
    // A level always provides the pieces it asks for. Until the progression
    // system decides unlock timing, required objects are unlocked on entry.
    this.unlockObjects(definition.blueprint.objects.map((o) => o.definitionId));

    const state = this.store.getState();
    this.store.setState({
      mode: 'playing',
      player: state.player ?? createPlayer(playerName),
      world: { id: `challenge:${definition.id}`, name: definition.title },
      level: { id: definition.id, index: definition.index },
      challenge: { challengeId: definition.id, status: 'in-progress', startedAt: new Date().toISOString() },
      challengeMatch: null,
      challengeResult: null,
      menuNotice: null,
      selectedObjectId: null,
      placementRotationStep: 0,
      placedObjects: [],
      selectedInstanceId: null,
      placementStatus: null,
    });
    return true;
  }

  /**
   * Start the current challenge over: construction cleared, selection and
   * matcher state reset. The blueprint preview stays (same challenge id).
   */
  restartChallenge(): void {
    const { challenge } = this.store.getState();
    if (!challenge) return;
    this.store.setState({
      challenge: { challengeId: challenge.challengeId, status: 'in-progress', startedAt: new Date().toISOString() },
      challengeMatch: null,
      challengeResult: null,
      selectedObjectId: null,
      placementRotationStep: 0,
      placedObjects: [],
      selectedInstanceId: null,
      placementStatus: null,
    });
  }

  /** Leave the current challenge, discarding its construction, back to the world map. */
  exitChallenge(): void {
    if (this.store.getState().challenge === null) return;
    this.store.setState({
      mode: 'world-map',
      challenge: null,
      challengeMatch: null,
      challengeResult: null,
      selectedObjectId: null,
      placedObjects: [],
      selectedInstanceId: null,
      placementStatus: null,
    });
  }

  /**
   * Publish the latest matcher output. Called by the challenge system after
   * construction changes; keeps `challenge.status` in line with completion.
   */
  setChallengeMatch(result: ChallengeMatchResult | null): void {
    const state = this.store.getState();
    if (state.challengeMatch === result) return;
    const status: ChallengeStatus = result?.completed ? 'completed' : 'in-progress';
    const challenge =
      state.challenge && state.challenge.status !== status ? { ...state.challenge, status } : state.challenge;
    this.store.setState({ challengeMatch: result, challenge });
  }

  /**
   * Continue to the level after the current one, or back to the menu when
   * there is none. Locked levels cannot be entered this way either.
   */
  startNextChallenge(): void {
    const { challenge } = this.store.getState();
    if (!challenge) return;
    const next = nextChallenge(challenge.challengeId, this.challenges.list());
    this.exitChallenge();
    if (next) this.startChallenge(next.id);
  }

  // ------------------------------------------------------------ progression

  /**
   * Record a completed attempt. Marks the challenge completed and raises its
   * best stars if this attempt is better; the stored best never decreases.
   * Level unlocking is derived from `completedChallengeIds`, so nothing else
   * needs to be written.
   */
  recordChallengeResult(challengeId: string, stars: StarRating, attemptStartedAt: string): void {
    const state = this.store.getState();
    const previousBest = state.progress.bestStars[challengeId] ?? 0;
    const bestStars = Math.max(previousBest, stars) as StarRating;
    const completedChallengeIds = state.progress.completedChallengeIds.includes(challengeId)
      ? state.progress.completedChallengeIds
      : [...state.progress.completedChallengeIds, challengeId];
    const progressChanged =
      completedChallengeIds !== state.progress.completedChallengeIds || bestStars !== previousBest;

    this.store.setState({
      progress: progressChanged
        ? { ...state.progress, completedChallengeIds, bestStars: { ...state.progress.bestStars, [challengeId]: bestStars } }
        : state.progress,
      challengeResult: {
        challengeId,
        stars,
        bestStars,
        isNewBest: stars > previousBest,
        attemptStartedAt,
      },
    });
  }

  /** Wipe Challenge Mode progress (completed levels and stars). */
  resetProgress(): void {
    this.store.setState({ progress: createInitialProgress(), challengeResult: null, menuNotice: null });
  }

  clearMenuNotice(): void {
    if (this.store.getState().menuNotice !== null) this.store.setState({ menuNotice: null });
  }

  // ---------------------------------------------------------------- unlocks

  /**
   * Grant access to construction objects. The progression system (later)
   * decides *when* to call this; the catalogue only needs locked/unlocked
   * state to exist. Unknown ids are ignored with a warning.
   */
  unlockObjects(objectIds: string[]): void {
    const { unlocks } = this.store.getState();
    const next = new Set(unlocks.objectIds);
    for (const id of objectIds) {
      if (!this.registry.has(id)) {
        console.warn(`[actions] Cannot unlock unknown object: ${id}`);
        continue;
      }
      next.add(id);
    }
    if (next.size === unlocks.objectIds.length) return;
    const categories = new Set(unlocks.categoryIds);
    for (const id of next) {
      const definition = this.registry.get(id);
      if (definition) categories.add(definition.category);
    }
    this.store.setState({ unlocks: { objectIds: [...next], categoryIds: [...categories] } });
  }

  // -------------------------------------------------------------- placement

  /**
   * Choose a construction object definition to place. Only unlocked,
   * registered objects can be selected. Passing `null` leaves placement mode.
   * Choosing a definition also deselects any placed object.
   */
  selectObject(objectId: string | null): void {
    if (objectId === null) {
      this.store.setState({ selectedObjectId: null, placementStatus: null });
      return;
    }
    const definition = this.registry.get(objectId);
    if (!definition) {
      console.warn(`[actions] Unknown construction object: ${objectId}`);
      return;
    }
    const { unlocks } = this.store.getState();
    if (!unlocks.objectIds.includes(objectId)) {
      console.warn(`[actions] Object is locked: ${objectId}`);
      return;
    }
    this.store.setState({ selectedObjectId: objectId, selectedInstanceId: null });
  }

  /** Leave placement mode without placing. */
  cancelPlacement(): void {
    if (this.store.getState().selectedObjectId !== null) {
      this.store.setState({ selectedObjectId: null, placementStatus: null });
    }
  }

  /**
   * Publish where the pending placement would land. Called by the
   * construction controller; only writes when something actually changed so
   * the store is not notified every frame.
   */
  setPlacementStatus(status: PlacementStatus | null): void {
    if (placementStatusEquals(this.store.getState().placementStatus, status)) return;
    this.store.setState({ placementStatus: status });
  }

  /** Rotate the pending placement by one step (quarter turn). */
  rotatePlacement(direction: 1 | -1 = 1): void {
    const { placementRotationStep } = this.store.getState();
    const next = (placementRotationStep + direction + PLACEMENT_ROTATION_STEPS) % PLACEMENT_ROTATION_STEPS;
    this.store.setState({ placementRotationStep: next });
  }

  /** Current pending rotation in radians, derived from the rotation step. */
  getPlacementRotation(): number {
    return this.store.getState().placementRotationStep * PLACEMENT_ROTATION_STEP;
  }

  /**
   * Place the currently selected definition at a world position (bottom-centre).
   * Returns the new instance, or null if placement was not allowed.
   *
   * Support rules, build area and overlap are re-checked here even though the
   * preview already checked them: state must never accept an invalid build,
   * whoever calls this. The definition stays selected so the player can keep placing.
   */
  placeObject(position: Vec3, options: PlaceOptions = {}): PlacedObject | null {
    const state = this.store.getState();
    if (state.mode !== 'playing' || state.selectedObjectId === null) return null;

    const definition = this.registry.get(state.selectedObjectId);
    if (!definition) {
      console.warn(`[actions] Cannot place unknown object: ${state.selectedObjectId}`);
      return null;
    }
    if (!state.unlocks.objectIds.includes(definition.id)) {
      console.warn(`[actions] Cannot place locked object: ${definition.id}`);
      return null;
    }

    const supportId = options.supportId ?? null;
    const support = supportId ? state.placedObjects.find((p) => p.id === supportId) ?? null : null;
    const supportDefinition = support ? this.registry.get(support.definitionId) ?? null : null;
    const surface: PlacementSurface = options.surface ?? (support ? 'top' : 'ground');
    const rotationY = options.rotationY ?? this.getPlacementRotation();

    const ruleHint =
      checkSupportRules(definition, surface, supportDefinition) ??
      checkTargetSupport(definition, surface, supportDefinition, this.registry, this.placementRules);
    if (ruleHint) {
      console.warn(`[actions] Placement rejected (${ruleHint}) for ${definition.id}`);
      return null;
    }

    let hostId: string | null = null;
    if (roleOf(definition) === 'opening') {
      const host = options.hostId ? state.placedObjects.find((p) => p.id === options.hostId) ?? null : null;
      const hostDefinition = host ? this.registry.get(host.definitionId) ?? null : null;
      if (!host || !hostDefinition || roleOf(hostDefinition) !== 'wall') {
        console.warn(`[actions] Placement rejected (opening needs a host wall) for ${definition.id}`);
        return null;
      }
      hostId = host.id;
    }

    const bounds = computeBounds(definition, position, rotationY, { x: 1, y: 1, z: 1 });
    const reason = findInvalidReason(bounds, state.placedObjects, this.registry, this.placementRules, hostId ? [hostId] : []);
    if (reason !== null) {
      console.warn(`[actions] Placement rejected (${reason}) for ${definition.id}`);
      return null;
    }

    const placed = createPlacedObject(definition, position, rotationY, {
      supportId: support ? support.id : null,
      hostId,
    });
    this.store.setState({ placedObjects: [...state.placedObjects, placed] });
    return placed;
  }

  // -------------------------------------------------------------- selection

  /**
   * Select a placed object by instance id, or `null` to clear.
   * Selecting an instance leaves placement mode.
   */
  selectPlacedObject(instanceId: string | null): void {
    const state = this.store.getState();
    if (instanceId === null) {
      if (state.selectedInstanceId !== null) this.store.setState({ selectedInstanceId: null });
      return;
    }
    if (!state.placedObjects.some((p) => p.id === instanceId)) {
      console.warn(`[actions] Unknown placed object: ${instanceId}`);
      return;
    }
    this.store.setState({ selectedInstanceId: instanceId, selectedObjectId: null, placementStatus: null });
  }

  /**
   * Remove a placed object.
   * - Openings set into it (doors, windows) are removed with it: an opening
   *   without a wall makes no sense.
   * - Objects that rested on it stay where they are (floating structures are
   *   allowed for now) but lose their support reference so nothing dangles.
   */
  removePlacedObject(instanceId: string): boolean {
    const state = this.store.getState();
    if (!state.placedObjects.some((p) => p.id === instanceId)) {
      console.warn(`[actions] Cannot remove unknown placed object: ${instanceId}`);
      return false;
    }
    const removedIds = new Set<string>([instanceId]);
    for (const p of state.placedObjects) {
      if (p.hostId === instanceId) removedIds.add(p.id);
    }
    const remaining = state.placedObjects
      .filter((p) => !removedIds.has(p.id))
      .map((p) => (p.supportId && removedIds.has(p.supportId) ? { ...p, supportId: null } : p));
    this.store.setState({
      placedObjects: remaining,
      selectedInstanceId:
        state.selectedInstanceId && removedIds.has(state.selectedInstanceId) ? null : state.selectedInstanceId,
    });
    return true;
  }

  /** Remove whichever placed object is selected. No-op if none. */
  removeSelectedPlacedObject(): boolean {
    const { selectedInstanceId } = this.store.getState();
    if (selectedInstanceId === null) return false;
    return this.removePlacedObject(selectedInstanceId);
  }
}
