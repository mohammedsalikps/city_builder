/**
 * The entire audio system, on purpose: two tiny generated WebAudio blips
 * triggered by the construction feedback events (`eavara:placed`,
 * `eavara:creation-complete`). No assets, no mixer, no volume settings, no
 * music - just enough to make placing something feel like it landed.
 *
 * Sound must never be able to block or break construction: every entry
 * point is wrapped in try/catch, nothing here is awaited by gameplay code,
 * and if the AudioContext can't run (autoplay policy, no browser support)
 * this quietly does nothing instead of throwing.
 */

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  const w = window as typeof window & { webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export class ConstructionSound {
  private context: AudioContext | null = null;
  private readonly onPlaced = (): void => this.playClick();
  private readonly onComplete = (): void => this.playChime();
  private readonly onIntroChime = (): void => this.playIntroChime();
  private readonly onIntroConfirm = (): void => this.playIntroConfirm();
  private readonly onGesture = (): void => {
    this.context?.resume().catch(() => {});
  };

  constructor() {
    window.addEventListener('eavara:placed', this.onPlaced);
    window.addEventListener('eavara:creation-complete', this.onComplete);
    // Startup intro's own two cues (see intro/IntroSequence.ts) - same
    // "presentation only, never blocking" contract as the two above.
    window.addEventListener('eavara:intro-chime', this.onIntroChime);
    window.addEventListener('eavara:intro-confirm', this.onIntroConfirm);
    // Browsers only let audio start after a real user gesture; this primes
    // playback the first time one happens, without ever blocking on it.
    window.addEventListener('pointerdown', this.onGesture, { once: true });
    window.addEventListener('keydown', this.onGesture, { once: true });
  }

  dispose(): void {
    window.removeEventListener('eavara:placed', this.onPlaced);
    window.removeEventListener('eavara:creation-complete', this.onComplete);
    window.removeEventListener('eavara:intro-chime', this.onIntroChime);
    window.removeEventListener('eavara:intro-confirm', this.onIntroConfirm);
    window.removeEventListener('pointerdown', this.onGesture);
    window.removeEventListener('keydown', this.onGesture);
    try {
      this.context?.close();
    } catch {
      // Already closed or never started - nothing to do.
    }
    this.context = null;
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    try {
      const Ctor = getAudioContextCtor();
      this.context = Ctor ? new Ctor() : null;
    } catch {
      this.context = null;
    }
    return this.context;
  }

  /** A subtle placement click, for one settled piece. */
  private playClick(): void {
    try {
      const ctx = this.ensureContext();
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(720, now);
      osc.frequency.exponentialRampToValueAtTime(900, now + 0.05);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } catch {
      // Audio is presentation-only; a failure here must never surface.
    }
  }

  /** A slightly richer chime for a finished multi-piece creation. */
  private playChime(): void {
    try {
      const ctx = this.ensureContext();
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const notes = [880, 1108.7, 1318.5]; // A5, C#6, E6
      for (let i = 0; i < notes.length; i++) {
        const start = now + i * 0.075;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(notes[i], start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.07, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.26);
      }
    } catch {
      // Audio is presentation-only; a failure here must never surface.
    }
  }

  /** A small warm swell as the startup logo begins forming from its particles. */
  private playIntroChime(): void {
    try {
      const ctx = this.ensureContext();
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(660, now + 0.5);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.6);
    } catch {
      // Audio is presentation-only; a failure here must never surface.
    }
  }

  /** A short, polished confirmation tone for the finished wordmark reveal. */
  private playIntroConfirm(): void {
    try {
      const ctx = this.ensureContext();
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const notes = [659.3, 987.8]; // E5, B5 - a brighter, simpler interval than the creation chime
      for (let i = 0; i < notes.length; i++) {
        const start = now + i * 0.09;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(notes[i], start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.06, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.34);
      }
    } catch {
      // Audio is presentation-only; a failure here must never surface.
    }
  }
}
