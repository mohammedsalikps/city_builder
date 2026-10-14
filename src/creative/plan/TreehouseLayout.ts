import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import type { TreehousePlan } from './ConstructionPlan';
import { DM, LayoutWriter, QUARTER, countTypes, pieceKit, rectsOverlap, specRect, toMetres, unionRect, type LocalRect, type PlanLayout } from './LayoutKit';

/**
 * A treehouse: a wooden deck on posts, built round a tall tree growing up
 * through a gap in the middle, with railings on every open edge, a ladder
 * (with handholds) or stairs up to a gap in the railing, and - unless the
 * child said no - a little hut with a door, windows and a pitched roof.
 *
 * Honest about what holds it up: the engine has no way to fix a deck to a
 * trunk, so eight posts carry the deck and the tree stands in its middle.
 *
 * Local frame (dm): the deck covers x, z in [-30, 30], made of eight 2 m
 * tiles round a 2 x 2 m gap for the tree; the way up arrives at the front
 * (+Z) edge; the hut stands on the back-left tile.
 */

const PIECES = {
  post: 'post_wood',
  deck: 'deck_wood',
  tree: 'tree_pine',
  wallLong: 'wall_long',
  wallShort: 'wall_short',
  door: 'door_single',
  window: 'window_square',
  roof: 'roof_gable',
  railing: 'railing_wood',
  ladder: 'ladder_wood',
  stairs: 'stairs_wood',
  bench: 'decor_bench',
} as const;

/** Tree scaled to stand well above the hut roof, kept slim enough to clear the deck and the hut's eaves. */
const TREE_SCALE = { x: 0.85, y: 2.0, z: 0.85 };

