import { roleOf, type ConstructionObjectDefinition } from '@/construction/ConstructionObjectDefinition';
import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import type { TemplateObjectSpec } from '@/creative/Template';
import { roomName, type HousePlan, type RoomType } from './ConstructionPlan';
import { countTypes, grow, pieceKit, rectsOverlap, type LayoutFacts, type LocalRect, type PlanLayout, type RoomLayout } from './LayoutKit';

export type { LocalRect, RoomLayout } from './LayoutKit';
export { isContentKey } from './LayoutKit';

/**
 * Turns a validated HousePlan into an ordinary template object list (see
 * src/creative/Template.ts): floor tiles, wall pieces, doors, windows,
 * furniture and fittings, roof, garden and driveway, positioned around the
 * house origin. Pure and deterministic - the same plan always gives the same
 * layout - and it only ever names catalogue pieces, so the result goes
 * through the normal `instantiateTemplate` validation like any hand-made
 * template.
 *
 * House-local frame: origin at the centre of the footprint on the ground,
 * front (front door, driveway) towards +Z, back towards -Z, width along X.
 *
 * Dimension contract, for a plan of W x D metres (both multiples of 2):
 *   - floor_large tiles (2 x 2 m) cover exactly x in [-W/2, W/2], z in [-D/2, D/2];
 *   - every wall stands on that floor (y = floor height) with its OUTER face
 *     flush with the floor edge, so the walls' outer faces are exactly W x D;
 *   - wall runs are built from the 1.8 / 2.0 / 2.2 m wall pieces and always
 *     add up to the exact run length; joints are butt joints (no overlaps);
 *   - rooms are the clear floor between wall faces;
 *   - furniture and fittings stand inside their room, 0.1 m clear of the
 *     walls, never in front of a door, never on each other, and cover at
 *     most MAX_FURNISHED of the floor so there is room to walk.
 *
 * All arithmetic is done in whole decimetres so runs add up exactly.
 */

const DM = 10;
const QUARTER = Math.PI / 2;

/** Catalogue pieces a house is built from (src/data/objects.json). */
const PARTS = {
  floor: 'floor_large',
  wallShort: 'wall_short',
  wall: 'wall_plain',
  wallLong: 'wall_long',
  door: 'door_single',
  window: 'window_square',
  bed: 'furniture_bed',
  sofa: 'furniture_sofa',
  table: 'furniture_table',
  chair: 'furniture_chair',
  wardrobe: 'furniture_wardrobe',
  counter: 'kitchen_counter',
  bath: 'bath_tub',
  toilet: 'bath_toilet',
  basin: 'bath_basin',
  plant: 'decor_potted_plant',
  trees: ['tree_round', 'tree_pine'],
  bush: 'bush_round',
  flower: 'flower_pink',
  driveway: 'road_driveway',
  car: 'vehicle_sedan',
  fence: 'fence_wood',
  roof: 'roof_gable_long',
  path: 'sidewalk_segment',
} as const;

/** Smallest clear width (dm) each room needs: a bedroom fits a 1.6 m bed with space around it. */
const MIN_ROOM_WIDTH: Record<RoomType, number> = { living: 30, kitchen: 24, bedroom: 28, bathroom: 18 };
/** How much of the spare width each room takes. */
const ROOM_WEIGHT: Record<RoomType, number> = { living: 1.6, kitchen: 1.1, bedroom: 1, bathroom: 0.6 };
/** Shallowest band of rooms (dm) when the house is split into a back and a front row. */
const MIN_BAND_DEPTH = 36;
/** Share of the depth the back row (bedrooms, bathrooms) gets. */
const BACK_BAND_SHARE = 0.45;
/** Roof overhang past the walls (dm), and the ridge height: this share of the narrower side, kept within limits (metres). */
const EAVE = 3;
const ROOF_PITCH = 0.3;
const ROOF_RISE = { min: 1.5, max: 4.5 };
/** Most of a room's floor its furniture may cover, so there is always room to walk. */
const MAX_FURNISHED = 0.45;
/** Floor kept clear in front of and behind every door (dm): a door needs room to open and to walk through. */
const DOOR_CLEARANCE = 10;
/** Walking room kept between pieces of furniture (dm); chairs sit right at their table or desk. */
const FURNITURE_GAP = 4;

/**
 * A house layout. `footprint` is the outer faces of the walls (always centred
 * on the house origin); `extent` the ground covered by everything standing on
 * the ground (house, garden, driveway), house-local metres.
 */
export interface HouseLayout extends PlanLayout {
  rooms: RoomLayout[];
}

interface Segment {
  id: string;
  /** Along the run's axis, dm. */
  from: number;
  to: number;
}

interface Run {
  axis: 'x' | 'z';
  /** Centreline coordinate across the run, dm. */
  at: number;
  rotationY: number;
  segments: Segment[];
}

