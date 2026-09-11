import type { Vec3 } from '@/construction/PlacedObject';
import { PLACEMENT_ROTATION_STEPS } from '@/construction/constants';

/**
 * Per-object overrides of the blueprint's default matching rules.
 * Anything omitted falls back to `ChallengeBlueprint.rules`.
 */
export interface BlueprintObjectRules {
  /** Max distance (metres) between target and player position to count as a match. */
  positionTolerance?: number;
  /** Whether the player's rotation must be equivalent to the target rotation. */
  rotationMatters?: boolean;
}

/** One construction element the player is expected to build. */
export interface BlueprintObject {
  /** Stable id inside the blueprint, e.g. "wall_a". Used in match results and relationships. */
  id: string;
  /** ConstructionObjectDefinition id from the object registry. */
  definitionId: string;
  /** Bottom-centre position relative to the challenge build origin, in metres. */
  position: Vec3;
  /** Quarter turns around the vertical axis (0..3). */
  rotationStep: number;
  rules?: BlueprintObjectRules;
  /**
   * Blueprint object this one must be set into (openings): the player's
   * object must carry, as `hostId`, the placed object matched to this target.
   */
  host?: string;
  /**
   * Blueprint objects this one may rest on (roofs): the player's object must
   * carry, as `supportId`, a placed object matched to one of these targets.
   */
  support?: string[];
}

/**
 * How the whole blueprint may be oriented:
 * - fixed: exactly as authored.
 * - anyQuarterTurn: the whole target may be rotated 0/90/180/270 degrees
 *   around the build origin; the best-matching orientation is used.
 */
export type RotationMode = 'fixed' | 'anyQuarterTurn';

export interface BlueprintRules {
  positionTolerance: number;
  rotationMatters: boolean;
  /** When false, any unmatched player object blocks completion. */
  allowExtraObjects: boolean;
  /** Defaults to 'fixed'. */
  rotationMode?: RotationMode;
}

/**
 * The target structure of a challenge, expressed as construction data.
 * Positions are relative to a build origin so the same blueprint can be
 * anchored anywhere in a world. Correctness is always judged against this
 * data, never against a picture.
 */
export interface ChallengeBlueprint {
  id: string;
  name: string;
  description: string;
  rules: BlueprintRules;
  objects: BlueprintObject[];
}

export interface ResolvedObjectRules {
  positionTolerance: number;
  rotationMatters: boolean;
}

export function resolveObjectRules(blueprint: ChallengeBlueprint, object: BlueprintObject): ResolvedObjectRules {
  return {
    positionTolerance: object.rules?.positionTolerance ?? blueprint.rules.positionTolerance,
    rotationMatters: object.rules?.rotationMatters ?? blueprint.rules.rotationMatters,
  };
}

/** World-space bottom-centre of a blueprint object for a given build origin. */
export function blueprintWorldPosition(origin: Vec3, object: BlueprintObject): Vec3 {
  return transformBlueprintObject(origin, object, 0).position;
}

/**
 * World position and rotation of a blueprint object after rotating the whole
 * blueprint by `quarterTurns` around the build origin (vertical axis).
 * Uses the same convention as three.js rotation.y, so a rigidly rotated build
 * lands exactly on the rotated targets.
 */
export function transformBlueprintObject(
  origin: Vec3,
  object: BlueprintObject,
  quarterTurns: number,
): { position: Vec3; rotationStep: number } {
  const k = ((quarterTurns % PLACEMENT_ROTATION_STEPS) + PLACEMENT_ROTATION_STEPS) % PLACEMENT_ROTATION_STEPS;
  const angle = (k * Math.PI) / 2;
  const cos = Math.round(Math.cos(angle));
  const sin = Math.round(Math.sin(angle));
  const { x, y, z } = object.position;
  return {
    position: {
      x: origin.x + x * cos + z * sin,
      y: origin.y + y,
      z: origin.z - x * sin + z * cos,
    },
    rotationStep: (object.rotationStep + k) % PLACEMENT_ROTATION_STEPS,
  };
}

export function rotationModeOf(blueprint: ChallengeBlueprint): RotationMode {
  return blueprint.rules.rotationMode ?? 'fixed';
}
