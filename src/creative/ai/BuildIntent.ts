import {
  HOUSE_SIZE_MAX,
  HOUSE_SIZE_MIN,
  OBJECT_ITEMS,
  ROOM_TYPES,
  SITE_ANCHORS,
  type ConstructionPlan,
  type ObjectItem,
  type PlanSite,
  type RoomType,
  type SiteAnchor,
} from '@/creative/plan/ConstructionPlan';
import type { PlanMove } from '@/creative/plan/PlanBuilder';

/**
 * What the construction helper (the AI model, or the offline fallback) says
 * a child's request means. Mirrors the strict JSON schema the server asks
 * the model for (server/buildIntent.ts). Read with `readBuildIntent`, which
 * treats it as untrusted; plans are validated again by PlanBuilder.
 *
 *   build    a NEW creation of any kind (house, garden, park, neighbourhood, treehouse)
 *   add      a few loose things added to the world ("three benches by the house")
 *   modify   change the current creation ("make it wider", "add a slide")
 *   move     move the current creation
 *   clarify  one short question when something important is missing
 *   chat     anything else, including what cannot be built (with an alternative)
 */
export type BuildAction = 'build' | 'add' | 'modify' | 'move' | 'clarify' | 'chat';

/** Where the model may put something: a named place, or relative to the child's house. */
export const MODEL_SITES = ['lake', 'home', 'view', 'behind_house', 'front_of_house', 'beside_house'] as const;
export type ModelSite = (typeof MODEL_SITES)[number];

export interface ModelHouse {
  kind: 'house';
  name: string;
  width: number;
  depth: number;
  site: ModelSite;
  rooms: Array<{ type: RoomType; count: number }>;
  roof: 'gable' | 'flat' | 'none';
  garden: boolean;
  driveway: boolean;
  balcony: boolean;
}

export interface ModelOutdoor {
  kind: 'garden' | 'park';
  name: string;
  width: number;
  depth: number;
  site: ModelSite;
  trees: number;
  flowerBeds: number;
  shrubs: number;
  benches: number;
  path: boolean;
  fence: boolean;
  playground: boolean;
  lamps: boolean;
}

export interface ModelNeighborhood {
  kind: 'neighborhood';
  name: string;
  houses: number;
  houseWidth: number;
  houseDepth: number;
  rooms: Array<{ type: RoomType; count: number }>;
  roof: 'gable' | 'flat' | 'none';
  street: boolean;
  park: boolean;
  site: ModelSite;
}

export interface ModelTreehouse {
  kind: 'treehouse';
  name: string;
  site: ModelSite;
  access: 'ladder' | 'stairs';
  hut: boolean;
  roof: 'gable' | 'none';
}

export interface ModelObjects {
  kind: 'objects';
  name: string;
  site: ModelSite;
  items: Array<{ item: ObjectItem; count: number }>;
}

/** A plan in the flat shape the model reads and writes, one variant per kind. */
export type ModelPlan = ModelHouse | ModelOutdoor | ModelNeighborhood | ModelTreehouse | ModelObjects;

export interface BuildIntent {
  action: BuildAction;
  /** What EAVARA says back to the child. */
  reply: string;
  plan: ModelPlan | null;
  move: PlanMove | null;
  /** For "clarify": up to three short answers the child can tap. */
  choices: string[];
}

const MAX_REPLY = 240;
const MAX_CHOICES = 3;
const MAX_CHOICE_LENGTH = 48;
const MAX_SHIFT = 80;
const MAX_NAME = 32;
const ACTIONS: readonly BuildAction[] = ['build', 'add', 'modify', 'move', 'clarify', 'chat'];

/**
 * What the AI is shown instead of a creation's name: names often come from
 * the child's own words, so they never leave the device (AiClient swaps them
 * for this, and the server ignores any name it is sent). Must match
 * HIDDEN_NAME in server/buildIntent.ts.
 */
export const HIDDEN_NAME = '(name kept on device)';

/** A copy of the plan with its name hidden, as it is sent to the AI. */
export function withHiddenName(plan: ModelPlan): ModelPlan {
  return { ...plan, name: HIDDEN_NAME };
}

/**
 * Put the real name back into an AI answer about the creation being changed:
 * a plan that kept the hidden name gets the creation's own name (or the
 * usual default for something new), and a reply that repeats the hidden
 * name says the real one. A new name the child asked for is kept.
 */
