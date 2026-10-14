import { roleOf, type ConstructionObjectDefinition } from '@/construction/ConstructionObjectDefinition';
import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import type { PlacedObject } from '@/construction/PlacedObject';
import { computeBounds } from '@/construction/bounds';
import { openingRects, wallFrame } from '@/construction/walls';
import { rotateAroundY } from '@/utils/math';
import { EYE_HEIGHT, WALK_RADIUS, findRoom, roomAt, worldToHouse, type Box2, type InteriorHouse, type InteriorRoom } from './HouseInterior';

/**
 * Walking around inside a planned house: the solid parts of its walls (doors
 * are open gaps, windows stay solid), the furniture standing in it right now
 * - so whatever the child moved, added or removed counts - and the doors
 * and windows that link its rooms. On top of that model:
 *
 *   - circle-against-boxes collision with sliding, sub-stepped so a walker
 *     can never tunnel through a 0.2 m wall;
 *   - a good standing spot and view for every room, the pose just inside the
 *     front door, and a point back outside;
 *   - the room graph through the doors and a breadth-first tour of it;
 *   - free floor for a new piece of furniture, kept clear of every doorway.
 *
 * Pure data and maths on PlacedObjects: no DOM, no three.js scene.
 */

export interface WalkDoor {
  /** Centre of the opening (in the middle of the wall's thickness), world metres. */
  x: number;
  z: number;
  width: number;
  /** Unit normal across the wall, pointing away from the house centre (outwards for an outside door). */
  normal: { x: number; z: number };
  /** Room id (or 'outside') along +normal, then along -normal. */
  sides: [string, string];
}

export interface WalkWindow {
  x: number;
  z: number;
  /** Unit normal pointing into the room the window lights. */
  normal: { x: number; z: number };
  roomId: string | null;
}

export interface WalkModel {
  house: InteriorHouse;
  /** Solid wall parts (door gaps cut out), world boxes. */
  walls: Box2[];
  /** Furniture standing in the house, tall enough to bump into. */
  furniture: Array<Box2 & { id: string }>;
  /** Everything the walker collides with: walls and furniture. */
  obstacles: Box2[];
  doors: WalkDoor[];
  windows: WalkWindow[];
  /** Where the walker may be: the house footprint (leaving is the integrator's exit action). */
  bounds: Box2;
}

/**
 * A camera pose for three.js with rotation.order 'YXZ': yaw 0 looks towards
 * -Z, forward = (-sin(yaw), 0, -cos(yaw)); pitch 0 is level, negative looks down.
 */
export interface ViewPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** Side name of a door that leads out of the house. */
export const OUTSIDE = 'outside';

/** Walls and openings of the house group belong to this house when their centre is this close to its footprint. */
const BELONG_MARGIN = 0.35;
/** Furniture lower than this is walked over (rugs, low items). */
const FURNITURE_MIN_HEIGHT = 0.35;
/** Anything whose top is at most this far above the floor is flat on it. */
const FLAT_ON_FLOOR = 0.05;
/** An opening starting at most this high above its wall's foot is a door (a walkable gap). */
const DOOR_SILL_MAX = 0.05;
/** How far past a door or window the room on each side is looked up. */
const SIDE_PROBE = 0.4;
/** Floor kept free in front of every door when finding room for furniture. */
const DOOR_CLEAR_DEPTH = 0.9;
/** Default gap kept between new furniture and walls or other furniture. */
const DEFAULT_CLEARANCE = 0.05;
/** Search grid for free furniture spots. */
const SPOT_GRID = 0.1;
/** Distance of a corner viewpoint from the walls. */
const CORNER_PAD = 0.45;
/** A slight downward look, so the floor and furniture are in view. */
const VIEW_PITCH = -0.12;
/** Furniture closer than this (m) along the line of sight fills the view from a standing spot. */
const VIEW_BLOCK_DISTANCE = 1.2;
/** Score (m) taken off a standing spot whose view is filled like that. */
const VIEW_BLOCK_PENALTY = 3;
/** Step (m) when checking that a straight walk is free all the way. */
const LINE_STEP = 0.05;
/** How far in front of the front door the camera returns outside. */
const EXIT_DISTANCE = 1.5;
/** Tried distances (m) from a door's centre into the room, and sideways offsets, for a viewpoint just inside it. */
const DOORWAY_DEPTHS = [0.75, 0.6, 0.95, 1.15, 1.4];
const DOORWAY_OFFSETS = [0, -0.25, 0.25, -0.5, 0.5];
/** Ring step and reach (m) when pushing a stuck walker out to free floor. */
const PUSH_STEP = 0.05;
const PUSH_REACH = 4;
/** Smallest collision sub-step, metres: keeps a tiny radius from turning one move into thousands of steps (still far below a 0.2 m wall). */
const MIN_SUB_STEP = 0.02;

