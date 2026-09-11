/**
 * Tunables for the placement system. Kept in one place so later steps
 * (per-object snapping, finer grids) change them without touching logic.
 */

/** Distance between valid placement positions, in metres. */
export const PLACEMENT_SNAP_STEP = 0.25;

/** Rotation applied per rotate command, in radians (quarter turn). */
export const PLACEMENT_ROTATION_STEP = Math.PI / 2;

/** Number of distinct rotation steps before wrapping to 0. */
export const PLACEMENT_ROTATION_STEPS = 4;
