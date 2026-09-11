import {
  orientationsEquivalent,
  roleOf,
  type ConstructionObjectDefinition,
  type SupportSurface,
} from './ConstructionObjectDefinition';
import type { ObjectRegistry } from './ObjectRegistry';
import type { PlacedObject, Vec3 } from './PlacedObject';
import type { BuildAreaProvider } from './BuildArea';
import { CONTACT_EPSILON, boundsOfPlaced, boundsOverlap, computeBounds, halfExtents, roundCoord, type Bounds } from './bounds';
import { PLACEMENT_ROTATION_STEP, PLACEMENT_SNAP_STEP } from './constants';
import { connectedWallBounds, placeOpeningInWall, snapWallToNeighbours } from './walls';
import { snap } from '@/utils/math';

export type PlacementSurface = 'ground' | 'top' | 'side';

export type PlacementInvalidReason =
  | 'overlap'
  | 'outside-area'
  | 'unsupported-face'
  | 'wrong-support'
  | 'does-not-fit';

/** Special alignment applied on top of the basic surface placement. */
export type PlacementSnap = 'corner' | 'inline' | 'opening' | 'edge' | 'target' | null;

/** Compact description of the pending placement, suitable for state/UI. */
export interface PlacementStatus {
  surface: PlacementSurface;
  supportId: string | null;
  supportName: string | null;
  valid: boolean;
  reason: PlacementInvalidReason | null;
  snap: PlacementSnap;
  /** Short, player-facing explanation (why invalid, or what snapped). */
  hint: string | null;
}

/** What the pointer ray hit, in world space. */
export type SurfaceHit =
  | { kind: 'ground'; point: Vec3 }
  | { kind: 'object'; instanceId: string; point: Vec3; normal: Vec3 };

/** A fully resolved, validated place-to-be. */
export interface PlacementCandidate {
  position: Vec3;
  rotationY: number;
  bounds: Bounds;
  /** Wall this opening would be set into; null otherwise. */
  hostId: string | null;
  status: PlacementStatus;
}

/** One place a level wants an object: its ghost transform (bottom-centre). */
export interface PlacementTarget {
  position: Vec3;
  rotationY: number;
}

/** What the active level says about placing one kind of object. */
export interface PlacementTargetSet {
  targets: readonly PlacementTarget[];
  /**
   * Definitions this object must rest on in this level (every target of it
   * names a support in the blueprint), or null when the level adds no rule.
   */
  requiredSupport: ReadonlySet<string> | null;
}

/** Everything the placement rules need to know about the current world. */
export interface PlacementRulesContext {
  getBuildArea: BuildAreaProvider;
  /**
   * Targets of the active challenge for a definition. Absent or empty in free
   * building, where only the catalogue rules apply.
   */
  getPlacementTargets?: (definitionId: string) => PlacementTargetSet;
}

const NO_TARGETS: PlacementTargetSet = { targets: [], requiredSupport: null };

const UNIT_SCALE: Vec3 = { x: 1, y: 1, z: 1 };

/**
 * How close a wall end must be to another wall's end to snap into a join;
 * also how close the pointer must be to a target ghost's footprint for a wall
 * with no neighbour to snap onto that target.
 */
const WALL_SNAP_RADIUS = 0.75;

/** Sliding step for openings along a wall, metres. */
const OPENING_SNAP_STEP = 0.05;
/** Largest gap a floor slab is pulled across to butt against a wall or tile. */
const FLOOR_PULL_RADIUS = PLACEMENT_SNAP_STEP;

/**
 * Turns "the pointer is here" into "the object would go there, and it is / is
 * not allowed". Pure world-space maths driven by the definition's placement
 * rules and role; nothing here touches three.js or the store.
 *
 * Order of work for every candidate:
 *   1. basic surface placement (ground / top / side) with the object's snap rule
 *   2. role behaviour: openings set into walls, walls join corners, floors
 *      clear walls
 *   3. support rules from the definition (what may it rest on / attach to)
 *   4. geometry rules: inside the build area, no volume overlap
 */
