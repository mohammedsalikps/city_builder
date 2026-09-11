import type { GameState } from '@/state/GameState';
import type { GameActions } from '@/state/actions';
import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import type { ChallengeRegistry } from '@/challenges/ChallengeRegistry';

export interface ScreenContext {
  actions: GameActions;
  /** Read-only access to construction definitions for data-driven UI. */
  registry: ObjectRegistry;
  /** Read-only access to challenge levels for data-driven UI. */
  challenges: ChallengeRegistry;
}

/**
 * Base class for every UI screen (main menu, HUD, settings...).
 *
 * Lifecycle:
 *  - `mount(parent)` creates DOM once and attaches it.
 *  - `update(state)` is called on every state change while mounted.
 *  - `unmount()` removes DOM and cleans up listeners.
 */
export abstract class Screen {
  protected root: HTMLElement | null = null;
  protected readonly context: ScreenContext;

  constructor(context: ScreenContext) {
    this.context = context;
  }

  abstract readonly id: string;

  mount(parent: HTMLElement, state: GameState): void {
    if (this.root) return;
    this.root = this.build();
    this.root.dataset.screen = this.id;
    parent.appendChild(this.root);
    this.update(state);
  }

  unmount(): void {
    if (!this.root) return;
    this.onUnmount();
    this.root.remove();
    this.root = null;
  }

  get isMounted(): boolean {
    return this.root !== null;
  }

  /** Create the screen's DOM. Called once per mount. */
  protected abstract build(): HTMLElement;

  /** Sync DOM with the latest state. */
  abstract update(state: GameState): void;

  /** Override to remove event listeners created in `build`. */
  protected onUnmount(): void {}
}

/** Small DOM helper to keep screen code readable. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
