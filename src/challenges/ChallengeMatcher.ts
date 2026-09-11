import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import {
  orientationsEquivalent,
  type ConstructionObjectDefinition,
} from '@/construction/ConstructionObjectDefinition';
import type { PlacedObject, Vec3 } from '@/construction/PlacedObject';
import { PLACEMENT_ROTATION_STEP, PLACEMENT_ROTATION_STEPS } from '@/construction/constants';
import type { ChallengeDefinition } from './Challenge';
import {
  resolveObjectRules,
  rotationModeOf,
  transformBlueprintObject,
  type BlueprintObject,
} from './Blueprint';

/** A player object that satisfies one blueprint object. */
export interface ObjectMatch {
  blueprintObjectId: string;
  placedObjectId: string;
  /** Distance between target and actual position, metres. */
  distance: number;
}

/**
 * How an unmatched player object relates to the target:
 * - misplaced: its definition is still needed somewhere (wrong position,
 *   rotation or relationship);
 * - extra: nothing in the remaining target needs this kind of object.
 */
export type UnmatchedKind = 'misplaced' | 'extra';

export interface UnmatchedObject {
  placedObjectId: string;
  definitionId: string;
  kind: UnmatchedKind;
}

/** Progress per kind of object, for the HUD ("Walls 3 / 4"). */
export interface MatchGroup {
  definitionId: string;
  label: string;
  required: number;
  matched: number;
}

export interface ChallengeMatchResult {
  challengeId: string;
  blueprintId: string;
  /** Number of blueprint objects. */
  required: number;
  matchedCount: number;
  missingCount: number;
  /** Unmatched player objects whose kind is still needed (misplaced). */
  wrongCount: number;
  /** Unmatched player objects that are not needed at all. */
  extraCount: number;
  matches: ObjectMatch[];
  /** Blueprint object ids not yet built correctly. */
  missing: string[];
  unmatched: UnmatchedObject[];
  groups: MatchGroup[];
  /** Quarter turns applied to the whole blueprint for this result (rotationMode). */
  rotationApplied: number;
  /** matched / required, 0..1. */
  progress: number;
  completed: boolean;
}

/** A blueprint object with its world-space target for one orientation. */
interface Target {
  object: BlueprintObject;
  definition: ConstructionObjectDefinition;
  position: Vec3;
  rotationStep: number;
  positionTolerance: number;
  rotationMatters: boolean;
}

/**
 * Compare a challenge's blueprint against what the player has built.
 *
 * Pure function over construction data: no meshes, no store, no build order.
 * Each blueprint object is matched to at most one player object and vice
 * versa, so four required walls with three correct ones report exactly
 * 3 matched, 1 missing.
 *
 * Matching runs in two passes so relationships can be checked:
 *   1. objects without relationships (walls, floors, bricks) are paired
 *      greedily by distance among candidates with the right definition,
 *      position and rotation;
 *   2. objects with `host` / `support` are paired the same way, but a
 *      candidate must also point (hostId / supportId) at the player object
 *      that pass 1 assigned to the related target.
 * If the blueprint allows quarter-turn rotation, all four orientations are
 * evaluated and the best (most matched, then fewest unmatched) is returned.
 */
export function matchBlueprint(
  challenge: ChallengeDefinition,
  placedObjects: PlacedObject[],
  registry: ObjectRegistry,
): ChallengeMatchResult {
  const turns = rotationModeOf(challenge.blueprint) === 'anyQuarterTurn' ? [0, 1, 2, 3] : [0];
  let best: ChallengeMatchResult | null = null;
  for (const k of turns) {
    const result = matchOrientation(challenge, placedObjects, registry, k);
    if (!best || isBetter(result, best)) best = result;
  }
  return best as ChallengeMatchResult;
}

function isBetter(a: ChallengeMatchResult, b: ChallengeMatchResult): boolean {
  if (a.matchedCount !== b.matchedCount) return a.matchedCount > b.matchedCount;
  return a.unmatched.length < b.unmatched.length;
}

function matchOrientation(
  challenge: ChallengeDefinition,
  placedObjects: PlacedObject[],
  registry: ObjectRegistry,
  quarterTurns: number,
): ChallengeMatchResult {
  const { blueprint, buildOrigin } = challenge;

  const targets: Target[] = [];
  for (const object of blueprint.objects) {
    const definition = registry.get(object.definitionId);
    if (!definition) continue;
    const rules = resolveObjectRules(blueprint, object);
    const placed = transformBlueprintObject(buildOrigin, object, quarterTurns);
    targets.push({
      object,
      definition,
      position: placed.position,
      rotationStep: placed.rotationStep,
      positionTolerance: rules.positionTolerance,
      rotationMatters: rules.rotationMatters,
    });
  }

  /** blueprint object id -> placed object id */
  const assignment = new Map<string, string>();
  const usedPlaced = new Set<string>();
  const matches: ObjectMatch[] = [];

  const hasRelation = (t: Target): boolean => t.object.host !== undefined || (t.object.support?.length ?? 0) > 0;
  pair(targets.filter((t) => !hasRelation(t)), placedObjects, assignment, usedPlaced, matches);
  pair(targets.filter(hasRelation), placedObjects, assignment, usedPlaced, matches);

  const missing = blueprint.objects.filter((o) => !assignment.has(o.id)).map((o) => o.id);
  const missingDefinitions = new Set(
    blueprint.objects.filter((o) => !assignment.has(o.id)).map((o) => o.definitionId),
  );
  const unmatched: UnmatchedObject[] = placedObjects
    .filter((p) => !usedPlaced.has(p.id))
    .map((p) => ({
      placedObjectId: p.id,
      definitionId: p.definitionId,
      kind: missingDefinitions.has(p.definitionId) ? 'misplaced' : 'extra',
    }));

  const groups = buildGroups(blueprint.objects, assignment, registry);
  const required = blueprint.objects.length;
  const wrongCount = unmatched.filter((u) => u.kind === 'misplaced').length;
  const completed = missing.length === 0 && (blueprint.rules.allowExtraObjects || unmatched.length === 0);

  return {
    challengeId: challenge.id,
    blueprintId: blueprint.id,
    required,
    matchedCount: matches.length,
    missingCount: missing.length,
    wrongCount,
    extraCount: unmatched.length - wrongCount,
    matches,
    missing,
    unmatched,
    groups,
    rotationApplied: quarterTurns,
    progress: required === 0 ? 1 : matches.length / required,
    completed,
  };
}