/** A usable radius: negative, NaN or infinite values mean the default walker. */
function walkerRadius(radius: number): number {
  return Number.isFinite(radius) && radius >= 0 ? radius : WALK_RADIUS;
}
const QUARTER = Math.PI / 2;
const EPS = 1e-9;
const TIDY = 1e6;

type Placed = { placed: PlacedObject; definition: ConstructionObjectDefinition };

/**
 * The walkable model of a house from the objects standing now. Walls and
 * openings of the house's group within 0.35 m of its footprint (which also
 * tells the houses of one neighbourhood apart), plus walls the child built
 * inside the footprint and openings set into any of them; furniture is
 * anything else standing inside the footprint that rises more than 0.05 m
 * above the floor, is at least `furnitureMinHeight` tall (default 0.35 m),
 * and does not stand on the roof.
 */
export function buildWalkModel(
  house: InteriorHouse,
  placedObjects: readonly PlacedObject[],
  registry: ObjectRegistry,
  opts: { furnitureMinHeight?: number } = {},
): WalkModel {
  const minHeight = opts.furnitureMinHeight ?? FURNITURE_MIN_HEIGHT;
  const near = grow(house.footprint, BELONG_MARGIN);
  const wallList: Placed[] = [];
  const openingList: Placed[] = [];
  const furniture: Array<Box2 & { id: string }> = [];
  for (const placed of placedObjects) {
    const definition = registry.get(placed.definitionId);
    if (!definition) continue;
    const role = roleOf(definition);
    const { x, z } = placed.position;
    if (role === 'wall') {
      const ours = placed.group?.id === house.groupId && contains(near, x, z);
      if (ours || (contains(house.footprint, x, z) && standsInRooms(house, placed, definition))) wallList.push({ placed, definition });
    } else if (role === 'opening') {
      openingList.push({ placed, definition });
    } else if (role === null && contains(house.footprint, x, z) && isFurniture(house, placed, definition, minHeight)) {
      const b = computeBounds(definition, placed.position, placed.rotationY, placed.scale);
      furniture.push({ id: placed.id, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
    }
  }

  const wallIds = new Set(wallList.map((w) => w.placed.id));
  const hosted = new Map<string, Placed[]>();
  for (const opening of openingList) {
    const hostId = opening.placed.hostId;
    if (!hostId || !wallIds.has(hostId)) continue;
    hosted.set(hostId, [...(hosted.get(hostId) ?? []), opening]);
  }

  const walls: Box2[] = [];
  const doors: WalkDoor[] = [];
  const windows: WalkWindow[] = [];
  for (const wall of wallList) {
    const openings = hosted.get(wall.placed.id) ?? [];
    walls.push(...solidWallParts(wall, openings));
    for (const opening of openings) {
      const normal = wallNormal(wall);
      const centre = { x: opening.placed.position.x, z: opening.placed.position.z };
      if (opening.placed.position.y - wall.placed.position.y <= DOOR_SILL_MAX) {
        // The gap cut in the wall is the door's catalogue width (openingRects ignores scale), so the door is measured the same way.
        doors.push(describeDoor(house, centre, opening.definition.dimensions.width, normal));
      } else {
        windows.push(describeWindow(house, centre, normal));
      }
    }
  }
  return { house, walls, furniture, obstacles: [...walls, ...furniture], doors, windows, bounds: { ...house.footprint } };
}

/** True when a walker of `radius` (default WALK_RADIUS) standing at `p` touches nothing and is inside the house. */
export function isFree(model: WalkModel, p: { x: number; z: number }, radius: number = WALK_RADIUS): boolean {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return false;
  const r = walkerRadius(radius);
  const b = model.bounds;
  if (p.x < b.minX + r - EPS || p.x > b.maxX - r + EPS || p.z < b.minZ + r - EPS || p.z > b.maxZ - r + EPS) return false;
  const limit = r * r - EPS;
  for (const box of model.obstacles) {
    if (r === 0 ? strictlyInside(box, p) : distanceSquared(box, p) < limit) return false;
  }
  return true;
}

/**
 * Walk from `from` towards `to`, sliding along whatever is in the way. The
 * target is first clamped inside the house (bounds inset by the radius), and
 * the walk is taken in steps of at most radius / 2, so a 0.2 m wall can never
 * be skipped over. From a free start the result is always free; a walker
 * that starts stuck (furniture moved onto it) is first pushed out to the
 * nearest free point.
 */
export function moveWithCollision(
  model: WalkModel,
  from: { x: number; z: number },
  to: { x: number; z: number },
  radius: number = WALK_RADIUS,
): { x: number; z: number } {
  radius = walkerRadius(radius);
  let p = isFree(model, from, radius) ? { x: from.x, z: from.z } : nearestFree(model, from, radius);
  if (!Number.isFinite(to.x) || !Number.isFinite(to.z)) return p;
  const target = clampInside(model.bounds, to, radius);
  const dx = target.x - p.x;
  const dz = target.z - p.z;
  const distance = Math.hypot(dx, dz);
  if (distance < EPS) return p;
  const maxStep = radius > 0 ? Math.max(radius / 2, MIN_SUB_STEP) : PUSH_STEP;
  const steps = Math.max(1, Math.ceil(distance / maxStep));
  const sx = dx / steps;
  const sz = dz / steps;
  for (let i = 0; i < steps; i++) {
    const next = { x: p.x + sx, z: p.z + sz };
    if (isFree(model, next, radius)) {
      p = next;
      continue;
    }
    // Blocked: keep the part of the step that is free on each axis (walls are axis-aligned, so this slides).
    const order: Array<'x' | 'z'> = Math.abs(sx) >= Math.abs(sz) ? ['x', 'z'] : ['z', 'x'];
    for (const axis of order) p = slideAxis(model, p, axis, axis === 'x' ? sx : sz, radius);
  }
  return p;
}

/**
 * Where to stand to look at a room: of the free spots just inside the door
 * the child would come in by and in the room's corners (0.45 m from the
 * walls) that are a straight, free walk from that doorway, the one that
 * shows the most of the room - the longest sightline across it, and no
 * furniture filling the view within 1.2 m - else the free floor nearest the
 * centre. Always a free spot in the room, looking across it towards the
 * centre (or the far corner when standing in the middle), at eye height,
 * slightly down.
 */
export function roomViewpoint(model: WalkModel, room: InteriorRoom): ViewPose {
  const door = entranceOf(model, room);
  const doorway = door ? doorwaySpot(model, room, door) : null;
  // Only corners in plain reach of the way in: never one behind furniture, or one that needs a detour to get to.
  const corners = cornerSpots(model, room).filter((c) => !doorway || clearWalk(model, doorway, c));
  const candidates = [...(doorway ? [doorway] : []), ...corners];
  let spot: { x: number; z: number } | null = null;
  let best = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const score = viewScore(model, room, candidate);
    if (score > best + 1e-6) {
      best = score;
      spot = candidate;
    }
  }
  spot ??= centreSpot(model, room);
  const target = lookTarget(room, spot);
  return pose(model, spot, { x: target.x - spot.x, z: target.z - spot.z });
}

/** Just inside the front door, facing into the house; without a front door, the living room's viewpoint. */
export function entryPose(model: WalkModel): ViewPose {
  const front = frontDoor(model);
  const room = front ? roomBehind(model, front) : null;
  if (front && room) {
    const spot = doorwaySpot(model, room, front);
    if (spot) return pose(model, spot, inwardNormal(front, room.id) ?? { x: 0, z: -1 });
    return roomViewpoint(model, room);
  }
  const living = findRoom(model.house, { type: 'living' }) ?? model.house.rooms[0];
  return roomViewpoint(model, living);
}

/** A point about 1.5 m outside the front door (any outside door when there is no front one), world metres. */
export function exitPoint(model: WalkModel): { x: number; z: number } {
  const door = frontDoor(model) ?? model.doors.find((d) => d.sides.includes(OUTSIDE)) ?? null;
  if (door) {
    const out = door.sides[0] === OUTSIDE ? door.normal : { x: -door.normal.x, z: -door.normal.z };
    return { x: tidy(door.x + out.x * EXIT_DISTANCE), z: tidy(door.z + out.z * EXIT_DISTANCE) };
  }
  // No door out at all: in front of the middle of the front wall.
  const { house } = model;
  const front = rotateAroundY(0, house.plan.size.depth / 2 + EXIT_DISTANCE, house.rotationY);
  return { x: tidy(house.origin.x + front.x), z: tidy(house.origin.z + front.z) };
}

/** Which rooms each door joins: room id -> neighbouring room ids (and 'outside'); every room has an entry. */
export function doorGraph(model: WalkModel): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>([[OUTSIDE, new Set()]]);
  for (const room of model.house.rooms) graph.set(room.id, new Set());
  for (const door of model.doors) {
    const [a, b] = door.sides;
    if (a === b) continue;
    if (!graph.has(a)) graph.set(a, new Set());
    if (!graph.has(b)) graph.set(b, new Set());
    graph.get(a)!.add(b);
    graph.get(b)!.add(a);
  }
  return graph;
}