export function restoreHiddenName(intent: BuildIntent, current: ModelPlan | null): BuildIntent {
  const pattern = HIDDEN_NAME.replace(/[()]/g, '\\$&');
  let plan = intent.plan;
  if (plan && new RegExp(pattern, 'i').test(plan.name)) {
    // The creation's own name, or the usual default name for something new.
    plan = { ...plan, name: current && current.kind === plan.kind ? current.name : readPlan({ ...plan, name: '' })?.name ?? plan.name };
  }
  const reply = intent.reply.replace(new RegExp(pattern, 'gi'), current?.name ?? 'it').slice(0, MAX_REPLY);
  return { ...intent, plan, reply };
}

/** Validate a model answer. Returns null when it cannot be used at all. */
export function readBuildIntent(data: unknown): BuildIntent | null {
  if (!isRecord(data)) return null;
  const action = data.action;
  if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) return null;
  const reply = typeof data.reply === 'string' ? cleanText(data.reply).slice(0, MAX_REPLY) : '';
  const plan = readPlan(data.plan);
  const move = readMove(data.move);
  const planned = action === 'build' || action === 'add' || action === 'modify';
  if (planned && !plan) return null;
  if (action === 'move' && !move) return null;
  if (action === 'clarify' && !reply) return null;
  // "add" is for loose things; a whole creation asked for that way is a build.
  const resolved: BuildAction = action === 'add' && plan?.kind !== 'objects' ? 'build' : (action as BuildAction);
  const choices =
    action === 'clarify' && Array.isArray(data.choices)
      ? data.choices
          .filter((c): c is string => typeof c === 'string')
          .map((c) => cleanText(c).slice(0, MAX_CHOICE_LENGTH))
          .filter((c) => c.length > 0)
          .slice(0, MAX_CHOICES)
      : [];
  return { action: resolved, reply, plan: planned ? plan : null, move: action === 'move' ? move : null, choices };
}

/** Typed reading of a model plan; anything malformed becomes null or a safe default (PlanBuilder clamps again). */
export function readPlan(value: unknown): ModelPlan | null {
  if (!isRecord(value)) return null;
  // Older answers had no kind: they were houses.
  const kind = value.kind === undefined ? 'house' : value.kind;
  const name = typeof value.name === 'string' ? cleanText(value.name).slice(0, MAX_NAME) : '';
  const site = readSite(value.site);
  const number = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const count = (v: unknown, fallback: number) => {
    const n = number(v);
    return n === null ? fallback : Math.max(0, Math.round(n));
  };
  const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  switch (kind) {
    case 'house': {
      const width = number(value.width);
      const depth = number(value.depth);
      if (width === null || depth === null) return null;
      return {
        kind: 'house',
        name: name || 'Your House',
        width,
        depth,
        site,
        rooms: readRooms(value.rooms),
        roof: value.roof === 'flat' || value.roof === 'none' ? value.roof : 'gable',
        garden: value.garden === true,
        driveway: value.driveway === true,
        balcony: value.balcony === true,
      };
    }
    case 'garden':
    case 'park': {
      const garden = kind === 'garden';
      const width = number(value.width);
      const depth = number(value.depth);
      if (width === null || depth === null) return null;
      return {
        kind: garden ? 'garden' : 'park',
        name: name || (garden ? 'Your Garden' : 'Your Park'),
        width,
        depth,
        site,
        trees: count(value.trees, garden ? 2 : 8),
        flowerBeds: count(value.flowerBeds, garden ? 3 : 4),
        shrubs: count(value.shrubs, garden ? 4 : 6),
        benches: count(value.benches, garden ? 1 : 4),
        path: flag(value.path, true),
        fence: flag(value.fence, garden),
        playground: flag(value.playground, false),
        lamps: flag(value.lamps, !garden),
      };
    }
    case 'neighborhood':
      return {
        kind: 'neighborhood',
        name: name || 'Your Neighbourhood',
        houses: count(value.houses, 4),
        houseWidth: number(value.houseWidth) ?? 12,
        houseDepth: number(value.houseDepth) ?? 10,
        rooms: readRooms(value.rooms),
        roof: value.roof === 'flat' || value.roof === 'none' ? value.roof : 'gable',
        street: flag(value.street, true),
        park: flag(value.park, true),
        site,
      };
    case 'treehouse':
      return {
        kind: 'treehouse',
        name: name || 'Your Treehouse',
        site,
        access: value.access === 'stairs' ? 'stairs' : 'ladder',
        hut: flag(value.hut, true),
        roof: value.roof === 'none' ? 'none' : 'gable',
      };
    case 'objects': {
      const items = Array.isArray(value.items)
        ? value.items
            .filter(isRecord)
            .filter((i) => typeof i.item === 'string' && (OBJECT_ITEMS as readonly string[]).includes(i.item))
            .map((i) => ({ item: i.item as ObjectItem, count: count(i.count, 1) }))
            .filter((i) => i.count > 0)
        : [];
      if (items.length === 0) return null;
      return { kind: 'objects', name: name || 'New Things', site, items };
    }
    default:
      return null;
  }
}

