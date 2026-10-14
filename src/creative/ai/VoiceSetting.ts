/**
 * "Talking to EAVARA" on this device: the microphone stays off until a
 * grown-up switches talking on from the Home screen, after a short
 * grown-up check (src/ui/grownUpCheck.ts). Off by default; switching it off
 * needs no check; "Delete everything on this device" removes it.
 *
 * This is a device setting, not consent. It does not find out who switched
 * it on, or whether they are the child's parent, and it is not the
 * verifiable parental consent that laws such as COPPA can require before a
 * child's voice is recorded (see docs/child-facing-release-checklist.md,
 * section 1). It only puts a grown-up's step in front of the server's own
 * switch (EAVARA_VOICE_ENABLED, read through /api/status), which still
 * decides: the microphone opens only when both are on (VoiceInput.start).
 *
 * Stored on this device only: `city-builder.voice` = "on"; absent means off.
 */
export const VOICE_SETTING_KEY = 'city-builder.voice';

type SettingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(): SettingStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage ?? null;
  } catch {
    return null;
  }
}

export class VoiceSetting {
  /** The choice made on this page, for when storage is blocked. */
  private choice = false;
  private readonly listeners = new Set<(allowed: boolean) => void>();

  constructor(private readonly storage: SettingStorage | null = browserStorage()) {
    this.choice = this.stored() ?? false;
  }

  /**
   * Whether a grown-up has switched talking on for this device. Read from
   * storage each time, so switching off in another tab, or deleting
   * everything, takes effect at once.
   */
  get allowed(): boolean {
    return this.stored() ?? this.choice;
  }

  set(allowed: boolean): void {
    const before = this.allowed;
    this.choice = allowed;
    try {
      if (allowed) this.storage?.setItem(VOICE_SETTING_KEY, 'on');
      else this.storage?.removeItem(VOICE_SETTING_KEY);
    } catch {
      // Not stored (storage blocked): the choice still applies until the page is closed.
    }
    if (this.allowed !== before) this.listeners.forEach((listener) => listener(this.allowed));
  }

  /** Called with the new value whenever `allowed` changes through `set`. */
  onChange(listener: (allowed: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The stored choice, or null when storage cannot be read. */
  private stored(): boolean | null {
    if (!this.storage) return null;
    try {
      return this.storage.getItem(VOICE_SETTING_KEY) === 'on';
    } catch {
      return null;
    }
  }
}

/** This device's setting (one per page). */
export const voiceSetting = new VoiceSetting();