/** Every room id once, breadth-first through the doors from the room behind the front door. */
export function tourOrder(model: WalkModel): string[] {
  return walkThrough(model).order;
}

/** The windows that light this room. */
export function windowsOf(model: WalkModel, room: InteriorRoom): WalkWindow[] {
  return model.windows.filter((w) => w.roomId === room.id);
}

/**
 * Free floor in `room` for a piece of `size` (width along its local X,
 * depth along local Z), turned by `rotationY` (default: 0, then the other
 * quarter turns). Searched on a 0.1 m grid: the piece keeps `clearance`
 * (default 0.05 m) from walls and furniture and stays out of the 0.9 m deep,
 * door-wide floor in front of every door of the room. `near` picks among
 * the spots that fit: 'wall' (default; back against a wall, facing into the
 * room), 'window' (closest to one of the room's windows), 'centre', or a
 * point. Null when nothing fits - callers must say so honestly.
 */
export function findFreeSpot(
  model: WalkModel,
  room: InteriorRoom,
  size: { width: number; depth: number },
  opts: { rotationY?: number; near?: 'window' | 'wall' | 'centre' | { x: number; z: number }; clearance?: number } = {},
): { x: number; z: number; rotationY: number } | null {
  const { width, depth } = size;
  if (!(Number.isFinite(width) && Number.isFinite(depth) && width > 0 && depth > 0)) return null;
  const clearance = Math.max(0, opts.clearance ?? DEFAULT_CLEARANCE);
  const rotations = opts.rotationY !== undefined && Number.isFinite(opts.rotationY) ? [opts.rotationY] : [0, QUARTER, Math.PI, 3 * QUARTER];
  const rect = room.rect;
  const reach = grow(rect, clearance + SPOT_GRID);
  const blockers = model.obstacles.filter((o) => overlaps(o, reach));
  const zones = doorZones(model, room);
  const windows = windowsOf(model, room);
  const near = opts.near === 'window' && windows.length === 0 ? 'wall' : opts.near ?? 'wall';

  let best: { x: number; z: number; rotationY: number; key: number[] } | null = null;
  for (let turn = 0; turn < rotations.length; turn++) {
    const rotationY = rotations[turn];
    const half = turnedHalfSize(width, depth, rotationY);
    for (const x of gridAlong(rect.minX + clearance + half.x, rect.maxX - clearance - half.x)) {
      for (const z of gridAlong(rect.minZ + clearance + half.z, rect.maxZ - clearance - half.z)) {
        const box = { minX: x - half.x, maxX: x + half.x, minZ: z - half.z, maxZ: z + half.z };
        const padded = grow(box, clearance);
        if (blockers.some((o) => overlaps(o, padded)) || zones.some((zone) => overlaps(zone, box))) continue;
        const key = [...spotScore(near, room, box, rotationY, windows), turn, x, z];
        if (!best || lexLess(key, best.key)) best = { x, z, rotationY, key };
      }
    }
  }
  return best ? { x: tidy(best.x), z: tidy(best.z), rotationY: best.rotationY } : null;
}

