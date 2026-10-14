/**
 * Pure physics helpers for the Real World Explorer lessons.
 *
 * Two kinds of numbers live here and must not be mixed up:
 * - LEARNING-MODEL units (supportedLoad, averagePressure, foundationScenario):
 *   relative "weight blocks" and "area squares" for a simplified simulation.
 *   They are NOT tonnes, newtons or square metres, and the levels they produce
 *   are teaching thresholds, not real soil or concrete limits.
 * - SI physics (windDynamicPressure): a textbook formula in real units (pascals),
 *   used to explain why wind push grows quickly with speed. It is not a
 *   structural calculation for any real building.
 * Visual-only helpers (exaggeratedSwayMetres) are labelled as exaggerated.
 */
import { clamp01 } from '@/realworld/types';

// ---------------------------------------------------------------------------
// Foundation pressure (learning-model units)
// ---------------------------------------------------------------------------

/**
 * Total load carried down to the foundation, in model "weight blocks".
 * Each floor (with everything inside it) adds `loadPerFloor` blocks.
 * `floors` is a whole number >= 0; fractions are rounded down and
 * negative or non-finite values count as 0.
 */
export function supportedLoad(floors: number, loadPerFloor = 1): number {
  const count = Number.isFinite(floors) && floors > 0 ? Math.floor(floors) : 0;
  const perFloor = Number.isFinite(loadPerFloor) && loadPerFloor > 0 ? loadPerFloor : 0;
  return count * perFloor;
}

/**
 * Average pressure P = F / A, in model units (weight blocks per area square).
 * Guard: when the area is 0, negative or not a number, any positive force
 * gives Infinity (the force has nowhere to spread) and no force gives 0.
 */
export function averagePressure(force: number, area: number): number {
  const f = Number.isFinite(force) && force > 0 ? force : 0;
  if (!(area > 0)) return f > 0 ? Number.POSITIVE_INFINITY : 0;
  return f / area;
}

/** The pressure-meter colour band in the foundation simulation. */
export type PressureLevel = 'low' | 'medium' | 'high';

/**
 * Relative teaching thresholds for the pressure meter, in model units
 * (weight blocks per area square): below `medium` is 'low', from `medium`
 * up to `high` is 'medium', and `high` or more is 'high'. They are chosen so
 * that a low-rise on a small base reads 'low', a very tall building on the
 * same base reads 'high', and spreading it over a larger base brings it down
 * again. They are not real soil or rock limits.
 */
export const PRESSURE_LEVELS = { medium: 5, high: 15 } as const;

/** Slider ranges and comparison presets for the foundation simulation (model units). */
export const FOUNDATION_SIMULATION = {
  minFloors: 0,
  maxFloors: 200,
  minArea: 2,
  maxArea: 40,
  presets: {
    lowRise: { floors: 4, area: 10 },
    tall: { floors: 160, area: 10 },
  },
} as const;

export interface FoundationScenario {
  /** Weight blocks carried down to the foundation. */
  load: number;
  /** Average pressure under the foundation, weight blocks per area square. */
  pressure: number;
  level: PressureLevel;
}

/** Pressure band for a model-unit pressure (see PRESSURE_LEVELS). */
export function pressureLevel(pressure: number): PressureLevel {
  if (pressure >= PRESSURE_LEVELS.high) return 'high';
  if (pressure >= PRESSURE_LEVELS.medium) return 'medium';
  return 'low';
}

/**
 * One state of the foundation-pressure simulation: `floors` hypothetical
 * floors of one weight block each, spread over `areaUnits` area squares.
 */
export function foundationScenario(floors: number, areaUnits: number): FoundationScenario {
  const load = supportedLoad(floors);
  const pressure = averagePressure(load, areaUnits);
  return { load, pressure, level: pressureLevel(pressure) };
}

// ---------------------------------------------------------------------------
// Wind (SI units)
// ---------------------------------------------------------------------------

/**
 * Standard sea-level air density, kg/m^3, from the International Standard
 * Atmosphere (ISO 2533:1975). NASA Glenn's "Earth Atmosphere Model - Metric
 * Units" (https://www.grc.nasa.gov/www/k-12/airplane/atmosmet.html) gives
 * T = 15.04 C and p = 101.29 kPa at h = 0, and r = p / (0.2869 (T + 273.1)),
 * which also works out to about 1.225 kg/m^3.
 */
export const SEA_LEVEL_AIR_DENSITY = 1.225;

/**
 * Dynamic pressure of moving air, q = 1/2 * rho * v^2, in pascals (N/m^2).
 * `speedMs` in metres per second, `airDensity` in kg/m^3.
 * Formula: NASA Glenn Research Center, "Dynamic Pressure", Beginner's Guide to
 * Aeronautics (https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/dynamic-pressure/).
 * This is the push of the moving air itself; the force on a real building
 * also depends on its shape, size, stiffness and the gusts it meets.
 */
export function windDynamicPressure(speedMs: number, airDensity = SEA_LEVEL_AIR_DENSITY): number {
  if (!Number.isFinite(speedMs) || !(airDensity > 0)) return 0;
  return 0.5 * airDensity * speedMs * speedMs;
}

/**
 * How many times harder wind at `speed` pushes than wind at `baseline`:
 * (speed / baseline)^2, so twice as fast pushes four times as hard.
 * Returns 0 when the baseline is 0 or not a number.
 */
export function relativeWindPush(speed: number, baseline: number): number {
  if (!Number.isFinite(speed) || !Number.isFinite(baseline) || baseline === 0) return 0;
  const ratio = speed / baseline;
  return ratio * ratio;
}

/**
 * Largest sway drawn at the top of the tower at full wind strength, metres.
 * VISUAL ONLY and deliberately exaggerated so children can see the effect;
 * it is not the real tower's movement.
 */
export const MAX_VISUAL_SWAY_M = 40;

/**
 * Sway drawn at the top of the model for a wind-slider value 0..1, metres.
 * EXAGGERATED and visual only. Grows with the square of the slider (like the
 * wind push), is 0 at 0 and never decreases as the slider goes up.
 */
export function exaggeratedSwayMetres(strength01: number): number {
  const s = clamp01(strength01);
  return MAX_VISUAL_SWAY_M * s * s;
}

/** Child-friendly wind words for the slider. */
export type WindLabel = 'calm' | 'breezy' | 'windy' | 'stormy';

/**
 * Slider bands (0..1) for the wind words, lowest first: a value belongs to the
 * last band whose `from` it reaches. A simple scale for the slider, loosely
 * inspired by the Beaufort idea of naming wind by its effects; not Beaufort numbers.
 */
export const WIND_LABELS: ReadonlyArray<{ from: number; label: WindLabel; text: string }> = [
  { from: 0, label: 'calm', text: 'Calm: hardly any wind' },
  { from: 0.2, label: 'breezy', text: 'Breezy: a gentle wind' },
  { from: 0.5, label: 'windy', text: 'Windy: a strong wind' },
  { from: 0.8, label: 'stormy', text: 'Stormy: a very strong wind' },
];

/** The wind word for a slider value 0..1. */
export function windLabel(strength01: number): WindLabel {
  const s = clamp01(strength01);
  let label: WindLabel = 'calm';
  for (const band of WIND_LABELS) if (s >= band.from) label = band.label;
  return label;
}