interface Room {
  type: RoomType;
  /** Clear floor, dm. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

interface Band {
  z0: number;
  z1: number;
  rooms: RoomType[];
}

export function layoutHouse(plan: HousePlan, registry: ObjectRegistry): HouseLayout {
  const kit = resolveKit(registry);
  const notes: string[] = [];
  const objects: TemplateObjectSpec[] = [];
  const W = toDm(plan.size.width);
  const D = toDm(plan.size.depth);
  const T = kit.wallThickness;
  if (W % kit.tile !== 0 || D % kit.tile !== 0) {
    throw new Error(`House size ${plan.size.width} x ${plan.size.depth} m is not a multiple of the ${kit.tile / DM} m floor tile`);
  }
  const floorTop = kit.floorHeight;
  const keys: string[] = [];

  const add = (
    key: string,
    definitionId: string,
    x: number,
    y: number,
    z: number,
    rotationY = 0,
    links: Pick<TemplateObjectSpec, 'localId' | 'hostRef' | 'supportRef' | 'surface' | 'scale'> = {},
  ): void => {
    objects.push({ definitionId, position: { x: x / DM, y, z: z / DM }, ...(rotationY ? { rotationY } : {}), ...links });
    keys.push(key);
  };

  // ------------------------------------------------------------- floor slab
  const cols = W / kit.tile;
  const rows = D / kit.tile;
  const floorId = (i: number, j: number) => `f${i}_${j}`;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      add(`floor:${i}_${j}`, kit.floor, -W / 2 + kit.tile / 2 + i * kit.tile, 0, -D / 2 + kit.tile / 2 + j * kit.tile, 0, { localId: floorId(i, j) });
    }
  }
  const floorAt = (x: number, z: number): string =>
    floorId(clampInt(Math.floor((x + W / 2) / kit.tile), 0, cols - 1), clampInt(Math.floor((z + D / 2) / kit.tile), 0, rows - 1));

  // -------------------------------------------------------------- wall runs
  const addRun = (name: string, axis: 'x' | 'z', at: number, from: number, to: number): Run => {
    const lengths = kit.composeRun(to - from);
    if (!lengths) throw new Error(`No wall pieces add up to ${(to - from) / DM} m`);
    const rotationY = axis === 'x' ? 0 : QUARTER;
    const segments: Segment[] = [];
    let cursor = from;
    lengths.forEach((length, k) => {
      const id = `${name}${k}`;
      const mid = cursor + length / 2;
      const [x, z] = axis === 'x' ? [mid, at] : [at, mid];
      add(`wall:${id}`, kit.wallByLength.get(length)!, x, floorTop, z, rotationY, { localId: id, supportRef: floorAt(x, z), surface: 'top' });
      segments.push({ id, from: cursor, to: cursor + length });
      cursor += length;
    });
    return { axis, at, rotationY, segments };
  };

  // Front and back run the full width; the sides fit between them.
  const back = addRun('wb', 'x', -D / 2 + T / 2, -W / 2, W / 2);
  const front = addRun('wf', 'x', D / 2 - T / 2, -W / 2, W / 2);
  const west = addRun('ww', 'z', -W / 2 + T / 2, -D / 2 + T, D / 2 - T);
  const east = addRun('we', 'z', W / 2 - T / 2, -D / 2 + T, D / 2 - T);
  const clear = { minX: -W / 2 + T, maxX: W / 2 - T, minZ: -D / 2 + T, maxZ: D / 2 - T };

  // ------------------------------------------------------------------ rooms
  const asked = [...plan.rooms];
  if (!asked.includes('living')) {
    asked.unshift('living');
    notes.push('Every house gets a living room, so the front door has somewhere to open.');
  }
  const isPrivate = (type: RoomType) => type === 'bedroom' || type === 'bathroom';
  const publicRooms = asked.filter((t) => !isPrivate(t));
  const privateRooms = asked.filter(isPrivate);

  // Bedrooms and bathrooms along the back, living room and kitchen along the
  // front, split by one long wall; a house without private rooms is one row.
  const depth = clear.maxZ - clear.minZ;
  const backDepth = privateRooms.length > 0 ? chooseBackDepth(depth, T, kit) : null;
  let divider: Run | null = null;
  const bands: Band[] = [];
  if (backDepth !== null) {
    const zDivider = clear.minZ + backDepth + T / 2;
    divider = addRun('wd', 'x', zDivider, clear.minX, clear.maxX);
    bands.push({ z0: clear.minZ, z1: clear.minZ + backDepth, rooms: privateRooms });
    bands.push({ z0: zDivider + T / 2, z1: clear.maxZ, rooms: publicRooms });
  } else {
    bands.push({ z0: clear.minZ, z1: clear.maxZ, rooms: [...publicRooms, ...privateRooms] });
  }

  const rooms: Room[] = [];
  const bandPartitions: Run[][] = [];
  const width = clear.maxX - clear.minX;
  bands.forEach((band, b) => {
    const fitted = fitRooms(band.rooms, width, T);
    const widths = distributeWidths(fitted, width - (fitted.length - 1) * T);
    const partitions: Run[] = [];
    let x = clear.minX;
    fitted.forEach((type, i) => {
      rooms.push({ type, x0: x, x1: x + widths[i], z0: band.z0, z1: band.z1 });
      x += widths[i];
      if (i < fitted.length - 1) {
        partitions.push(addRun(`p${b}_${i}`, 'z', x + T / 2, band.z0, band.z1));
        x += T;
      }
    });
    bandPartitions.push(partitions);
  });
  for (const type of new Set(asked)) {
    const wanted = asked.filter((t) => t === type).length;
    const built = rooms.filter((r) => r.type === type).length;
    if (built < wanted) notes.push(`Only ${built} of the ${wanted} ${roomName(type, wanted)} fit in a ${plan.size.width} m wide house.`);
  }

  // ------------------------------------------------------------ openings
  const usedSegments = new Set<string>();
  /** Floor in front of and behind each door that furniture must leave free (dm). */
  const doorZones: LocalRect[] = [];
  const centreOf = (run: Run, u: number): [number, number] => (run.axis === 'x' ? [u, run.at] : [run.at, u]);
  const placeOpening = (
    definitionId: string,
    sill: number,
    halfWidth: number,
    run: Run,
    lo: number,
    hi: number,
    preferred: number,
    avoid: number[],
  ): number | null => {
    const spot = findOpeningSpot(run, lo, hi, preferred, halfWidth, avoid.map((a) => ({ at: a, clearance: T / 2 + halfWidth + 2 })), usedSegments);
    if (!spot) return null;
    const [x, z] = centreOf(run, spot.u);
    add(`opening:${spot.segment.id}:${spot.u}`, definitionId, x, floorTop + sill, z, run.rotationY, { hostRef: spot.segment.id, surface: 'side' });
    usedSegments.add(spot.segment.id);
    if (definitionId === kit.door) {
      const along = { from: spot.u - halfWidth - 2, to: spot.u + halfWidth + 2 };
      const across = { from: run.at - T / 2 - DOOR_CLEARANCE, to: run.at + T / 2 + DOOR_CLEARANCE };
      doorZones.push(
        run.axis === 'x'
          ? { minX: along.from, maxX: along.to, minZ: across.from, maxZ: across.to }
          : { minX: across.from, maxX: across.to, minZ: along.from, maxZ: along.to },
      );
    }
    return spot.u;
  };
  const placeDoor = (run: Run, lo: number, hi: number, preferred: number, avoid: number[] = []) =>
    placeOpening(kit.door, kit.doorSill, kit.doorWidth / 2, run, lo, hi, preferred, avoid);