// --------------------------------------------------------------- model parts

/** The solid parts of one wall: its length minus the door gaps (windows stay solid), as axis-aligned boxes. */
function solidWallParts(wall: Placed, openings: Placed[]): Box2[] {
  const { placed, definition } = wall;
  const frame = wallFrame(definition, placed.position, placed.rotationY);
  const length = definition.dimensions.width * placed.scale.x;
  const thickness = definition.dimensions.depth * placed.scale.z;
  const gaps = openingRects(definition, placed, openings).filter((r) => r.v0 <= DOOR_SILL_MAX);
  const parts: Array<[number, number]> = [];
  let cursor = -length / 2;
  for (const gap of gaps) {
    if (gap.u0 > cursor) parts.push([cursor, Math.min(gap.u0, length / 2)]);
    cursor = Math.max(cursor, gap.u1);
  }
  if (cursor < length / 2) parts.push([cursor, length / 2]);
  return parts
    .filter(([a, b]) => b - a > EPS)
    .map(([a, b]) => {
      const mid = (a + b) / 2;
      const cx = frame.center.x + frame.dir.x * mid;
      const cz = frame.center.z + frame.dir.z * mid;
      const along = (b - a) / 2;
      const across = thickness / 2;
      const hx = Math.abs(frame.dir.x) * along + Math.abs(frame.normal.x) * across;
      const hz = Math.abs(frame.dir.z) * along + Math.abs(frame.normal.z) * across;
      return { minX: tidy(cx - hx), maxX: tidy(cx + hx), minZ: tidy(cz - hz), maxZ: tidy(cz + hz) };
    });
}

/** The wall's unit normal (snapped onto an axis for quarter-turn walls). */
function wallNormal(wall: Placed): { x: number; z: number } {
  return tidyDirection(wallFrame(wall.definition, wall.placed.position, wall.placed.rotationY).normal);
}

function describeDoor(house: InteriorHouse, centre: { x: number; z: number }, width: number, wallNormalDir: { x: number; z: number }): WalkDoor {
  // Point the normal away from the house centre, so an outside door's normal points out.
  const away = (centre.x - house.origin.x) * wallNormalDir.x + (centre.z - house.origin.z) * wallNormalDir.z;
  const normal = away < -EPS ? { x: -wallNormalDir.x, z: -wallNormalDir.z } : wallNormalDir;
  const side = (sign: 1 | -1) => sideAt(house, centre.x + normal.x * SIDE_PROBE * sign, centre.z + normal.z * SIDE_PROBE * sign);
  return { x: tidy(centre.x), z: tidy(centre.z), width, normal: tidyDirection(normal), sides: [side(1), side(-1)] };
}

