import type { GameStore } from '@/state/GameStore';
import type { GameActions } from '@/state/actions';
import type { GameState } from '@/state/GameState';
import type { PlacedObject } from '@/construction/PlacedObject';

const MAX_STEPS = 60;

/**
 * Undo / redo for My World.
 *
 * `placedObjects` is immutable data (every change produces a new array), so
 * history is simply a stack of earlier arrays - no command objects, no
 * second representation. Changes made in the same synchronous burst (a
 * template placing twenty pieces one by one) collapse into one step, so one
 * Undo removes the whole neighbourhood the child just created.
 *
 * Only free-build is recorded; the stacks are cleared whenever free-build
 * (re)starts, since a restored or freshly entered world has no past to
 * return to.
 */
export class HistoryService {
  private undoStack: PlacedObject[][] = [];
  private redoStack: PlacedObject[][] = [];
  private current: PlacedObject[] | null = null;
  private pendingBase: PlacedObject[] | null = null;
  private applying = false;
  private unsubscribe: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: GameStore,
    private readonly actions: GameActions,
  ) {}

  start(): void {
    this.unsubscribe = this.store.subscribe((state, previous) => this.onStateChanged(state, previous));
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.listeners.clear();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0 || this.pendingBase !== null;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Notified whenever canUndo/canRedo may have changed. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  undo(): void {
    this.flush();
    const previous = this.undoStack.pop();
    if (!previous || !this.current) return;
    this.redoStack.push(this.current);
    this.apply(previous);
  }

  redo(): void {
    this.flush();
    const next = this.redoStack.pop();
    if (!next || !this.current) return;
    this.undoStack.push(this.current);
    this.apply(next);
  }

  private apply(objects: PlacedObject[]): void {
    this.applying = true;
    this.actions.applyMyWorldSnapshot(objects);
    this.applying = false;
    this.current = objects;
    this.emit();
  }

  private isFreeBuild(state: GameState): boolean {
    return state.mode === 'playing' && state.challenge === null;
  }

  private onStateChanged(state: GameState, previous: GameState): void {
    if (!this.isFreeBuild(state)) {
      if (this.isFreeBuild(previous)) this.reset(null);
      return;
    }
    if (!this.isFreeBuild(previous)) {
      this.reset(state.placedObjects);
      return;
    }
    if (state.placedObjects === this.current) return;
    if (this.applying) {
      this.current = state.placedObjects;
      return;
    }
    if (this.pendingBase === null && this.current !== null) {
      this.pendingBase = this.current;
      queueMicrotask(() => this.flush());
    }
    this.current = state.placedObjects;
    this.redoStack = [];
  }

  private flush(): void {
    if (this.pendingBase === null) return;
    if (this.pendingBase !== this.current) {
      this.undoStack.push(this.pendingBase);
      if (this.undoStack.length > MAX_STEPS) this.undoStack.shift();
    }
    this.pendingBase = null;
    this.emit();
  }

  private reset(objects: PlacedObject[] | null): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pendingBase = null;
    this.current = objects;
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