  const frontBand = bandPartitions.length - 1;
  const frontPartitions = bandPartitions[frontBand].map((r) => r.at);
  const living = rooms.find((r) => r.type === 'living' && r.z1 === clear.maxZ) ?? rooms.find((r) => r.z1 === clear.maxZ)!;
  const frontDoor = placeDoor(front, living.x0, living.x1, (living.x0 + living.x1) / 2, frontPartitions);
  if (frontDoor === null) notes.push('There was no room for a front door.');

  // Rooms along the front open into each other through their shared walls.
  bandPartitions[frontBand].forEach((run) => {
    const band = bands[frontBand];
    if (placeDoor(run, band.z0, band.z1, Math.round((band.z0 + band.z1) / 2)) === null) notes.push('Two rooms could not be joined by a door.');
  });
  // Back rooms open onto the front row through the long dividing wall.
  if (divider) {
    const allPartitions = bandPartitions.flat().map((r) => r.at);
    const frontRooms = rooms.filter((r) => r.z1 === clear.maxZ);
    for (const room of rooms.filter((r) => r.z0 === clear.minZ && r.z1 !== clear.maxZ)) {
      const options = frontRooms
        .map((f) => ({ room: f, lo: Math.max(room.x0, f.x0), hi: Math.min(room.x1, f.x1) }))
        .filter((o) => o.hi - o.lo >= kit.doorWidth + 6)
        .sort((a, b) => Number(b.room.type === 'living') - Number(a.room.type === 'living') || b.hi - b.lo - (a.hi - a.lo));
      const opened = options.some((o) => placeDoor(divider!, o.lo, o.hi, Math.round((o.lo + o.hi) / 2), allPartitions) !== null);
      if (!opened) notes.push(`The ${roomName(room.type)} could not get a door.`);
    }
  }

  // A balcony terrace on the garden side, behind the most central back room,
  // with a door out to it (the deck itself is laid with the outside pieces).
  let balcony: { x0: number; x1: number } | null = null;
  if (plan.balcony) {
    const room = rooms
      .filter((r) => r.z0 === clear.minZ)
      .sort((a, b) => Math.abs(a.x0 + a.x1) - Math.abs(b.x0 + b.x1))[0];
    const middle = (room.x0 + room.x1) / 2;
    const columnCentre = (i: number) => -W / 2 + kit.tile / 2 + i * kit.tile;
    const columns = Array.from({ length: cols }, (_, i) => i)
      .sort((a, b) => Math.abs(columnCentre(a) - middle) - Math.abs(columnCentre(b) - middle))
      .filter((i, index) => index === 0 || (columnCentre(i) >= room.x0 && columnCentre(i) <= room.x1))
      .slice(0, 4)
      .sort((a, b) => a - b);
    const x0 = -W / 2 + columns[0] * kit.tile;
    const x1 = -W / 2 + (columns[columns.length - 1] + 1) * kit.tile;
    const lo = Math.max(room.x0, x0);
    const hi = Math.min(room.x1, x1);
    if (placeDoor(back, lo, hi, Math.round((lo + hi) / 2), bandPartitions.flat().map((r) => r.at)) !== null) balcony = { x0, x1 };
    else notes.push('There was no room for a door out to the balcony.');
  }

