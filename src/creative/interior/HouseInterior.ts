import { roleOf } from '@/construction/ConstructionObjectDefinition';
import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import { roomName, type ConstructionPlan, type HousePlan, type RoomType } from '@/creative/plan/ConstructionPlan';
import { layoutHouse, type HouseLayout } from '@/creative/plan/HouseLayout';
import { neighborhoodHouse } from '@/creative/plan/NeighborhoodLayout';
import { layoutPlan } from '@/creative/plan/PlanLayouts';
import { rotateAroundY } from '@/utils/math';

/**
 * The inside of one planned house, in world metres - what the Interior
 * Explorer needs to walk a child through it: its rooms (named the way a
 * child says them, "Bedroom 2"), its floor and ceiling heights, and the
 * frame that turns house-local points into world points.
 *
 * Rooms are never stored: they are recomputed from the plan with the same
 * pure, deterministic layout that built the house (HouseLayout), then placed
 * with the plan record's origin and quarter-turn rotation - exactly how the
 * pieces themselves were placed. So the same record always describes the
 * same rooms, after any reload.
 *
 * Pure data and maths: no DOM, no three.js scene, safe to load headlessly.
 */

/** Camera eye height above the floor top, metres. */
export const EYE_HEIGHT = 1.45;
/** Walker collision radius, metres. */
export const WALK_RADIUS = 0.28;