function describeWindow(house: InteriorHouse, centre: { x: number; z: number }, wallNormalDir: { x: number; z: number }): WalkWindow {
  for (const sign of [1, -1]) {
    const room = roomAt(house, centre.x + wallNormalDir.x * SIDE_PROBE * sign, centre.z + wallNormalDir.z * SIDE_PROBE * sign);
    if (room) return { x: tidy(centre.x), z: tidy(centre.z), normal: tidyDirection({ x: wallNormalDir.x * sign, z: wallNormalDir.z * sign }), roomId: room.id };
  }
  const inward = { x: house.origin.x - centre.x, z: house.origin.z - centre.z };
  const length = Math.hypot(inward.x, inward.z) || 1;
  return { x: tidy(centre.x), z: tidy(centre.z), normal: tidyDirection({ x: inward.x / length, z: inward.z / length }), roomId: null };
}

/** The room at a point beside a door, 'outside' past the outer walls, else the nearest room (a point inside a wall). */
function sideAt(house: InteriorHouse, x: number, z: number): string {
  const room = roomAt(house, x, z);
  if (room) return room.id;
  if (!contains(house.footprint, x, z) || house.rooms.length === 0) return OUTSIDE;
  let best = house.rooms[0];
  for (const r of house.rooms) if (distanceSquared(r.rect, { x, z }) < distanceSquared(best.rect, { x, z })) best = r;
  return best.id;
}

/** A wall the child built inside the house: it stands between the floor and the ceiling. */
function standsInRooms(house: InteriorHouse, placed: PlacedObject, definition: ConstructionObjectDefinition): boolean {
  const top = placed.position.y + definition.dimensions.height * placed.scale.y;
  return top > house.floorY + FLAT_ON_FLOOR && placed.position.y < house.ceilingY - FLAT_ON_FLOOR;
}

function isFurniture(house: InteriorHouse, placed: PlacedObject, definition: ConstructionObjectDefinition, minHeight: number): boolean {
  const height = definition.dimensions.height * placed.scale.y;
  return standsInRooms(house, placed, definition) && height >= minHeight;
}

// ------------------------------------------------------------- doors, tours

/** The front door: a door out of the house in its front wall (house-local +Z). */
function frontDoor(model: WalkModel): WalkDoor | null {
  const { house } = model;
  const frontZ = house.plan.size.depth / 2 - 0.5;
  const candidates = model.doors
    .filter((d) => d.sides.includes(OUTSIDE) && d.sides.some((s) => s !== OUTSIDE))
    .map((door) => ({ door, local: worldToHouse(house, door) }))
    .filter((c) => c.local.z >= frontZ)
    .sort((a, b) => Math.abs(a.local.x) - Math.abs(b.local.x));
  return candidates[0]?.door ?? null;
}

function roomBehind(model: WalkModel, door: WalkDoor): InteriorRoom | null {
  const id = door.sides.find((s) => s !== OUTSIDE);
  return model.house.rooms.find((r) => r.id === id) ?? null;
}

/**
 * Breadth-first walk through the house's inner doors, from the room behind
 * the front door (else the living room, else the first room); rooms it
 * cannot reach start walks of their own, in house order. `via` is the door
 * each room was first entered by (the front door for the first room).
 */
function walkThrough(model: WalkModel): { order: string[]; via: Map<string, WalkDoor> } {
  const rooms = model.house.rooms;
  const index = new Map(rooms.map((r, i) => [r.id, i]));
  const links = new Map<string, Array<{ to: string; door: WalkDoor }>>();
  for (const door of model.doors) {
    const [a, b] = door.sides;
    if (a === b || !index.has(a) || !index.has(b)) continue;
    links.set(a, [...(links.get(a) ?? []), { to: b, door }]);
    links.set(b, [...(links.get(b) ?? []), { to: a, door }]);
  }
  const front = frontDoor(model);
  const entry = (front ? roomBehind(model, front) : null) ?? findRoom(model.house, { type: 'living' }) ?? rooms[0];
  const order: string[] = [];
  const via = new Map<string, WalkDoor>();
  if (front && entry) via.set(entry.id, front);
  const seen = new Set<string>();
  const visit = (start: string) => {
    seen.add(start);
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.shift()!;
      order.push(id);
      const next = [...(links.get(id) ?? [])].sort((a, b) => index.get(a.to)! - index.get(b.to)!);
      for (const link of next) {
        if (seen.has(link.to)) continue;
        seen.add(link.to);
        via.set(link.to, link.door);
        queue.push(link.to);
      }
    }
  };
  if (entry) visit(entry.id);
  for (const room of rooms) if (!seen.has(room.id)) visit(room.id);
  return { order, via };
}

/** The door a child comes into this room by on the tour, else any door of the room. */
function entranceOf(model: WalkModel, room: InteriorRoom): WalkDoor | null {
  return walkThrough(model).via.get(room.id) ?? model.doors.find((d) => d.sides.includes(room.id)) ?? null;
}