  // Windows on every outside wall of every room, about one per 4.5 m.
  const placeWindows = (run: Run, lo: number, hi: number): void => {
    const half = kit.windowWidth / 2;
    const count = Math.max(1, Math.floor((hi - lo) / 45));
    const mid = (lo + hi) / 2;
    const candidates = run.segments
      .filter((s) => !usedSegments.has(s.id) && s.to - s.from >= kit.windowWidth + 2)
      .map((s) => ({ segment: s, u: (s.from + s.to) / 2 }))
      .filter((c) => c.u - half >= lo + 2 && c.u + half <= hi - 2)
      .sort((a, b) => Math.abs(a.u - mid) - Math.abs(b.u - mid));
    const chosen: number[] = [];
    for (const c of candidates) {
      if (chosen.length >= count) break;
      if (chosen.some((u) => Math.abs(u - c.u) < 30)) continue;
      chosen.push(c.u);
      const [x, z] = centreOf(run, c.u);
      add(`opening:${c.segment.id}:${c.u}`, kit.window, x, floorTop + kit.windowSill, z, run.rotationY, { hostRef: c.segment.id, surface: 'side' });
      usedSegments.add(c.segment.id);
    }
  };
  let roomsWithWindows = 0;
  for (const room of rooms) {
    const before = objects.length;
    if (room.z0 === clear.minZ) placeWindows(back, room.x0, room.x1);
    if (room.z1 === clear.maxZ) placeWindows(front, room.x0, room.x1);
    if (room.x0 === clear.minX) placeWindows(west, room.z0, room.z1);
    if (room.x1 === clear.maxX) placeWindows(east, room.z0, room.z1);
    if (objects.length > before) roomsWithWindows++;
  }

