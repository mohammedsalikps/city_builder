import type { Bounds } from './bounds';
import type { Vec3 } from './PlacedObject';

/** Something that can stand between the camera and a target, by its box. */
export interface OccluderBox {
  id: string;
  bounds: Bounds;
}

/** A point on (or within this distance of) a box counts as belonging to it. */
const INSIDE_EPSILON = 1e-3;
/** Segments that only graze a box (shorter crossing, as a fraction) are ignored. */
const MIN_CROSSING = 1e-3;

export function boxContainsPoint(b: Bounds, p: Vec3): boolean {
  return (
    p.x > b.minX - INSIDE_EPSILON &&
    p.x < b.maxX + INSIDE_EPSILON &&
    p.y > b.minY - INSIDE_EPSILON &&
    p.y < b.maxY + INSIDE_EPSILON &&
    p.z > b.minZ - INSIDE_EPSILON &&
    p.z < b.maxZ + INSIDE_EPSILON
  );
}

/** Reused interval for the slab test; the test is synchronous, so sharing is safe. */
const range = { t0: 0, t1: 1 };

function clipAxis(start: number, delta: number, min: number, max: number): boolean {
  if (Math.abs(delta) < 1e-12) return start >= min && start <= max;
  let enter = (min - start) / delta;
  let exit = (max - start) / delta;
  if (enter > exit) {
    const swap = enter;
    enter = exit;
    exit = swap;
  }
  if (enter > range.t0) range.t0 = enter;
  if (exit < range.t1) range.t1 = exit;
  return range.t0 <= range.t1;
}

/**
 * Whether the straight line from `from` (the camera) to `to` (a target point)
 * passes through the box on its way. A box that contains the target is the
 * target's own host (a door's wall) and never counts as blocking it.
 */
export function segmentCrossesBox(from: Vec3, to: Vec3, b: Bounds): boolean {
  if (boxContainsPoint(b, to) || boxContainsPoint(b, from)) return false;
  range.t0 = 0;
  range.t1 = 1;
  return (
    clipAxis(from.x, to.x - from.x, b.minX, b.maxX) &&
    clipAxis(from.y, to.y - from.y, b.minY, b.maxY) &&
    clipAxis(from.z, to.z - from.z, b.minZ, b.maxZ) &&
    range.t1 - range.t0 > MIN_CROSSING
  );
}

/**
 * Add to `out` the id of every occluder that stands between the camera and
 * at least one focus point. Pure geometry over axis-aligned boxes (placed
 * objects only ever turn in quarter turns, so their boxes are exact).
 *
 * An occluder that contains any of `hostPoints` (by default the focus points
 * themselves) is the host of a target, e.g. the wall a window belongs in,
 * and is never reported, even when it hides a different target. Otherwise
 * placing one of two windows could see through the other window's wall.
 */
export function findOccluders(
  camera: Vec3,
  focusPoints: readonly Vec3[],
  occluders: readonly OccluderBox[],
  out: Set<string>,
  hostPoints: readonly Vec3[] = focusPoints,
): Set<string> {
  for (const occluder of occluders) {
    if (hostPoints.some((p) => boxContainsPoint(occluder.bounds, p))) continue;
    for (const point of focusPoints) {
      if (segmentCrossesBox(camera, point, occluder.bounds)) {
        out.add(occluder.id);
        break;
      }
    }
  }
  return out;
}
