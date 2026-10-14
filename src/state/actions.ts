import type { GameStore } from './GameStore';
import { DEFAULT_WORLD_NAME, isObjectUnlocked, type GameState, type InteriorView, type TemplatePlacementState } from './GameState';
import { createInitialState } from './initialState';
import { createPlayer } from '@/player/Player';
import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import { roleOf, type ConstructionObjectDefinition } from '@/construction/ConstructionObjectDefinition';
import { createPlacedObject, type CreationGroupRef, type PlacedObject, type Vec3 } from '@/construction/PlacedObject';
import { createId } from '@/utils/id';
import { PLACEMENT_ROTATION_STEP, PLACEMENT_ROTATION_STEPS } from '@/construction/constants';
import { boundsOfPlaced, computeBounds, roundCoord } from '@/construction/bounds';
import { rotateAroundY } from '@/utils/math';
import {
  checkSupportRules,
  checkTargetSupport,
  findInvalidReason,
  objectsNear,
  placementStatusEquals,
  PlacementResolver,
  unionBounds,
  type PlacementCandidate,
  type PlacementRulesContext,
  type PlacementStatus,
  type PlacementSurface,
} from '@/construction/PlacementResolver';
import { transformCapabilitiesOf, TRANSFORM_MODES, type TransformMode } from '@/construction/TransformCapabilities';
import type { ChallengeRegistry } from '@/challenges/ChallengeRegistry';
import type { ChallengeMatchResult } from '@/challenges/ChallengeMatcher';
import type { ChallengeStatus } from '@/challenges/Challenge';
import { createInitialProgress, type StarRating } from '@/progression/Progression';
import { getLevelStatus, lockedMessage, nextChallenge } from '@/progression/levelState';
import type { TemplateObjectSpec } from '@/creative/Template';

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** See `GameActions.instantiateTemplate`. */
export interface TemplateInstantiateOptions {
  /** Objects of an earlier version of this creation, removed first (same step). */
  replace?: string[];
  /** Objects kept from the earlier version, moved rigidly from its placement to the new one. */
  carry?: { ids: string[]; from: { origin: Vec3; rotationY: number } };
}

export interface TemplateInstantiateResult {
  placed: number;
  skipped: number;
  ids: string[];
  groupId: string | null;
  /** The placed object made from each template entry (same index), or null when it was skipped. */
  byIndex: Array<string | null>;
}

/** How a placement was resolved; the action re-validates against it. */
export interface PlaceOptions {
  supportId?: string | null;
  /** Wall an opening is set into. Overlap with the host is expected and allowed. */
  hostId?: string | null;
  /** Explicit yaw; defaults to the pending placement rotation. */
  rotationY?: number;
  /** Surface used; defaults to 'top' when a support is given, else 'ground'. */
  surface?: PlacementSurface;
  /** Creation Group the new object joins. */
  group?: CreationGroupRef;
  /** Size multiplier per axis (template pieces fitted to a creation); defaults to 1. */
  scale?: Vec3;
}

/**
 * What one creation's pieces are checked against while it is built: the
 * objects already standing within its footprint plus its own pieces so far
 * (see `placeTemplatePieces`), with the pieces by id for supports and hosts.
 */
interface PlacementScope {
  others: PlacedObject[];
  byId: Map<string, PlacedObject>;
}

/**
 * The only sanctioned ways to change game state. UI and systems call these
 * instead of calling `store.setState` directly, so every transition is
 * named, discoverable and testable.
 */
export class GameActions {
  /** Stateless; reused to re-validate moves/rotations of already-placed objects. */
  private readonly resolver: PlacementResolver;

