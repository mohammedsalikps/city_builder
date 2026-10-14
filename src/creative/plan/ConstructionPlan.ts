/**
 * A construction plan: the structured description of something a child asked
 * EAVARA to build ("a 30 by 20 metre house near the lake with three
 * bedrooms...", "a garden behind the house with flower beds and a bench").
 * Plans are DATA, never code. Whatever produced one - an AI model, a test, a
 * saved creation - is untrusted, so `parseConstructionPlan` reads only the
 * fields it knows for the plan's kind, checks every type, clamps sizes and
 * counts to what the construction engine can build and reports each
 * adjustment, before a layout is ever made from it. Nothing in a plan is
 * evaluated or executed.
 *
 * Kinds (one layout each, all producing ordinary template objects):
 *   house         rooms, roof, garden, driveway, balcony (HouseLayout)
 *   garden        flower beds, trees, shrubs, benches, path, fence (OutdoorLayout)
 *   park          the same features at park scale, plus a playground and lamps
 *   neighborhood  several planned houses along a street, with a shared park
 *   treehouse     a deck on posts round a tree, ladder or stairs, railings, a hut
 *   objects       a few loose things added to the world ("three benches")
 *
 * Units are metres throughout. `size` is the outer size of the creation: for
 * a house, the outside faces of its walls (a 30 x 20 m plan covers exactly
 * x in [-15, 15], z in [-10, 10] around the house origin); for a garden or
 * park, the ground it covers. Sizes are rounded to the step of the pieces
 * they are built from (see SIZE_LIMITS).
 */

export const PLAN_VERSION = 1;

