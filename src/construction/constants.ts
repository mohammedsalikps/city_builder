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

/**
 * Depth every catalogue wall shares (wall/wall_long/wall_short), in metres.
 * Presentation only: an opening's own gameplay depth stays whatever
 * `objects.json` declares for collision, but its VISUAL frame/glazing is
 * drawn at least this thick so it fills the wall's cut hole on both faces
 * instead of sitting recessed in the middle of it.
 */
export const WALL_VISUAL_THICKNESS = 0.2;
