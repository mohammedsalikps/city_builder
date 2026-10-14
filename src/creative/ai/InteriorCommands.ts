import type { RoomType } from '@/creative/plan/ConstructionPlan';
import { colourIn, type PaintColour } from '@/creative/colours';

/**
 * Interior Explorer requests understood on the device, before anything is
 * sent to the AI: going inside and outside, travelling to a room, the
 * dollhouse view and the guided tour, and furniture changes ("add a sofa to
 * the living room", "move the bed near the window", "make the kitchen
 * cabinets white"). They are matched with anchored, specific patterns so a
 * building request ("build a house with a big kitchen") is never mistaken
 * for one; anything unmatched goes to the AI builder as before.
 *
 * Nothing here acts: the assistant hands a command to the game, and what
 * EAVARA says comes from what the game really did.
 */
export type InteriorCommand =
  | { kind: 'enter' }
  | { kind: 'exit' }
  | { kind: 'room'; type: RoomType; ordinal: number | null }
  | { kind: 'view'; view: 'walk' | 'dollhouse' }
  | { kind: 'tour' }
  | { kind: 'add'; item: FurnitureWord; count: number; room: { type: RoomType; ordinal: number | null } | 'here' | null; near: Near | null }
  | { kind: 'move'; item: FurnitureWord | 'it'; near: Near }
  | { kind: 'paint'; item: FurnitureWord | 'it'; colour: PaintColour; room: { type: RoomType; ordinal: number | null } | null }
  | { kind: 'cannot-paint'; what: string };

export type Near = 'window' | 'wall' | 'centre';

/** Furniture a child can name, with the catalogue piece added for it and the placed types that count as it. */
export interface FurnitureWord {
  word: string;
  /** Catalogue id added for "add a ...". */
  definitionId: string;
  /** Placed object `type`s (definition.type) that this word means. */
  types: string[];
  /** Plural used in replies ("chairs"). */
  plural: string;
}

export const FURNITURE_WORDS: readonly FurnitureWord[] = [
  { word: 'sofa', definitionId: 'furniture_sofa', types: ['sofa'], plural: 'sofas' },
  { word: 'bed', definitionId: 'furniture_bed', types: ['bed'], plural: 'beds' },
  { word: 'table', definitionId: 'furniture_table', types: ['table'], plural: 'tables' },
  { word: 'chair', definitionId: 'furniture_chair', types: ['chair'], plural: 'chairs' },
  { word: 'wardrobe', definitionId: 'furniture_wardrobe', types: ['wardrobe'], plural: 'wardrobes' },
  { word: 'kitchen cabinet', definitionId: 'kitchen_counter', types: ['counter'], plural: 'kitchen cabinets' },
  { word: 'bathtub', definitionId: 'bath_tub', types: ['bathtub'], plural: 'bathtubs' },
  { word: 'toilet', definitionId: 'bath_toilet', types: ['toilet'], plural: 'toilets' },
  { word: 'washbasin', definitionId: 'bath_basin', types: ['basin'], plural: 'washbasins' },
  { word: 'plant', definitionId: 'decor_potted_plant', types: ['plant'], plural: 'plants' },
];

/** Words children use for each piece (whole words; singular or plural). */
const FURNITURE_SYNONYMS: Array<[RegExp, string]> = [
  [/\b(sofas?|couch(es)?|settees?)\b/, 'sofa'],
  [/\b(beds?)\b/, 'bed'],
  [/\b(tables?|desks?)\b/, 'table'],
  [/\b(chairs?|seats?|stools?)\b/, 'chair'],
  [/\b(wardrobes?|closets?)\b/, 'wardrobe'],
  [/\b(cabinets?|cupboards?|counters?|worktops?)\b/, 'kitchen cabinet'],
  [/\b(bathtubs?|baths?|tubs?)\b/, 'bathtub'],
  [/\b(toilets?|loos?)\b/, 'toilet'],
  [/\b(washbasins?|basins?|sinks?)\b/, 'washbasin'],
  [/\b(plants?|flowerpots?|pot plants?)\b/, 'plant'],
];

const ROOM_WORDS: Array<[RegExp, RoomType]> = [
  [/\b(living ?rooms?|lounges?|sitting ?rooms?|family ?rooms?)\b/, 'living'],
  [/\b(kitchens?)\b/, 'kitchen'],
  [/\b(bed ?rooms?)\b/, 'bedroom'],
  [/\b(bath ?rooms?|toilets?|washrooms?)\b/, 'bathroom'],
];

const ORDINALS: Record<string, number> = { first: 1, '1st': 1, one: 1, second: 2, '2nd': 2, two: 2, third: 3, '3rd': 3, three: 3, fourth: 4, '4th': 4, four: 4, fifth: 5, '5th': 5, five: 5 };
const COUNTS: Record<string, number> = { a: 1, an: 1, one: 1, another: 1, two: 2, three: 3, four: 4, couple: 2, pair: 2 };

/** Building words: a sentence with these is a construction request, not an interior one. */
const BUILDS = /\b(build|make me|create|design|plan|construct)\b/;