export function layoutTreehouse(plan: TreehousePlan, registry: ObjectRegistry): PlanLayout {
  const kit = pieceKit(registry, Object.values(PIECES));
  const out = new LayoutWriter();
  const notes: string[] = [];
  const [tile] = kit.footprint(PIECES.deck, 0);
  const deckBottom = kit.height(PIECES.post);
  const deckTop = deckBottom + kit.height(PIECES.deck);
  const half = (3 * tile) / 2;

  // The tree first, in the gap.
  out.add('tree:0', PIECES.tree, 0, 0, 0, 0, { scale: { ...TREE_SCALE } });

  // ---------------------------------------------------------- posts and deck
  const tiles: Array<{ i: number; j: number; x: number; z: number; id: string }> = [];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      if (i === 1 && j === 1) continue;
      const x = (i - 1) * tile;
      const z = (j - 1) * tile;
      // Each tile rests on a post near its outer edge.
      const [postWidth] = kit.footprint(PIECES.post, 0);
      const inset = tile / 2 - postWidth / 2 - 2;
      out.add(`post:${i}_${j}`, PIECES.post, x + Math.sign(x) * inset, 0, z + Math.sign(z) * inset, 0, { localId: `p${i}_${j}` });
      out.add(`deck:${i}_${j}`, PIECES.deck, x, deckBottom, z, 0, { localId: `t${i}_${j}`, supportRef: `p${i}_${j}`, surface: 'top' });
      tiles.push({ i, j, x, z, id: `t${i}_${j}` });
    }
  }
  const tileAt = (i: number, j: number) => tiles.find((t) => t.i === i && t.j === j)!;

  // -------------------------------------------------------------------- hut
  const hutTile = tileAt(0, 0);
  let hutRect: LocalRect | null = null;
  if (plan.hut) {
    // 2.2 m square outside, centred on its 2 m tile: every wall rests on the
    // deck, overhanging its edges by just 0.1 m.
    const [long, T] = kit.footprint(PIECES.wallLong, 0);
    const [short] = kit.footprint(PIECES.wallShort, 0);
    if (short !== long - 2 * T) throw new Error('Treehouse hut walls must close into a square');
    const mid = hutTile.x;
    const min = mid - long / 2;
    const max = mid + long / 2;
    hutRect = { minX: min, maxX: max, minZ: min, maxZ: max };
    const walls = {
      back: { id: 'hw_back', piece: PIECES.wallLong, x: mid, z: min + T / 2, r: 0 },
      front: { id: 'hw_front', piece: PIECES.wallLong, x: mid, z: max - T / 2, r: 0 },
      west: { id: 'hw_west', piece: PIECES.wallShort, x: min + T / 2, z: mid, r: QUARTER },
      east: { id: 'hw_east', piece: PIECES.wallShort, x: max - T / 2, z: mid, r: QUARTER },
    };
    for (const [name, w] of Object.entries(walls)) {
      out.add(`wall:hut_${name}`, w.piece, w.x, deckTop, w.z, w.r, { localId: w.id, supportRef: hutTile.id, surface: 'top' });
    }
    const sill = (id: string) => kit.get(id).placement?.sillHeight ?? 0;
    // The door opens onto the deck; windows look out over the garden and at the tree.
    out.add('opening:hut_door', PIECES.door, walls.front.x, deckTop + sill(PIECES.door), walls.front.z, 0, { hostRef: walls.front.id, surface: 'side' });
    for (const name of ['back', 'west', 'east'] as const) {
      const w = walls[name];
      out.add(`opening:hut_${name}`, PIECES.window, w.x, deckTop + sill(PIECES.window), w.z, w.r, { hostRef: w.id, surface: 'side' });
    }
    if (plan.roof === 'gable') {
      out.add('roof:hut', PIECES.roof, mid, deckTop + kit.height(PIECES.wallLong), mid, 0, { supportRef: walls.back.id, surface: 'top' });
    }
  } else {
    // An open deck: a bench to sit on instead of the hut.
    out.add('bench:0', PIECES.bench, hutTile.x, deckTop, hutTile.z - 4, 0, { supportRef: hutTile.id, surface: 'top' });
  }

  // --------------------------------------------------------------- railings
  // Every open outer edge, except where the way up arrives (front middle) and
  // where the hut's own walls are. A railing stops short of anything already
  // at its ends - a corner railing, the hut - so none of them overlap.
  const [railLength, railDepth] = kit.footprint(PIECES.railing, 0);
  const rails: LocalRect[] = [];
  const isHut = (i: number, j: number) => plan.hut && i === 0 && j === 0;
  const addRail = (key: string, t: { x: number; z: number; id: string }, axis: 'x' | 'z', at: number, start: number, end: number) => {
    const strip = (a: number, b: number): LocalRect =>
      axis === 'x' ? { minX: a, maxX: b, minZ: at - railDepth / 2, maxZ: at + railDepth / 2 } : { minX: at - railDepth / 2, maxX: at + railDepth / 2, minZ: a, maxZ: b };
    const blocked = (rect: LocalRect) => [...rails, ...(hutRect ? [hutRect] : [])].some((r) => rectsOverlap(r, rect));
    let from = start;
    let to = end;
    while (to - from > railDepth && blocked(strip(to - railDepth, to))) to -= railDepth;
    while (to - from > railDepth && blocked(strip(from, from + railDepth))) from += railDepth;
    const length = to - from;
    const mid = (from + to) / 2;
    const scale = length < railLength ? { x: length / railLength, y: 1, z: 1 } : undefined;
    const [x, z, r] = axis === 'x' ? [mid, at, 0] : [at, mid, QUARTER];
    out.add(key, PIECES.railing, x, deckTop, z, r, { supportRef: t.id, surface: 'top', ...(scale ? { scale } : {}) });
    rails.push(axis === 'x' ? { minX: from, maxX: to, minZ: at - railDepth / 2, maxZ: at + railDepth / 2 } : { minX: at - railDepth / 2, maxX: at + railDepth / 2, minZ: from, maxZ: to });
  };
  for (const i of [0, 1, 2]) {
    const front = tileAt(i, 2);
    if (i !== 1) addRail(`rail:front_${i}`, front, 'x', half - railDepth / 2, front.x - tile / 2, front.x + tile / 2);
    const back = tileAt(i, 0);
    if (!isHut(i, 0)) addRail(`rail:back_${i}`, back, 'x', -half + railDepth / 2, back.x - tile / 2, back.x + tile / 2);
  }
  for (const [side, i] of [['west', 0], ['east', 2]] as const) {
    const at = (side === 'west' ? -1 : 1) * (half - railDepth / 2);
    for (const j of [0, 1, 2]) {
      if (isHut(i, j)) continue;
      const t = tileAt(i, j);
      addRail(`rail:${side}_${j}`, t, 'z', at, t.z - tile / 2, t.z + tile / 2);
    }
  }

  // ----------------------------------------------------------------- way up
  if (plan.access === 'ladder') {
    const [, depth] = kit.footprint(PIECES.ladder, 0);
    // Feet away from the deck, top against its front edge (the ladder's -Z side).
    out.add('access:ladder', PIECES.ladder, 0, 0, half + depth / 2, 0);
  } else {
    const [, depth] = kit.footprint(PIECES.stairs, Math.PI);
    // Stairs climb towards their +Z end, so turned round they climb up to the deck.
    out.add('access:stairs', PIECES.stairs, 0, 0, half + depth / 2, Math.PI);
  }

  const rects = out.objects.map((spec) => specRect(spec, kit));
  const counts = countTypes(out.objects, kit);
  return {
    objects: out.objects,
    keys: out.keys,
    rooms: [],
    footprint: { width: (3 * tile) / DM, depth: (3 * tile) / DM },
    extent: toMetres(unionRect(rects)),
    notes,
    facts: {
      counts,
      measures: {
        deckHeight: round2(deckTop),
        deckArea: (tiles.length * tile * tile) / (DM * DM),
        railingHeight: round2(kit.height(PIECES.railing)),
        treeHeight: round2(kit.height(PIECES.tree) * TREE_SCALE.y),
        posts: counts.pillar ?? 0,
        handholds: plan.access === 'ladder' ? round2(kit.height(PIECES.ladder) - deckTop) : 0,
      },
      flags: { hut: plan.hut, roof: plan.hut && plan.roof === 'gable', ladder: plan.access === 'ladder', stairs: plan.access === 'stairs' },
    },
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