/** An axis-aligned box on the ground, world metres. */
export interface Box2 {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface InteriorRoom {
  /** Stable id: type and 1-based ordinal ("living-1", "bedroom-2"). */
  id: string;
  type: RoomType;
  /** 1-based among rooms of the same type, in layout order (the furniture key ordinal + 1). */
  ordinal: number;
  /** What a child calls it: "Kitchen", or "Bedroom 2" when the house has more than one bedroom. */
  name: string;
  /** Storey index; houses are single-storey, so always 0. */
  floor: number;
  /** Clear floor between the wall faces, world metres. */
  rect: Box2;
  center: { x: number; z: number };
  /** Floor area, square metres. */
  area: number;
  /** Layout keys of this room's planned furniture that were really built (prefixed "h2/" inside a neighbourhood). */
  furnitureKeys: string[];
}

export interface InteriorFloor {
  index: number;
  name: string;
  roomIds: string[];
}

export interface InteriorHouse {
  /** Creation Group id of the built version this describes. */
  groupId: string;
  /** Which house of a neighbourhood (0-based), or null for a single house. */
  houseIndex: number | null;
  /** "Your house" / the plan's own name, or "House 3" inside a neighbourhood. */
  name: string;
  /**
   * The house's own plan (for a neighbourhood: that one house, with the
   * child's changes to it), its rooms listed front row first, then back row,
   * in the order they stand - so `layoutHouse(plan)` gives exactly the
   * layout that was built.
   */
  plan: HousePlan;
  /** World position of the house-local origin (footprint centre, on the ground). */
  origin: { x: number; y: number; z: number };
  /** World turn of the house frame (quarter turns), radians. */
  rotationY: number;
  /** World y of the floor top. */
  floorY: number;
  /** World y of the wall tops. */
  ceilingY: number;
  /** Outer wall faces, world metres. */
  footprint: Box2;
  rooms: InteriorRoom[];
  floors: InteriorFloor[];
  /** Layout key prefix of this house's pieces: "" for a single house, "h2/" for house 3 of a neighbourhood. */
  keyPrefix: string;
}

/** The parts of a PlanRecord (src/creative/plan/PlanRecords.ts) the interior needs. */
export interface PlanRecordLike {
  plan: ConstructionPlan;
  origin: { x: number; y: number; z: number };
  rotationY: number;
  pieces: Record<string, { key: string; x: number; z: number; rotationY: number }>;
}

/** Name of the one storey a planned house has. */
const GROUND_FLOOR = 'Ground floor';
/** Coordinates are tidied to this precision (1 micrometre) so quarter-turn maths reads cleanly. */
const TIDY = 1e6;

/**
 * Describe the inside of a planned house (or of house `houseIndex` of a
 * planned neighbourhood; the index is ignored for a single house). Null
 * when the plan is not a house, the neighbourhood has no such house, or the
 * house has no rooms - callers must then say honestly that there is no
 * inside to explore.
 */
export function describeHouseInterior(
  groupId: string,
  record: PlanRecordLike,
  registry: ObjectRegistry,
  houseIndex: number | null,
): InteriorHouse | null {
  const frame = houseFrame(record, registry, houseIndex);
  if (!frame) return null;
  const standing = standingLayout(frame, record, registry);
  if (!standing || standing.layout.rooms.length === 0) return null;
  const { plan, layout } = standing;
  const heights = pieceHeights(layout, registry);
  if (!heights) return null;

  const { rotationY, keyPrefix } = frame;
  const origin = { x: tidy(frame.origin.x), y: record.origin.y, z: tidy(frame.origin.z) };
  const floorY = tidy(origin.y + heights.floor);
  const toWorld = (rect: Box2): Box2 => worldBox(origin, rotationY, rect);
  const halfW = layout.footprint.width / 2;
  const halfD = layout.footprint.depth / 2;
  const built = new Set(Object.values(record.pieces).map((p) => p.key));
  const rooms = buildRooms(layout, toWorld, keyPrefix, built);
  return {
    groupId,
    houseIndex: frame.houseIndex,
    name: frame.name,
    plan,
    origin,
    rotationY,
    floorY,
    ceilingY: tidy(floorY + heights.wall),
    footprint: toWorld({ minX: -halfW, maxX: halfW, minZ: -halfD, maxZ: halfD }),
    rooms,
    floors: [{ index: 0, name: GROUND_FLOOR, roomIds: rooms.map((r) => r.id) }],
    keyPrefix,
  };
}

/** A house-local point in world metres. */
export function houseToWorld(house: InteriorHouse, local: { x: number; z: number }): { x: number; z: number } {
  const turned = rotateAroundY(local.x, local.z, house.rotationY);
  return { x: house.origin.x + turned.x, z: house.origin.z + turned.z };
}

/** A world point in the house's own frame (front door towards +Z). */
export function worldToHouse(house: InteriorHouse, world: { x: number; z: number }): { x: number; z: number } {
  return rotateAroundY(world.x - house.origin.x, world.z - house.origin.z, -house.rotationY);
}

/** The room whose clear floor contains this world point (edges included), or null (inside a wall, or outside). */
export function roomAt(house: InteriorHouse, x: number, z: number): InteriorRoom | null {
  return house.rooms.find((r) => x >= r.rect.minX && x <= r.rect.maxX && z >= r.rect.minZ && z <= r.rect.maxZ) ?? null;
}

/**
 * Find a room by id, or by type and 1-based ordinal (a type alone means the
 * first of that type). Null when the house has no such room - "take me to
 * the bathroom" in a house without one must be answered honestly.
 */
export function findRoom(house: InteriorHouse, query: { id?: string; type?: RoomType; ordinal?: number }): InteriorRoom | null {
  if (query.id !== undefined) {
    const room = house.rooms.find((r) => r.id === query.id) ?? null;
    if (!room) return null;
    if (query.type !== undefined && room.type !== query.type) return null;
    if (query.ordinal !== undefined && room.ordinal !== query.ordinal) return null;
    return room;
  }
  if (query.type === undefined) return null;
  const ordinal = query.ordinal ?? 1;
  return house.rooms.find((r) => r.type === query.type && r.ordinal === ordinal) ?? null;
}

// ------------------------------------------------------------------ helpers

interface HouseFrame {
  plan: HousePlan;
  houseIndex: number | null;
  name: string;
  keyPrefix: string;
  /** World position of the house-local origin. */
  origin: { x: number; z: number };
  /** World turn of the house frame, radians. */
  rotationY: number;
}

/**
 * Where a house stands: a single house is the record's own frame; house i of
 * a neighbourhood sits at its layout slot (`layout.houses[i]`) inside the
 * record's frame, with the slot's extra turn added.
 */
function houseFrame(record: PlanRecordLike, registry: ObjectRegistry, houseIndex: number | null): HouseFrame | null {
  const { plan } = record;
  if (plan.kind === 'house') {
    return {
      plan,
      houseIndex: null,
      name: plan.name.trim() || 'Your house',
      keyPrefix: '',
      origin: { x: record.origin.x, z: record.origin.z },
      rotationY: record.rotationY,
    };
  }
  if (plan.kind !== 'neighborhood') return null;
  if (houseIndex === null || !Number.isInteger(houseIndex) || houseIndex < 0 || houseIndex >= plan.houses) return null;
  let slot: { origin: { x: number; z: number }; rotationY: number; prefix: string } | undefined;
  try {
    slot = layoutPlan(plan, registry).houses?.find((h) => h.index === houseIndex);
  } catch {
    return null;
  }
  if (!slot) return null;
  const offset = rotateAroundY(slot.origin.x, slot.origin.z, record.rotationY);
  return {
    plan: neighborhoodHouse(plan, houseIndex),
    houseIndex,
    name: `House ${houseIndex + 1}`,
    keyPrefix: `${slot.prefix}/`,
    origin: { x: record.origin.x + offset.x, z: record.origin.z + offset.z },
    rotationY: record.rotationY + slot.rotationY,
  };
}

/**
 * The house's layout as it was built. HouseLayout puts the living room and
 * kitchen in the front row and bedrooms and bathrooms in the back row, each
 * row in the order the rooms were asked for - but a saved plan comes back
 * with its rooms grouped by type (planInput), which can be a different
 * order. So the room orders that could have been asked for are tried, the
 * plan's own first, and the one whose walls and openings stand exactly
 * where the record says they were built wins. A record without structural
 * pieces (or with none matching) keeps the plan's own order.
 */
function standingLayout(frame: HouseFrame, record: PlanRecordLike, registry: ObjectRegistry): { plan: HousePlan; layout: HouseLayout } | null {
  const structure = builtStructure(frame, record);
  let best: { plan: HousePlan; layout: HouseLayout; score: number } | null = null;
  for (const rooms of roomOrders(frame.plan.rooms)) {
    const plan: HousePlan = { ...frame.plan, rooms };
    let layout: HouseLayout;
    try {
      layout = layoutHouse(plan, registry);
    } catch {
      return null;
    }
    const score = matchingPieces(layout, structure);
    if (!best || score > best.score) best = { plan, layout, score };
    if (score === structure.size) break;
  }
  return best;
}

/** Most room orders tried when recovering the order a house was built in. */
const MAX_ROOM_ORDERS = 400;
/** How close (m) a recorded piece must be to a laid-out one to count as the same piece. */
const SAME_SPOT = 0.02;

/** Where this house's walls and openings were built (record.pieces), house-local metres, by layout key without the house prefix. */
function builtStructure(frame: HouseFrame, record: PlanRecordLike): Map<string, { x: number; z: number }> {
  const out = new Map<string, { x: number; z: number }>();
  for (const piece of Object.values(record.pieces)) {
    if (!piece.key.startsWith(frame.keyPrefix)) continue;
    const key = piece.key.slice(frame.keyPrefix.length);
    if (!key.startsWith('wall:') && !key.startsWith('opening:')) continue;
    out.set(key, rotateAroundY(piece.x - frame.origin.x, piece.z - frame.origin.z, -frame.rotationY));
  }
  return out;
}

/** How many recorded structural pieces stand exactly where this layout puts them. */
function matchingPieces(layout: HouseLayout, structure: Map<string, { x: number; z: number }>): number {
  if (structure.size === 0) return 0;
  const laidOut = new Map<string, { x: number; z: number }>();
  layout.keys.forEach((key, i) => laidOut.set(key, layout.objects[i].position));
  let matched = 0;
  for (const [key, spot] of structure) {
    const at = laidOut.get(key);
    if (at && Math.abs(at.x - spot.x) <= SAME_SPOT && Math.abs(at.z - spot.z) <= SAME_SPOT) matched++;
  }
  return matched;
}

/** Bedrooms and bathrooms go in the back row (as HouseLayout lays them out); the rest in the front row. */
function isBackRoom(type: RoomType): boolean {
  return type === 'bedroom' || type === 'bathroom';
}

/**
 * Room lists that lay out differently: only the order within the front row
 * and within the back row matters, so each is written front row first. The
 * plan's own order comes first, then every other arrangement (up to a cap).
 */
function* roomOrders(rooms: readonly RoomType[]): Generator<RoomType[]> {
  const front = rooms.filter((t) => !isBackRoom(t));
  const back = rooms.filter(isBackRoom);
  const own = [...front, ...back];
  yield own;
  let tried = 1;
  for (const f of arrangements(front)) {
    for (const b of arrangements(back)) {
      const order = [...f, ...b];
      if (order.every((t, i) => t === own[i])) continue;
      if (++tried > MAX_ROOM_ORDERS) return;
      yield order;
    }
  }
}

/** Every distinct ordering of a list of room types (types repeat, so far fewer than n!). */
function* arrangements(items: readonly RoomType[]): Generator<RoomType[]> {
  const counts = new Map<RoomType, number>();
  for (const t of items) counts.set(t, (counts.get(t) ?? 0) + 1);
  const types = [...counts.keys()];
  const order: RoomType[] = [];
  function* extend(): Generator<RoomType[]> {
    if (order.length === items.length) {
      yield [...order];
      return;
    }
    for (const t of types) {
      const left = counts.get(t) ?? 0;
      if (left === 0) continue;
      counts.set(t, left - 1);
      order.push(t);
      yield* extend();
      order.pop();
      counts.set(t, left);
    }
  }
  yield* extend();
}

/** Floor tile thickness and wall height, read from the catalogue pieces the layout really used. */
function pieceHeights(layout: HouseLayout, registry: ObjectRegistry): { floor: number; wall: number } | null {
  const definitionOf = (prefix: string, role: 'floor' | 'wall') => {
    const index = layout.keys.findIndex((k) => k.startsWith(prefix));
    const definition = index >= 0 ? registry.get(layout.objects[index].definitionId) : undefined;
    return definition && roleOf(definition) === role ? definition : null;
  };
  const floor = definitionOf('floor:', 'floor');
  const wall = definitionOf('wall:', 'wall');
  return floor && wall ? { floor: floor.dimensions.height, wall: wall.dimensions.height } : null;
}

/** The layout's rooms in world metres, with ids, child-facing names and the keys of their furniture. */
function buildRooms(layout: HouseLayout, toWorld: (rect: Box2) => Box2, keyPrefix: string, built: Set<string>): InteriorRoom[] {
  const totals = new Map<RoomType, number>();
  for (const room of layout.rooms) totals.set(room.type, (totals.get(room.type) ?? 0) + 1);
  const seen = new Map<RoomType, number>();
  return layout.rooms.map((room) => {
    const ordinal = (seen.get(room.type) ?? 0) + 1;
    seen.set(room.type, ordinal);
    const rect = toWorld(room.rect);
    const furniturePrefix = `furn:${room.type}#${ordinal - 1}:`;
    const furnitureKeys = layout.keys.filter((k) => k.startsWith(furniturePrefix)).map((k) => keyPrefix + k).filter((k) => built.has(k));
    const label = capitalise(roomName(room.type));
    return {
      id: `${room.type}-${ordinal}`,
      type: room.type,
      ordinal,
      name: (totals.get(room.type) ?? 0) > 1 ? `${label} ${ordinal}` : label,
      floor: 0,
      rect,
      center: { x: tidy((rect.minX + rect.maxX) / 2), z: tidy((rect.minZ + rect.maxZ) / 2) },
      // From whole decimetres, so 4.6 x 3.6 m is exactly 16.56 m2.
      area: (Math.round((room.rect.maxX - room.rect.minX) * 10) * Math.round((room.rect.maxZ - room.rect.minZ) * 10)) / 100,
      furnitureKeys,
    };
  });
}

/** A house-local box in world metres: its four corners turned and moved (exact for quarter turns). */
function worldBox(origin: { x: number; z: number }, rotationY: number, rect: Box2): Box2 {
  const corners = [
    [rect.minX, rect.minZ],
    [rect.maxX, rect.minZ],
    [rect.minX, rect.maxZ],
    [rect.maxX, rect.maxZ],
  ].map(([x, z]) => rotateAroundY(x, z, rotationY));
  return {
    minX: tidy(origin.x + Math.min(...corners.map((c) => c.x))),
    maxX: tidy(origin.x + Math.max(...corners.map((c) => c.x))),
    minZ: tidy(origin.z + Math.min(...corners.map((c) => c.z))),
    maxZ: tidy(origin.z + Math.max(...corners.map((c) => c.z))),
  };
}

function tidy(value: number): number {
  return Math.round(value * TIDY) / TIDY;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
