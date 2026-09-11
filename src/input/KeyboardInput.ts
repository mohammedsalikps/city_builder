import { EventEmitter } from '@/utils/EventEmitter';

export interface KeyPress {
  /** KeyboardEvent.code, e.g. "KeyR", "Delete", "Escape". */
  code: string;
  shift: boolean;
}

export interface KeyboardEvents extends Record<string, unknown> {
  keydown: KeyPress;
}

/**
 * Single window-level keyboard listener. Presses that originate in text
 * inputs are ignored so typing a name never triggers game commands.
 */
export class KeyboardInput extends EventEmitter<KeyboardEvents> {
  constructor() {
    super();
    window.addEventListener('keydown', this.onKeyDown);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.clear();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTextEntryTarget(event.target)) return;
    this.emit('keydown', { code: normalizeCode(event), shift: event.shiftKey });
  };
}

/**
 * Physical key code, with a fallback derived from `key` for environments
 * (virtual keyboards, automation) that dispatch events without `code`.
 */
function normalizeCode(event: KeyboardEvent): string {
  if (event.code) return event.code;
  const key = event.key;
  if (key.length === 1) {
    if (/[a-z]/i.test(key)) return `Key${key.toUpperCase()}`;
    if (/[0-9]/.test(key)) return `Digit${key}`;
  }
  return key;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
