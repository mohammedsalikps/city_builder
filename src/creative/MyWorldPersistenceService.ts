import type { GameStore } from '@/state/GameStore';
import type { GameActions } from '@/state/actions';
import type { GameState } from '@/state/GameState';
import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import type { MyWorldStorage } from '@/state/MyWorldStorage';

/**
 * Keeps My World's build durable across reloads, using the same
 * store-subscription + storage-interface pattern as `ProgressionService`
 * (see `src/progression/ProgressionService.ts`) - the existing save
 * architecture, applied to a second, unrelated slice of state.
 *
 * `placedObjects` is the one field Challenge Mode and My World share: a
 * challenge starting or ending overwrites it with the level's own build.
 * So this doesn't just save on reload - it also restores the sandbox the
 * moment the player returns to free-build after a challenge, since that
 * transition briefly wipes the field out from under it.
 */
export class MyWorldPersistenceService {
  private unsubscribe: (() => void) | null = null;
  private lastSavedPlacedObjects: GameState['placedObjects'] | null = null;
  private lastSavedIdentity: GameState['myWorld'] | null = null;

  constructor(
    private readonly store: GameStore,
    private readonly actions: GameActions,
    private readonly storage: MyWorldStorage,
    private readonly registry: ObjectRegistry,
  ) {}

  start(): void {
    this.unsubscribe = this.store.subscribe((state, previous) => this.onStateChanged(state, previous));
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private isFreeBuild(state: GameState): boolean {
    return state.mode === 'playing' && state.challenge === null;
  }

  private onStateChanged(state: GameState, previous: GameState): void {
    // Restore the saved build the instant free-build starts - a fresh
    // session, or returning from a challenge that overwrote placedObjects.
    if (this.isFreeBuild(state) && !this.isFreeBuild(previous)) {
      const saved = state.player ? this.storage.load() : null;
      if (saved && saved.player.id === state.player?.id) {
        // Drop anything whose definition no longer exists, rather than let
        // a stale save crash rendering/placement later.
        const restored = saved.placedObjects.filter((p) => this.registry.has(p.definitionId));
        this.lastSavedPlacedObjects = restored;
        this.lastSavedIdentity = state.myWorld;
        this.actions.restoreMyWorld(restored);
        return; // the resulting state change re-enters this handler below
      }
    }

    if (!this.isFreeBuild(state)) return;
    if (state.placedObjects === this.lastSavedPlacedObjects && state.myWorld === this.lastSavedIdentity) return;
    this.lastSavedPlacedObjects = state.placedObjects;
    this.lastSavedIdentity = state.myWorld;
    if (!state.player) return;
    this.storage.save({ player: state.player, placedObjects: state.placedObjects, identity: state.myWorld });
  }
}
