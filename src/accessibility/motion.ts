/**
 * Reduced motion: one place that decides whether the app should move less.
 *
 * The child (or a grown-up) can choose "Follow my device" (the default: the
 * operating system's "reduce motion" setting), "Reduce motion" or "Full
 * motion" on the Home screen. When motion is reduced:
 * - camera moves jump instead of gliding, and the Home screen stops turning;
 * - the startup animation is skipped;
 * - CSS animations and transitions are switched off (`data-motion="reduce"`
 *   on <html>, see styles.css);
 * - RealWorld Explorer's force arrows and wind streaks stand still and the
 *   wind lesson's sway becomes a still lean. Every number, label and arrow
 *   direction stays, so nothing a lesson explains is lost.
 *
 * The choice is stored on this device only (`city-builder.motion`, removed
 * by "Delete everything on this device"). Works headlessly: without a
 * window there is no storage and no system preference.
 */

export type MotionSetting = 'system' | 'reduce' | 'full';

export const MOTION_SETTINGS: readonly MotionSetting[] = ['system', 'reduce', 'full'];
export const MOTION_STORAGE_KEY = 'city-builder.motion';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** The bits of a media query list this needs (old Safari only has addListener). */
interface MotionQuery {
  matches: boolean;
  addEventListener?(type: 'change', listener: () => void): void;
  addListener?(listener: () => void): void;
}

export interface MotionEnvironment {
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  matchMedia?: ((query: string) => MotionQuery) | null;
}

function browserEnvironment(): MotionEnvironment {
  if (typeof window === 'undefined') return {};
  let storage: MotionEnvironment['storage'] = null;
  try {
    storage = window.localStorage ?? null;
  } catch {
    storage = null;
  }
  const matchMedia = typeof window.matchMedia === 'function' ? (query: string) => window.matchMedia(query) : null;
  return { storage, matchMedia };
}

function isSetting(value: unknown): value is MotionSetting {
  return typeof value === 'string' && (MOTION_SETTINGS as readonly string[]).includes(value);
}

export class MotionPreference {
  private choice: MotionSetting = 'system';
  private systemReduces = false;
  private readonly listeners = new Set<(reduced: boolean) => void>();

  constructor(private readonly env: MotionEnvironment = browserEnvironment()) {
    try {
      const stored = env.storage?.getItem(MOTION_STORAGE_KEY);
      if (isSetting(stored)) this.choice = stored;
    } catch {
      // Storage blocked: follow the device.
    }
    try {
      const query = env.matchMedia?.(REDUCED_MOTION_QUERY);
      if (query) {
        this.systemReduces = Boolean(query.matches);
        const changed = () => this.setSystemReduces(Boolean(query.matches));
        if (typeof query.addEventListener === 'function') query.addEventListener('change', changed);
        else query.addListener?.(changed);
      }
    } catch {
      this.systemReduces = false;
    }
  }

  /** What was chosen: follow the device, or always reduce, or always full. */
  get setting(): MotionSetting {
    return this.choice;
  }

  /** Whether the operating system asks for reduced motion. */
  get systemPrefersReduced(): boolean {
    return this.systemReduces;
  }

  /** Whether the app should move less right now. */
  get reduced(): boolean {
    return this.choice === 'reduce' || (this.choice === 'system' && this.systemReduces);
  }

  /** Change the choice; stored on this device ('system' removes the stored value). */
  set(setting: MotionSetting): void {
    if (!isSetting(setting)) return;
    const before = this.reduced;
    this.choice = setting;
    try {
      if (setting === 'system') this.env.storage?.removeItem(MOTION_STORAGE_KEY);
      else this.env.storage?.setItem(MOTION_STORAGE_KEY, setting);
    } catch {
      // Not stored (storage blocked); the choice still applies until the page is closed.
    }
    if (this.reduced !== before) this.notify();
  }

  /** Seconds for a nonessential animation: none at all when motion is reduced. */
  duration(seconds: number): number {
    return this.reduced ? 0 : seconds;
  }

  /** Called with the new value whenever `reduced` changes. */
  onChange(listener: (reduced: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** For the system setting changing while the app runs (and for tests). */
  setSystemReduces(reduces: boolean): void {
    const before = this.reduced;
    this.systemReduces = reduces;
    if (this.reduced !== before) this.notify();
  }

  private notify(): void {
    const reduced = this.reduced;
    this.listeners.forEach((listener) => listener(reduced));
  }
}

/** The app's preference (one per page). */
export const motion = new MotionPreference();

/**
 * Mirror the preference on <html data-motion="reduce|full"> so CSS can stop
 * animations; kept in sync when it changes. Returns an unsubscribe.
 */
export function applyMotionToDocument(preference: MotionPreference = motion, root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement): () => void {
  if (!root) return () => undefined;
  const apply = (reduced: boolean) => root.setAttribute('data-motion', reduced ? 'reduce' : 'full');
  apply(preference.reduced);
  return preference.onChange(apply);
}