export const PLAN_KINDS = ['house', 'garden', 'park', 'neighborhood', 'treehouse', 'objects'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const ROOM_TYPES = ['living', 'kitchen', 'bedroom', 'bathroom'] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

/** gable: one pitched roof over the whole house (the default); flat: roof tiles; none: open-topped, only when asked for. */
export const ROOF_STYLES = ['gable', 'flat', 'none'] as const;
export type RoofStyle = (typeof ROOF_STYLES)[number];

/** Named places a plan may ask to be built near. */
export const SITE_ANCHORS = ['lake', 'home', 'view'] as const;
export type SiteAnchor = (typeof SITE_ANCHORS)[number];

/** Places relative to the child's house: behind it, in front of it, or beside it. */
export const SITE_SIDES = ['back', 'front', 'side'] as const;
export type SiteSide = (typeof SITE_SIDES)[number];

export type PlanSite = { near: SiteAnchor } | { at: { x: number; z: number } } | { beside: SiteSide };

/** Things a child can add to the world one by one ("add three benches"). */
export const OBJECT_ITEMS = ['tree', 'bush', 'flower_bed', 'flowers', 'bench', 'lamp', 'bin', 'rock', 'swing', 'slide', 'sandpit'] as const;
export type ObjectItem = (typeof OBJECT_ITEMS)[number];

export const TREEHOUSE_ACCESS = ['ladder', 'stairs'] as const;
export type TreehouseAccess = (typeof TREEHOUSE_ACCESS)[number];

/** Outer house size limits, metres per side, and the step sizes are rounded to. */
export const HOUSE_SIZE_MIN = 8;
export const HOUSE_SIZE_MAX = 40;
export const HOUSE_MODULE = 2;

/** Size limits per kind (metres per side) and the step sizes are rounded to. */
export const SIZE_LIMITS = {
  house: { min: HOUSE_SIZE_MIN, max: HOUSE_SIZE_MAX, step: HOUSE_MODULE },
  garden: { min: 6, max: 30, step: 2 },
  // Park paths are 4 m paving slabs, so parks grow in 4 m steps.
  park: { min: 12, max: 60, step: 4 },
  neighborhoodHouse: { min: 10, max: 16, step: 2 },
} as const;

/** Most rooms one house may ask for, and the most of one kind in a single entry. */
export const MAX_ROOMS = 10;
const MAX_ROOM_COUNT = 6;
/** Rooms per house in a neighbourhood (smaller houses, kept quick to build). */
const MAX_NEIGHBORHOOD_ROOMS = 5;
export const NEIGHBORHOOD_HOUSES = { min: 2, max: 6, fallback: 4 };
/** Most loose objects one request may add. */
export const MAX_OBJECTS = 12;
const MAX_NAME_LENGTH = 32;
const DEFAULT_ROOMS: RoomType[] = ['living', 'kitchen', 'bedroom'];

/** Feature counts for gardens and parks: [most allowed, default]. */
export const OUTDOOR_COUNTS = {
  garden: { trees: [8, 2], flowerBeds: [8, 3], shrubs: [16, 4], benches: [4, 1] },
  park: { trees: [30, 8], flowerBeds: [12, 4], shrubs: [20, 6], benches: [12, 4] },
} as const;
const OUTDOOR_DEFAULTS = {
  garden: { size: { width: 10, depth: 8 }, path: true, fence: true, playground: false, lamps: false },
  park: { size: { width: 24, depth: 20 }, path: true, fence: false, playground: false, lamps: true },
} as const;
const DEFAULT_NAMES: Record<PlanKind, string> = {
  house: 'Your House',
  garden: 'Your Garden',
  park: 'Your Park',
  neighborhood: 'Your Neighbourhood',
  treehouse: 'Your Treehouse',
  objects: 'New Things',
};

interface PlanBase {
  version: typeof PLAN_VERSION;
  /** Child-facing name ("Lakeside House", "Sunny Garden"). */
  name: string;
  site: PlanSite;
}

export interface HousePlan extends PlanBase {
  kind: 'house';
  /** Outer size, metres: width runs along the front (local X), depth front to back (local Z). */
  size: { width: number; depth: number };
  /** One entry per room, in the order they were asked for. */
  rooms: RoomType[];
  roof: RoofStyle;
  garden: boolean;
  driveway: boolean;
  /** A terrace with railings on the garden side, with a door out to it. */
  balcony: boolean;
}

/** A garden or a park: the same features, at different scales and defaults. */
export interface OutdoorPlan extends PlanBase {
  kind: 'garden' | 'park';
  /** Ground covered, metres; the entrance is on the front (local +Z) side. */
  size: { width: number; depth: number };
  trees: number;
  flowerBeds: number;
  shrubs: number;
  benches: number;
  /** A path in from the entrance (stepping stones in a garden, paved paths crossing a park). */
  path: boolean;
  /** A fence round the edge with a gate where the path comes in. */
  fence: boolean;
  /** A slide, a swing set and a sandpit, each with safe space around it. */
  playground: boolean;
  /** Lamps along the paths. */
  lamps: boolean;
}

export interface GardenPlan extends OutdoorPlan {
  kind: 'garden';
}

export interface ParkPlan extends OutdoorPlan {
  kind: 'park';
}

export interface NeighborhoodPlan extends PlanBase {
  kind: 'neighborhood';
  houses: number;
  /** Outer wall size of each house, metres. */
  houseSize: { width: number; depth: number };
  /** Rooms in each house. */
  rooms: RoomType[];
  roof: RoofStyle;
  /** A street with pavements and lamps between the two rows of houses. */
  street: boolean;
  /** A small shared park in one of the plots. */
  park: boolean;
  /** Houses the child changed on their own ("make house 2 deeper"); every other house follows the fields above. */
  customHouses: NeighborhoodHouseEdit[];
}

/**
 * One house of a neighbourhood changed on its own. Fields left out follow
 * the neighbourhood. A house keeps its plot, so it can grow backwards
 * (deeper) or get narrower, but never wider than its neighbours allow.
 */
export interface NeighborhoodHouseEdit {
  /** Which house (0-based, in the order the neighbourhood lays them out). */
  house: number;
  size?: { width: number; depth: number };
  rooms?: RoomType[];
  roof?: RoofStyle;
  balcony?: boolean;
}

export interface TreehousePlan extends PlanBase {
  kind: 'treehouse';
  /** How to climb up: a ladder with handholds, or stairs. */
  access: TreehouseAccess;
  /** A little hut on the deck, with a door and windows. */
  hut: boolean;
  /** The hut's roof: pitched, or open-topped when asked for. */
  roof: 'gable' | 'none';
}

export interface ObjectsPlan extends PlanBase {
  kind: 'objects';
  /** What to add and how many of each, in the order asked for. */
  items: Array<{ item: ObjectItem; count: number }>;
}

export type ConstructionPlan = HousePlan | GardenPlan | ParkPlan | NeighborhoodPlan | TreehousePlan | ObjectsPlan;

export interface PlanParseResult {
  /** The normalised plan, or null when the input cannot be built at all. */
  plan: ConstructionPlan | null;
  /** Why there is no plan. */
  errors: string[];
  /** Child-friendly explanations of what was adjusted ("Walls come in 2 m pieces..."). */
  notes: string[];
  /** Technical details for the console: fields that were ignored. */
  warnings: string[];
}

const KNOWN_FIELDS: Record<PlanKind, Set<string>> = {
  house: new Set(['version', 'kind', 'name', 'size', 'site', 'rooms', 'roof', 'garden', 'driveway', 'balcony']),
  garden: new Set(['version', 'kind', 'name', 'size', 'site', 'trees', 'flowerBeds', 'shrubs', 'benches', 'path', 'fence', 'playground', 'lamps']),
  park: new Set(['version', 'kind', 'name', 'size', 'site', 'trees', 'flowerBeds', 'shrubs', 'benches', 'path', 'fence', 'playground', 'lamps']),
  neighborhood: new Set(['version', 'kind', 'name', 'site', 'houses', 'houseSize', 'rooms', 'roof', 'street', 'park', 'customHouses']),
  treehouse: new Set(['version', 'kind', 'name', 'site', 'access', 'hut', 'roof']),
  objects: new Set(['version', 'kind', 'name', 'site', 'items']),
};

const ROOM_NAMES: Record<RoomType, string> = {
  living: 'living room',
  kitchen: 'kitchen',
  bedroom: 'bedroom',
  bathroom: 'bathroom',
};

/** What each kind is called in sentences ("a garden", "the treehouse"). */
export const KIND_NAMES: Record<PlanKind, string> = {
  house: 'house',
  garden: 'garden',
  park: 'park',
  neighborhood: 'neighbourhood',
  treehouse: 'treehouse',
  objects: 'group of things',
};

const ITEM_NAMES: Record<ObjectItem, [string, string]> = {
  tree: ['tree', 'trees'],
  bush: ['bush', 'bushes'],
  flower_bed: ['flower bed', 'flower beds'],
  flowers: ['flower', 'flowers'],
  bench: ['bench', 'benches'],
  lamp: ['lamp', 'lamps'],
  bin: ['litter bin', 'litter bins'],
  rock: ['rock', 'rocks'],
  swing: ['swing set', 'swing sets'],
  slide: ['slide', 'slides'],
  sandpit: ['sandpit', 'sandpits'],
};

export function roomName(type: RoomType, count = 1): string {
  const name = ROOM_NAMES[type];
  return count === 1 ? name : `${name}s`;
}

export function itemName(item: ObjectItem, count = 1): string {
  return ITEM_NAMES[item][count === 1 ? 0 : 1];
}

/** A plan back in the input format `parseConstructionPlan` reads (rooms grouped by type). */
export function planInput(plan: ConstructionPlan): Record<string, unknown> {
  const site = siteInput(plan.site);
  switch (plan.kind) {
    case 'house':
      return {
        version: plan.version,
        kind: plan.kind,
        name: plan.name,
        size: { ...plan.size },
        site,
        rooms: groupRooms(plan.rooms),
        roof: plan.roof,
        garden: plan.garden,
        driveway: plan.driveway,
        balcony: plan.balcony,
      };
    case 'garden':
    case 'park':
      return {
        version: plan.version,
        kind: plan.kind,
        name: plan.name,
        size: { ...plan.size },
        site,
        trees: plan.trees,
        flowerBeds: plan.flowerBeds,
        shrubs: plan.shrubs,
        benches: plan.benches,
        path: plan.path,
        fence: plan.fence,
        playground: plan.playground,
        lamps: plan.lamps,
      };
    case 'neighborhood':
      return {
        version: plan.version,
        kind: plan.kind,
        name: plan.name,
        site,
        houses: plan.houses,
        houseSize: { ...plan.houseSize },
        rooms: groupRooms(plan.rooms),
        roof: plan.roof,
        street: plan.street,
        park: plan.park,
        ...(plan.customHouses.length ? { customHouses: plan.customHouses.map(houseEditInput) } : {}),
      };
    case 'treehouse':
      return { version: plan.version, kind: plan.kind, name: plan.name, site, access: plan.access, hut: plan.hut, roof: plan.roof };
    case 'objects':
      return { version: plan.version, kind: plan.kind, name: plan.name, site, items: plan.items.map((i) => ({ ...i })) };
  }
}

/** Strict reader for an untrusted plan. Never throws. */
export function parseConstructionPlan(input: unknown): PlanParseResult {
  const errors: string[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];
  const fail = (message: string): PlanParseResult => ({ plan: null, errors: [...errors, message], notes, warnings });

  if (!isRecord(input)) return fail('The plan is not an object.');
  if (own(input, 'version') !== PLAN_VERSION) return fail(`Unsupported plan version (expected ${PLAN_VERSION}).`);
  const kind = own(input, 'kind');
  if (typeof kind !== 'string' || !(PLAN_KINDS as readonly string[]).includes(kind)) {
    return fail('EAVARA can plan houses, gardens, parks, neighbourhoods, treehouses and small groups of things.');
  }
  const known = KNOWN_FIELDS[kind as PlanKind];
  for (const key of Object.keys(input)) {
    if (!known.has(key)) warnings.push(`Ignored unknown field "${key}".`);
  }
  const name = readName(own(input, 'name'), DEFAULT_NAMES[kind as PlanKind], warnings);
  const site = readSite(own(input, 'site'), warnings);
  const base = { version: PLAN_VERSION, name, site } as const;

  switch (kind as PlanKind) {
    case 'house': {
      const size = readSize(own(input, 'size'), SIZE_LIMITS.house, 'house', notes);
      if (!size) return fail('The house size must be two numbers of metres.');
      const plan: HousePlan = {
        ...base,
        kind: 'house',
        size,
        rooms: readRooms(own(input, 'rooms'), MAX_ROOMS, 'A house', notes, warnings),
        roof: readEnum(own(input, 'roof'), ROOF_STYLES, 'gable', 'roof', warnings),
        garden: readBoolean(own(input, 'garden'), true, 'garden', warnings),
        driveway: readBoolean(own(input, 'driveway'), false, 'driveway', warnings),
        balcony: readBoolean(own(input, 'balcony'), false, 'balcony', warnings),
      };
      return { plan, errors, notes, warnings };
    }
    case 'garden':
    case 'park': {
      const outdoor = kind as 'garden' | 'park';
      const defaults = OUTDOOR_DEFAULTS[outdoor];
      const counts = OUTDOOR_COUNTS[outdoor];
      const rawSize = own(input, 'size');
      const size = rawSize === undefined ? { ...defaults.size } : readSize(rawSize, SIZE_LIMITS[outdoor], outdoor, notes);
      if (!size) return fail(`The ${outdoor} size must be two numbers of metres.`);
      const count = (field: keyof typeof counts, label: string) =>
        readCount(own(input, field), 0, counts[field][0], counts[field][1], `A ${outdoor}`, label, notes, warnings);
      const plan = {
        ...base,
        kind: outdoor,
        size,
        trees: count('trees', 'trees'),
        flowerBeds: count('flowerBeds', 'flower beds'),
        shrubs: count('shrubs', 'bushes'),
        benches: count('benches', 'benches'),
        path: readBoolean(own(input, 'path'), defaults.path, 'path', warnings),
        fence: readBoolean(own(input, 'fence'), defaults.fence, 'fence', warnings),
        playground: readBoolean(own(input, 'playground'), defaults.playground, 'playground', warnings),
        lamps: readBoolean(own(input, 'lamps'), defaults.lamps, 'lamps', warnings),
      } as OutdoorPlan;
      return { plan: plan as GardenPlan | ParkPlan, errors, notes, warnings };
    }
    case 'neighborhood': {
      const rawSize = own(input, 'houseSize');
      const houseSize = rawSize === undefined ? { width: 12, depth: 10 } : readSize(rawSize, SIZE_LIMITS.neighborhoodHouse, 'neighbourhood house', notes);
      if (!houseSize) return fail('The house size must be two numbers of metres.');
      const houses = readCount(own(input, 'houses'), NEIGHBORHOOD_HOUSES.min, NEIGHBORHOOD_HOUSES.max, NEIGHBORHOOD_HOUSES.fallback, 'A neighbourhood', 'houses', notes, warnings);
      const plan: NeighborhoodPlan = {
        ...base,
        kind: 'neighborhood',
        houses,
        houseSize,
        rooms: readRooms(own(input, 'rooms'), MAX_NEIGHBORHOOD_ROOMS, 'Each neighbourhood house', notes, warnings),
        roof: readEnum(own(input, 'roof'), ROOF_STYLES, 'gable', 'roof', warnings),
        street: readBoolean(own(input, 'street'), true, 'street', warnings),
        park: readBoolean(own(input, 'park'), true, 'park', warnings),
        customHouses: readHouseEdits(own(input, 'customHouses'), houses, notes, warnings),
      };
      return { plan, errors, notes, warnings };
    }
    case 'treehouse': {
      // The hut has no flat-roof version: a flat request gets the pitched roof, and says so.
      const roof = readEnum(own(input, 'roof'), ROOF_STYLES, 'gable', 'roof', warnings);
      if (roof === 'flat') notes.push('A treehouse hut gets a pitched roof so rain runs off.');
      const plan: TreehousePlan = {
        ...base,
        kind: 'treehouse',
        access: readEnum(own(input, 'access'), TREEHOUSE_ACCESS, 'ladder', 'access', warnings),
        hut: readBoolean(own(input, 'hut'), true, 'hut', warnings),
        roof: roof === 'none' ? 'none' : 'gable',
      };
      return { plan, errors, notes, warnings };
    }
    case 'objects': {
      const items = readItems(own(input, 'items'), notes, warnings);
      if (items.length === 0) return fail('Say what to add - for example trees, benches or flower beds.');
      const plan: ObjectsPlan = { ...base, kind: 'objects', items };
      return { plan, errors, notes, warnings };
    }
  }
}

/** The houses changed on their own, one entry per house, in house order; entries for houses that are gone are dropped. */
function readHouseEdits(value: unknown, houses: number, notes: string[], warnings: string[]): NeighborhoodHouseEdit[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push('Ignored customHouses that were not a list.');
    return [];
  }
  const edits = new Map<number, NeighborhoodHouseEdit>();
  for (const entry of value) {
    const house = isRecord(entry) ? own(entry, 'house') : undefined;
    if (!isRecord(entry) || typeof house !== 'number' || !Number.isInteger(house) || house < 0 || house >= houses || edits.has(house)) {
      warnings.push("Ignored a changed house that is not one of the neighbourhood's houses.");
      continue;
    }
    for (const key of Object.keys(entry)) if (!HOUSE_EDIT_FIELDS.has(key)) warnings.push(`Ignored unknown house field "${key}".`);
    const edit: NeighborhoodHouseEdit = { house };
    const size = own(entry, 'size') === undefined ? null : readSize(own(entry, 'size'), SIZE_LIMITS.neighborhoodHouse, 'neighbourhood house', notes);
    if (size) edit.size = size;
    if (own(entry, 'rooms') !== undefined) edit.rooms = readRooms(own(entry, 'rooms'), MAX_NEIGHBORHOOD_ROOMS, `House ${house + 1}`, notes, warnings);
    const roof = own(entry, 'roof');
    if (roof !== undefined && typeof roof === 'string' && (ROOF_STYLES as readonly string[]).includes(roof)) edit.roof = roof as RoofStyle;
    else if (roof !== undefined) warnings.push(`Ignored an unknown roof ${JSON.stringify(roof)}.`);
    const balcony = own(entry, 'balcony');
    if (typeof balcony === 'boolean') edit.balcony = balcony;
    else if (balcony !== undefined) warnings.push('Ignored a balcony value that was not true or false.');
    if (Object.keys(edit).length > 1) edits.set(house, edit);
  }
  return [...edits.values()].sort((a, b) => a.house - b.house);
}

