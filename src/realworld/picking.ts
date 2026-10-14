/**
 * Which structural part a tap on a landmark means. Pure (no DOM, no
 * camera): RealWorldScene casts the rays and asks these helpers to decide,
 * so the rule is the same for every landmark model and can be tested
 * headlessly.
 *
 * The rule follows what the child sees:
 * - see-through things never stop a tap: a part faded for the cutaway (the
 *   glass facade, the podium), parts dimmed while another is inspected, and
 *   overlays such as the load-path arrows and wind streaks;
 * - the tap selects the first solid part behind them;
 * - if the first solid thing is not a part (the ground) or nothing solid is
 *   hit, the tap meant a see-through part it crossed - an inner one (the
 *   core, the floors) rather than the outer skin;
 * - thin parts (piles, the spire) are easy to miss, so a tap that finds
 *   nothing tries a few points around it (see TAP_TOLERANCE_PX).
 */
import type * as THREE from 'three';

/** Materials fainter than this (and anything that does not write depth) are see-through for taps. */
export const SEE_THROUGH_OPACITY = 0.5;

/** Rings (CSS pixels) tried around a tap that found no part, nearest first. */
export const TAP_TOLERANCE_PX: readonly number[] = [10, 20];

/** Directions tried on each tolerance ring. */
const RING_DIRECTIONS = 8;

/** What the picking rule needs from a landmark model. */
export interface PickableModel {
  /** The part id an object belongs to, or null (ground, arrows, wind). */
  pick(object: THREE.Object3D): string | null;
  /** Outer-skin parts: when a tap only crosses see-through parts, an inner part is preferred over these. */
  readonly envelopeParts: ReadonlySet<string>;
}

/** True when every material of an object lets a tap through (faded, or drawn without depth like overlays). */
export function seeThroughForTaps(object: THREE.Object3D): boolean {
  const material = (object as { material?: THREE.Material | THREE.Material[] }).material;
  if (!material) return true;
  const materials = Array.isArray(material) ? material : [material];
  return materials.every((m) => !m.depthWrite || (m.transparent && m.opacity < SEE_THROUGH_OPACITY));
}

/**
 * The part meant by a ray's hits, nearest first. Hidden objects must already
 * be removed (a part switched off for the current view never catches taps).
 */
export function partFromHits(model: PickableModel, hits: ReadonlyArray<{ object: THREE.Object3D }>): string | null {
  let crossed: string | null = null;
  let crossedInner: string | null = null;
  for (const hit of hits) {
    const part = model.pick(hit.object);
    if (seeThroughForTaps(hit.object)) {
      if (part !== null) {
        crossed ??= part;
        if (!model.envelopeParts.has(part)) crossedInner ??= part;
      }
      continue;
    }
    return part ?? crossedInner ?? crossed;
  }
  return crossedInner ?? crossed;
}

/** Points on a ring around a tap, in CSS pixels (x right, y down). */
export function ringOffsets(radius: number): Array<{ dx: number; dy: number }> {
  const offsets: Array<{ dx: number; dy: number }> = [];
  for (let i = 0; i < RING_DIRECTIONS; i++) {
    const angle = (i / RING_DIRECTIONS) * Math.PI * 2;
    offsets.push({ dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius });
  }
  return offsets;
}

/** The part found most often (ties go to the one found first), or null when none was found. */
export function mostFrequentPart(parts: ReadonlyArray<string | null>): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestCount = 0;
  for (const part of parts) {
    if (part === null) continue;
    const count = (counts.get(part) ?? 0) + 1;
    counts.set(part, count);
    if (count > bestCount) {
      best = part;
      bestCount = count;
    }
  }
  return best;
}
