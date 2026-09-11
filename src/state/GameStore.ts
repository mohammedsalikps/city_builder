import type { GameState } from './GameState';

export type StateListener = (state: GameState, previous: GameState) => void;
export type StateUpdater = Partial<GameState> | ((state: GameState) => Partial<GameState>);

/**
 * Central, observable game state container.
 *
 * - `getState()` returns the current immutable snapshot.
 * - `setState()` merges a partial update (or updater function) and notifies subscribers.
 * - `subscribe()` registers a listener; returns an unsubscribe function.
 *
 * State objects are treated as immutable: always produce new objects, never mutate.
 */
export class GameStore {
  private state: GameState;
  private listeners = new Set<StateListener>();

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
    this.listeners.forEach((listener) => listener(this.state, previous));
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Replace the whole state (used for loading a save in the future). */
  replaceState(state: GameState): void {
    const previous = this.state;
    this.state = state;
    this.listeners.forEach((listener) => listener(this.state, previous));
  }
}