const HOUSE_EDIT_FIELDS = new Set(['house', 'size', 'rooms', 'roof', 'balcony']);

/** One changed house back in the input format. */
export function houseEditInput(edit: NeighborhoodHouseEdit): Record<string, unknown> {
  return {
    house: edit.house,
    ...(edit.size ? { size: { ...edit.size } } : {}),
    ...(edit.rooms ? { rooms: groupRooms(edit.rooms) } : {}),
    ...(edit.roof ? { roof: edit.roof } : {}),
    ...(edit.balcony !== undefined ? { balcony: edit.balcony } : {}),
  };
}

function readSize(
  value: unknown,
  limits: { min: number; max: number; step: number },
  label: string,
  notes: string[],
): { width: number; depth: number } | null {
  if (!isRecord(value)) return null;
  const width = readSide(own(value, 'width'), 'width', label, limits, notes);
  const depth = readSide(own(value, 'depth'), 'depth', label, limits, notes);
  return width === null || depth === null ? null : { width, depth };
}

function readSide(
  value: unknown,
  side: string,
  label: string,
  limits: { min: number; max: number; step: number },
  notes: string[],
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const clamped = Math.min(limits.max, Math.max(limits.min, value));
  const rounded = Math.min(limits.max, Math.max(limits.min, Math.round(clamped / limits.step) * limits.step));
  const things = label === 'house' ? 'Houses' : `${capitalise(label)}s`;
  if (clamped !== value) {
    notes.push(`${things} can be ${limits.min} to ${limits.max} m on a side, so the ${side} is ${rounded} m.`);
  } else if (rounded !== value) {
    const why = label === 'house' || label === 'neighbourhood house' ? `Walls come in ${limits.step} m pieces` : `${things} are measured in ${limits.step} m steps`;
    notes.push(`${why}, so the ${side} is ${rounded} m instead of ${formatMetres(value)} m.`);
  }
  return rounded;
}

