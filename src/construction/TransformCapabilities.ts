import { distinctOrientationsOf, roleOf, type ConstructionObjectDefinition } from './ConstructionObjectDefinition';

/** Which gizmo/indicator the player currently has active for the selection. */
export const TRANSFORM_MODES = ['move', 'rotate', 'scale'] as const;
export type TransformMode = (typeof TRANSFORM_MODES)[number];

/** Challenge Mode (blueprint-authoritative) vs. My World (free building). */
export type PlayContext = 'challenge' | 'freeplay';

/**
 * What the transform gizmo may do to a placed instance of a definition.
 * Movement and rotation still go through `PlacementResolver.resolveMove` /
 * `resolveRotate`, so this only decides which handles are worth showing -
 * it grants no exemption from snapping, support or collision rules.
 */
export interface TransformCapabilities {
  movable: boolean;
  rotatableY: boolean;
  /** No current catalogue object needs tilt; kept for a future definition that does. */
  rotatableX: boolean;
  rotatableZ: boolean;
  scalable: boolean;
  minScale: number;
  maxScale: number;
  scaleStep: number;
}

const BASE: TransformCapabilities = {
  movable: true,
  rotatableY: true,
  rotatableX: false,
  rotatableZ: false,
  scalable: false,
  minScale: 1,
  maxScale: 1,
  scaleStep: 0,
};

/**
 * Derives capabilities from the definition's role/category and, for a wall,
 * from whether it currently hosts a door or window - never from an object id.
 *
 * - wall: moves (any hosted openings move with it); rotates only while it
 *   hosts nothing (a hole's geometry is cut for the wall's current facing).
 * - floor: moves; rotates only if a turn actually looks different.
 * - roof: re-centres on its wall structure automatically and is not
 *   hand-manipulated, matching how it already behaves when first placed.
 * - opening (door/window): slides along its host wall; rotates (flips) if
 *   more than one orientation looks different. Never changes host.
 * - furniture/nature/decoration: move, rotate, and - My World only - scale
 *   within a small, type-appropriate range.
 * - everything else (bricks, roads, vehicles, utilities...): move and
 *   rotate, fixed size.
 *
 * Challenge Mode never allows scaling: gameplay dimensions there stay
 * authoritative for collision, snapping, support and blueprint matching.
 */
export function transformCapabilitiesOf(
  definition: ConstructionObjectDefinition,
  context: PlayContext,
  hostsOpenings: boolean,
): TransformCapabilities {
  const rotatable = distinctOrientationsOf(definition) > 1;
  const role = roleOf(definition);
  let caps: TransformCapabilities;

  switch (role) {
    case 'wall':
      caps = { ...BASE, rotatableY: !hostsOpenings };
      break;
    case 'floor':
      caps = { ...BASE, rotatableY: rotatable };
      break;
    case 'roof':
      caps = { ...BASE, movable: false, rotatableY: false };
      break;
    case 'opening':
      caps = { ...BASE, rotatableY: rotatable };
      break;
    default:
      caps = decorativeCapabilities(definition, rotatable);
  }

  if (context === 'challenge' && caps.scalable) caps = { ...caps, scalable: false };
  return caps;
}

function decorativeCapabilities(definition: ConstructionObjectDefinition, rotatable: boolean): TransformCapabilities {
  const base: TransformCapabilities = { ...BASE, rotatableY: rotatable };
  switch (definition.category) {
    case 'furniture':
      return { ...base, scalable: true, minScale: 0.85, maxScale: 1.25, scaleStep: 0.05 };
    case 'nature':
      return { ...base, scalable: true, minScale: 0.7, maxScale: 1.6, scaleStep: 0.1 };
    case 'decoration':
      return { ...base, scalable: true, minScale: 0.7, maxScale: 1.5, scaleStep: 0.1 };
    default:
      return base; // structures, openings-as-category, roads, vehicles, utilities
  }
}

/** Whether any handle at all applies, i.e. whether the gizmo should show. */
export function hasAnyCapability(caps: TransformCapabilities): boolean {
  return caps.movable || caps.rotatableY || caps.rotatableX || caps.rotatableZ || caps.scalable;
}
