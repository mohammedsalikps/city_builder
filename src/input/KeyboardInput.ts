import { EventEmitter } from '@/utils/EventEmitter';

export interface KeyPress {
  /** KeyboardEvent.code, e.g. "KeyR", "Delete", "Escape". */
  code: string;
  shift: boolean;
}

export interface KeyboardEvents extends Record<string, unknown> {
  keydown: KeyPress;
  /** A key was let go (also sent for every held key when the window loses focus, the tab is hidden or Cmd/Meta comes up). */
  keyup: KeyPress;
}

/**
 * Single window-level keyboard listener. Presses that originate in text
 * inputs are ignored so typing a name never triggers game commands.
 *
 * Besides the press events it keeps the set of keys held down right now
 * (`isDown`), for continuous controls such as walking. Held keys are all
 * let go when the window loses focus, the tab is hidden or Cmd (Meta) comes
 * up, because the browser never reports some key-ups then and the walker
 * would otherwise keep walking on its own.
 */
export class KeyboardInput extends EventEmitter<KeyboardEvents> {
  private readonly held = new Set<string>();

  constructor() {
    super();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  /** Whether the key with this KeyboardEvent.code (e.g. "KeyW", "ArrowUp") is held down right now. */
  isDown(code: string): boolean {
    return this.held.has(code);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.held.clear();
    this.clear();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTextEntryTarget(event.target)) return;
    const code = normalizeCode(event);
    this.held.add(code);
    this.emit('keydown', { code, shift: event.shiftKey });
  };

  /**
   * Only keys whose press was announced are announced as released, so every
   * 'keyup' pairs with an earlier 'keydown': typing in a text box never adds
   * a held key, while a key held before the child tapped into a text box is
   * still let go (and announced) when it comes up there.
   */
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const code = normalizeCode(event);
    if (this.held.delete(code)) this.emit('keyup', { code, shift: event.shiftKey });
    // macOS sends no key-up for keys let go while Cmd is down (Cmd+A, Cmd+Q...): when Cmd comes up, let go of everything.
    if (META_CODES.has(code)) this.releaseAll();
  };

  private readonly onBlur = (): void => {
    this.releaseAll();
  };

  private readonly onVisibilityChange = (): void => {
    this.releaseAll();
  };

  /** Let go of every held key, announcing each release so listeners never see a key stuck down. */
  private releaseAll(): void {
    if (this.held.size === 0) return;
    const released = [...this.held];
    this.held.clear();
    for (const code of released) this.emit('keyup', { code, shift: false });
  }
}

/** The Cmd / Windows key, under every name browsers have used for it. */
const META_CODES = new Set(['MetaLeft', 'MetaRight', 'Meta', 'OSLeft', 'OSRight', 'OS']);

/** What Shift+0 .. Shift+9 type on a US keyboard, in digit order. */
const SHIFTED_DIGITS = ')!@#$%^&*(';

/**
 * Physical key code, with a fallback derived from `key` for environments
 * (virtual keyboards, automation) that dispatch events without `code`.
 * The fallback maps shifted digits back to their digit ('!' is Digit1), so
 * a key pressed without Shift and let go with it (or the other way round)
 * still comes up under the code it went down with.
 */
function normalizeCode(event: KeyboardEvent): string {
  if (event.code) return event.code;
  const key = event.key;
  if (key.length === 1) {
    if (/[a-z]/i.test(key)) return `Key${key.toUpperCase()}`;
    if (/[0-9]/.test(key)) return `Digit${key}`;
    const shiftedDigit = SHIFTED_DIGITS.indexOf(key);
    if (shiftedDigit >= 0) return `Digit${shiftedDigit}`;
  }
  return key;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  // `HTMLElement` is missing outside a browser (headless tests): nothing there is a text box.
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