function readCount(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  owner: string,
  label: string,
  notes: string[],
  warnings: string[],
): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    warnings.push(`Ignored a ${label} count that was not a number.`);
    return fallback;
  }
  const rounded = Math.round(value);
  if (rounded > max) notes.push(`${owner} can have up to ${max} ${label}.`);
  if (rounded < min) notes.push(`${owner} needs at least ${min} ${label}.`);
  return Math.min(max, Math.max(min, rounded));
}

function readName(value: unknown, fallback: string, warnings: string[]): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') {
    warnings.push('Ignored a name that was not text.');
    return fallback;
  }
  // Display text only (always set through textContent), but keep it tidy.
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

function readSite(value: unknown, warnings: string[]): PlanSite {
  if (value === undefined) return { near: 'view' };
  if (isRecord(value)) {
    const near = own(value, 'near');
    if (typeof near === 'string' && (SITE_ANCHORS as readonly string[]).includes(near)) return { near: near as SiteAnchor };
    const beside = own(value, 'beside');
    if (typeof beside === 'string' && (SITE_SIDES as readonly string[]).includes(beside)) return { beside: beside as SiteSide };
    const at = own(value, 'at');
    if (isRecord(at)) {
      const x = own(at, 'x');
      const z = own(at, 'z');
      if (typeof x === 'number' && typeof z === 'number' && Number.isFinite(x) && Number.isFinite(z)) return { at: { x, z } };
    }
  }
  warnings.push('Ignored a site that was not understood; building near the current view.');
  return { near: 'view' };
}

