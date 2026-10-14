import type { GameState } from './GameState';

export type StateListener = (state: GameState, previous: GameState) => void;
export type StateUpdater = Partial<GameState> | ((state: GameState) => Partial<GameState>);

/**
 * Central, observable game state container.
 *
 * - `getState()` returns the current immutable snapshot.
 * - `setState()` merges a partial update (or updater function) and notifies subscribers.
 * - `subscribe()` registers a listener; returns an unsubscribe function.
 * - `batch()` runs several updates and notifies subscribers once, at the end.
 *
 * State objects are treated as immutable: always produce new objects, never mutate.
 */
export class GameStore {
  private state: GameState;
  private listeners = new Set<StateListener>();
  private batchDepth = 0;
  /** The state before the first update of the batch in progress (null when nothing changed yet). */
  private batchStart: GameState | null = null;

  constructor(initialState: GameState) {
    this.state = initialState;
  }

  getState(): GameState {
    return this.state;
  }

  setState(update: StateUpdater): void {
    const patch = typeof update === 'function' ? update(this.state) : update;
    if (!patch || Object.keys(patch).length === 0) return;

    const previous = this.state;
    this.state = { ...previous, ...patch };
    if (this.batchDepth > 0) {
      this.batchStart ??= previous;
      return;
    }
    this.listeners.forEach((listener) => listener(this.state, previous));
  }

  /**
   * Run `work` with subscriber notifications held back, then notify once
   * with the state before and after the whole batch. Every update inside
   * still sees the latest state through `getState()`, so validation that
   * builds on earlier updates (a door needs its wall) is unchanged - only
   * the listeners (renderer, autosave, history, UI) skip the steps between.
   * Used when one action makes hundreds of updates, like building a
   * neighbourhood piece by piece.
   */
  batch<T>(work: () => T): T {
    this.batchDepth++;
    try {
      return work();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.batchStart) {
        const previous = this.batchStart;
        this.batchStart = null;
        this.listeners.forEach((listener) => listener(this.state, previous));
      }
    }
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Replace the whole state (used for loading a save in the future). */
  replaceState(state: GameState): void {
    const previous = this.state;
    this.state = state;
    if (this.batchDepth > 0) {
      this.batchStart ??= previous;
      return;
    }
    this.listeners.forEach((listener) => listener(this.state, previous));
  }
}