  // -------------------------------------------------------------- furniture
  // Each room is furnished for what it is for; bigger rooms get a little
  // more, never everything. Every piece has a fixed key ("furn:kitchen#0:5"
  // is always the first kitchen's counter) and a list of spots to try; it is
  // placed at the first that is inside the room, clear of doors and of the
  // other furniture, and keeps the room under MAX_FURNISHED.
  const seen: Partial<Record<RoomType, number>> = {};
  const furnished: LocalRect[] = [];
  let fittings = 0;
  for (const room of rooms) {
    const ordinal = (seen[room.type] = (seen[room.type] ?? -1) + 1);
    const roomArea = (room.x1 - room.x0) * (room.z1 - room.z0);
    let covered = 0;
    type Spot = [number, number, number];
    const rectOf = (definitionId: string, [x, z, rotationY]: Spot): LocalRect => {
      const [w, d] = kit.footprint(definitionId, rotationY);
      return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
    };
    /** Inside the room, out of every doorway, `pad` clear of the furniture already there (and touching nothing in `also`). */
    const free = (rect: LocalRect, also: LocalRect[] = [], pad = FURNITURE_GAP): boolean =>
      rect.minX >= room.x0 + 1 &&
      rect.maxX <= room.x1 - 1 &&
      rect.minZ >= room.z0 + 1 &&
      rect.maxZ <= room.z1 - 1 &&
      !doorZones.some((zone) => rectsOverlap(zone, rect)) &&
      !furnished.some((f) => rectsOverlap(grow(f, pad), rect)) &&
      !also.some((f) => rectsOverlap(f, rect));
    const area = (rect: LocalRect) => (rect.maxX - rect.minX) * (rect.maxZ - rect.minZ);
    const place = (index: number, definitionId: string, spot: Spot): void => {
      const rect = rectOf(definitionId, spot);
      furnished.push(rect);
      covered += area(rect);
      const [x, z, rotationY] = spot;
      add(`furn:${room.type}#${ordinal}:${index}`, definitionId, x, floorTop, z, rotationY, { supportRef: floorAt(x, z), surface: 'top' });
    };
    /** Place one piece at the first free spot; false when none is free. Chairs pass pad 0 to sit at their table. */
    const put = (index: number, definitionId: string, spots: Spot[], pad = FURNITURE_GAP): boolean => {
      for (const spot of spots) {
        const rect = rectOf(definitionId, spot);
        if (free(rect, [], pad) && covered + area(rect) <= roomArea * MAX_FURNISHED) {
          place(index, definitionId, spot);
          return true;
        }
      }
      return false;
    };
    /** Spots against the walls, facing into the room, from the middle of each wall outwards. */
    const alongWalls = (definitionId: string, walls: Array<'back' | 'front' | 'west' | 'east'>): Spot[] => {
      const [w, d] = kit.footprint(definitionId, 0);
      const spots: Spot[] = [];
      const sweep = (lo: number, hi: number): number[] => {
        const mid = Math.round((lo + hi) / 2);
        const out: number[] = [];
        for (let offset = 0; mid - offset >= lo || mid + offset <= hi; offset += 2) {
          if (mid - offset >= lo) out.push(mid - offset);
          if (offset > 0 && mid + offset <= hi) out.push(mid + offset);
        }
        return out;
      };
      for (const wall of walls) {
        if (wall === 'back') for (const x of sweep(room.x0 + 1 + w / 2, room.x1 - 1 - w / 2)) spots.push([x, room.z0 + 1 + d / 2, 0]);
        if (wall === 'front') for (const x of sweep(room.x0 + 1 + w / 2, room.x1 - 1 - w / 2)) spots.push([x, room.z1 - 1 - d / 2, Math.PI]);
        if (wall === 'west') for (const z of sweep(room.z0 + 1 + w / 2, room.z1 - 1 - w / 2)) spots.push([room.x0 + 1 + d / 2, z, QUARTER]);
        if (wall === 'east') for (const z of sweep(room.z0 + 1 + w / 2, room.z1 - 1 - w / 2)) spots.push([room.x1 - 1 - d / 2, z, -QUARTER]);
      }
      return spots;
    };
    /** Corners for a small piece (a plant), back corners first. */
    const corners = (definitionId: string): Spot[] => {
      const [w, d] = kit.footprint(definitionId, 0);
      return [
        [room.x0 + 1 + w / 2, room.z0 + 1 + d / 2, 0],
        [room.x1 - 1 - w / 2, room.z0 + 1 + d / 2, 0],
        [room.x0 + 1 + w / 2, room.z1 - 1 - d / 2, 0],
        [room.x1 - 1 - w / 2, room.z1 - 1 - d / 2, 0],
      ];
    };
    const cx = (room.x0 + room.x1) / 2;
    const cz = (room.z0 + room.z1) / 2;
    const roomWidth = room.x1 - room.x0;
    const roomDepth = room.z1 - room.z0;
    if (room.type === 'bedroom') {
      // Headboard against the back wall; the door is on another wall.
      const [, bedDepth] = kit.footprint(PARTS.bed, 0);
      const bedZ = room.z0 + 3 + bedDepth / 2;
      put(0, PARTS.bed, [[cx, bedZ, 0], [room.x0 + 3 + 8, bedZ, 0], [room.x1 - 3 - 8, bedZ, 0]]);
      if (roomWidth >= 40 && roomDepth >= 40) {
        // A desk with its chair in a front corner.
        const deskX = room.x0 + 3 + 6;
        if (put(1, PARTS.table, [[deskX, room.z1 - 3 - 4, 0], [room.x1 - 3 - 6, room.z1 - 3 - 4, 0]])) {
          const desk = furnished[furnished.length - 1];
          put(2, PARTS.chair, [[(desk.minX + desk.maxX) / 2, desk.minZ - 1 - 2.5, 0]], 0);
        }
      }
      put(3, PARTS.wardrobe, alongWalls(PARTS.wardrobe, ['back', 'west', 'east']));
      if (roomWidth >= 45 && roomDepth >= 45) put(4, PARTS.plant, corners(PARTS.plant));
    } else if (room.type === 'living') {
      // Sofa and coffee table as a pair (sofa back towards the back wall), slid
      // across the room until both are clear of the doorways.
      const [, sofaDepth] = kit.footprint(PARTS.sofa, 0);
      const [, tableDepth] = kit.footprint(PARTS.table, 0);
      const pairs: Array<[Spot, Spot]> = [];
      for (const x of [cx, cx - roomWidth / 4, cx + roomWidth / 4]) {
        for (const sofaZ of [cz - 7, cz - 4, room.z0 + 2 + sofaDepth / 2]) {
          pairs.push([[x, sofaZ, 0], [x, sofaZ + sofaDepth / 2 + FURNITURE_GAP + tableDepth / 2, 0]]);
        }
      }
      const pair = pairs.find(([sofa, table]) => free(rectOf(PARTS.sofa, sofa)) && free(rectOf(PARTS.table, table), [rectOf(PARTS.sofa, sofa)]));
      put(0, PARTS.sofa, pair ? [pair[0]] : pairs.map(([sofa]) => sofa));
      if (put(1, PARTS.table, pair ? [pair[1]] : pairs.map(([, table]) => table)) && roomWidth >= 50 && roomDepth >= 40) {
        // Armchairs either side of the coffee table, turned towards it.
        const table = furnished[furnished.length - 1];
        const tz = (table.minZ + table.maxZ) / 2;
        put(2, PARTS.chair, [[cx - 14, tz, QUARTER]]);
        put(3, PARTS.chair, [[cx + 14, tz, -QUARTER]]);
      }
      if (roomWidth >= 60 && roomDepth >= 45) {
        // A big living room gets plants in its corners.
        put(4, PARTS.plant, corners(PARTS.plant));
        put(5, PARTS.plant, corners(PARTS.plant).reverse());
      }
    } else if (room.type === 'kitchen') {
      // Worktop against a wall first, then the table with its chairs in the free floor.
      put(5, PARTS.counter, alongWalls(PARTS.counter, ['back', 'west', 'east']));
      const chairs: Array<[number, number, number]> = [
        [-9, 0, QUARTER],
        [9, 0, -QUARTER],
        [0, -7, 0],
        [0, 7, Math.PI],
      ];
      const centres = [0, 3, 6, -3, 9].flatMap((dz) => [0, -6, 6].map((dx): [number, number] => [cx + dx, cz + dz]));
      // The first spot where the table and all four chairs fit; else the table with what fits.
      const whole = centres.find(([x, z]) => {
        const table = rectOf(PARTS.table, [x, z, 0]);
        const seats = chairs.map(([dx, dz, r]) => rectOf(PARTS.chair, [x + dx, z + dz, r]));
        return free(table) && seats.every((s, i) => free(s, [table, ...seats.slice(0, i)], 0));
      });
      if (put(0, PARTS.table, whole ? [[whole[0], whole[1], 0]] : centres.map(([x, z]): Spot => [x, z, 0]))) {
        const table = furnished[furnished.length - 1];
        const [x, z] = [(table.minX + table.maxX) / 2, (table.minZ + table.maxZ) / 2];
        chairs.forEach(([dx, dz, r], i) => put(1 + i, PARTS.chair, [[x + dx, z + dz, r]], 0));
      }
      if (roomWidth >= 50 && roomDepth >= 40) {
        put(6, PARTS.counter, alongWalls(PARTS.counter, ['west', 'east', 'back']));
        put(7, PARTS.plant, corners(PARTS.plant));
      }
    } else if (room.type === 'bathroom') {
      // Fittings against the walls, leaving the middle free to move about.
      const before = furnished.length;
      put(0, PARTS.bath, alongWalls(PARTS.bath, ['back', 'west', 'east']));
      put(1, PARTS.toilet, alongWalls(PARTS.toilet, ['east', 'west', 'back']));
      put(2, PARTS.basin, alongWalls(PARTS.basin, ['west', 'east', 'back', 'front']));
      fittings += furnished.length - before;
    }
  }