  constructor(
    private readonly store: GameStore,
    private readonly registry: ObjectRegistry,
    private readonly challenges: ChallengeRegistry,
    private readonly placementRules: PlacementRulesContext,
  ) {
    this.resolver = new PlacementResolver(registry, placementRules);
  }

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
      transformMode: 'move',
      placementStatus: null,
      interior: null,
    });
  }

  /** Re-enter the existing session from the menu. No-op if no session exists. */
  continueGame(): void {
    const { player, mode } = this.store.getState();
    if (player === null || mode !== 'menu') return;
    this.store.setState({ mode: 'playing' });
  }

  /**
   * The My World card's action: resume the player's saved sandbox if one
   * exists (a returning player, whether from earlier this session or from
   * before a reload - see MyWorldPersistenceService), or start a brand new
   * one. Always lands in free-build, regardless of what the player was
   * doing before (including a challenge merely paused via `returnToMenu`,
   * which leaves `challenge` set) - My World must never carry Challenge
   * Mode session state into it.
   */
  enterMyWorld(playerName = 'Builder'): void {
    const state = this.store.getState();
    if (state.player === null) {
      this.startNewGame(playerName);
      return;
    }
    this.store.setState({
      mode: 'playing',
      challenge: null,
      challengeMatch: null,
      challengeResult: null,
      world: { id: 'sandbox', name: 'Sandbox' },
      level: { id: 'sandbox', index: 0 },
      selectedObjectId: null,
      selectedInstanceId: null,
      placementStatus: null,
      transformMode: 'move',
      templatePlacement: null,
      streetDrawing: false,
      creationFocus: null,
      interior: null,
    });
  }

  /**
   * Replace My World's build with a previously saved one. Called only by
   * MyWorldPersistenceService, right after free-build starts; never a
   * player-facing action. Clears transient selection/placement state along
   * with it - a restored world starts with nothing selected, exactly like a
   * fresh one.
   */
  restoreMyWorld(placedObjects: PlacedObject[]): void {
    // Tells the construction renderer the next batch of objects is a
    // restore, not a creation: they should just appear, with no settle,
    // particles or sound (see ConstructionRenderer).
    window.dispatchEvent(new CustomEvent('eavara:silent-sync'));
    this.store.setState({
      placedObjects,
      selectedObjectId: null,
      selectedInstanceId: null,
      placementStatus: null,
      transformMode: 'move',
      templatePlacement: null,
      streetDrawing: false,
      creationFocus: null,
      interior: null,
    });
  }

  // ------------------------------------------------------- template placement

  /**
   * Begin positioning a creative template (a Build Intent or a browsed
   * template) - see `TemplatePlacementController`, which drives the ghost
   * and turns this into real objects via `instantiateTemplate` once the
   * player confirms. Cancels any single-object placement/selection first;
   * the two never overlap.
   */
  startTemplatePlacement(
    templateId: string,
    options: Pick<TemplatePlacementState, 'label' | 'creationId' | 'origin' | 'revise'> & { rotationY?: number } = {},
  ): void {
    const state = this.store.getState();
    if (state.mode !== 'playing' || state.challenge !== null) return;
    this.store.setState({
      templatePlacement: {
        templateId,
        rotationY: options.rotationY ?? 0,
        label: options.label,
        creationId: options.creationId,
        ...(options.origin ? { origin: { ...options.origin } } : {}),
        ...(options.revise ? { revise: options.revise } : {}),
      },
      streetDrawing: false,
      selectedObjectId: null,
      selectedInstanceId: null,
      placementStatus: null,
      creationFocus: null,
    });
  }

  /** Turn the template being positioned by one quarter-turn. */
  rotateTemplatePlacement(direction: 1 | -1): void {
    const { templatePlacement } = this.store.getState();
    if (!templatePlacement) return;
    const steps = Math.round(templatePlacement.rotationY / PLACEMENT_ROTATION_STEP) + direction;
    const rotationY = (((steps % PLACEMENT_ROTATION_STEPS) + PLACEMENT_ROTATION_STEPS) % PLACEMENT_ROTATION_STEPS) * PLACEMENT_ROTATION_STEP;
    this.store.setState({ templatePlacement: { ...templatePlacement, rotationY } });
  }

  /** Move a pinned template preview (one started with an `origin`) to another spot. */
  moveTemplatePlacement(origin: Vec3): void {
    const { templatePlacement } = this.store.getState();
    if (!templatePlacement?.origin) return;
    this.store.setState({ templatePlacement: { ...templatePlacement, origin: { ...origin } } });
  }

  /** Leave template placement without building anything. */
  cancelTemplatePlacement(): void {
    if (this.store.getState().templatePlacement === null) return;
    this.store.setState({ templatePlacement: null });
  }

  // ------------------------------------------------------------ world studio

  /** Begin "Draw a Street": the next drag across the ground lays a road (see StreetDrawController). */
  startStreetDrawing(): void {
    const state = this.store.getState();
    if (state.mode !== 'playing' || state.challenge !== null) return;
    this.store.setState({
      streetDrawing: true,
      templatePlacement: null,
      selectedObjectId: null,
      selectedInstanceId: null,
      placementStatus: null,
      creationFocus: null,
    });
  }

  cancelStreetDrawing(): void {
    if (this.store.getState().streetDrawing) this.store.setState({ streetDrawing: false });
  }

  /**
   * Select what a creation just produced and remember it came from that
   * creation, so World Studio can offer its "Make it yours" actions.
   */
  focusCreation(creationId: string, instanceId: string, label?: string): void {
    const state = this.store.getState();
    if (!state.placedObjects.some((p) => p.id === instanceId)) return;
    this.selectPlacedObject(instanceId);
    this.store.setState({ creationFocus: { creationId, instanceId, label } });
  }

  /** The child's own name for My World. Blank names fall back to the default. */
  setWorldName(name: string): void {
    const trimmed = name.trim().slice(0, 32);
    const state = this.store.getState();
    const next = trimmed.length > 0 ? trimmed : DEFAULT_WORLD_NAME;
    if (next === state.myWorld.name) return;
    this.store.setState({ myWorld: { ...state.myWorld, name: next } });
  }

  /** The kind of place the child is building. Shapes suggestions only - never restricts anything. */
  setWorldStory(story: string | null): void {
    const state = this.store.getState();
    if (story === state.myWorld.story) return;
    this.store.setState({ myWorld: { ...state.myWorld, story } });
  }

  /**
   * Replace My World's objects with a snapshot (undo/redo - see
   * HistoryService). Selection is kept only if the selected object still
   * exists; the snapshot itself is ordinary placedObjects data.
   */
  applyMyWorldSnapshot(placedObjects: PlacedObject[]): void {
    const state = this.store.getState();
    if (state.challenge !== null) return;
    const keepSelection = state.selectedInstanceId !== null && placedObjects.some((p) => p.id === state.selectedInstanceId);
    // Undo/redo restores a prior snapshot; the objects it brings back have
    // already had their construction moment once and must not replay it.
    window.dispatchEvent(new CustomEvent('eavara:silent-sync'));
    this.store.setState({
      placedObjects,
      selectedInstanceId: keepSelection ? state.selectedInstanceId : null,
      creationFocus: keepSelection ? state.creationFocus : null,
    });
  }

  /**
   * Rest an object on top of another placed object, centred on it - e.g.
   * park a car on a driveway. Goes through the normal support and overlap
   * validation. My World only.
   */
  placeOnTop(definitionId: string, supportId: string, rotationY: number): PlacedObject | null {
    const state = this.store.getState();
    if (state.mode !== 'playing' || state.challenge !== null) return null;
    const definition = this.registry.get(definitionId);
    const support = state.placedObjects.find((p) => p.id === supportId);
    const supportDefinition = support ? this.registry.get(support.definitionId) : undefined;
    if (!definition || !support || !supportDefinition) return null;
    const position: Vec3 = {
      x: support.position.x,
      y: support.position.y + supportDefinition.dimensions.height * support.scale.y,
      z: support.position.z,
    };
    return this.placeDefinition(definition, position, { supportId, surface: 'top', rotationY }, true);
  }

  /**
   * Place one object somewhere free near `anchor` - the "Make it yours"
   * shortcuts (add a tree beside a house, a car in front of it...). Tries
   * the preferred offsets first (relative to `anchorRotationY`), then an
   * outward ring, each through the normal placement validation. Returns the
   * new object, or null if nothing nearby was free. My World only.
   */
  placeNearby(
    definitionId: string,
    anchor: Vec3,
    options: {
      anchorRotationY?: number;
      offsets?: Array<{ x: number; z: number }>;
      rotationY?: number;
      /** Closest ring to try, e.g. just outside the anchor's own footprint. */
      minRadius?: number;
    } = {},
  ): PlacedObject | null {
    const state = this.store.getState();
    if (state.mode !== 'playing' || state.challenge !== null) return null;
    const definition = this.registry.get(definitionId);
    if (!definition) return null;
    const turn = options.anchorRotationY ?? 0;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const candidates: Array<{ x: number; z: number }> = [...(options.offsets ?? [])];
    const base = Math.max(1.2, options.minRadius ?? 3);
    for (const step of [0, 1, 2, 3.5, 5, 7]) {
      const radius = base + step;
      const slots = Math.max(8, Math.round(radius * 3));
      for (let i = 0; i < slots; i++) {
        // Front first (+z local), then fan out to the sides and the back.
        const angle = Math.PI / 2 + (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * ((Math.PI * 2) / slots);
        candidates.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
      }
    }
    const rotationY = (options.rotationY ?? 0) + turn;
    for (const offset of candidates) {
      const position: Vec3 = {
        x: roundTo(anchor.x + offset.x * cos - offset.z * sin, 0.05),
        y: 0,
        z: roundTo(anchor.z + offset.x * sin + offset.z * cos, 0.05),
      };
      const placed = this.placeDefinition(definition, position, { rotationY }, true);
      if (placed) return placed;
    }
    return null;
  }

  returnToMenu(): void {
    this.store.setState({
      mode: 'menu',
      selectedObjectId: null,
      selectedInstanceId: null,
      placementStatus: null,
      templatePlacement: null,
      streetDrawing: false,
      creationFocus: null,
      interior: null,
      realWorld: { landmarkId: null },
    });
  }

  // ------------------------------------------------------------ interior

  /**
   * Go inside a planned house (Interior Explorer). My World only, never
   * during a placement flow. The house itself does not change: this is a
   * view of the same placed objects, and edits made inside use the ordinary
   * actions (undoable, saved with My World).
   */
  enterInterior(groupId: string, houseIndex: number | null, view: InteriorView = 'walk'): boolean {
    const state = this.store.getState();
    if (state.mode !== 'playing' || state.challenge !== null || state.templatePlacement !== null || state.streetDrawing) return false;
    if (!state.placedObjects.some((p) => p.group?.id === groupId)) return false;
    this.store.setState({
      interior: { groupId, houseIndex, view, roomId: null, touring: false },
      selectedObjectId: null,
      // The piece tapped outside (often the roof) is not part of the visit: its card must not cover the interior.
      selectedInstanceId: null,
      creationFocus: null,
      placementStatus: null,
    });
    return true;
  }

  /** Back outside: the camera returns to the world view (see Game). */
  exitInterior(): void {
    if (this.store.getState().interior === null) return;
    this.store.setState({ interior: null, selectedObjectId: null, selectedInstanceId: null, creationFocus: null, placementStatus: null });
  }

  setInteriorView(view: InteriorView): void {
    const interior = this.store.getState().interior;
    if (!interior || interior.view === view) return;
    this.store.setState({ interior: { ...interior, view, touring: false } });
  }

  /** Record which room the walker is in (or was sent to). */
  setInteriorRoom(roomId: string | null): void {
    const interior = this.store.getState().interior;
    if (!interior || interior.roomId === roomId) return;
    this.store.setState({ interior: { ...interior, roomId } });
  }

  setInteriorTouring(touring: boolean): void {
    const interior = this.store.getState().interior;
    if (!interior || interior.touring === touring) return;
    this.store.setState({ interior: { ...interior, touring } });
  }

  // ------------------------------------------------------------ realworld

  /**
   * Open RealWorld Explorer (the landmark library). A mode of its own: My
   * World's build, undo history and autosave are untouched, and nothing in
   * placedObjects changes. Challenge state is cleared like enterMyWorld does.
   */
  enterRealWorld(): void {
    this.store.setState({
      mode: 'realworld',
      challenge: null,
      challengeMatch: null,
      challengeResult: null,
      selectedObjectId: null,
      selectedInstanceId: null,
      placementStatus: null,
      templatePlacement: null,
      streetDrawing: false,
      creationFocus: null,
      interior: null,
      realWorld: { landmarkId: null },
      menuNotice: null,
    });
  }

  /** Explore one landmark (null returns to the library). */
  openLandmark(landmarkId: string | null): void {
    const state = this.store.getState();
    if (state.mode !== 'realworld' || state.realWorld.landmarkId === landmarkId) return;
    this.store.setState({ realWorld: { landmarkId } });
  }

  /** Leave RealWorld Explorer for the main menu. */
  exitRealWorld(): void {
    if (this.store.getState().mode !== 'realworld') return;
    this.store.setState({ mode: 'menu', realWorld: { landmarkId: null } });
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
      transformMode: 'move',
      placementStatus: null,
      templatePlacement: null,
      streetDrawing: false,
      creationFocus: null,
      interior: null,
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
      transformMode: 'move',
      placementStatus: null,
      templatePlacement: null,
      streetDrawing: false,
      creationFocus: null,
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
      transformMode: 'move',
      placementStatus: null,
      templatePlacement: null,
      streetDrawing: false,
      creationFocus: null,
      interior: null,
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

  /**
   * Start over as if EAVARA had never been opened on this device: no
   * builder, no world, no progress - back on the home screen. The in-memory
   * half of deleting everything (see src/state/DeviceData.ts, which also
   * clears the services' memory and the stored copies).
   */
  eraseEverything(): void {
    this.store.replaceState({ ...createInitialState(), mode: 'menu' });
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
    const state = this.store.getState();
    if (!isObjectUnlocked(state, objectId)) {
      console.warn(`[actions] Object is locked: ${objectId}`);
      return;
    }
    this.store.setState({
      selectedObjectId: objectId,
      selectedInstanceId: null,
      templatePlacement: null,
      streetDrawing: false,
      creationFocus: null,
    });
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
    return this.placeDefinition(definition, position, { ...options, ...this.houseGroupFor(state, options) });
  }

  /**
   * My World: furniture put on a planned house's floor (or on furniture
   * inside it) joins that house's creation group, so it moves and is kept
   * with the house when the house is changed later, and edits inside one
   * house can never be mistaken for another's. Challenge Mode and pieces
   * placed on the ground are unaffected.
   */
  private houseGroupFor(state: GameState, options: PlaceOptions): Pick<PlaceOptions, 'group'> {
    if (state.challenge !== null || options.group || !options.supportId) return {};
    const support = state.placedObjects.find((p) => p.id === options.supportId);
    const group = support?.group;
    if (!group || (group.creation !== 'house' && group.creation !== 'neighborhood')) return {};
    return { group: { ...group } };
  }

  /**
   * Place a catalogue object at an exact spot - furniture added to a room in
   * Interior Explorer (by the palette or the AI builder, after the child
   * confirmed it). My World only. Goes through the same validation as any
   * placement (support rules, build area, overlaps); returns null when the
   * spot is not allowed, so callers can say so honestly.
   */
  placeAt(definitionId: string, position: Vec3, rotationY: number, options: { supportId?: string | null; group?: CreationGroupRef } = {}): PlacedObject | null {
    const state = this.store.getState();
    if (state.mode !== 'playing' || state.challenge !== null) return null;
    const definition = this.registry.get(definitionId);
    if (!definition) return null;
    const place: PlaceOptions = {
      rotationY,
      ...(options.supportId ? { supportId: options.supportId, surface: 'top' as const } : {}),
      ...(options.group ? { group: { ...options.group } } : {}),
    };
    return this.placeDefinition(definition, position, { ...place, ...this.houseGroupFor(state, place) });
  }

  /**
   * Instantiate a creative template (see `src/creative/Template.ts`): a
   * small, fixed arrangement of ordinary objects, placed and rotated as one
   * group around `origin`. Every piece goes through the exact same
   * validation a manual placement would - one that would overlap something
   * already there, or land outside the buildable area, is simply skipped,
   * never forced in. Pieces that reference another piece of the same
   * template (a door's host wall, a roof's support) are placed in
   * dependency order, in up to a few passes, exactly like the challenge
   * blueprint's own dependency-aware build order; a piece whose dependency
   * never got placed is skipped along with it. There is no separate
   * "template state": once placed, each object is a normal `placedObjects`
   * entry, selectable, movable, deletable like anything the player built by
   * hand. My World only - never available mid-challenge.
   *
   * `options.replace` makes this a new version of an earlier creation (a
   * planned house changed by a follow-up request): those objects are removed
   * first, and `options.carry` objects - pieces the child edited - are moved
   * rigidly from the old placement to the new one and join the new group.
   * All of it happens in one synchronous burst, so one Undo restores the
   * earlier version exactly.
   */
  instantiateTemplate(
    template: { objects: TemplateObjectSpec[] },
    origin: Vec3 = { x: 0, y: 0, z: 0 },
    groupRotationY = 0,
    creation?: string,
    options: TemplateInstantiateOptions = {},
  ): TemplateInstantiateResult {
    const state = this.store.getState();
    if (state.mode !== 'playing' || state.challenge !== null) {
      console.warn('[actions] Templates are only available in My World');
      return { placed: 0, skipped: template.objects.length, ids: [], groupId: null, byIndex: template.objects.map(() => null) };
    }
    const ids: string[] = [];
    const byIndex: Array<string | null> = template.objects.map(() => null);
    // Everything one creation places shares a Creation Group id.
    const group: CreationGroupRef | undefined = creation ? { id: createId('grp'), creation } : undefined;
    // Brackets this call for the construction celebration (see
    // ConstructionRenderer): the renderer needs to know up front that the
    // pieces below all belong to one live creation, and needs an explicit
    // "that's all of them" signal once they are in - it can't infer either
    // from the state alone without also mistaking a save/undo restore for one.
    if (group) window.dispatchEvent(new CustomEvent('eavara:creation-start', { detail: { groupId: group.id } }));
    // Each piece is placed and validated against the state as it stands
    // (so a door finds the wall placed just before it), but subscribers -
    // renderer, autosave, history, UI - hear about the whole creation once.
    const { placed, skipped } = this.store.batch(() => this.placeTemplatePieces(template, origin, groupRotationY, group, options, ids, byIndex));
    if (group) window.dispatchEvent(new CustomEvent('eavara:creation-end', { detail: { groupId: group.id, ids } }));
    return { placed, skipped, ids, groupId: group && placed > 0 ? group.id : null, byIndex };
  }

  /** The body of `instantiateTemplate`, run inside one store batch. */
  private placeTemplatePieces(
    template: { objects: TemplateObjectSpec[] },
    origin: Vec3,
    groupRotationY: number,
    group: CreationGroupRef | undefined,
    options: TemplateInstantiateOptions,
    ids: string[],
    byIndex: Array<string | null>,
  ): { placed: number; skipped: number } {
    if (options.replace?.length) this.removeObjects(new Set(options.replace));
    if (options.carry?.ids.length) this.carryObjects(options.carry.ids, options.carry.from, { origin, rotationY: groupRotationY }, group);
    const localIds = new Map<string, string>(); // spec.localId -> real placedObject id
    // Each piece is checked against what stands within the creation's own
    // footprint (and the pieces placed so far), not the whole world: the
    // same answers, without scanning thousands of far-away objects per piece.
    const worldPose = (spec: TemplateObjectSpec) => {
      const offset = rotateAroundY(spec.position.x, spec.position.z, groupRotationY);
      return {
        position: { x: roundCoord(origin.x + offset.x), y: roundCoord(origin.y + spec.position.y), z: roundCoord(origin.z + offset.z) },
        rotationY: (spec.rotationY ?? 0) + groupRotationY,
      };
    };
    const footprint = unionBounds(
      template.objects.flatMap((spec) => {
        const definition = this.registry.get(spec.definitionId);
        if (!definition) return [];
        const pose = worldPose(spec);
        return [computeBounds(definition, pose.position, pose.rotationY, spec.scale ?? { x: 1, y: 1, z: 1 })];
      }),
    );
    const scope: PlacementScope = {
      others: footprint ? objectsNear(footprint, this.store.getState().placedObjects, this.registry) : [],
      byId: new Map(),
    };

    let placed = 0;
    let skipped = 0;
    let pending = template.objects.map((_, index) => index);
    for (let pass = 0; pass < 4 && pending.length > 0; pass++) {
      const next: number[] = [];
      for (const index of pending) {
        const spec = template.objects[index];
        const dependsOn = spec.hostRef ?? spec.supportRef;
        if (dependsOn && !localIds.has(dependsOn)) {
          next.push(index); // its dependency hasn't been placed yet - try again next pass
          continue;
        }
        const definition = this.registry.get(spec.definitionId);
        if (!definition) {
          skipped++;
          continue;
        }
        // Same turn the placement ghost is drawn with (a three.js group rotation).
        const { position, rotationY } = worldPose(spec);
        const options: PlaceOptions = { rotationY, group, ...(spec.scale ? { scale: spec.scale } : {}) };
        if (dependsOn) {
          const refId = localIds.get(dependsOn);
          if (spec.hostRef) {
            options.hostId = refId;
            options.surface = spec.surface ?? 'side';
          } else {
            options.supportId = refId;
            options.surface = spec.surface ?? 'top';
          }
        }
        const result = this.placeDefinition(definition, position, options, true, scope);
        if (result) {
          placed++;
          ids.push(result.id);
          byIndex[index] = result.id;
          if (spec.localId) localIds.set(spec.localId, result.id);
        } else {
          skipped++;
        }
      }
      pending = next;
    }
    skipped += pending.length; // dependencies that never resolved
    return { placed, skipped };
  }

  /**
   * Remove several objects in one state update, with the same consequences
   * as `removePlacedObject`: openings set into a removed wall go too, and
   * anything resting on a removed object keeps its place but loses the link.
   */
  private removeObjects(ids: Set<string>): void {
    const state = this.store.getState();
    const removed = new Set(ids);
    for (const p of state.placedObjects) if (p.hostId && removed.has(p.hostId)) removed.add(p.id);
    const remaining = state.placedObjects
      .filter((p) => !removed.has(p.id))
      .map((p) => (p.supportId && removed.has(p.supportId) ? { ...p, supportId: null } : p));
    this.store.setState({
      placedObjects: remaining,
      selectedInstanceId: state.selectedInstanceId && removed.has(state.selectedInstanceId) ? null : state.selectedInstanceId,
      creationFocus: state.creationFocus && removed.has(state.creationFocus.instanceId) ? null : state.creationFocus,
    });
  }

  /**
   * Move objects rigidly from one creation placement to another (same offset
   * and turn relative to the creation's origin) and put them in `group`.
   * Each is checked like any move; one that would not fit at its new spot
   * stays where it was rather than being lost.
   */
  private carryObjects(
    ids: string[],
    from: { origin: Vec3; rotationY: number },
    to: { origin: Vec3; rotationY: number },
    group: CreationGroupRef | undefined,
  ): void {
    const state = this.store.getState();
    const carried = new Set(ids);
    const turn = to.rotationY - from.rotationY;
    // Carried in place (one house of a neighbourhood rebuilt, the rest kept): nothing moves, only the group changes.
    const still = turn === 0 && from.origin.x === to.origin.x && from.origin.z === to.origin.z;
    const others = still ? [] : state.placedObjects.filter((o) => !carried.has(o.id));
    const placedObjects = state.placedObjects.map((p) => {
      if (!carried.has(p.id)) return p;
      if (still) return group ? { ...p, group: { ...group } } : p;
      const definition = this.registry.get(p.definitionId);
      if (!definition) return p;
      const local = rotateAroundY(p.position.x - from.origin.x, p.position.z - from.origin.z, -from.rotationY);
      const offset = rotateAroundY(local.x, local.z, to.rotationY);
      const position = { x: roundCoord(to.origin.x + offset.x), y: p.position.y, z: roundCoord(to.origin.z + offset.z) };
      const rotationY = p.rotationY + turn;
      const bounds = computeBounds(definition, position, rotationY, p.scale);
      const fits = findInvalidReason(bounds, others, this.registry, this.placementRules) === null;
      const moved = fits ? { ...p, position, rotationY } : { ...p };
      return group ? { ...moved, group: { ...group } } : moved;
    });
    this.store.setState({ placedObjects });
  }

  /**
   * Core placement pipeline shared by `placeObject` (reads the toolbar's
   * current selection) and `instantiateTemplate` (places a known list of
   * definitions). Kept private: callers never bypass the unlock/rule/bounds
   * checks below, whichever entry point they came through.
   */
  private placeDefinition(
    definition: ConstructionObjectDefinition,
    position: Vec3,
    options: PlaceOptions,
    quiet = false,
    scope?: PlacementScope,
  ): PlacedObject | null {
    // Creative helpers probe many spots; a skipped probe is expected, not worth a warning.
    const warn = quiet ? () => {} : (message: string) => console.warn(message);
    const state = this.store.getState();
    if (state.mode !== 'playing') return null;
    if (!isObjectUnlocked(state, definition.id)) {
      console.warn(`[actions] Cannot place locked object: ${definition.id}`);
      return null;
    }

    const supportId = options.supportId ?? null;
    const lookup = (id: string) => scope?.byId.get(id) ?? state.placedObjects.find((p) => p.id === id) ?? null;
    const support = supportId ? lookup(supportId) : null;
    const supportDefinition = support ? this.registry.get(support.definitionId) ?? null : null;
    const surface: PlacementSurface = options.surface ?? (support ? 'top' : 'ground');
    const rotationY = options.rotationY ?? this.getPlacementRotation();

    const ruleHint =
      checkSupportRules(definition, surface, supportDefinition) ??
      checkTargetSupport(definition, surface, supportDefinition, this.registry, this.placementRules);
    if (ruleHint) {
      warn(`[actions] Placement rejected (${ruleHint}) for ${definition.id}`);
      return null;
    }

    let hostId: string | null = null;
    if (roleOf(definition) === 'opening') {
      const host = options.hostId ? lookup(options.hostId) : null;
      const hostDefinition = host ? this.registry.get(host.definitionId) ?? null : null;
      if (!host || !hostDefinition || roleOf(hostDefinition) !== 'wall') {
        warn(`[actions] Placement rejected (opening needs a host wall) for ${definition.id}`);
        return null;
      }
      hostId = host.id;
    }

    const scale = options.scale ?? { x: 1, y: 1, z: 1 };
    const bounds = computeBounds(definition, position, rotationY, scale);
    const reason = findInvalidReason(bounds, scope?.others ?? state.placedObjects, this.registry, this.placementRules, hostId ? [hostId] : []);
    if (reason !== null) {
      warn(`[actions] Placement rejected (${reason}) for ${definition.id}`);
      return null;
    }

    const placed = createPlacedObject(definition, position, rotationY, {
      supportId: support ? support.id : null,
      hostId,
      group: options.group,
    });
    if (options.scale) placed.scale = { ...options.scale };
    this.store.setState({ placedObjects: [...state.placedObjects, placed] });
    if (scope) {
      scope.others.push(placed);
      scope.byId.set(placed.id, placed);
    }
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
      if (state.selectedInstanceId !== null) this.store.setState({ selectedInstanceId: null, creationFocus: null });
      return;
    }
    if (!state.placedObjects.some((p) => p.id === instanceId)) {
      console.warn(`[actions] Unknown placed object: ${instanceId}`);
      return;
    }
    this.store.setState({
      selectedInstanceId: instanceId,
      selectedObjectId: null,
      transformMode: 'move',
      placementStatus: null,
      creationFocus: state.creationFocus?.instanceId === instanceId ? state.creationFocus : null,
    });
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

  /**
   * Place a second, independent copy of the selected object just beside it -
   * same definition, rotation and scale, resting on the same support if it
   * had one. Goes through the same move/snap/collision validation as
   * `moveSelectedPlacedObject`, so the copy can never land on top of the
   * original or break a role's rules (a wall still snaps to neighbours, a
   * floor still clears them). Doors/windows are skipped: a duplicate would
   * need a host wall of its own, which this simple nudge cannot supply.
   * If the spot beside it is taken, the other sides are tried, then a step
   * further out. Selects the new copy so the player can immediately move it
   * further. Returns the resulting status, or null if nothing could be
   * duplicated.
   */
  duplicateSelectedPlacedObject(): PlacementStatus | null {
    const state = this.store.getState();
    const selected = this.selectedPlacedObject(state);
    if (!selected) return null;
    const { placed, definition } = selected;
    if (roleOf(definition) === 'opening') return null;

    // Offset along one axis only, by the object's own full span (whichever
    // axis is larger, so a rotated footprint is still cleared) plus a gap -
    // guaranteed clear of the original regardless of role, since only walls
    // and floors get any further automatic push-apart from `resolveMove`.
    const span = Math.max(definition.dimensions.width, definition.dimensions.depth) * placed.scale.x;
    const nudge = span + 0.4;
    // A placed object that does not yet exist in `placedObjects`, so the
    // duplicate is validated against the original like any other neighbour
    // (including being pushed clear of it, for a role that does that).
    const proposal: PlacedObject = { ...placed, id: `${placed.id}:duplicate-preview` };
    // Beside it first; if that spot is taken, the other sides, then a step further out.
    const offsets = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [-1, 1], [1, -1], [-1, -1],
      [2, 0], [-2, 0], [0, 2], [0, -2],
    ];
    let candidate: PlacementCandidate | null = null;
    let firstStatus: PlacementStatus | null = null;
    for (const [dx, dz] of offsets) {
      const proposed = { x: placed.position.x + dx * nudge, z: placed.position.z + dz * nudge };
      const attempt = this.resolver.resolveMove(proposal, definition, proposed, placed.rotationY, state.placedObjects);
      if (!attempt) continue;
      firstStatus ??= attempt.status;
      if (attempt.status.valid) {
        candidate = attempt;
        break;
      }
    }
    if (!candidate) return firstStatus;

    const copy = createPlacedObject(definition, candidate.position, candidate.rotationY, {
      supportId: placed.supportId,
      hostId: null,
      // A copy of furniture inside a house belongs to that house too (My World only).
      ...(state.challenge === null && placed.group ? { group: { ...placed.group } } : {}),
    });
    copy.scale = { ...placed.scale };
    copy.materialOverrides = { ...placed.materialOverrides };
    this.store.setState({ placedObjects: [...state.placedObjects, copy], selectedInstanceId: copy.id });
    return candidate.status;
  }

  // -------------------------------------------------------------- transform

  /**
   * Switch the active gizmo/indicator for the current selection. Ignored
   * (with a warning) when nothing is selected or the selected object does
   * not support that mode, so the UI/keyboard never has to duplicate the
   * capability check.
   */
  setTransformMode(mode: TransformMode): void {
    if (!TRANSFORM_MODES.includes(mode)) return;
    const state = this.store.getState();
    if (state.transformMode === mode) return;
    const selected = this.selectedPlacedObject(state);
    if (!selected) return;
    const caps = transformCapabilitiesOf(selected.definition, this.playContext(state), this.hostsOpenings(state, selected.placed.id));
    const allowed = mode === 'move' ? caps.movable : mode === 'rotate' ? caps.rotatableY : caps.scalable;
    if (!allowed) {
      console.warn(`[actions] "${mode}" is not available for ${selected.definition.name}`);
      return;
    }
    this.store.setState({ transformMode: mode });
  }

  /**
   * Reposition the selected placed object (horizontal only - Y and any
   * role-specific snapping are re-resolved exactly like a fresh placement:
   * wall corners, floor clearance against neighbours, openings sliding along
   * their host wall). A wall carries any doors/windows set into it along by
   * the same offset. Returns the resulting status (so the caller can show
   * why a move was rejected); nothing is committed when it is invalid.
   */
  moveSelectedPlacedObject(x: number, z: number): PlacementStatus | null {
    const state = this.store.getState();
    const selected = this.selectedPlacedObject(state);
    if (!selected) return null;
    const { placed, definition } = selected;
    const caps = transformCapabilitiesOf(definition, this.playContext(state), this.hostsOpenings(state, placed.id));
    if (!caps.movable) return null;

    const base = state.challenge === null ? this.withFloorUnder(placed, definition, x, z, state.placedObjects) : placed;
    const candidate = this.resolver.resolveMove(base, definition, { x, z }, placed.rotationY, state.placedObjects);
    if (!candidate) return null;
    if (!candidate.status.valid) return candidate.status;

    const delta = { x: candidate.position.x - placed.position.x, z: candidate.position.z - placed.position.z };
    const carryOpenings = roleOf(definition) === 'wall';
    const placedObjects = state.placedObjects.map((p) => {
      if (p.id === placed.id) return { ...p, position: candidate.position, rotationY: candidate.rotationY, supportId: base.supportId };
      if (carryOpenings && p.hostId === placed.id) {
        return { ...p, position: { x: p.position.x + delta.x, y: p.position.y, z: p.position.z + delta.z } };
      }
      return p;
    });
    this.store.setState({ placedObjects });
    return candidate.status;
  }

  /**
   * My World: a piece standing on a floor (furniture in a house) whose
   * support link was lost - its floor tile was rebuilt when the house was
   * changed - would otherwise be moved as if it stood on the ground and
   * collide with the floor slab. It re-finds the floor under it (at the same
   * height) so it can be moved again. Anything else is returned unchanged.
   */
  private withFloorUnder(placed: PlacedObject, definition: ConstructionObjectDefinition, x: number, z: number, placedObjects: PlacedObject[]): PlacedObject {
    if (placed.supportId || placed.hostId || placed.position.y < 0.01 || roleOf(definition) !== null) return placed;
    for (const point of [{ x, z }, { x: placed.position.x, z: placed.position.z }]) {
      const floor = placedObjects.find((p) => {
        if (p.id === placed.id) return false;
        const floorDefinition = this.registry.get(p.definitionId);
        if (!floorDefinition || roleOf(floorDefinition) !== 'floor') return false;
        const b = boundsOfPlaced(floorDefinition, p);
        return point.x >= b.minX && point.x <= b.maxX && point.z >= b.minZ && point.z <= b.maxZ && Math.abs(b.maxY - placed.position.y) < 0.05;
      });
      if (floor) return { ...placed, supportId: floor.id };
    }
    return placed;
  }

  /**
   * Rotate the selected placed object to an absolute yaw (radians), snapped
   * to the nearest quarter turn - the same discrete steps every other
   * rotation in the game uses. Returns the resulting status; rejected
   * rotations are never committed.
   */
  rotateSelectedPlacedObject(rotationY: number): PlacementStatus | null {
    const state = this.store.getState();
    const selected = this.selectedPlacedObject(state);
    if (!selected) return null;
    const { placed, definition } = selected;
    const caps = transformCapabilitiesOf(definition, this.playContext(state), this.hostsOpenings(state, placed.id));
    if (!caps.rotatableY) return null;

    const step = Math.round(rotationY / PLACEMENT_ROTATION_STEP) % PLACEMENT_ROTATION_STEPS;
    const snapped = ((step + PLACEMENT_ROTATION_STEPS) % PLACEMENT_ROTATION_STEPS) * PLACEMENT_ROTATION_STEP;

    const candidate = this.resolver.resolveRotate(placed, definition, snapped, state.placedObjects);
    if (!candidate) return null;
    if (!candidate.status.valid) return candidate.status;

    const placedObjects = state.placedObjects.map((p) =>
      p.id === placed.id ? { ...p, position: candidate.position, rotationY: candidate.rotationY } : p,
    );
    this.store.setState({ placedObjects });
    return candidate.status;
  }

  /**
   * Step the selected placed object's uniform scale up or down within its
   * capability range. My World only: Challenge Mode's capabilities always
   * report `scalable: false`, so gameplay dimensions there stay authoritative.
   * Returns the resulting scale, or null if the step is not allowed/valid.
   */
  scaleSelectedPlacedObject(direction: 1 | -1): number | null {
    const state = this.store.getState();
    const selected = this.selectedPlacedObject(state);
    if (!selected) return null;
    const { placed, definition } = selected;
    const caps = transformCapabilitiesOf(definition, this.playContext(state), this.hostsOpenings(state, placed.id));
    if (!caps.scalable) return null;

    const next = Math.min(caps.maxScale, Math.max(caps.minScale, roundScale(placed.scale.x + direction * caps.scaleStep)));
    if (next === placed.scale.x) return next;

    const scale: Vec3 = { x: next, y: next, z: next };
    const bounds = computeBounds(definition, placed.position, placed.rotationY, scale);
    const reason = findInvalidReason(bounds, state.placedObjects, this.registry, this.placementRules, [placed.id]);
    if (reason !== null) return null;

    const placedObjects = state.placedObjects.map((p) => (p.id === placed.id ? { ...p, scale } : p));
    this.store.setState({ placedObjects });
    return next;
  }

  /**
   * Paint the selected object a colour (null restores its own colour). My
   * World only; colours must be '#rrggbb'. Returns false when nothing changed.
   */
  recolorSelectedPlacedObject(color: string | null): boolean {
    const state = this.store.getState();
    const selected = this.selectedPlacedObject(state);
    if (!selected) return false;
    return this.recolorPlacedObjects([selected.placed.id], color) > 0;
  }

  /**
   * Paint several objects at once ("make the kitchen cabinets white") in one
   * undo step. My World only; walls, floors, roofs and openings keep their
   * own look. Returns how many objects changed.
   */
  recolorPlacedObjects(ids: readonly string[], color: string | null): number {
    const state = this.store.getState();
    if (state.mode !== 'playing' || state.challenge !== null) return 0;
    if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(color)) return 0;
    const wanted = new Set(ids);
    let changed = 0;
    const placedObjects = state.placedObjects.map((p) => {
      if (!wanted.has(p.id)) return p;
      const definition = this.registry.get(p.definitionId);
      if (!definition || roleOf(definition) !== null) return p;
      const current = p.materialOverrides.color ?? null;
      const next = color === null ? null : color.toLowerCase();
      if (current === next) return p;
      changed++;
      const { color: _old, ...rest } = p.materialOverrides;
      return { ...p, materialOverrides: next === null ? rest : { ...rest, color: next } };
    });
    if (changed > 0) this.store.setState({ placedObjects });
    return changed;
  }

  private selectedPlacedObject(
    state: GameState,
  ): { placed: PlacedObject; definition: ConstructionObjectDefinition } | null {
    if (state.mode !== 'playing' || !state.selectedInstanceId) return null;
    const placed = state.placedObjects.find((p) => p.id === state.selectedInstanceId);
    if (!placed) return null;
    const definition = this.registry.get(placed.definitionId);
    if (!definition) return null;
    return { placed, definition };
  }

  private playContext(state: GameState): 'challenge' | 'freeplay' {
    return state.challenge ? 'challenge' : 'freeplay';
  }

  private hostsOpenings(state: GameState, instanceId: string): boolean {
    return state.placedObjects.some((p) => p.hostId === instanceId);
  }
}

/** Precision used for stored scale multipliers (0.001), removing float drift on repeated steps. */
function roundScale(value: number): number {
  return Math.round(value * 1000) / 1000;
}
