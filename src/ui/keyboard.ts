/**
 * Keyboard helpers shared by the screens. The decisions are plain functions
 * (no DOM), so what Escape does in each place is tested headlessly
 * (scripts/test-accessibility.mjs).
 */

/** What Escape does in RealWorld Explorer: one step back each time, like the Android back button. */
export type RealWorldBackStep = 'close-lesson' | 'close-part' | 'close-landmark' | 'leave-explorer';

export function realWorldBackStep(state: { lessonOpen: boolean; partOpen: boolean; landmarkOpen: boolean }): RealWorldBackStep {
  if (state.lessonOpen) return 'close-lesson';
  if (state.partOpen) return 'close-part';
  if (state.landmarkOpen) return 'close-landmark';
  return 'leave-explorer';
}

/**
 * What Escape does inside a house. It closes what is open, one thing at a
 * time; a selected piece of furniture is left to the builder's own Escape
 * (which deselects it). It never leaves the house: "Go outside" does that,
 * so pressing Escape a few times cannot throw the child out by surprise.
 */
export type InteriorBackStep = 'close-palette' | 'cancel-proposal' | 'leave-to-builder' | 'stop-tour' | 'nothing';

export function interiorBackStep(state: { paletteOpen: boolean; proposalPending: boolean; objectSelected: boolean; touring: boolean }): InteriorBackStep {
  if (state.paletteOpen) return 'close-palette';
  if (state.proposalPending) return 'cancel-proposal';
  if (state.objectSelected) return 'leave-to-builder';
  if (state.touring) return 'stop-tour';
  return 'nothing';
}

/** True when keys belong to a text box (or a select), so screen shortcuts must stand down. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes(type);
}

/** Moves keyboard focus to an element if it is still on the page; true when it worked. */
export function focusIfPresent(element: Element | null | undefined): boolean {
  if (!element || !(element as HTMLElement).isConnected || typeof (element as HTMLElement).focus !== 'function') return false;
  (element as HTMLElement).focus({ preventScroll: true });
  return document.activeElement === element;
}

/**
 * Focus to restore when the Home screen comes back (screens unmount when the
 * mode changes, so the button that left would otherwise drop focus to the
 * page): the mode card the child came from.
 */
let homeReturnSelector: string | null = null;

export function returnFocusTo(selector: string): void {
  homeReturnSelector = selector;
}

export function takeReturnFocus(): string | null {
  const selector = homeReturnSelector;
  homeReturnSelector = null;
  return selector;
}

/**
 * True when Escape belongs to the focused element (a text box clearing or
 * leaving its text). A closed drop-down has no use for Escape, so there it
 * stays the screen's "step back".
 */
export function blocksEscape(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  return target.tagName !== 'SELECT' && isTypingTarget(target);
}