  // ----------------------------------------------------------------- roof
  if (plan.roof === 'gable') {
    // One pitched roof over the whole house, ridge along the longer side,
    // resting on the wall tops with a small overhang (eaves) all round.
    const ridgeAlongX = W >= D;
    const span = (ridgeAlongX ? D : W) + 2 * EAVE;
    const length = (ridgeAlongX ? W : D) + 2 * EAVE;
    const [roofWidth, roofDepth] = kit.footprint(PARTS.roof, 0);
    const rise = clamp((Math.min(W, D) / DM) * ROOF_PITCH, ROOF_RISE.min, ROOF_RISE.max);
    add('roof:gable', PARTS.roof, 0, floorTop + kit.wallHeight, 0, ridgeAlongX ? QUARTER : 0, {
      supportRef: back.segments[0].id,
      surface: 'top',
      scale: { x: span / roofWidth, y: rise / kit.height(PARTS.roof), z: length / roofDepth },
    });
  }

  // ------------------------------------------------------------- flat roof
  if (plan.roof === 'flat') {
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = -W / 2 + kit.tile / 2 + i * kit.tile;
        const z = -D / 2 + kit.tile / 2 + j * kit.tile;
        const run = z < 0 ? back : front;
        const segment = run.segments.find((s) => x >= s.from && x <= s.to) ?? run.segments[0];
        add(`roof:${i}_${j}`, kit.floor, x, floorTop + kit.wallHeight, z, 0, { supportRef: segment.id, surface: 'top' });
      }
    }
  }

  // ------------------------------------------------- driveway and garden
  // Outside pieces never overlap each other or the house (checked here, so
  // the template never relies on instantiateTemplate skipping a clash).
  const groundRects: LocalRect[] = [{ minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 }];
  const addOutside = (
    key: string,
    definitionId: string,
    x: number,
    z: number,
    y = 0,
    links: Parameters<typeof add>[6] = {},
    rotationY = 0,
  ): boolean => {
    const [w, d] = kit.footprint(definitionId, rotationY);
    const rect = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
    if (y === 0 && groundRects.some((r) => rectsOverlap(r, rect))) return false;
    if (y === 0) groundRects.push(rect);
    add(key, definitionId, x, y, z, rotationY, links);
    return true;
  };
  if (balcony) {
    // Two rows of deck tiles against the back wall, railings round the open sides.
    const rail = kit.footprint(PARTS.fence, 0)[1];
    for (let row = 0; row < 2; row++) {
      const z = -D / 2 - kit.tile / 2 - row * kit.tile;
      for (let x = balcony.x0 + kit.tile / 2; x < balcony.x1; x += kit.tile) addOutside(`deck:${x}_${row}`, kit.floor, x, z);
      addOutside(`rail:west:${row}`, PARTS.fence, balcony.x0 - rail / 2, z, 0, {}, QUARTER);
      addOutside(`rail:east:${row}`, PARTS.fence, balcony.x1 + rail / 2, z, 0, {}, QUARTER);
    }
    for (let x = balcony.x0 + kit.tile / 2; x < balcony.x1; x += kit.tile) {
      addOutside(`rail:back:${x}`, PARTS.fence, x, -D / 2 - 2 * kit.tile - rail / 2);
    }
  }
  const doorX = frontDoor ?? 0;
  if (plan.driveway) {
    const tile = kit.footprint(PARTS.driveway, 0)[1];
    // On the side away from the front door, from the front wall outwards
    // (so in a neighbourhood it reaches the pavement exactly like the path).
    const side = doorX <= 0 ? 1 : -1;
    const x = side * Math.max(0, W / 2 - tile / 2 - 10);
    const z0 = D / 2 + tile / 2;
    if (addOutside('drive:0', PARTS.driveway, x, z0, 0, { localId: 'drive0' })) {
      addOutside('drive:1', PARTS.driveway, x, z0 + tile, 0, { localId: 'drive1' });
      addOutside('car', PARTS.car, x, z0, kit.height(PARTS.driveway), { supportRef: 'drive0', surface: 'top' });
    }
  }
  if (frontDoor !== null) {
    // A paved path from the front door out to the garden.
    const [, pathLength] = kit.footprint(PARTS.path, QUARTER);
    for (let k = 0; k < 2; k++) {
      if (!addOutside(`path:${k}`, PARTS.path, doorX, D / 2 + pathLength / 2 + k * pathLength, 0, {}, QUARTER)) break;
    }
  }
  if (plan.garden) {
    const trees = Math.max(2, Math.round(W / 70));
    for (let i = 0; i < trees; i++) {
      const x = Math.round(-W / 2 + 15 + (i * (W - 30)) / (trees - 1));
      addOutside(`tree:back#${i}`, PARTS.trees[i % 2], x, -D / 2 - 35);
    }
    addOutside('tree:west', PARTS.trees[1], -W / 2 - 30, 0);
    addOutside('tree:east', PARTS.trees[0], W / 2 + 30, 0);
    for (let k = 0, x = -W / 2 + 10; x <= W / 2 - 10; k++, x += 25) {
      if (Math.abs(x - doorX) < 20) continue; // keep the path to the door clear
      addOutside(`bush:${k}`, PARTS.bush, x, D / 2 + 10);
    }
    addOutside('flower:left', PARTS.flower, doorX - 12, D / 2 + 8);
    addOutside('flower:right', PARTS.flower, doorX + 12, D / 2 + 8);
  }

  // Everything the house covers: its ground pieces and the roof's eaves over the walls.
  const eaves = plan.roof === 'gable' ? [{ minX: -W / 2 - EAVE, maxX: W / 2 + EAVE, minZ: -D / 2 - EAVE, maxZ: D / 2 + EAVE }] : [];
  const extent = [...groundRects, ...eaves].reduce(
    (e, r) => ({ minX: Math.min(e.minX, r.minX), maxX: Math.max(e.maxX, r.maxX), minZ: Math.min(e.minZ, r.minZ), maxZ: Math.max(e.maxZ, r.maxZ) }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
  );
  const counts = countTypes(objects, kit.pieces);
  const facts: LayoutFacts = {
    counts,
    measures: {
      width: W / DM,
      depth: D / DM,
      doorWidth: kit.doorWidth / DM,
      windows: counts.window ?? 0,
      rooms: rooms.length,
      bathroomFittings: fittings,
      smallestRoom: Math.min(...rooms.map((r) => ((r.x1 - r.x0) * (r.z1 - r.z0)) / (DM * DM))),
    },
    flags: {
      frontPath: frontDoor !== null && keys.includes('path:0'),
      roof: plan.roof !== 'none',
      everyRoomHasWindow: roomsWithWindows === rooms.length,
      // Bedrooms in the back row, away from the front door (not true of a one-row house).
      bedroomsAtBack: divider !== null && rooms.some((r) => r.type === 'bedroom') && rooms.filter((r) => r.type === 'bedroom').every((r) => r.z1 < clear.maxZ),
      armchairs: keys.includes('furn:living#0:2'),
      driveway: keys.includes('drive:0'),
      balcony: balcony !== null,
    },
  };
  return {
    objects,
    keys,
    rooms: rooms.map((r) => ({ type: r.type, rect: { minX: r.x0 / DM, maxX: r.x1 / DM, minZ: r.z0 / DM, maxZ: r.z1 / DM } })),
    footprint: { width: W / DM, depth: D / DM },
    extent: { minX: extent.minX / DM, maxX: extent.maxX / DM, minZ: extent.minZ / DM, maxZ: extent.maxZ / DM },
    notes,
    facts,
  };
}