function siteInput(site: PlanSite): Record<string, unknown> {
  if ('at' in site) return { at: { ...site.at } };
  if ('beside' in site) return { beside: site.beside };
  return { near: site.near };
}

function readRooms(value: unknown, maxRooms: number, owner: string, notes: string[], warnings: string[]): RoomType[] {
  if (value === undefined) return [...DEFAULT_ROOMS];
  if (!Array.isArray(value)) {
    warnings.push('Ignored rooms that were not a list.');
    return [...DEFAULT_ROOMS];
  }
  const rooms: RoomType[] = [];
  let dropped = false;
  for (const entry of value.slice(0, MAX_ROOMS * 2)) {
    if (!isRecord(entry)) {
      warnings.push('Ignored a room that was not an object.');
      continue;
    }
    const type = own(entry, 'type');
    if (typeof type !== 'string' || !(ROOM_TYPES as readonly string[]).includes(type)) {
      warnings.push(`Ignored an unknown room type ${JSON.stringify(type)}.`);
      continue;
    }
    const rawCount = own(entry, 'count');
    let count = 1;
    if (rawCount !== undefined) {
      if (typeof rawCount !== 'number' || !Number.isFinite(rawCount)) {
        warnings.push(`Ignored a ${type} count that was not a number.`);
      } else {
        count = Math.min(MAX_ROOM_COUNT, Math.max(0, Math.round(rawCount)));
      }
    }
    for (let i = 0; i < count; i++) {
      if (rooms.length >= maxRooms) {
        dropped = true;
        break;
      }
      rooms.push(type as RoomType);
    }
  }
  if (dropped) notes.push(`${owner} can have up to ${maxRooms} rooms.`);
  return rooms.length > 0 ? rooms : [...DEFAULT_ROOMS];
}