/** The door's normal turned to point into `roomId`, or null when the door is not one of that room's. */
function inwardNormal(door: WalkDoor, roomId: string): { x: number; z: number } | null {
  if (door.sides[0] === roomId) return door.normal;
  if (door.sides[1] === roomId) return { x: -door.normal.x, z: -door.normal.z };
  return null;
}

/** The door-wide, 0.9 m deep floor in front of each door of the room (from the wall face into the room). */
function doorZones(model: WalkModel, room: InteriorRoom): Box2[] {
  const zones: Box2[] = [];
  for (const door of model.doors) {
    const inward = inwardNormal(door, room.id);
    if (!inward) continue;
    const half = door.width / 2;
    const r = room.rect;
    if (Math.abs(inward.x) >= Math.abs(inward.z)) {
      const face = inward.x > 0 ? Math.max(door.x, r.minX) : Math.min(door.x, r.maxX);
      const far = face + Math.sign(inward.x) * DOOR_CLEAR_DEPTH;
      zones.push({ minX: Math.min(door.x, far), maxX: Math.max(door.x, far), minZ: door.z - half, maxZ: door.z + half });
    } else {
      const face = inward.z > 0 ? Math.max(door.z, r.minZ) : Math.min(door.z, r.maxZ);
      const far = face + Math.sign(inward.z) * DOOR_CLEAR_DEPTH;
      zones.push({ minX: door.x - half, maxX: door.x + half, minZ: Math.min(door.z, far), maxZ: Math.max(door.z, far) });
    }
  }
  return zones;
}

// ---------------------------------------------------------------- viewpoints

/** A free spot just inside `door`, in `room`. */
function doorwaySpot(model: WalkModel, room: InteriorRoom, door: WalkDoor): { x: number; z: number } | null {
  const inward = inwardNormal(door, room.id);
  if (!inward) return null;
  const tangent = { x: -inward.z, z: inward.x };
  for (const depth of DOORWAY_DEPTHS) {
    for (const offset of DOORWAY_OFFSETS) {
      const p = { x: tidy(door.x + inward.x * depth + tangent.x * offset), z: tidy(door.z + inward.z * depth + tangent.z * offset) };
      if (contains(room.rect, p.x, p.z) && isFree(model, p)) return p;
    }
  }
  return null;
}

/** The free corners of the room, 0.45 m from its walls. */
function cornerSpots(model: WalkModel, room: InteriorRoom): Array<{ x: number; z: number }> {
  const r = room.rect;
  const corners = [
    { x: r.minX + CORNER_PAD, z: r.minZ + CORNER_PAD },
    { x: r.maxX - CORNER_PAD, z: r.minZ + CORNER_PAD },
    { x: r.minX + CORNER_PAD, z: r.maxZ - CORNER_PAD },
    { x: r.maxX - CORNER_PAD, z: r.maxZ - CORNER_PAD },
  ].map((c) => ({ x: tidy(c.x), z: tidy(c.z) }));
  return corners.filter((c) => contains(r, c.x, c.z) && isFree(model, c));
}

/** A straight walk from `a` to `b` touches nothing (checked every 5 cm). */
function clearWalk(model: WalkModel, a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / LINE_STEP));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    if (!isFree(model, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false;
  }
  return true;
}

/** Where a viewpoint at `spot` looks: the room's centre, or its far corner when standing in the middle. */
function lookTarget(room: InteriorRoom, spot: { x: number; z: number }): { x: number; z: number } {
  const centre = room.center;
  return Math.hypot(centre.x - spot.x, centre.z - spot.z) >= 0.8 ? centre : farthestCorner(room.rect, spot);
}

/**
 * How much of the room a standing spot shows: its longest sightline across
 * the room (to the far corner), less a penalty when furniture stands within
 * 1.2 m on the line it looks along (a bed or a wardrobe would fill the view).
 */
function viewScore(model: WalkModel, room: InteriorRoom, spot: { x: number; z: number }): number {
  const far = farthestCorner(room.rect, spot);
  const reach = Math.hypot(far.x - spot.x, far.z - spot.z);
  const target = lookTarget(room, spot);
  const length = Math.hypot(target.x - spot.x, target.z - spot.z);
  if (length < EPS) return reach;
  const ahead = { x: spot.x + ((target.x - spot.x) / length) * VIEW_BLOCK_DISTANCE, z: spot.z + ((target.z - spot.z) / length) * VIEW_BLOCK_DISTANCE };
  const filled = model.furniture.some((box) => segmentHitsBox(spot, ahead, box));
  return reach - (filled ? VIEW_BLOCK_PENALTY : 0);
}