// ------------------------------------------------------------------ helpers

interface HouseKit {
  floor: string;
  /** Floor tile side, dm. */
  tile: number;
  /** Floor tile thickness, metres: walls and furniture stand at this height. */
  floorHeight: number;
  wallThickness: number;
  wallHeight: number;
  wallByLength: Map<number, string>;
  composeRun(length: number): number[] | null;
  door: string;
  doorWidth: number;
  doorSill: number;
  window: string;
  windowWidth: number;
  windowSill: number;
  /** Rotated footprint (width along X, depth along Z), dm. */
  footprint(definitionId: string, rotationY: number): [number, number];
  height(definitionId: string): number;
  pieces: ReturnType<typeof pieceKit>;
}

/** Look up every piece the layout uses, failing loudly if the catalogue changed underneath it. */
function resolveKit(registry: ObjectRegistry): HouseKit {
  const get = (id: string): ConstructionObjectDefinition => {
    const definition = registry.get(id);
    if (!definition) throw new Error(`House piece "${id}" is missing from objects.json`);
    return definition;
  };
  const floor = get(PARTS.floor);
  const walls = [get(PARTS.wallShort), get(PARTS.wall), get(PARTS.wallLong)];
  const [short, plain, long] = walls.map((w) => toDm(w.dimensions.width));
  const step = plain - short;
  if (walls.some((w) => roleOf(w) !== 'wall' || w.dimensions.depth !== walls[1].dimensions.depth || w.dimensions.height !== walls[1].dimensions.height)) {
    throw new Error('House walls must share one thickness and height');
  }
  if (step <= 0 || long - plain !== step) throw new Error('House walls must be evenly spaced lengths (short / plain / long)');
  if (toDm(floor.dimensions.width) !== plain || toDm(floor.dimensions.depth) !== plain) {
    throw new Error('House floor tiles must match the plain wall length');
  }
  const pieces = pieceKit(registry, [
    PARTS.door,
    PARTS.window,
    PARTS.bed,
    PARTS.sofa,
    PARTS.table,
    PARTS.chair,
    PARTS.wardrobe,
    PARTS.counter,
    PARTS.bath,
    PARTS.toilet,
    PARTS.basin,
    PARTS.plant,
    ...PARTS.trees,
    PARTS.bush,
    PARTS.flower,
    PARTS.driveway,
    PARTS.car,
    PARTS.fence,
    PARTS.path,
  ]);
  if (roleOf(get(PARTS.roof)) !== 'roof') throw new Error('The house roof piece must have the roof role');
  const door = get(PARTS.door);
  const window = get(PARTS.window);
  return {
    floor: floor.id,
    tile: plain,
    floorHeight: floor.dimensions.height,
    wallThickness: toDm(walls[1].dimensions.depth),
    wallHeight: walls[1].dimensions.height,
    wallByLength: new Map([
      [short, walls[0].id],
      [plain, walls[1].id],
      [long, walls[2].id],
    ]),
    composeRun: (length) => composeRun(length, plain, step),
    door: door.id,
    doorWidth: toDm(door.dimensions.width),
    doorSill: door.placement?.sillHeight ?? 0,
    window: window.id,
    windowWidth: toDm(window.dimensions.width),
    windowSill: window.placement?.sillHeight ?? 0,
    footprint: (id, rotationY) => {
      // Rounded up to whole decimetres, so a 0.42 m piece is planned as 0.5 m and never clashes.
      const { width, depth } = get(id).dimensions;
      const turned = Math.abs(Math.round(rotationY / QUARTER)) % 2 === 1;
      return turned ? [ceilDm(depth), ceilDm(width)] : [ceilDm(width), ceilDm(depth)];
    },
    height: (id) => get(id).dimensions.height,
    pieces,
  };
}