export class PlacementResolver {
  constructor(
    private readonly registry: ObjectRegistry,
    private readonly rules: PlacementRulesContext,
  ) {}

  resolve(
    hit: SurfaceHit,
    definition: ConstructionObjectDefinition,
    rotationY: number,
    placedObjects: PlacedObject[],
  ): PlacementCandidate | null {
    // 1. Basic surface placement.
    let surface: PlacementSurface;
    let support: PlacedObject | null = null;
    let supportDefinition: ConstructionObjectDefinition | null = null;
    let position: Vec3;

    if (hit.kind === 'ground') {
      surface = 'ground';
      position = this.snapOnGround(hit.point, definition, rotationY);
    } else {
      support = placedObjects.find((p) => p.id === hit.instanceId) ?? null;
      supportDefinition = support ? this.registry.get(support.definitionId) ?? null : null;
      if (!support || !supportDefinition) return null;

      const supportBounds = boundsOfPlaced(supportDefinition, support);
      if (hit.normal.y > 0.5) {
        surface = 'top';
        position = this.snapOnTop(hit.point, supportBounds, support, definition, rotationY);
      } else if (hit.normal.y < -0.5) {
        // Underside: nothing can hang from an object.
        const at = { x: roundCoord(hit.point.x), y: roundCoord(hit.point.y), z: roundCoord(hit.point.z) };
        return this.invalid(definition, at, rotationY, 'side', support, supportDefinition, 'unsupported-face', 'Nothing can hang under an object');
      } else {
        surface = 'side';
        position = this.snapBeside(hit.point, hit.normal, supportBounds, support, definition, rotationY);
      }
    }

    // 2. Role behaviour.
    const role = roleOf(definition);
    let hostId: string | null = null;
    let snapKind: PlacementSnap = null;
    let finalRotation = rotationY;
    let hint: string | null = null;

    if (role === 'opening') {
      if (surface !== 'side' || !support || !supportDefinition || roleOf(supportDefinition) !== 'wall') {
        return this.invalid(definition, position, rotationY, surface, support, supportDefinition, 'wrong-support', supportHint(definition));
      }
      const flip = rotationStepOf(rotationY) % 2 === 1;
      const placement = placeOpeningInWall(supportDefinition, support, definition, hit.point, flip, OPENING_SNAP_STEP);
      if (!placement) {
        return this.invalid(definition, position, rotationY, surface, support, supportDefinition, 'does-not-fit', `${definition.name} does not fit this wall`);
      }
      position = placement.position;
      finalRotation = placement.rotationY;
      hostId = support.id;
      snapKind = 'opening';
      hint = `Set into ${supportDefinition.name}. R flips it`;
    } else if (role === 'wall') {
      const walls = this.objectsWithRole(placedObjects, 'wall');
      const snapped = snapWallToNeighbours(definition, position, rotationY, walls, WALL_SNAP_RADIUS, {
        x: hit.point.x,
        z: hit.point.z,
      });
      // A join is only offered when it is buildable; otherwise the plain
      // placement stands (e.g. a wall laid flat against another wall's face).
      if (snapped) {
        const snappedBounds = computeBounds(definition, snapped.position, rotationY, UNIT_SCALE);
        if (findInvalidReason(snappedBounds, placedObjects, this.registry, this.rules) === null) {
          position = snapped.position;
          snapKind = snapped.kind;
          hint = snapped.kind === 'corner' ? 'Snapped into a corner' : 'Continues the wall';
        }
      }
      // No neighbour to join: in a level, a wall held near one of its target
      // ghosts snaps onto that target, so any wall of a room can go first.
      if (snapKind === null) {
        const target = this.snapToTarget(definition, position, rotationY, hit.point, placedObjects);
        if (target) {
          position = target;
          snapKind = 'target';
          hint = 'Snapped to the blueprint';
        }
      }
    } else if (role === 'roof' && surface === 'top' && support && supportDefinition && roleOf(supportDefinition) === 'wall') {
      // A roof dropped on any wall of a building sits centred over all the
      // walls joined to it, on top of them.
      const walls = this.objectsWithRole(placedObjects, 'wall');
      const structure = connectedWallBounds(support, walls);
      position = {
        x: roundCoord((structure.minX + structure.maxX) / 2),
        y: roundCoord(structure.maxY),
        z: roundCoord((structure.minZ + structure.maxZ) / 2),
      };
      snapKind = 'edge';
      hint = 'Centred on the walls';
    } else if (role === 'floor' && surface !== 'side') {
      const pushed = this.pushClearOfWalls(definition, position, rotationY, placedObjects);
      if (pushed) {
        position = pushed;
        snapKind = 'edge';
        hint = 'Against the wall';
      }
    }

    // 3. Support rules: the catalogue's, then the level's (blueprint support).
    const ruleHint =
      checkSupportRules(definition, surface, supportDefinition) ??
      checkTargetSupport(definition, surface, supportDefinition, this.registry, this.rules);
    if (ruleHint) {
      return this.invalid(definition, position, finalRotation, surface, support, supportDefinition, 'wrong-support', ruleHint);
    }

    // 4. Geometry rules.
    const bounds = computeBounds(definition, position, finalRotation, UNIT_SCALE);
    const reason = findInvalidReason(bounds, placedObjects, this.registry, this.rules, hostId ? [hostId] : []);
    return {
      position,
      rotationY: finalRotation,
      bounds,
      hostId,
      status: makeStatus(surface, support, supportDefinition, reason === null, reason, snapKind, reason ? null : hint),
    };
  }