/**
 * Greedy nearest-first pairing of the given targets with free player
 * objects. Relationship requirements are checked against `assignment`, so
 * this must run for relation-free targets before related ones.
 */
function pair(
  targets: Target[],
  placedObjects: PlacedObject[],
  assignment: Map<string, string>,
  usedPlaced: Set<string>,
  matches: ObjectMatch[],
): void {
  interface Candidate {
    targetId: string;
    placedId: string;
    distance: number;
  }
  const candidates: Candidate[] = [];

  for (const target of targets) {
    for (const placed of placedObjects) {
      if (usedPlaced.has(placed.id)) continue;
      if (placed.definitionId !== target.object.definitionId) continue;
      const distance = distanceBetween(target.position, placed.position);
      if (distance > target.positionTolerance) continue;
      if (
        target.rotationMatters &&
        !rotationsEquivalent(target.definition, target.rotationStep, rotationStepOf(placed))
      ) {
        continue;
      }
      if (!relationshipsSatisfied(target.object, placed, assignment)) continue;
      candidates.push({ targetId: target.object.id, placedId: placed.id, distance });
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);
  for (const c of candidates) {
    if (assignment.has(c.targetId) || usedPlaced.has(c.placedId)) continue;
    assignment.set(c.targetId, c.placedId);
    usedPlaced.add(c.placedId);
    matches.push({ blueprintObjectId: c.targetId, placedObjectId: c.placedId, distance: c.distance });
  }
}

/**
 * host: the player's object must be set into the player object matched to
 * the target's host. support: it must rest on a player object matched to one
 * of the target's supports. A door in some other wall never satisfies the
 * target door, even at the right position.
 */
function relationshipsSatisfied(
  target: BlueprintObject,
  placed: PlacedObject,
  assignment: Map<string, string>,
): boolean {
  if (target.host !== undefined) {
    const hostPlacedId = assignment.get(target.host);
    if (!hostPlacedId || placed.hostId !== hostPlacedId) return false;
  }
  if (target.support && target.support.length > 0) {
    const allowed = target.support.map((id) => assignment.get(id)).filter((id): id is string => !!id);
    if (!placed.supportId || !allowed.includes(placed.supportId)) return false;
  }
  return true;
}

function buildGroups(
  objects: BlueprintObject[],
  assignment: Map<string, string>,
  registry: ObjectRegistry,
): MatchGroup[] {
  const byDefinition = new Map<string, MatchGroup>();
  for (const object of objects) {
    let group = byDefinition.get(object.definitionId);
    if (!group) {
      const name = registry.get(object.definitionId)?.name ?? object.definitionId;
      group = { definitionId: object.definitionId, label: name, required: 0, matched: 0 };
      byDefinition.set(object.definitionId, group);
    }
    group.required++;
    if (assignment.has(object.id)) group.matched++;
  }
  for (const group of byDefinition.values()) {
    if (group.required > 1) group.label = pluralize(group.label);
  }
  return [...byDefinition.values()];
}

function pluralize(name: string): string {
  // "Wall (long)" -> "Walls (long)": pluralise the noun, keep the qualifier.
  const qualified = /^(.*?)(\s+\(.*\))$/.exec(name);
  if (qualified) return `${pluralize(qualified[1])}${qualified[2]}`;
  if (name.endsWith('s')) return name;
  if (/(sh|ch|x|z)$/.test(name)) return `${name}es`;
  return `${name}s`;
}

/** Quarter-turn step (0..3) of a placed object's yaw. */
export function rotationStepOf(placed: PlacedObject): number {
  const step = Math.round(placed.rotationY / PLACEMENT_ROTATION_STEP);
  return ((step % PLACEMENT_ROTATION_STEPS) + PLACEMENT_ROTATION_STEPS) % PLACEMENT_ROTATION_STEPS;
}

/**
 * Whether two quarter-turn rotations look the same for this object, from its
 * data (`distinctOrientations`): with 4 every quarter turn is different (a
 * sofa facing the wall is wrong), with 2 a half turn is the same (a plain
 * table), with 1 rotation never matters. Objects that declare nothing keep
 * the footprint rule: square -> 1, otherwise 2.
 */
export function rotationsEquivalent(definition: ConstructionObjectDefinition, a: number, b: number): boolean {
  return orientationsEquivalent(definition, a, b);
}

function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Human-readable one-liner for HUD/debug output. */
export function describeMatch(result: ChallengeMatchResult): string {
  const parts = [`${result.matchedCount} / ${result.required} correct`];
  if (result.wrongCount > 0) parts.push(`${result.wrongCount} misplaced`);
  if (result.extraCount > 0) parts.push(`${result.extraCount} extra`);
  return parts.join(', ');
}