function readItems(value: unknown, notes: string[], warnings: string[]): ObjectsPlan['items'] {
  if (!Array.isArray(value)) {
    if (value !== undefined) warnings.push('Ignored items that were not a list.');
    return [];
  }
  const items: ObjectsPlan['items'] = [];
  let total = 0;
  let dropped = false;
  for (const entry of value.slice(0, OBJECT_ITEMS.length * 2)) {
    if (!isRecord(entry)) continue;
    const item = own(entry, 'item');
    if (typeof item !== 'string' || !(OBJECT_ITEMS as readonly string[]).includes(item)) {
      warnings.push(`Ignored an unknown item ${JSON.stringify(item)}.`);
      continue;
    }
    const rawCount = own(entry, 'count');
    let count = typeof rawCount === 'number' && Number.isFinite(rawCount) ? Math.max(0, Math.round(rawCount)) : 1;
    if (total + count > MAX_OBJECTS) {
      count = MAX_OBJECTS - total;
      dropped = true;
    }
    if (count <= 0) continue;
    const existing = items.find((i) => i.item === item);
    if (existing) existing.count += count;
    else items.push({ item: item as ObjectItem, count });
    total += count;
  }
  if (dropped) notes.push(`I can add up to ${MAX_OBJECTS} things at a time.`);
  return items;
}

function groupRooms(rooms: RoomType[]): Array<{ type: RoomType; count: number }> {
  return ROOM_TYPES.map((type) => ({ type, count: rooms.filter((r) => r === type).length })).filter((r) => r.count > 0);
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T, label: string, warnings: string[]): T {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  warnings.push(`Ignored an unknown ${label} ${JSON.stringify(value)}.`);
  return fallback;
}

function readBoolean(value: unknown, fallback: boolean, label: string, warnings: string[]): boolean {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  warnings.push(`Ignored a ${label} value that was not true or false.`);
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Own properties only, so inherited keys (`__proto__`, `constructor`...) are never read as plan data. */
function own(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function formatMetres(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