  /**
   * Re-resolve an existing placed object at a new horizontal position, using
   * the same role-specific snapping and validation as a fresh placement
   * (wall corners, floor clearance, opening sliding along its host). The
   * object's current relationship (ground / support / host wall) never
   * changes, only its position within that relationship does.
   */
  resolveMove(
    placed: PlacedObject,
    definition: ConstructionObjectDefinition,
    proposed: { x: number; z: number },
    rotationY: number,
    placedObjects: PlacedObject[],
  ): PlacementCandidate | null {
    let position: Vec3;
    let surface: PlacementSurface;
    let support: PlacedObject | null = null;
    let supportDefinition: ConstructionObjectDefinition | null = null;
    const hostId: string | null = placed.hostId;

    if (placed.hostId) {
      const host = placedObjects.find((p) => p.id === placed.hostId) ?? null;
      const hostDefinition = host ? this.registry.get(host.definitionId) ?? null : null;
      if (!host || !hostDefinition) return null;
      const flip = rotationStepOf(rotationY) % 2 === 1;
      const point: Vec3 = { x: proposed.x, y: placed.position.y, z: proposed.z };
      const placement = placeOpeningInWall(hostDefinition, host, definition, point, flip, OPENING_SNAP_STEP);
      if (!placement) {
        return this.invalid(definition, placed.position, placed.rotationY, 'side', host, hostDefinition, 'does-not-fit', `${definition.name} does not fit this wall`);
      }
      position = placement.position;
      rotationY = placement.rotationY;
      surface = 'side';
      support = host;
      supportDefinition = hostDefinition;
    } else if (placed.supportId) {
      support = placedObjects.find((p) => p.id === placed.supportId) ?? null;
      supportDefinition = support ? this.registry.get(support.definitionId) ?? null : null;
      if (!support || !supportDefinition) return null;
      const supportBounds = boundsOfPlaced(supportDefinition, support);
      position = this.snapOnTop({ x: proposed.x, y: 0, z: proposed.z }, supportBounds, support, definition, rotationY);
      surface = 'top';
    } else {
      position = this.snapOnGround({ x: proposed.x, y: 0, z: proposed.z }, definition, rotationY);
      surface = 'ground';
    }

    const role = roleOf(definition);
    let snapKind: PlacementSnap = null;
    let hint: string | null = null;
    // Openings hosted by this object move with it (see actions.moveSelectedPlacedObject),
    // so they must not count as an obstacle against their own host's new spot.
    const dependentIds = placedObjects.filter((p) => p.hostId === placed.id).map((p) => p.id);
    const selfAndDependents = [placed.id, ...dependentIds];

    if (role === 'wall') {
      const walls = this.objectsWithRole(placedObjects, 'wall').filter((w) => w.placed.id !== placed.id);
      const snapped = snapWallToNeighbours(definition, position, rotationY, walls, WALL_SNAP_RADIUS, {
        x: proposed.x,
        z: proposed.z,
      });
      if (snapped) {
        const snappedBounds = computeBounds(definition, snapped.position, rotationY, UNIT_SCALE);
        if (findInvalidReason(snappedBounds, placedObjects, this.registry, this.rules, selfAndDependents) === null) {
          position = snapped.position;
          snapKind = snapped.kind;
          hint = snapped.kind === 'corner' ? 'Snapped into a corner' : 'Continues the wall';
        }
      }
    } else if (role === 'floor') {
      const others = placedObjects.filter((p) => p.id !== placed.id);
      const pushed = this.pushClearOfWalls(definition, position, rotationY, others);
      if (pushed) {
        position = pushed;
        snapKind = 'edge';
        hint = 'Against the wall';
      }
    }

    const ruleHint =
      checkSupportRules(definition, surface, supportDefinition) ??
      checkTargetSupport(definition, surface, supportDefinition, this.registry, this.rules);
    if (ruleHint) {
      return this.invalid(definition, position, rotationY, surface, support, supportDefinition, 'wrong-support', ruleHint);
    }

    const bounds = computeBounds(definition, position, rotationY, placed.scale);
    const ignoreIds = hostId ? [...selfAndDependents, hostId] : selfAndDependents;
    const reason = findInvalidReason(bounds, placedObjects, this.registry, this.rules, ignoreIds);
    return {
      position,
      rotationY,
      bounds,
      hostId,
      status: makeStatus(surface, support, supportDefinition, reason === null, reason, snapKind, reason ? null : hint),
    };
  }

