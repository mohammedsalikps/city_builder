import { createId } from '@/utils/id';
import type { ConstructionObjectDefinition, Dimensions } from './ConstructionObjectDefinition';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Appearance values that override the definition for one instance. */
export interface MaterialOverrides {
  /** Hex colour, e.g. "#ff0000". */
  color?: string;
}

/**
 * One construction element that exists in the world.
 *
 * This is the source of truth: the three.js mesh is derived from it by the
 * ConstructionRenderer and never the other way round. Definition data
 * (dimensions, material, cost...) is referenced via `definitionId`, not copied.
 */
export interface PlacedObject {
  /** Unique instance id. */
  id: string;
  /** References ConstructionObjectDefinition.id in the registry. */
  definitionId: string;
  /** World position of the object's bottom-centre, in metres. */
  position: Vec3;
  /** Rotation around the vertical axis, in radians. */
  rotationY: number;
  /** Multiplier applied to the definition's dimensions. 1 = as defined. */
  scale: Vec3;
  materialOverrides: MaterialOverrides;
  /**
   * Instance this object was placed onto or against, if any. Null for ground
   * placement, and reset to null when the support is removed (the object then
   * stays where it is; floating structures are allowed for now).
   */
  supportId: string | null;
  /**
   * For openings (doors, windows): the wall this object is set into. The wall
   * is rendered with a hole where this object sits. Removing the wall removes
   * its openings. Null for everything else.
   */
  hostId: string | null;
  /** ISO timestamp of placement. */
  createdAt: string;
}

export interface PlacedObjectLinks {
  supportId?: string | null;
  hostId?: string | null;
}

export function createPlacedObject(
  definition: ConstructionObjectDefinition,
  position: Vec3,
  rotationY: number,
  links: PlacedObjectLinks = {},
): PlacedObject {
  return {
    id: createId('obj'),
    definitionId: definition.id,
    position: { ...position },
    rotationY,
    scale: { x: 1, y: 1, z: 1 },
    materialOverrides: {},
    supportId: links.supportId ?? null,
    hostId: links.hostId ?? null,
    createdAt: new Date().toISOString(),
  };
}

/** Effective size of a placed object after scale is applied. */
export function effectiveDimensions(definition: ConstructionObjectDefinition, placed: PlacedObject): Dimensions {
  return {
    width: definition.dimensions.width * placed.scale.x,
    height: definition.dimensions.height * placed.scale.y,
    depth: definition.dimensions.depth * placed.scale.z,
  };
}

/** Colour to render an instance with: override first, then definition. */
export function effectiveColor(definition: ConstructionObjectDefinition, placed?: PlacedObject): string {
  return placed?.materialOverrides.color ?? definition.color;
}