/** Whether the segment a-b passes through the box (touching counts). */
function segmentHitsBox(a: { x: number; z: number }, b: { x: number; z: number }, box: Box2): boolean {
  let t0 = 0;
  let t1 = 1;
  const axes: Array<[number, number, number, number]> = [
    [a.x, b.x - a.x, box.minX, box.maxX],
    [a.z, b.z - a.z, box.minZ, box.maxZ],
  ];
  for (const [start, delta, min, max] of axes) {
    if (Math.abs(delta) < EPS) {
      if (start < min || start > max) return false;
      continue;
    }
    let u0 = (min - start) / delta;
    let u1 = (max - start) / delta;
    if (u0 > u1) [u0, u1] = [u1, u0];
    t0 = Math.max(t0, u0);
    t1 = Math.min(t1, u1);
    if (t0 > t1) return false;
  }
  return true;
}

/** The room's centre when free, else the free grid point nearest it, else the centre anyway. */
function centreSpot(model: WalkModel, room: InteriorRoom): { x: number; z: number } {
  const centre = room.center;
  if (isFree(model, centre)) return { ...centre };
  let best: { x: number; z: number } | null = null;
  let bestDistance = Infinity;
  for (const x of gridAlong(room.rect.minX, room.rect.maxX)) {
    for (const z of gridAlong(room.rect.minZ, room.rect.maxZ)) {
      const d = Math.hypot(x - centre.x, z - centre.z);
      if (d < bestDistance && isFree(model, { x, z })) {
        best = { x, z };
        bestDistance = d;
      }
    }
  }
  return best ?? { ...centre };
}

function pose(model: WalkModel, spot: { x: number; z: number }, look: { x: number; z: number }): ViewPose {
  const yaw = Math.hypot(look.x, look.z) < EPS ? 0 : Math.atan2(-look.x, -look.z);
  return { x: spot.x, y: tidy(model.house.floorY + EYE_HEIGHT), z: spot.z, yaw, pitch: VIEW_PITCH };
}

function farthestCorner(rect: Box2, p: { x: number; z: number }): { x: number; z: number } {
  return { x: Math.abs(rect.minX - p.x) > Math.abs(rect.maxX - p.x) ? rect.minX : rect.maxX, z: Math.abs(rect.minZ - p.z) > Math.abs(rect.maxZ - p.z) ? rect.minZ : rect.maxZ };
}

// ----------------------------------------------------------------- collision

/** Move along one axis as far as is free (all of `delta` when nothing is in the way). */
function slideAxis(model: WalkModel, p: { x: number; z: number }, axis: 'x' | 'z', delta: number, radius: number): { x: number; z: number } {
  if (delta === 0) return p;
  const at = (t: number) => (axis === 'x' ? { x: p.x + delta * t, z: p.z } : { x: p.x, z: p.z + delta * t });
  const whole = at(1);
  if (isFree(model, whole, radius)) return whole;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 14; k++) {
    const mid = (lo + hi) / 2;
    if (isFree(model, at(mid), radius)) lo = mid;
    else hi = mid;
  }
  return lo === 0 ? p : at(lo);
}

/**
 * The nearest free point to a stuck walker (furniture was put on top of
 * them): first in the same room - so nobody is pushed through a wall into
 * the next room - then anywhere in the house. Rings of growing radius,
 * refined to the edge of the free floor; failing that, a grid search.
 */
function nearestFree(model: WalkModel, from: { x: number; z: number }, radius: number): { x: number; z: number } {
  const start = clampInside(model.bounds, Number.isFinite(from.x) && Number.isFinite(from.z) ? from : centreOf(model.bounds), radius);
  if (isFree(model, start, radius)) return start;
  const room = roomAt(model.house, start.x, start.z);
  if (room) {
    const inRoom = nearestFreeWhere(model, start, radius, (p) => roomAt(model.house, p.x, p.z) === room);
    if (inRoom) return inRoom;
  }
  return nearestFreeWhere(model, start, radius, () => true) ?? start;
}

function nearestFreeWhere(model: WalkModel, start: { x: number; z: number }, radius: number, accept: (p: { x: number; z: number }) => boolean): { x: number; z: number } | null {
  const ok = (p: { x: number; z: number }) => isFree(model, p, radius) && accept(p);
  for (let ring = 1; ring * PUSH_STEP <= PUSH_REACH; ring++) {
    const d = ring * PUSH_STEP;
    const count = Math.max(8, Math.ceil((2 * Math.PI * d) / PUSH_STEP));
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 2 * Math.PI;
      const dir = { x: Math.cos(angle), z: Math.sin(angle) };
      const at = (t: number) => ({ x: start.x + dir.x * t, z: start.z + dir.z * t });
      if (!ok(at(d))) continue;
      // Refine between the last blocked ring and this free one.
      let lo = d - PUSH_STEP;
      let hi = d;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2;
        if (ok(at(mid))) hi = mid;
        else lo = mid;
      }
      return at(hi);
    }
  }
  let best: { x: number; z: number } | null = null;
  let bestDistance = Infinity;
  for (const x of gridAlong(model.bounds.minX + radius, model.bounds.maxX - radius)) {
    for (const z of gridAlong(model.bounds.minZ + radius, model.bounds.maxZ - radius)) {
      const d = Math.hypot(x - start.x, z - start.z);
      if (d < bestDistance && ok({ x, z })) {
        best = { x, z };
        bestDistance = d;
      }
    }
  }
  return best;
}