  /**
   * Re-resolve an existing placed object at a new quarter-turn rotation, in
   * place. A wall that hosts a door or window is never offered a rotate
   * handle (see `transformCapabilitiesOf`), so this need not rotate hosted
   * openings; every other role rotates around its own current position.
   */
  resolveRotate(
    placed: PlacedObject,
    definition: ConstructionObjectDefinition,
    rotationY: number,
    placedObjects: PlacedObject[],
  ): PlacementCandidate | null {
    let position = placed.position;
    const surface: PlacementSurface = placed.hostId ? 'side' : placed.supportId ? 'top' : 'ground';
    let support: PlacedObject | null = null;
    let supportDefinition: ConstructionObjectDefinition | null = null;

    if (placed.hostId) {
      const host = placedObjects.find((p) => p.id === placed.hostId) ?? null;
      const hostDefinition = host ? this.registry.get(host.definitionId) ?? null : null;
      if (!host || !hostDefinition) return null;
      const flip = rotationStepOf(rotationY) % 2 === 1;
      const placement = placeOpeningInWall(hostDefinition, host, definition, placed.position, flip, OPENING_SNAP_STEP);
      if (!placement) return null;
      position = placement.position;
      rotationY = placement.rotationY;
      support = host;
      supportDefinition = hostDefinition;
    } else if (placed.supportId) {
      support = placedObjects.find((p) => p.id === placed.supportId) ?? null;
      supportDefinition = support ? this.registry.get(support.definitionId) ?? null : null;
    }

    const ruleHint =
      checkSupportRules(definition, surface, supportDefinition) ??
      checkTargetSupport(definition, surface, supportDefinition, this.registry, this.rules);
    if (ruleHint) {
      return this.invalid(definition, position, rotationY, surface, support, supportDefinition, 'wrong-support', ruleHint);
    }

    const bounds = computeBounds(definition, position, rotationY, placed.scale);
    const ignoreIds = placed.hostId ? [placed.id, placed.hostId] : [placed.id];
    const reason = findInvalidReason(bounds, placedObjects, this.registry, this.rules, ignoreIds);
    return {
      position,
      rotationY,
      bounds,
      hostId: placed.hostId,
      status: makeStatus(surface, support, supportDefinition, reason === null, reason, null, null),
    };
  }

