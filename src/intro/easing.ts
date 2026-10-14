/** Shared easing curves for the intro timeline (no tween library - just small pure functions). */

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Progress of `elapsed` through [start, start+duration], clamped and eased. */
export function phaseT(elapsed: number, start: number, duration: number): number {
  return clamp01((elapsed - start) / Math.max(duration, 1e-6));
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** A small overshoot-and-settle - good for something "landing" into place. */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