function clampInside(bounds: Box2, p: { x: number; z: number }, radius: number): { x: number; z: number } {
  const clampAxis = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  return { x: clampAxis(p.x, bounds.minX + radius, bounds.maxX - radius), z: clampAxis(p.z, bounds.minZ + radius, bounds.maxZ - radius) };
}

// ------------------------------------------------------------ furniture spots

/** Ranking of a candidate spot (smaller is better), before the turn and position tie-breaks. */
function spotScore(
  near: 'window' | 'wall' | 'centre' | { x: number; z: number },
  room: InteriorRoom,
  box: Box2,
  rotationY: number,
  windows: WalkWindow[],
): number[] {
  const centre = { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
  const toRoomCentre = Math.hypot(centre.x - room.center.x, centre.z - room.center.z);
  if (near === 'centre') return [round3(toRoomCentre)];
  if (near === 'window') return [round3(Math.min(...windows.map((w) => Math.hypot(w.x - centre.x, w.z - centre.z)))), round3(toRoomCentre)];
  if (near !== 'wall') return [round3(Math.hypot(near.x - centre.x, near.z - centre.z)), round3(toRoomCentre)];
  // Back against a wall: the gap behind the piece, then how far it sits from the middle of that wall.
  const r = room.rect;
  const back = tidyDirection(rotateAroundY(0, -1, rotationY));
  const gaps: Array<{ gap: number; offCentre: number }> = [];
  if (back.z < -0.99) gaps.push({ gap: box.minZ - r.minZ, offCentre: Math.abs(centre.x - room.center.x) });
  if (back.z > 0.99) gaps.push({ gap: r.maxZ - box.maxZ, offCentre: Math.abs(centre.x - room.center.x) });
  if (back.x < -0.99) gaps.push({ gap: box.minX - r.minX, offCentre: Math.abs(centre.z - room.center.z) });
  if (back.x > 0.99) gaps.push({ gap: r.maxX - box.maxX, offCentre: Math.abs(centre.z - room.center.z) });
  if (gaps.length === 0) {
    // Not a quarter turn: whichever wall is closest.
    gaps.push({ gap: Math.min(box.minZ - r.minZ, r.maxZ - box.maxZ, box.minX - r.minX, r.maxX - box.maxX), offCentre: toRoomCentre });
  }
  const { gap, offCentre } = gaps[0];
  return [round3(gap), round3(offCentre), round3(toRoomCentre)];
}

/** Half the footprint of a width x depth piece turned by rotationY (exact for quarter turns). */
function turnedHalfSize(width: number, depth: number, rotationY: number): { x: number; z: number } {
  const cos = Math.abs(Math.cos(rotationY));
  const sin = Math.abs(Math.sin(rotationY));
  return { x: tidy((width * cos + depth * sin) / 2), z: tidy((width * sin + depth * cos) / 2) };
}

/** Grid positions from lo to hi in 0.1 m steps, hi itself included; empty when lo > hi. */
function gridAlong(lo: number, hi: number): number[] {
  if (!(hi >= lo - EPS)) return [];
  const count = Math.floor((hi - lo) / SPOT_GRID + 1e-6);
  const out: number[] = [];
  for (let k = 0; k <= count; k++) out.push(tidy(lo + k * SPOT_GRID));
  if (out[out.length - 1] < hi - 1e-6) out.push(tidy(hi));
  return out;
}

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false;
}

// -------------------------------------------------------------------- boxes

function grow(box: Box2, pad: number): Box2 {
  return { minX: box.minX - pad, maxX: box.maxX + pad, minZ: box.minZ - pad, maxZ: box.maxZ + pad };
}

/** Boxes sharing area (touching edges do not count). */
function overlaps(a: Box2, b: Box2): boolean {
  return a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minZ < b.maxZ - EPS && b.minZ < a.maxZ - EPS;
}

function contains(box: Box2, x: number, z: number): boolean {
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}

function strictlyInside(box: Box2, p: { x: number; z: number }): boolean {
  return p.x > box.minX && p.x < box.maxX && p.z > box.minZ && p.z < box.maxZ;
}

/** Squared distance from a point to a box (0 inside it). */
function distanceSquared(box: Box2, p: { x: number; z: number }): number {
  const dx = Math.max(box.minX - p.x, 0, p.x - box.maxX);
  const dz = Math.max(box.minZ - p.z, 0, p.z - box.maxZ);
  return dx * dx + dz * dz;
}

function centreOf(box: Box2): { x: number; z: number } {
  return { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
}

/** A unit direction with float noise removed (an exact axis for quarter turns). */
function tidyDirection(v: { x: number; z: number }): { x: number; z: number } {
  return { x: Math.round(v.x * TIDY) / TIDY + 0, z: Math.round(v.z * TIDY) / TIDY + 0 };
}

function tidy(value: number): number {
  return Math.round(value * TIDY) / TIDY;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