  // -------------------------------------------------------------- snapping

  /**
   * The target of this definition nearest the pointer, if the pointer is
   * within WALL_SNAP_RADIUS of its footprint, it is at the same level, its
   * rotation looks the same as the one being placed, and the spot is
   * buildable (a filled or blocked target is skipped for the next nearest).
   * Returns the target position, or null to keep the plain placement.
   */
  private snapToTarget(
    definition: ConstructionObjectDefinition,
    position: Vec3,
    rotationY: number,
    pointer: Vec3,
    placedObjects: PlacedObject[],
  ): Vec3 | null {
    const { targets } = this.rules.getPlacementTargets?.(definition.id) ?? NO_TARGETS;
    if (targets.length === 0) return null;

    const step = rotationStepOf(rotationY);
    let candidates: Array<{ position: Vec3; bounds: Bounds; footprint: number; centre: number }> | null = null;
    for (const target of targets) {
      if (Math.abs(target.position.y - position.y) > 1e-4) continue;
      if (!orientationsEquivalent(definition, rotationStepOf(target.rotationY), step)) continue;
      const bounds = computeBounds(definition, target.position, rotationY, UNIT_SCALE);
      const dx = Math.max(bounds.minX - pointer.x, 0, pointer.x - bounds.maxX);
      const dz = Math.max(bounds.minZ - pointer.z, 0, pointer.z - bounds.maxZ);
      const footprint = Math.hypot(dx, dz);
      if (footprint > WALL_SNAP_RADIUS) continue;
      const centre = Math.hypot(pointer.x - target.position.x, pointer.z - target.position.z);
      (candidates ??= []).push({ position: target.position, bounds, footprint, centre });
    }
    if (!candidates) return null;

    candidates.sort((a, b) => a.footprint - b.footprint || a.centre - b.centre);
    for (const candidate of candidates) {
      if (findInvalidReason(candidate.bounds, placedObjects, this.registry, this.rules) === null) {
        return { ...candidate.position };
      }
    }
    return null;
  }

  /** Snap step per horizontal axis for this definition at this rotation. */
  private snapSteps(definition: ConstructionObjectDefinition, rotationY: number): { x: number; z: number } {
    const rule = definition.placement?.horizontalSnap;
    if (rule === undefined) return { x: PLACEMENT_SNAP_STEP, z: PLACEMENT_SNAP_STEP };
    if (typeof rule === 'number') return { x: rule, z: rule };

    const divisions = Math.max(1, definition.placement?.snapDivisions ?? 1);
    const half = halfExtents(definition, rotationY, UNIT_SCALE);
    return { x: (half.x * 2) / divisions, z: (half.z * 2) / divisions };
  }

  /**
   * On the ground: snapped relative to the build area's centre, so a
   * challenge's blueprint positions (relative to its origin) are reachable.
   */
  private snapOnGround(point: Vec3, definition: ConstructionObjectDefinition, rotationY: number): Vec3 {
    const step = this.snapSteps(definition, rotationY);
    const { center } = this.rules.getBuildArea();
    return {
      x: roundCoord(center.x + snap(point.x - center.x, step.x)),
      y: 0,
      z: roundCoord(center.z + snap(point.z - center.z, step.z)),
    };
  }

