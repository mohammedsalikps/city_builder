import { itemName, roomName, ROOM_TYPES, type ObjectItem, type RoomType, type SiteAnchor } from '@/creative/plan/ConstructionPlan';
import { clampSize, type BuildIntent, type ModelOutdoor, type ModelPlan, type ModelSite } from './BuildIntent';

/**
 * EAVARA's offline helper: deterministic construction commands for when the
 * AI service cannot be reached (no network, not configured, busy). It
 * understands the common requests - "build a 30 by 20 house near the lake
 * with 3 bedrooms and a garden", "a garden behind the house with a bench",
 * "a park with a playground", "a treehouse with stairs", "a neighbourhood of
 * six houses", "add three benches", "make it wider", "move it closer to the
 * lake" - and answers in the same BuildIntent shape the model does, so
 * everything after it is identical.
 */

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, another: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const COUNT = '(\\d+|a|an|one|another|single|two|three|four|five|six|seven|eight|nine|ten)';
const ROOM_WORDS: Record<RoomType, string> = {
  bedroom: 'bed ?rooms?',
  bathroom: 'bath ?rooms?|toilets?|washrooms?',
  kitchen: 'kitchens?',
  living: 'living ?rooms?|lounges?|sitting ?rooms?|family ?rooms?',
};
const ITEM_WORDS: Record<ObjectItem, string> = {
  tree: 'trees?',
  bush: 'bush(?:es)?|shrubs?|hedges?',
  flower_bed: 'flower ?beds?',
  flowers: 'flowers?',
  bench: 'bench(?:es)?|seats?',
  lamp: 'lamps?|lights?|street ?lights?',
  bin: '(?:litter |rubbish |trash )?bins?|trash ?cans?',
  rock: 'rocks?|stones?|boulders?',
  swing: 'swings?(?: sets?)?',
  slide: 'slides?',
  sandpit: 'sand ?pits?|sand ?box(?:es)?',
};
const FEATURES = {
  balcony: /balcon(y|ies)|terrace|deck|veranda|porch/,
  garden: /garden|yard|trees/,
  driveway: /driveway|garage|parking|\bcar\b/,
  roof: /\broof/,
} as const;
const NEGATION = /\b(no|without|remove|delete|take away|get rid of|don't want|dont want)\b/;
const HOUSE_WORDS = /\b(house|home|villa|cottage|mansion|bungalow|cabin)\b/;
const KIND_NOUN = '(?:house|home|cottage|villa|mansion|bungalow|cabin|garden|park|playground|tree ?house|neighbou?rhood|village)';
const EXPLICIT_NEW = new RegExp(
  `\\b(?:new|another|second|third|one more|extra|different)\\s+(?:\\w+\\s+){0,2}${KIND_NOUN}\\b|\\b(?:build|make|create|design|plan|give me|i want|can you build)\\s+(?:me\\s+)?(?:a|an)\\s+(?:\\w+\\s+){0,3}${KIND_NOUN}\\b`,
);

/**
 * Whether a request explicitly asks for a NEW creation: "another house", "a
 * new garden", "build a park". Anything else, while a creation is being
 * worked on, is first read as a change to it ("add another bedroom",
 * "remove the garden", "add a playground"). In a neighbourhood, "another
 * house" means one more house in it.
 */
export function asksForNew(text: string, current: ModelPlan['kind'] | null): boolean {
  const t = text.toLowerCase();
  if (current === 'neighborhood' && /\b(add|another|more|extra|one more)\b.*\b(houses?|homes?)\b/.test(t) && !/\bneighbou?rhood\b/.test(t)) return false;
  return EXPLICIT_NEW.test(t);
}
const DEFAULT_SIZE = { width: 16, depth: 12 };
const STEP = 4;

export function interpretLocally(text: string, current: ModelPlan | null, context: { hasHouse?: boolean } = {}): BuildIntent {
  const t = ` ${text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ')} `;
  const site = siteIn(t);
  const hasHouse = context.hasHouse === true || current?.kind === 'house';
  const kind = kindIn(t);
  const wantsNew = asksForNew(t, current?.kind ?? null);

  if (current && /\b(move|shift|carry|bring)\b/.test(t) && !wantsNew) return moveIntent(t, site, current);
  if (current && !wantsNew) {
    const modified = modifyIntent(t, current, site);
    if (modified) return modified;
  }
  if (kind === 'treehouse') return treehouseIntent(t, site);
  if (kind === 'neighborhood') return neighborhoodIntent(t, site);
  if (kind === 'park' || kind === 'playground') return outdoorIntent(t, 'park', site, hasHouse, kind === 'playground');
  if (kind === 'garden') return outdoorIntent(t, 'garden', site, hasHouse, false);
  if (kind === 'house') return houseIntent(t, site);
  const items = itemsIn(t);
  if (items.length > 0 && /\b(add|put|place|plant|give me|i want|can you|build|make)\b/.test(t)) return addIntent(items, site, hasHouse);
  // Something EAVARA cannot build yet: say so, and offer the closest thing.
  const unsupported = t.match(/\b(castle|rocket|spaceship|pool|swimming pool|skyscraper|tower|bridge|boat|ship|zoo|school|hospital|shop|stadium)\b/);
  if (unsupported) {
    return {
      action: 'chat',
      reply: `I can't build a ${unsupported[1]} yet. I can build houses, gardens, parks with playgrounds, treehouses and neighbourhoods - shall I make one of those?`,
      plan: null,
      move: null,
      choices: [],
    };
  }
  // Too vague to build: one simple question with answers to tap.
  if (/\b(build|make|create)\b.*\b(something|anything|stuff|thing)\b/.test(t) || /^\s*(build|make|create)\s*$/.test(t)) {
    return {
      action: 'clarify',
      reply: 'What shall we build?',
      plan: null,
      move: null,
      choices: ['A cosy little house', 'A park with a playground', 'A treehouse'],
    };
  }
  return {
    action: 'chat',
    reply: current
      ? `I can change your ${kindWord(current.kind)}! Try "make it bigger", "add a bench" or "move it closer to the lake".`
      : 'I can build houses, gardens, parks, treehouses and neighbourhoods! Try "build a garden with flower beds and a bench".',
    plan: null,
    move: null,
    choices: [],
  };
}

// ------------------------------------------------------------------ build

function houseIntent(t: string, site: ModelSite | null): BuildIntent {
  const size = sizeIn(t) ?? sizeWord(t) ?? DEFAULT_SIZE;
  const counts: Record<RoomType, number> = { living: 1, kitchen: 1, bedroom: 1, bathroom: 0 };
  for (const type of ROOM_TYPES) {
    const asked = roomCount(t, type);
    if (asked !== null) counts[type] = asked;
  }
  const where = anchorSite(site);
  const plan: ModelPlan = {
    kind: 'house',
    name: nameIn(t) ?? (where === 'lake' ? 'Lakeside House' : /villa/.test(t) ? 'Villa' : 'Your House'),
    width: clampSize(size.width),
    depth: clampSize(size.depth),
    site: where,
    rooms: ROOM_TYPES.map((type) => ({ type, count: counts[type] })).filter((r) => r.count > 0),
    roof: wants(t, FEATURES.roof) === false ? 'none' : /flat roof/.test(t) ? 'flat' : 'gable',
    garden: wants(t, FEATURES.garden) ?? true,
    driveway: wants(t, FEATURES.driveway) ?? false,
    balcony: wants(t, FEATURES.balcony) ?? false,
  };
  const roomWords = plan.rooms.filter((r) => r.type !== 'living' && r.type !== 'kitchen').map((r) => `${r.count} ${roomName(r.type, r.count)}`);
  return {
    action: 'build',
    reply: `Here is a ${plan.width} by ${plan.depth} metre house${placePhrase(where)}${roomWords.length ? ` with ${roomWords.join(' and ')}` : ''}. Do you like it?`,
    plan,
    move: null,
    choices: [],
  };
}

function outdoorIntent(t: string, kind: 'garden' | 'park', site: ModelSite | null, hasHouse: boolean, playground: boolean): BuildIntent {
  const garden = kind === 'garden';
  const size = sizeIn(t) ?? (playground ? { width: 20, depth: 16 } : null) ?? (/\b(big|large|huge)\b/.test(t) ? (garden ? { width: 16, depth: 12 } : { width: 40, depth: 32 }) : null) ?? (/\b(small|little|tiny|cosy|cozy)\b/.test(t) ? (garden ? { width: 8, depth: 6 } : { width: 16, depth: 12 }) : null);
  const count = (item: ObjectItem, fallback: number) => itemCount(t, item) ?? fallback;
  const plan: ModelOutdoor = {
    kind,
    name: nameIn(t) ?? (playground ? 'Playground' : garden ? 'Your Garden' : 'Your Park'),
    width: size?.width ?? (garden ? 10 : 24),
    depth: size?.depth ?? (garden ? 8 : 20),
    site: site ?? (garden && hasHouse ? 'behind_house' : 'view'),
    trees: count('tree', playground ? 4 : garden ? 2 : 8),
    flowerBeds: count('flower_bed', garden ? 3 : 4),
    shrubs: count('bush', garden ? 4 : 6),
    benches: count('bench', garden ? 1 : playground ? 2 : 4),
    path: !/\b(no|without) (a )?path/.test(t),
    fence: /\b(no|without) (a )?fence/.test(t) ? false : garden || /\bfence/.test(t),
    playground: playground || /\b(playground|swings?|slides?|sand ?pit)\b/.test(t),
    lamps: /\b(no|without) (lamps|lights)/.test(t) ? false : !garden || /\b(lamps?|lights?)\b/.test(t),
  };
  const what = playground ? 'a playground with a slide, swings and a sandpit' : `a ${plan.width} by ${plan.depth} metre ${kind}`;
  return { action: 'build', reply: `Here is ${what}${placePhrase(plan.site)}. Do you like it?`, plan, move: null, choices: [] };
}

function treehouseIntent(t: string, site: ModelSite | null): BuildIntent {
  const stairs = /\b(stairs|steps|staircase)\b/.test(t);
  const hut = !/\b(no|without) (a )?(hut|house|cabin)\b|\bjust a (platform|deck)\b|\bopen deck\b/.test(t);
  const plan: ModelPlan = {
    kind: 'treehouse',
    name: nameIn(t) ?? 'Your Treehouse',
    site: site ?? 'view',
    access: stairs ? 'stairs' : 'ladder',
    hut,
    roof: /\b(no|without) (a )?roof\b/.test(t) ? 'none' : 'gable',
  };
  return {
    action: 'build',
    reply: `Here is a treehouse ${stairs ? 'with stairs' : 'with a ladder'}${hut ? ' and a little hut' : ''}, round a tall tree. Do you like it?`,
    plan,
    move: null,
    choices: [],
  };
}

function neighborhoodIntent(t: string, site: ModelSite | null): BuildIntent {
  const houses = t.match(new RegExp(`\\b${COUNT} (?:houses|homes)`));
  const count = Math.min(6, Math.max(2, (houses && countValue(houses[1])) || 4));
  const counts: Record<RoomType, number> = { living: 1, kitchen: 1, bedroom: 1, bathroom: 0 };
  for (const type of ROOM_TYPES) {
    const asked = roomCount(t, type);
    if (asked !== null) counts[type] = asked;
  }
  const plan: ModelPlan = {
    kind: 'neighborhood',
    name: nameIn(t) ?? 'Your Neighbourhood',
    houses: count,
    houseWidth: 12,
    houseDepth: 10,
    rooms: ROOM_TYPES.map((type) => ({ type, count: counts[type] })).filter((r) => r.count > 0),
    roof: /flat roof/.test(t) ? 'flat' : 'gable',
    street: !/\b(no|without) (a )?(street|road)/.test(t),
    park: !/\b(no|without) (a )?park/.test(t),
    site: anchorSite(site),
  };
  return { action: 'build', reply: `Here is a neighbourhood of ${count} houses${plan.street ? ' along a street' : ''}${plan.park ? ' with a little park' : ''}. Do you like it?`, plan, move: null, choices: [] };
}

function addIntent(items: Array<{ item: ObjectItem; count: number }>, site: ModelSite | null, hasHouse: boolean): BuildIntent {
  const plan: ModelPlan = { kind: 'objects', name: 'New Things', site: site ?? (hasHouse ? 'front_of_house' : 'view'), items };
  const words = items.map((i) => (i.count === 1 ? `a ${itemName(i.item)}` : `${i.count} ${itemName(i.item, i.count)}`));
  return { action: 'add', reply: `Adding ${words.join(' and ')}${placePhrase(plan.site)}. Take a look!`, plan, move: null, choices: [] };
}

// ----------------------------------------------------------------- modify

function modifyIntent(t: string, current: ModelPlan, site: ModelSite | null): BuildIntent | null {
  const said: string[] = [];
  const amount = (word: string, step = STEP) => {
    const match = t.match(new RegExp(`(\\d+(?:\\.\\d+)?) ?(?:m|metres?|meters?)? (?:${word})`));
    return match ? Number(match[1]) : step;
  };
  const resize = (plan: { width: number; depth: number }, step = STEP, clamp = (v: number) => v) => {
    const grow = (axis: 'width' | 'depth', delta: number) => (plan[axis] = clamp(plan[axis] + delta));
    if (/\b(wider|broader)\b/.test(t)) grow('width', amount('wider|broader', step)), said.push('making it wider');
    if (/\b(narrower|thinner)\b/.test(t)) grow('width', -amount('narrower|thinner', step)), said.push('making it narrower');
    if (/\b(longer|deeper)\b/.test(t)) grow('depth', amount('longer|deeper', step)), said.push('making it deeper');
    if (/\b(shorter|shallower)\b/.test(t)) grow('depth', -amount('shorter|shallower', step)), said.push('making it shallower');
    if (/\b(bigger|larger)\b/.test(t)) grow('width', amount('bigger|larger', step)), grow('depth', amount('bigger|larger', step)), said.push('making it bigger');
    if (/\b(smaller|tinier)\b/.test(t)) grow('width', -amount('smaller|tinier', step)), grow('depth', -amount('smaller|tinier', step)), said.push('making it smaller');
    const size = sizeIn(t);
    if (size) {
      plan.width = clamp(size.width);
      plan.depth = clamp(size.depth);
      said.push(`making it ${plan.width} by ${plan.depth} metres`);
    }
  };
  const moveTo = (plan: { site: ModelSite }) => {
    // A house cannot stand beside "the house": "put a garden behind the house" is not about moving it.
    const relative = site === 'behind_house' || site === 'front_of_house' || site === 'beside_house';
    if (relative && (current.kind === 'house' || current.kind === 'neighborhood')) return;
    if (site && site !== plan.site) {
      plan.site = site;
      said.push(`putting it${placePhrase(site)}`);
    }
  };

  let plan: ModelPlan;
  switch (current.kind) {
    case 'house': {
      const house = { ...current, rooms: current.rooms.map((r) => ({ ...r })) };
      resize(house, STEP, clampSize);
      changeRooms(t, house.rooms, said);
      house.rooms = house.rooms.filter((r) => r.count > 0);
      for (const feature of ['balcony', 'garden', 'driveway'] as const) {
        const want = wants(t, FEATURES[feature]);
        if (want !== null && want !== house[feature]) {
          house[feature] = want;
          said.push(`${want ? 'adding' : 'taking away'} the ${feature}`);
        }
      }
      changeRoof(t, house, said);
      moveTo(house);
      plan = house;
      break;
    }
    case 'garden':
    case 'park': {
      const outdoor = { ...current };
      resize(outdoor);
      const counts: Array<[ObjectItem, 'trees' | 'flowerBeds' | 'shrubs' | 'benches']> = [['tree', 'trees'], ['flower_bed', 'flowerBeds'], ['bush', 'shrubs'], ['bench', 'benches']];
      for (const [item, field] of counts) {
        const delta = itemDelta(t, item);
        if (delta !== 0) {
          outdoor[field] = Math.max(0, outdoor[field] + delta);
          said.push(`${delta > 0 ? 'adding' : 'taking away'} ${Math.abs(delta) === 1 ? `a ${itemName(item)}` : `${Math.abs(delta)} ${itemName(item, 2)}`}`);
        }
      }
      const toggles: Array<[keyof ModelOutdoor & ('path' | 'fence' | 'playground' | 'lamps'), RegExp]> = [
        ['path', /\bpaths?\b/],
        ['fence', /\bfences?\b/],
        ['playground', /\b(playground|swings?|slides?|sand ?pit)\b/],
        ['lamps', /\b(lamps?|lights?)\b/],
      ];
      for (const [field, words] of toggles) {
        const want = wants(t, words);
        if (want !== null && want !== outdoor[field] && (field !== 'lamps' || itemDelta(t, 'lamp') === 0)) {
          outdoor[field] = want;
          said.push(`${want ? 'adding' : 'taking away'} the ${field === 'lamps' ? 'lamps' : field}`);
        }
      }
      moveTo(outdoor);
      plan = outdoor;
      break;
    }
    case 'neighborhood': {
      const hood = { ...current, rooms: current.rooms.map((r) => ({ ...r })) };
      const more = t.match(new RegExp(`\\b(?:add|another|more|extra)\\b(?: ${COUNT})? ?(?:more )?(?:houses?|homes?)`));
      const fewer = t.match(new RegExp(`\\b(?:remove|fewer|less|take away)\\b(?: ${COUNT})? ?(?:houses?|homes?)`));
      if (more) {
        const n = more[0].startsWith('another') ? 1 : countValue(more[1]) ?? 1;
        hood.houses = Math.min(6, hood.houses + n);
        said.push(`adding ${n === 1 ? 'a house' : `${n} houses`}`);
      } else if (fewer) {
        const n = countValue(fewer[1]) ?? 1;
        hood.houses = Math.max(2, hood.houses - n);
        said.push(`taking away ${n === 1 ? 'a house' : `${n} houses`}`);
      }
      const houseSize = { width: hood.houseWidth, depth: hood.houseDepth };
      resize(houseSize, 2);
      hood.houseWidth = houseSize.width;
      hood.houseDepth = houseSize.depth;
      changeRooms(t, hood.rooms, said);
      hood.rooms = hood.rooms.filter((r) => r.count > 0);
      const street = wants(t, /\b(street|road)\b/);
      if (street !== null && street !== hood.street) (hood.street = street), said.push(street ? 'adding a street' : 'taking away the street');
      const park = wants(t, /\bpark\b/);
      if (park !== null && park !== hood.park) (hood.park = park), said.push(park ? 'adding a park' : 'taking away the park');
      changeRoof(t, hood, said);
      moveTo(hood);
      plan = hood;
      break;
    }
    case 'treehouse': {
      const tree = { ...current };
      if (/\b(stairs|steps|staircase)\b/.test(t) && tree.access !== 'stairs') (tree.access = 'stairs'), said.push('swapping the ladder for stairs');
      else if (/\bladder\b/.test(t) && tree.access !== 'ladder') (tree.access = 'ladder'), said.push('swapping the stairs for a ladder');
      const hut = wants(t, /\b(hut|cabin|little house)\b/);
      if (hut !== null && hut !== tree.hut) (tree.hut = hut), said.push(hut ? 'adding a hut' : 'taking the hut away');
      const roof = wants(t, FEATURES.roof);
      if (roof !== null && (roof ? 'gable' : 'none') !== tree.roof) (tree.roof = roof ? 'gable' : 'none'), said.push(roof ? 'adding a roof' : 'taking the roof off');
      moveTo(tree);
      plan = tree;
      break;
    }
    case 'objects': {
      const group = { ...current, items: current.items.map((i) => ({ ...i })) };
      for (const item of Object.keys(ITEM_WORDS) as ObjectItem[]) {
        const delta = itemDelta(t, item);
        if (delta === 0) continue;
        const entry = group.items.find((i) => i.item === item) ?? (group.items[group.items.length] = { item, count: 0 });
        entry.count = Math.max(0, entry.count + delta);
        said.push(`${delta > 0 ? 'adding' : 'taking away'} ${Math.abs(delta) === 1 ? `a ${itemName(item)}` : `${Math.abs(delta)} ${itemName(item, 2)}`}`);
      }
      group.items = group.items.filter((i) => i.count > 0);
      if (group.items.length === 0) return null;
      moveTo(group);
      plan = group;
      break;
    }
  }
  if (said.length === 0) return null;
  return { action: 'modify', reply: `Okay! ${capitalise(said.join(', '))}. Take a look.`, plan, move: null, choices: [] };
}

function changeRooms(t: string, rooms: Array<{ type: RoomType; count: number }>, said: string[]): void {
  for (const type of ROOM_TYPES) {
    const words = ROOM_WORDS[type];
    const entry = rooms.find((r) => r.type === type) ?? (rooms[rooms.length] = { type, count: 0 });
    const removing = t.match(new RegExp(`\\b(?:remove|delete|take away|less|fewer|get rid of)\\b(?: the)? ?${COUNT}? ?(?:${words})`));
    const adding = t.match(new RegExp(`\\b(?:add|another|more|extra|plus|put in)\\b(?: an?)? ?${COUNT}? ?(?:more |extra )?(?:${words})`));
    const exact = t.match(new RegExp(`\\b(\\d+|two|three|four|five|six) (?:${words})`));
    if (removing) {
      const n = countValue(removing[1]) ?? 1;
      entry.count = Math.max(type === 'living' ? 1 : 0, entry.count - n);
      said.push(`taking away ${n === 1 ? 'a' : n} ${roomName(type, n)}`);
    } else if (adding) {
      const word = adding[0].split(' ')[0];
      const n = word === 'another' ? 1 : countValue(adding[1]) ?? 1;
      entry.count = Math.min(6, entry.count + n);
      said.push(`adding ${n === 1 ? 'a' : n} ${roomName(type, n)}`);
    } else if (exact) {
      const n = countValue(exact[1]) ?? entry.count;
      if (n !== entry.count) said.push(`giving it ${n} ${roomName(type, n)}`);
      entry.count = n;
    }
  }
}

function changeRoof(t: string, plan: { roof: 'gable' | 'flat' | 'none' }, said: string[]): void {
  const roof = wants(t, FEATURES.roof);
  const wanted = roof === null ? null : !roof ? 'none' : /flat roof/.test(t) ? 'flat' : 'gable';
  if (wanted && wanted !== plan.roof) {
    plan.roof = wanted;
    said.push(wanted === 'none' ? 'taking the roof off' : wanted === 'flat' ? 'giving it a flat roof' : 'adding a pitched roof');
  }
}

function moveIntent(t: string, site: ModelSite | null, current: ModelPlan): BuildIntent {
  const thing = `your ${kindWord(current.kind)}`;
  const named = site === 'lake' || site === 'home' || site === 'view' ? site : null;
  if (named) {
    const where = named === 'lake' ? 'next to the lake' : named === 'home' ? 'near your home' : 'over here';
    return { action: 'move', reply: `Moving ${thing} ${where}.`, plan: null, move: { near: named, right: 0, forward: 0 }, choices: [] };
  }
  if (site) {
    // Behind / in front of / beside the house is a new site, not a move by metres.
    const plan = { ...current, site } as ModelPlan;
    return { action: 'modify', reply: `Putting ${thing}${placePhrase(site)}.`, plan, move: null, choices: [] };
  }
  const match = t.match(/(?:(\d+(?:\.\d+)?) ?(?:m|metres?|meters?)? )?(?:to the )?\b(left|right|forwards?|backwards?|back|away|further|closer)\b/);
  if (!match) {
    return { action: 'chat', reply: 'Where should it go? Try "move it closer to the lake" or "move it 10 metres left".', plan: null, move: null, choices: [] };
  }
  const metres = match[1] ? Number(match[1]) : 6;
  const direction = match[2];
  const move = { near: null as SiteAnchor | null, right: 0, forward: 0 };
  if (direction === 'left') move.right = -metres;
  else if (direction === 'right') move.right = metres;
  else if (direction === 'away' || direction === 'further' || direction.startsWith('forward')) move.forward = metres;
  else move.forward = -metres;
  const words = direction === 'closer' ? 'closer to you' : direction.startsWith('back') ? 'back towards you' : direction === 'left' || direction === 'right' ? `to the ${direction}` : 'further away';
  return { action: 'move', reply: `Moving ${thing} ${metres} metres ${words}.`, plan: null, move, choices: [] };
}

// --------------------------------------------------------------- reading

function kindIn(t: string): ModelPlan['kind'] | 'playground' | null {
  if (/\btree ?houses?\b/.test(t)) return 'treehouse';
  if (/\b(neighbou?rhoods?|village|street of houses|houses along|a few houses|lots of houses)\b/.test(t) || /\b(\d+|two|three|four|five|six) (houses|homes)\b/.test(t)) return 'neighborhood';
  if (/\bplay ?grounds?\b/.test(t)) return 'playground';
  if (/\bparks?\b/.test(t) && !/\bparking\b/.test(t)) return 'park';
  // "a house with a garden" is a house; "a garden (behind the house)" is a garden.
  if (/\bgardens?\b/.test(t) && (!HOUSE_WORDS.test(t) || /\bgardens?\b.*\b(behind|in front of|next to|beside|by)\b.*\b(house|home)\b/.test(t) || /\b(build|make|design|create|plant)\b (?:me )?(?:a |an |my )?(?:\w+ )?gardens?\b/.test(t))) return 'garden';
  if (HOUSE_WORDS.test(t)) return 'house';
  return null;
}

function siteIn(t: string): ModelSite | null {
  if (/\b(behind|at the back of|back of) (the |my |your )?(house|home)\b|\bback garden\b|\bbehind it\b/.test(t)) return 'behind_house';
  if (/\b(in front of|at the front of|front of) (the |my |your )?(house|home)\b|\bfront garden\b|\bin front of it\b/.test(t)) return 'front_of_house';
  if (/\b(beside|next to|by the side of) (the |my |your )?(house|home)\b|\bnext to it\b|\bbeside it\b/.test(t)) return 'beside_house';
  if (/\b(lake|water|shore|lakeside)\b/.test(t)) return 'lake';
  if (/\b(my home|home plot|near home|at home)\b/.test(t)) return 'home';
  if (/\b(here|over there|where i'm looking|where i am looking)\b/.test(t)) return 'view';
  return null;
}

/** A house or neighbourhood cannot stand beside "the house": those become where the child is looking. */
function anchorSite(site: ModelSite | null): ModelSite {
  return site === 'lake' || site === 'home' ? site : 'view';
}

function itemsIn(t: string): Array<{ item: ObjectItem; count: number }> {
  const found: Array<{ item: ObjectItem; count: number }> = [];
  for (const item of Object.keys(ITEM_WORDS) as ObjectItem[]) {
    if (item === 'flowers' && /flower ?beds?/.test(t)) continue;
    const n = itemCount(t, item);
    if (n !== null) found.push({ item, count: n });
  }
  return found;
}

/** How many of `item` the request names ("three benches" = 3, "a bench" = 1); null when not mentioned. */
function itemCount(t: string, item: ObjectItem): number | null {
  const match = t.match(new RegExp(`\\b(?:${COUNT} )?(?:more |big |small |little |nice |wooden |tall )?(?:${ITEM_WORDS[item]})\\b`));
  if (!match) return null;
  const n = match[1] ? countValue(match[1]) : null;
  return n ?? (/s\b|es\b/.test(match[0].trim().split(' ').pop() ?? '') ? 2 : 1);
}

/** +n for "add n / more", -n for "remove n / fewer"; 0 when the item is not changed. */
function itemDelta(t: string, item: ObjectItem): number {
  const words = ITEM_WORDS[item];
  const removing = t.match(new RegExp(`\\b(?:remove|delete|take away|less|fewer|get rid of)\\b(?: the)? ?${COUNT}? ?(?:${words})\\b`));
  if (removing) return -(countValue(removing[1]) ?? 1);
  const adding = t.match(new RegExp(`\\b(?:add|another|more|extra|plus|put in|plant)\\b(?: an?)? ?${COUNT}? ?(?:more |extra )?(?:${words})\\b`));
  if (adding) return adding[0].startsWith('another') ? 1 : countValue(adding[1]) ?? (/^more\b/.test(adding[0]) ? 2 : 1);
  return 0;
}

function sizeIn(t: string): { width: number; depth: number } | null {
  const match = t.match(/(\d+(?:\.\d+)?) ?(m|metres?|meters?|ft|feet|foot)?(?:-| )?(?:by|x|×|\*)(?:-| )?(\d+(?:\.\d+)?)(?:-| )?(m\b|metres?|meters?|ft|feet|foot)?/);
  if (!match) return null;
  const feet = /^f/.test(match[2] ?? match[4] ?? '');
  const scale = feet ? 0.3048 : 1;
  return { width: Number(match[1]) * scale, depth: Number(match[3]) * scale };
}

function sizeWord(t: string): { width: number; depth: number } | null {
  if (/\b(huge|giant|mansion|enormous)\b/.test(t)) return { width: 30, depth: 20 };
  if (/\b(big|large)\b/.test(t)) return { width: 24, depth: 16 };
  if (/\b(small|tiny|little|cosy|cozy)\b/.test(t)) return { width: 10, depth: 8 };
  return null;
}

function roomCount(t: string, type: RoomType): number | null {
  const match = t.match(new RegExp(`\\b${COUNT}? ?(?:big |small |nice |cosy |cozy |large )?(?:${ROOM_WORDS[type]})\\b`));
  if (!match) return null;
  return countValue(match[1]) ?? 1;
}

function countValue(word: string | undefined): number | null {
  if (!word) return null;
  const n = /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word];
  return n === undefined ? null : Math.min(12, Math.max(0, n));
}

/** true / false when the request asks for / against a feature; null when it does not mention it. */
function wants(t: string, feature: RegExp): boolean | null {
  const match = feature.exec(t);
  if (!match) return null;
  const before = t.slice(Math.max(0, match.index - 28), match.index);
  return !NEGATION.test(before);
}

function nameIn(t: string): string | null {
  const match = t.match(/\b(?:called|named) ([a-z0-9][a-z0-9 ']{0,22})/);
  if (!match) return null;
  return match[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

function placePhrase(site: ModelSite): string {
  switch (site) {
    case 'lake':
      return ' by the lake';
    case 'home':
      return ' near your home';
    case 'behind_house':
      return ' behind your house';
    case 'front_of_house':
      return ' in front of your house';
    case 'beside_house':
      return ' beside your house';
    default:
      return '';
  }
}

function kindWord(kind: ModelPlan['kind']): string {
  return kind === 'neighborhood' ? 'neighbourhood' : kind === 'objects' ? 'things' : kind;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