function clean(text: string): string {
  return ` ${text.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

function furnitureIn(t: string): FurnitureWord | null {
  for (const [pattern, word] of FURNITURE_SYNONYMS) {
    if (pattern.test(t)) return FURNITURE_WORDS.find((f) => f.word === word) ?? null;
  }
  return null;
}

/** "the second bedroom", "bedroom 2", "the kitchen" - a room type with an optional ordinal. */
export function roomIn(text: string): { type: RoomType; ordinal: number | null } | null {
  const t = clean(text);
  for (const [pattern, type] of ROOM_WORDS) {
    const match = pattern.exec(t);
    if (!match) continue;
    const before = t.slice(0, match.index).trim().split(' ').pop() ?? '';
    const after = t.slice(match.index + match[0].length).trim().split(' ')[0] ?? '';
    const ordinal = ORDINALS[before] ?? (/^\d$/.test(after) ? Number(after) : ORDINALS[after] && after !== 'one' ? ORDINALS[after] : null);
    return { type, ordinal: ordinal ?? null };
  }
  return null;
}

function nearIn(t: string): Near | null {
  if (/\b(window|windows)\b/.test(t)) return 'window';
  if (/\b(middle|centre|center)\b/.test(t)) return 'centre';
  if (/\b(wall|corner|side)\b/.test(t)) return 'wall';
  return null;
}

/**
 * The interior command in a child's words, or null when it is something
 * else (left to the AI builder). `inside` says whether the child is in a
 * house; some commands only make sense there.
 */
export function interpretInteriorCommand(text: string, context: { inside: boolean }): InteriorCommand | null {
  const t = clean(text);
  if (t.trim().length === 0 || t.length > 200) return null;
  if (BUILDS.test(t)) return null;

  // Going in and out.
  if (/^ (please )?(can we |let's |lets |i want to )?(enter|go in|go inside|go into|step inside|walk inside|walk in|look inside|take me (in|inside|into))\b/.test(t) && !furnitureIn(t)) {
    return { kind: 'enter' };
  }
  if (/\b(take me|go|get|step|walk|bring me) (back )?(outside|out of the house|out)\b|\bleave the house\b|\bexit the house\b|\b(go|back) outside\b/.test(t)) {
    return { kind: 'exit' };
  }

  // Views and the tour.
  if (/\b(dollhouse|doll house|from above|see all the rooms|see every room|bird's eye|birds eye|top view)\b/.test(t)) return { kind: 'view', view: 'dollhouse' };
  if (/\b(walk around|first person|walking view|walk inside)\b/.test(t)) return { kind: 'view', view: 'walk' };
  if (/\b(tour|show me around|show me every room|show me all the rooms|guide me)\b/.test(t)) return { kind: 'tour' };

  // Painting furniture.
  const paintVerb = /\b(make|paint|colour|color|turn|change)\b/.test(t);
  const colour = colourIn(t);
  if (paintVerb && colour) {
    if (/\b(walls?|floors?|roofs?|doors?|windows?|ceilings?)\b/.test(t) && !furnitureIn(t)) {
      const what = /\b(walls?)\b/.test(t) ? 'walls' : /\b(floors?)\b/.test(t) ? 'floor' : /\b(roofs?)\b/.test(t) ? 'roof' : /\b(doors?)\b/.test(t) ? 'doors' : /\b(ceilings?)\b/.test(t) ? 'ceiling' : 'windows';
      return { kind: 'cannot-paint', what };
    }
    const item = furnitureIn(t);
    if (item) return { kind: 'paint', item, colour, room: roomIn(t) };
    if (/\b(it|this|that)\b/.test(t)) return { kind: 'paint', item: 'it', colour, room: null };
  }

  // Moving furniture (never the whole house - that stays with the AI builder outside).
  const moveMatch = /\b(move|put|shift|push|slide)\b/.test(t);
  if (moveMatch && context.inside) {
    const near = nearIn(t);
    const item = furnitureIn(t);
    if (near && item && !/\b(add|another|new)\b/.test(t)) return { kind: 'move', item, near };
    if (near && /\b(it|this|that)\b/.test(t)) return { kind: 'move', item: 'it', near };
  }

  // Adding furniture.
  const addMatch = /\b(add|put|place|i want|can i have|give me|get me)\b/.test(t);
  const item = furnitureIn(t);
  if (addMatch && item) {
    const countWord = /\b(a|an|one|another|two|three|four|couple|pair|\d)\b/.exec(t)?.[1] ?? 'a';
    const count = Math.min(4, Math.max(1, /^\d$/.test(countWord) ? Number(countWord) : COUNTS[countWord] ?? 1));
    const room = /\b(this room|here|in here)\b/.test(t) ? 'here' : roomIn(t);
    // Outside, only clearly indoor requests count ("add a sofa to the living room"); "add plants to the garden" stays outdoors.
    const outdoorish = /\b(garden|park|street|yard|outside|lawn|path)\b/.test(t);
    const indoorOnly = !['plant', 'table', 'chair'].includes(item.word);
    if (!context.inside && (outdoorish || (room === null && !indoorOnly))) return null;
    return { kind: 'add', item, count, room, near: nearIn(t) };
  }

  // Travelling to a room.
  const room = roomIn(t);
  if (room && /\b(show me|take me to|go to|walk to|visit|open|let's see|lets see|where is|i want to see)\b/.test(t)) {
    return { kind: 'room', type: room.type, ordinal: room.ordinal };
  }
  return null;
}