  /**
   * On top of a support: Y is the support's top face. X/Z snap relative to the
   * support's centre so stacked objects align with it (offset 0) or sit at
   * clean fractions of their own footprint (running bond).
   */
  private snapOnTop(
    point: Vec3,
    supportBounds: Bounds,
    support: PlacedObject,
    definition: ConstructionObjectDefinition,
    rotationY: number,
  ): Vec3 {
    const step = this.snapSteps(definition, rotationY);
    return {
      x: roundCoord(support.position.x + snap(point.x - support.position.x, step.x)),
      y: supportBounds.maxY,
      z: roundCoord(support.position.z + snap(point.z - support.position.z, step.z)),
    };
  }

  /**
   * Beside a support: pushed out along the hit face's normal so the two boxes
   * touch exactly; slid along the face in snap steps; same course (bottom Y)
   * as the support so walls stay level.
   */
  private snapBeside(
    point: Vec3,
    normal: Vec3,
    supportBounds: Bounds,
    support: PlacedObject,
    definition: ConstructionObjectDefinition,
    rotationY: number,
  ): Vec3 {
    const step = this.snapSteps(definition, rotationY);
    const half = halfExtents(definition, rotationY, UNIT_SCALE);
    const alongX = Math.abs(normal.x) >= Math.abs(normal.z);

    if (alongX) {
      const sign = normal.x >= 0 ? 1 : -1;
      const faceX = sign > 0 ? supportBounds.maxX : supportBounds.minX;
      return {
        x: roundCoord(faceX + sign * half.x),
        y: supportBounds.minY,
        z: roundCoord(support.position.z + snap(point.z - support.position.z, step.z)),
      };
    }
    const sign = normal.z >= 0 ? 1 : -1;
    const faceZ = sign > 0 ? supportBounds.maxZ : supportBounds.minZ;
    return {
      x: roundCoord(support.position.x + snap(point.x - support.position.x, step.x)),
      y: supportBounds.minY,
      z: roundCoord(faceZ + sign * half.z),
    };
  }