function readRooms(value: unknown): Array<{ type: RoomType; count: number }> {
  return Array.isArray(value)
    ? value
        .filter(isRecord)
        .filter((r) => typeof r.type === 'string' && (ROOM_TYPES as readonly string[]).includes(r.type))
        .map((r) => ({ type: r.type as RoomType, count: typeof r.count === 'number' && Number.isFinite(r.count) ? Math.round(r.count) : 1 }))
    : [];
}

function readSite(value: unknown): ModelSite {
  return typeof value === 'string' && (MODEL_SITES as readonly string[]).includes(value) ? (value as ModelSite) : 'view';
}

function readMove(value: unknown): PlanMove | null {
  if (!isRecord(value)) return null;
  const near = typeof value.near === 'string' && (SITE_ANCHORS as readonly string[]).includes(value.near) ? (value.near as SiteAnchor) : null;
  const metres = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, v)) : 0);
  const move = { near, right: metres(value.right), forward: metres(value.forward) };
  return move.near || move.right || move.forward ? move : null;
}

/** A model site as a plan site. */
export function toPlanSite(site: ModelSite): PlanSite {
  if (site === 'behind_house') return { beside: 'back' };
  if (site === 'front_of_house') return { beside: 'front' };
  if (site === 'beside_house') return { beside: 'side' };
  return { near: site };
}

/** A plan site as a model site (an exact spot becomes "where you are looking"). */
export function toModelSite(site: PlanSite): ModelSite {
  if ('beside' in site) return site.beside === 'back' ? 'behind_house' : site.beside === 'front' ? 'front_of_house' : 'beside_house';
  if ('near' in site) return site.near;
  return 'view';
}

/** The input format PlanBuilder reads (validated there). Entries with no count are dropped. */
export function toPlanInput(plan: ModelPlan): Record<string, unknown> {
  const base = { version: 1, kind: plan.kind, name: plan.name, site: toPlanSite(plan.site) };
  switch (plan.kind) {
    case 'house':
      return {
        ...base,
        size: { width: plan.width, depth: plan.depth },
        rooms: plan.rooms.filter((r) => r.count > 0),
        roof: plan.roof,
        garden: plan.garden,
        driveway: plan.driveway,
        balcony: plan.balcony,
      };
    case 'garden':
    case 'park':
      return {
        ...base,
        size: { width: plan.width, depth: plan.depth },
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
        ...base,
        houses: plan.houses,
        houseSize: { width: plan.houseWidth, depth: plan.houseDepth },
        rooms: plan.rooms.filter((r) => r.count > 0),
        roof: plan.roof,
        street: plan.street,
        park: plan.park,
      };
    case 'treehouse':
      return { ...base, access: plan.access, hut: plan.hut, roof: plan.roof };
    case 'objects':
      return { ...base, items: plan.items.filter((i) => i.count > 0) };
  }
}

/** A validated plan in the model's flat shape (sent as the "current" creation with a follow-up). */
export function toModelPlan(plan: ConstructionPlan): ModelPlan {
  const site = toModelSite(plan.site);
  const grouped = (rooms: RoomType[]) => ROOM_TYPES.map((type) => ({ type, count: rooms.filter((r) => r === type).length })).filter((r) => r.count > 0);
  switch (plan.kind) {
    case 'house':
      return {
        kind: 'house',
        name: plan.name,
        width: plan.size.width,
        depth: plan.size.depth,
        site,
        rooms: grouped(plan.rooms),
        roof: plan.roof,
        garden: plan.garden,
        driveway: plan.driveway,
        balcony: plan.balcony,
      };
    case 'garden':
    case 'park':
      return {
        kind: plan.kind,
        name: plan.name,
        width: plan.size.width,
        depth: plan.size.depth,
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
        kind: 'neighborhood',
        name: plan.name,
        houses: plan.houses,
        houseWidth: plan.houseSize.width,
        houseDepth: plan.houseSize.depth,
        rooms: grouped(plan.rooms),
        roof: plan.roof,
        street: plan.street,
        park: plan.park,
        site,
      };
    case 'treehouse':
      return { kind: 'treehouse', name: plan.name, site, access: plan.access, hut: plan.hut, roof: plan.roof };
    case 'objects':
      return { kind: 'objects', name: plan.name, site, items: plan.items.map((i) => ({ ...i })) };
  }
}

export function clampSize(value: number): number {
  return Math.min(HOUSE_SIZE_MAX, Math.max(HOUSE_SIZE_MIN, Math.round(value / 2) * 2));
}

function cleanText(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