/**
 * Wall pieces (plain, plain - step, plain + step) adding up to exactly
 * `length` dm, the odd-sized pieces at the ends; null when impossible.
 */
export function composeRun(length: number, plain: number, step: number): number[] | null {
  if (length <= 0) return null;
  const guess = Math.round(length / plain);
  for (const n of [guess, guess + 1, guess - 1]) {
    if (n < 1) continue;
    const k = (length - n * plain) / step;
    if (!Number.isInteger(k) || Math.abs(k) > n) continue;
    const odd = Array<number>(Math.abs(k)).fill(k > 0 ? plain + step : plain - step);
    const head = odd.slice(0, Math.ceil(odd.length / 2));
    const tail = odd.slice(head.length);
    return [...head, ...Array<number>(n - odd.length).fill(plain), ...tail];
  }
  return null;
}

/** Depth (dm) of the back row of rooms: about 45%, with both rows buildable from whole wall pieces. */
function chooseBackDepth(depth: number, T: number, kit: HouseKit): number | null {
  const usable = depth - T;
  const target = Math.round((usable * BACK_BAND_SHARE) / 2) * 2;
  for (let delta = 0; delta <= usable; delta += 2) {
    for (const back of delta === 0 ? [target] : [target - delta, target + delta]) {
      const frontDepth = usable - back;
      if (back < MIN_BAND_DEPTH || frontDepth < MIN_BAND_DEPTH) continue;
      if (kit.composeRun(back) && kit.composeRun(frontDepth)) return back;
    }
  }
  return null;
}

/** The rooms that fit side by side in `width` dm; later rooms give way first, the living room never does. */
function fitRooms(rooms: RoomType[], width: number, T: number): RoomType[] {
  const kept = [...rooms];
  const needed = () => kept.reduce((sum, t) => sum + MIN_ROOM_WIDTH[t], 0) + (kept.length - 1) * T;
  while (kept.length > 1 && needed() > width) {
    let index = kept.length - 1;
    while (index > 0 && kept[index] === 'living') index--;
    kept.splice(index, 1);
  }
  return kept;
}

/** Whole-decimetre room widths that add up to `available`, by weight, each at least its minimum. */
function distributeWidths(rooms: RoomType[], available: number): number[] {
  const total = rooms.reduce((sum, t) => sum + ROOM_WEIGHT[t], 0);
  const widths = rooms.map((t) => Math.max(MIN_ROOM_WIDTH[t], Math.floor((available * ROOM_WEIGHT[t]) / total)));
  const order = rooms.map((_, i) => i).sort((a, b) => ROOM_WEIGHT[rooms[b]] - ROOM_WEIGHT[rooms[a]]);
  let diff = available - widths.reduce((sum, w) => sum + w, 0);
  while (diff !== 0) {
    let changed = false;
    for (const i of order) {
      if (diff === 0) break;
      if (diff > 0) {
        widths[i]++;
        diff--;
        changed = true;
      } else if (widths[i] > MIN_ROOM_WIDTH[rooms[i]]) {
        widths[i]--;
        diff++;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return widths;
}

/**
 * Where along a run an opening of half-width `half` can go: inside [lo, hi]
 * (0.2 m clear of the ends), within one free wall piece (0.1 m from its
 * joints), and clear of walls butting into the run. Searched outwards from
 * `preferred`, in 0.1 m steps.
 */
function findOpeningSpot(
  run: Run,
  lo: number,
  hi: number,
  preferred: number,
  half: number,
  avoid: Array<{ at: number; clearance: number }>,
  used: Set<string>,
): { segment: Segment; u: number } | null {
  const start = Math.round(preferred);
  for (let offset = 0; offset <= hi - lo; offset++) {
    for (const u of offset === 0 ? [start] : [start - offset, start + offset]) {
      if (u - half < lo + 2 || u + half > hi - 2) continue;
      if (avoid.some((a) => Math.abs(u - a.at) < a.clearance)) continue;
      const segment = run.segments.find((s) => !used.has(s.id) && s.from + 1 <= u - half && u + half <= s.to - 1);
      if (segment) return { segment, u };
    }
  }
  return null;
}

function toDm(metres: number): number {
  return Math.round(metres * DM);
}

function ceilDm(metres: number): number {
  return Math.ceil(metres * DM - 1e-6);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