  /**
   * Floors are slabs: if the snapped slab would run into a wall or another
   * floor at its level, slide it the shortest distance so its edge meets that
   * face instead. Each pass applies the smallest candidate shift that leaves
   * fewer obstacles overlapping, so two obstacles cannot bounce the slab back
   * and forth; a corner plus a neighbouring tile needs up to three passes.
   */
  private pushClearOfWalls(
    definition: ConstructionObjectDefinition,
    position: Vec3,
    rotationY: number,
    placedObjects: PlacedObject[],
  ): Vec3 | null {
    const obstacles = [...this.objectsWithRole(placedObjects, 'wall'), ...this.objectsWithRole(placedObjects, 'floor')];
    if (obstacles.length === 0) return null;

    const overlapping = (at: Vec3): Bounds[] => {
      const bounds = computeBounds(definition, at, rotationY, UNIT_SCALE);
      return obstacles
        .map(({ placed, definition: def }) => boundsOfPlaced(def, placed))
        .filter((wb) => boundsOverlap(bounds, wb));
    };

    let current = position;
    let moved = false;
    for (let pass = 0; pass < 4; pass++) {
      const hits = overlapping(current);
      if (hits.length === 0) break;
      const bounds = computeBounds(definition, current, rotationY, UNIT_SCALE);
      const options: Array<{ axis: 'x' | 'z'; amount: number }> = [];
      for (const wb of hits) {
        options.push(
          { axis: 'x', amount: wb.maxX - bounds.minX },
          { axis: 'x', amount: wb.minX - bounds.maxX },
          { axis: 'z', amount: wb.maxZ - bounds.minZ },
          { axis: 'z', amount: wb.minZ - bounds.maxZ },
        );
      }
      options.sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount));
      let next: Vec3 | null = null;
      for (const option of options) {
        const candidate =
          option.axis === 'x'
            ? { ...current, x: roundCoord(current.x + option.amount) }
            : { ...current, z: roundCoord(current.z + option.amount) };
        if (overlapping(candidate).length < hits.length) {
          next = candidate;
          break;
        }
      }
      if (!next) break;
      current = next;
      moved = true;
    }

    // A slab that stops just short of a wall or tile (a lattice gap smaller
    // than one snap step) is pulled the rest of the way so it butts against
    // it. Two pulls cover a corner. A pull is skipped if it would overlap.
    for (let pull = 0; pull < 2; pull++) {
      const bounds = computeBounds(definition, current, rotationY, UNIT_SCALE);
      let best: { axis: 'x' | 'z'; amount: number } | null = null;
      for (const { placed, definition: def } of obstacles) {
        const wb = boundsOfPlaced(def, placed);
        if (wb.minY >= bounds.maxY - CONTACT_EPSILON || wb.maxY <= bounds.minY + CONTACT_EPSILON) continue;
        const spansZ = wb.minZ < bounds.maxZ - CONTACT_EPSILON && wb.maxZ > bounds.minZ + CONTACT_EPSILON;
        const spansX = wb.minX < bounds.maxX - CONTACT_EPSILON && wb.maxX > bounds.minX + CONTACT_EPSILON;
        const gaps: Array<{ axis: 'x' | 'z'; amount: number }> = [];
        if (spansZ) gaps.push({ axis: 'x', amount: wb.minX - bounds.maxX }, { axis: 'x', amount: wb.maxX - bounds.minX });
        if (spansX) gaps.push({ axis: 'z', amount: wb.minZ - bounds.maxZ }, { axis: 'z', amount: wb.maxZ - bounds.minZ });
        for (const gap of gaps) {
          const size = Math.abs(gap.amount);
          if (size <= CONTACT_EPSILON || size > FLOOR_PULL_RADIUS) continue;
          if (!best || size < Math.abs(best.amount)) best = gap;
        }
      }
      if (!best) break;
      const candidate =
        best.axis === 'x'
          ? { ...current, x: roundCoord(current.x + best.amount) }
          : { ...current, z: roundCoord(current.z + best.amount) };
      if (overlapping(candidate).length > 0) break;
      current = candidate;
      moved = true;
    }
    return moved ? current : null;
  }

  private objectsWithRole(
    placedObjects: PlacedObject[],
    role: 'wall' | 'floor',
  ): Array<{ placed: PlacedObject; definition: ConstructionObjectDefinition }> {
    const result: Array<{ placed: PlacedObject; definition: ConstructionObjectDefinition }> = [];
    for (const placed of placedObjects) {
      const definition = this.registry.get(placed.definitionId);
      if (definition && roleOf(definition) === role) result.push({ placed, definition });
    }
    return result;
  }

  private invalid(
    definition: ConstructionObjectDefinition,
    position: Vec3,
    rotationY: number,
    surface: PlacementSurface,
    support: PlacedObject | null,
    supportDefinition: ConstructionObjectDefinition | null,
    reason: PlacementInvalidReason,
    hint: string,
  ): PlacementCandidate {
    return {
      position,
      rotationY,
      bounds: computeBounds(definition, position, rotationY, UNIT_SCALE),
      hostId: null,
      status: makeStatus(surface, support, supportDefinition, false, reason, null, hint),
    };
  }
}

function makeStatus(
  surface: PlacementSurface,
  support: PlacedObject | null,
  supportDefinition: ConstructionObjectDefinition | null,
  valid: boolean,
  reason: PlacementInvalidReason | null,
  snapKind: PlacementSnap,
  hint: string | null,
): PlacementStatus {
  return {
    surface,
    supportId: support?.id ?? null,
    supportName: supportDefinition?.name ?? null,
    valid,
    reason,
    snap: snapKind,
    hint,
  };
}

/** Quarter-turn step (0..3) for a yaw in radians. */
export function rotationStepOf(rotationY: number): number {
  const step = Math.round(rotationY / PLACEMENT_ROTATION_STEP);
  return ((step % 4) + 4) % 4;
}

function supportHint(definition: ConstructionObjectDefinition): string {
  return definition.placement?.support?.hint ?? `${definition.name} cannot go here`;
}

/**
 * Data-driven support check. Returns a player-facing hint when the
 * definition's support rules reject this surface/support, else null.
 * Shared by the live preview and the place action.
 */
