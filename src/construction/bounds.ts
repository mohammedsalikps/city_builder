import type { ConstructionObjectDefinition } from './ConstructionObjectDefinition';
import type { PlacedObject, Vec3 } from './PlacedObject';

/**
 * Axis-aligned bounding box in world metres.
 *
 * Objects rotate only around Y and, today, only in quarter turns, so an
 * axis-aligned box is exact. For arbitrary yaw the box becomes conservative
 * (it encloses the rotated object), which is acceptable for game rules.
 */
export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** Horizontal half-size of an object after yaw rotation. */
export interface HalfExtents {
  x: number;
  z: number;
}

/**
 * Precision used for stored coordinates (0.01 mm). Rounding every derived
 * position removes floating-point drift when stacking (0.065 * 3 !== 0.195).
 */
const COORD_PRECISION = 1e5;

export function roundCoord(value: number): number {
  return Math.round(value * COORD_PRECISION) / COORD_PRECISION;
}

/** Tolerance below which two boxes are considered touching, not overlapping. */
export const CONTACT_EPSILON = 1e-4;

export function halfExtents(definition: ConstructionObjectDefinition, rotationY: number, scale: Vec3): HalfExtents {
  const halfW = (definition.dimensions.width * scale.x) / 2;
  const halfD = (definition.dimensions.depth * scale.z) / 2;
  const cos = Math.abs(Math.cos(rotationY));
  const sin = Math.abs(Math.sin(rotationY));
  return {
    x: roundCoord(halfW * cos + halfD * sin),
    z: roundCoord(halfW * sin + halfD * cos),
  };
}

export function computeBounds(
  definition: ConstructionObjectDefinition,
  position: Vec3,
  rotationY: number,
  scale: Vec3,
): Bounds {
  const half = halfExtents(definition, rotationY, scale);
  const height = definition.dimensions.height * scale.y;
  return {
    minX: roundCoord(position.x - half.x),
    maxX: roundCoord(position.x + half.x),
    minY: roundCoord(position.y),
    maxY: roundCoord(position.y + height),
    minZ: roundCoord(position.z - half.z),
    maxZ: roundCoord(position.z + half.z),
  };
}

export function boundsOfPlaced(definition: ConstructionObjectDefinition, placed: PlacedObject): Bounds {
  return computeBounds(definition, placed.position, placed.rotationY, placed.scale);
}

/** True when the boxes share volume. Touching faces do not count. */
export function boundsOverlap(a: Bounds, b: Bounds, epsilon = CONTACT_EPSILON): boolean {
  return (
    a.minX < b.maxX - epsilon &&
    a.maxX > b.minX + epsilon &&
    a.minY < b.maxY - epsilon &&
    a.maxY > b.minY + epsilon &&
    a.minZ < b.maxZ - epsilon &&
    a.maxZ > b.minZ + epsilon
  );
}