export function checkSupportRules(
  definition: ConstructionObjectDefinition,
  surface: PlacementSurface,
  supportDefinition: ConstructionObjectDefinition | null,
): string | null {
  const rules = definition.placement?.support;
  if (!rules) return null;

  if (surface === 'ground') {
    return rules.ground === false ? supportHint(definition) : null;
  }
  if (!supportDefinition) return null;
  if (rules.surfaces && !rules.surfaces.includes(surface as SupportSurface)) return supportHint(definition);
  if (rules.types && !rules.types.includes(supportDefinition.type)) return supportHint(definition);
  if (rules.categories && !rules.categories.includes(supportDefinition.category)) return supportHint(definition);
  return null;
}

/**
 * Level support rule from the blueprint: when every target of this object in
 * the active challenge rests on another object, it must rest on one of those
 * objects' definitions here, not on the ground or anything else. Free
 * building has no targets, so there only the catalogue rules apply.
 * Shared by the live preview and the place action.
 */
export function checkTargetSupport(
  definition: ConstructionObjectDefinition,
  surface: PlacementSurface,
  supportDefinition: ConstructionObjectDefinition | null,
  registry: ObjectRegistry,
  rules: PlacementRulesContext,
): string | null {
  const required = rules.getPlacementTargets?.(definition.id).requiredSupport ?? null;
  if (!required || required.size === 0) return null;
  if (surface !== 'ground' && supportDefinition && required.has(supportDefinition.id)) return null;
  const names = [...required].map((id) => registry.get(id)?.name ?? id).join(' or ');
  return `In this level the ${definition.name} goes on the ${names}`;
}

/**
 * Shared geometry check used by both the live preview and the place action,
 * so state can never accept a placement the preview would have refused.
 * `ignoreIds` exempts an opening's host wall (the opening sits inside it).
 */
export function findInvalidReason(
  bounds: Bounds,
  placedObjects: PlacedObject[],
  registry: ObjectRegistry,
  rules: PlacementRulesContext,
  ignoreIds: string[] = [],
): PlacementInvalidReason | null {
  const { center, halfSize } = rules.getBuildArea();
  const tolerance = 1e-6;
  if (
    bounds.minY < -tolerance ||
    bounds.minX < center.x - halfSize - tolerance ||
    bounds.maxX > center.x + halfSize + tolerance ||
    bounds.minZ < center.z - halfSize - tolerance ||
    bounds.maxZ > center.z + halfSize + tolerance
  ) {
    return 'outside-area';
  }
  for (const other of placedObjects) {
    if (ignoreIds.includes(other.id)) continue;
    const definition = registry.get(other.definitionId);
    if (!definition) continue;
    if (boundsOverlap(bounds, boundsOfPlaced(definition, other))) return 'overlap';
  }
  return null;
}

export function placementStatusEquals(a: PlacementStatus | null, b: PlacementStatus | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.surface === b.surface &&
    a.supportId === b.supportId &&
    a.supportName === b.supportName &&
    a.valid === b.valid &&
    a.reason === b.reason &&
    a.snap === b.snap &&
    a.hint === b.hint
  );
}

/** Human-readable explanation for the HUD. */
export function describePlacementStatus(status: PlacementStatus): string {
  if (!status.valid) {
    if (status.hint) return `Invalid: ${status.hint}.`;
    switch (status.reason) {
      case 'overlap':
        return 'Invalid: overlaps another object.';
      case 'outside-area':
        return 'Invalid: outside the build area.';
      default:
        return 'Invalid placement.';
    }
  }
  if (status.reason === 'overlap') return 'Invalid: overlaps another object.';
  let base: string;
  switch (status.surface) {
    case 'ground':
      base = 'On the ground.';
      break;
    case 'top':
      base = `On top of ${status.supportName ?? 'object'}.`;
      break;
    case 'side':
      base = `Beside ${status.supportName ?? 'object'}.`;
      break;
  }
  return status.hint ? `${status.hint}. ${base}` : base;
}
