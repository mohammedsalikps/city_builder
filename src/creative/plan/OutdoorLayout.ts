import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import { itemName, KIND_NAMES, type ObjectItem, type ObjectsPlan, type OutdoorPlan } from './ConstructionPlan';
import {
  DM,
  GroundPlan,
  LayoutWriter,
  QUARTER,
  countTypes,
  grow,
  pieceKit,
  rectAt,
  rectDistance,
  rectsOverlap,
  sections,
  toMetres,
  unionRect,
  type LocalRect,
  type PlanLayout,
} from './LayoutKit';

/**
 * Gardens and parks (one layout, two scales), and loose objects added to the
 * world. Pure and deterministic like HouseLayout: features are placed in a
 * fixed order, each at the first of a fixed list of spots where it keeps its
 * clearances, so the same plan always gives the same garden. What does not
 * fit is left out and explained in `notes` - never squeezed in.
 *
 * Local frame: origin at the centre of the plot, entrance (gate, path in) on
 * the front (+Z) side. Clearances, all checked on the ground plan:
 *   - pieces stay 0.3 m inside the plot edge (the fence runs along it);
 *   - 0.4 m of grass between a path and anything beside it;
 *   - 1.5 m of free ground round every piece of play equipment;
 *   - trees at least 3 m apart, benches with free ground in front for legs.
 */

const PIECES = {
  fence: 'fence_wood',
  stones: 'path_stones',
  paving: 'sidewalk_segment',
  trees: ['tree_round', 'tree_pine'],
  bush: 'bush_round',
  flowerBed: 'garden_flowerbed',
  bench: 'decor_bench',
  lamp: 'streetlight_single',
  bin: 'decor_bin',
  slide: 'play_slide',
  swing: 'play_swing',
  sandpit: 'play_sandpit',
  rock: 'decor_rock_large',
  flower: 'flower_pink',
} as const;

/** Clearances, dm. */
const EDGE = 3;
const PATH_PAD = 4;
const TREE_SPACING = 30;
const PLAY_SAFETY = 15;
const BENCH_FRONT = 6;
/** Gate width in the fence where the path comes in, dm. */
const GATE = 20;
/** A bench "looks at" flowers within this distance in front of it, dm. */
const BENCH_VIEW = 40;

type Spot = [x: number, z: number, rotationY: number];

export function layoutOutdoor(plan: OutdoorPlan, registry: ObjectRegistry): PlanLayout {
  const kit = pieceKit(registry, [...Object.values(PIECES).flat()]);
  const park = plan.kind === 'park';
  const W = plan.size.width * DM;
  const D = plan.size.depth * DM;
  const hw = W / 2;
  const hd = D / 2;
  const out = new LayoutWriter();
  const notes: string[] = [];
  const inner: LocalRect = { minX: -hw + EDGE, maxX: hw - EDGE, minZ: -hd + EDGE, maxZ: hd - EDGE };
  const ground = new GroundPlan(inner);

  const put = (key: string, id: string, [x, z, rotationY]: Spot, tag: string, scale?: { x: number; y: number; z: number }): LocalRect => {
    const rect = rectAt(x, z, kit.footprint(id, rotationY, scale ? { x: scale.x, z: scale.z } : undefined));
    ground.take(rect, tag);
    out.add(key, id, x, 0, z, rotationY, scale ? { scale } : {});
    return rect;
  };
  /** First spot where `id` fits with `pad` of clear ground round it. */
  const first = (id: string, spots: Spot[], pad: number, extra?: (rect: LocalRect, spot: Spot) => boolean): Spot | null =>
    spots.find((spot) => {
      const rect = rectAt(spot[0], spot[1], kit.footprint(id, spot[2]));
      return ground.fits(rect, pad) && (!extra || extra(rect, spot));
    }) ?? null;
  const shortfall = (placed: number, wanted: number, what: string) => {
    if (placed < wanted) notes.push(`Only ${placed} of the ${wanted} ${what} fit in a ${plan.size.width} × ${plan.size.depth} m ${KIND_NAMES[plan.kind]} - try a bigger one.`);
  };

  // ------------------------------------------------------------------ fence
  if (plan.fence) {
    const run = (name: string, axis: 'x' | 'z', at: number, from: number, to: number) => {
      let cursor = from;
      sections(to - from, kit.footprint(PIECES.fence, 0)[0]).forEach((length, k) => {
        const mid = cursor + length / 2;
        const full = kit.footprint(PIECES.fence, 0)[0];
        const scale = length < full ? { x: length / full, y: 1, z: 1 } : undefined;
        const spot: Spot = axis === 'x' ? [mid, at, 0] : [at, mid, QUARTER];
        put(`fence:${name}#${k}`, PIECES.fence, spot, 'fence', scale);
        cursor += length;
      });
    };
    const t = kit.footprint(PIECES.fence, 0)[1];
    run('back', 'x', -hd + t / 2, -hw, hw);
    run('frontL', 'x', hd - t / 2, -hw, -GATE / 2);
    run('frontR', 'x', hd - t / 2, GATE / 2, hw);
    run('west', 'z', -hw + t / 2, -hd + t, hd - t);
    run('east', 'z', hw - t / 2, -hd + t, hd - t);
  }

  // ------------------------------------------------------------------ paths
  let pathWidth = 0;
  if (plan.path && !park) {
    // Stepping stones from the gate towards the back, stopping short of the seat there.
    const [width, length] = kit.footprint(PIECES.stones, 0);
    const room = D - EDGE - kit.footprint(PIECES.bench, 0)[1] - BENCH_FRONT - 2;
    const count = Math.max(1, Math.floor(room / length));
    for (let k = 0; k < count; k++) put(`walk:${k}`, PIECES.stones, [0, hd - length / 2 - k * length, 0], 'path');
    pathWidth = width / DM;
  } else if (plan.path && park) {
    // Paved paths crossing the park: one right across, one from the entrance to the back.
    const [tile, width] = kit.footprint(PIECES.paving, 0);
    for (let k = 0; k < W / tile; k++) put(`walk:x#${k}`, PIECES.paving, [-hw + tile / 2 + k * tile, 0, 0], 'path');
    const along = (name: string, from: number, to: number) => {
      let cursor = from;
      sections(to - from, tile).forEach((length, k) => {
        const scale = length < tile ? { x: length / tile, y: 1, z: 1 } : undefined;
        put(`walk:${name}#${k}`, PIECES.paving, [0, cursor + length / 2, QUARTER], 'path', scale);
        cursor += length;
      });
    };
    along('front', width / 2, hd);
    along('back', -hd, -width / 2);
    pathWidth = width / DM;
  }
  const pathHalf = (pathWidth * DM) / 2;

  // ------------------------------------------------------------- playground
  let playPlaced = 0;
  const playRects: LocalRect[] = [];
  if (plan.playground) {
    // One corner of the park (back first), each piece with safe space all round.
    const regions: LocalRect[] = park && plan.path
      ? [
          { minX: inner.minX, maxX: -pathHalf, minZ: inner.minZ, maxZ: -pathHalf },
          { minX: pathHalf, maxX: inner.maxX, minZ: inner.minZ, maxZ: -pathHalf },
          { minX: inner.minX, maxX: -pathHalf, minZ: pathHalf, maxZ: inner.maxZ },
          { minX: pathHalf, maxX: inner.maxX, minZ: pathHalf, maxZ: inner.maxZ },
        ]
      : [inner];
    const playFits = (rect: LocalRect) =>
      ground.fits(rect, 0) && ground.taken.every((t) => t.tag === 'play-zone' || !rectsOverlap(t.rect, grow(rect, PLAY_SAFETY)));
    for (const [n, id] of [PIECES.swing, PIECES.slide, PIECES.sandpit].entries()) {
      const spots: Spot[] = [];
      for (const region of regions) {
        for (let z = region.minZ; z <= region.maxZ; z += 5) {
          for (let x = region.minX; x <= region.maxX; x += 5) for (const r of [0, QUARTER]) spots.push([x, z, r]);
        }
      }
      const spot = spots.find((s) => {
        const rect = rectAt(s[0], s[1], kit.footprint(id, s[2]));
        return regions.some((g) => rect.minX >= g.minX && rect.maxX <= g.maxX && rect.minZ >= g.minZ && rect.maxZ <= g.maxZ) && playFits(rect);
      });
      if (!spot) continue;
      const rect = put(`play:${n}`, id, spot, 'play');
      ground.take(grow(rect, PLAY_SAFETY), 'play-zone');
      playRects.push(rect);
      playPlaced++;
    }
    if (playPlaced < 3) notes.push(`There was only room for ${playPlaced} of the 3 playground pieces with safe space round them - try a bigger ${KIND_NAMES[plan.kind]}.`);
  }

  // ---------------------------------------------------------------- benches
  const benchRects: Array<{ rect: LocalRect; spot: Spot }> = [];
  const [benchW, benchD] = kit.footprint(PIECES.bench, 0);
  /** The free ground a bench needs in front of it (its front faces local +Z, turned by rotationY). */
  const frontOf = (rect: LocalRect, rotationY: number, reach: number): LocalRect => {
    const step = Math.round(rotationY / QUARTER) & 3;
    if (step === 0) return { ...rect, minZ: rect.maxZ, maxZ: rect.maxZ + reach };
    if (step === 2) return { ...rect, maxZ: rect.minZ, minZ: rect.minZ - reach };
    if (step === 1) return { ...rect, minX: rect.maxX, maxX: rect.maxX + reach };
    return { ...rect, maxX: rect.minX, minX: rect.minX - reach };
  };
  const benchSpots: Spot[] = [];
  if (!park) {
    const backZ = inner.minZ + benchD / 2 + 1;
    benchSpots.push([0, backZ, 0], [-hw / 2, backZ, 0], [hw / 2, backZ, 0], [inner.minX + benchD / 2 + 1, 0, QUARTER], [inner.maxX - benchD / 2 - 1, 0, -QUARTER]);
  } else {
    const off = pathHalf + PATH_PAD + benchD / 2;
    for (let x = -hw + 30; x <= hw - 30; x += 50) {
      if (plan.path && Math.abs(x) < pathHalf + PATH_PAD + benchW) continue;
      benchSpots.push([x, -off, 0], [x, off, Math.PI]);
    }
    for (let z = -hd + 30; z <= hd - 30; z += 50) {
      if (plan.path && Math.abs(z) < pathHalf + PATH_PAD + benchW) continue;
      benchSpots.push([-off, z, QUARTER], [off, z, -QUARTER]);
    }
  }
  // Legroom in front of a bench may reach onto a path (it is for walking on), never onto anything else.
  const legroom = (rect: LocalRect, rotationY: number) => {
    const front = frontOf(rect, rotationY, BENCH_FRONT);
    return ground.taken.every((t) => t.tag === 'path' || !rectsOverlap(t.rect, front));
  };
  for (let i = 0; i < plan.benches; i++) {
    const spot = first(PIECES.bench, benchSpots, 2, (rect, s) => legroom(rect, s[2]));
    if (!spot) break;
    const rect = put(`bench:${i}`, PIECES.bench, spot, 'bench');
    ground.take(frontOf(rect, spot[2], BENCH_FRONT), 'bench-front');
    benchRects.push({ rect, spot });
  }
  shortfall(benchRects.length, plan.benches, 'benches');
  if (park && benchRects.length > 0) {
    // A litter bin beside the first bench.
    const { rect } = benchRects[0];
    const [bw] = kit.footprint(PIECES.bin, 0);
    const spot = first(PIECES.bin, [[rect.maxX + 2 + bw / 2, (rect.minZ + rect.maxZ) / 2, 0], [rect.minX - 2 - bw / 2, (rect.minZ + rect.maxZ) / 2, 0]], 1);
    if (spot) put('bin:0', PIECES.bin, spot, 'bin');
  }

  // ------------------------------------------------------------ flower beds
  const bedSpots: Spot[] = [];
  const [bedW, bedD] = kit.footprint(PIECES.flowerBed, 0);
  if (!park) {
    // Along both sides of the path, then beside the seat, then along the sides.
    const off = (plan.path ? pathHalf + PATH_PAD : 0) + bedD / 2;
    for (let z = hd - EDGE - bedW / 2 - 4; z >= inner.minZ + bedW / 2; z -= bedW + 4) bedSpots.push([-off, z, QUARTER], [off, z, QUARTER]);
    const backZ = inner.minZ + bedD / 2 + 1;
    for (let x = benchW / 2 + 4 + bedW / 2; x <= hw; x += bedW + 4) bedSpots.push([-x, backZ, 0], [x, backZ, 0]);
    for (let z = inner.maxZ - bedW / 2; z >= inner.minZ; z -= bedW + 4) bedSpots.push([inner.minX + bedD / 2 + 1, z, QUARTER], [inner.maxX - bedD / 2 - 1, z, QUARTER]);
  } else {
    // Round the crossing, then along the paths.
    const ox = pathHalf + PATH_PAD + bedW / 2;
    const oz = pathHalf + PATH_PAD + bedD / 2;
    bedSpots.push([-ox, -oz, 0], [ox, -oz, 0], [-ox, oz, 0], [ox, oz, 0]);
    for (let x = ox + bedW + 30; x <= hw; x += bedW + 30) bedSpots.push([-x, -oz, 0], [x, oz, 0], [x, -oz, 0], [-x, oz, 0]);
    for (let z = oz + bedW + 30; z <= hd; z += bedW + 30) bedSpots.push([-ox, -z, QUARTER], [ox, z, QUARTER], [ox, -z, QUARTER], [-ox, z, QUARTER]);
    for (let z = inner.minZ + bedD / 2 + 4; z <= inner.maxZ; z += 40) for (let x = inner.minX + bedW / 2 + 4; x <= inner.maxX; x += 40) bedSpots.push([x, z, 0]);
  }
  const bedRects: LocalRect[] = [];
  for (let i = 0; i < plan.flowerBeds; i++) {
    const spot = first(PIECES.flowerBed, bedSpots, 2);
    if (!spot) break;
    bedRects.push(put(`bed:${i}`, PIECES.flowerBed, spot, 'flowerbed'));
  }
  shortfall(bedRects.length, plan.flowerBeds, 'flower beds');

  // ------------------------------------------------------------------ lamps
  let lamps = 0;
  if (plan.lamps && plan.path) {
    const [lampW] = kit.footprint(PIECES.lamp, 0);
    const off = pathHalf + 1 + lampW / 2;
    const spots: Spot[] = [];
    if (park) {
      // About one lamp every 8 m of path, on alternating sides, heads leaning over the path.
      for (let x = -hw + 20; x <= hw - 20; x += 160) spots.push([x, off, QUARTER], [x + 80, -off, -QUARTER]);
      for (let z = hd - 20; z >= -hd + 20; z -= 160) spots.push([off, z, Math.PI], [-off, z - 80, 0]);
    } else {
      spots.push([-(pathHalf + 1 + lampW / 2), hd - 10, Math.PI], [pathHalf + 1 + lampW / 2, hd - 10, 0]);
    }
    for (const spot of spots) {
      if (!first(PIECES.lamp, [spot], 1)) continue;
      put(`lamp:${lamps++}`, PIECES.lamp, spot, 'lamp');
    }
  }

  // ------------------------------------------------------------------ trees
  // Round the edge, spread out as far as possible from each other (farthest
  // first); a park also fills its inside once the edge is used up.
  const [treeW] = kit.footprint(PIECES.trees[1], 0);
  const ring: Spot[] = [];
  const inset = EDGE + treeW / 2 + 2;
  for (let x = -hw + inset; x <= hw - inset; x += 10) ring.push([x, -hd + inset, 0], [x, hd - inset, 0]);
  for (let z = -hd + inset + 10; z <= hd - inset - 10; z += 10) ring.push([-hw + inset, z, 0], [hw - inset, z, 0]);
  if (park) for (let z = -hd + 40; z <= hd - 40; z += 30) for (let x = -hw + 40; x <= hw - 40; x += 30) ring.push([x, z, 0]);
  const trees: Spot[] = [];
  for (let i = 0; i < plan.trees; i++) {
    const id = PIECES.trees[i % 2];
    const usable = ring.filter((spot) => {
      if (Math.abs(spot[0]) < GATE && spot[1] > hd - 40) return false; // keep the way in open
      if (trees.some((t) => Math.hypot(t[0] - spot[0], t[1] - spot[1]) < TREE_SPACING)) return false;
      return ground.fits(rectAt(spot[0], spot[1], kit.footprint(id, 0)), PATH_PAD);
    });
    if (usable.length === 0) break;
    const score = (spot: Spot) => (trees.length === 0 ? -Math.hypot(spot[0] + hw, spot[1] + hd) : Math.min(...trees.map((t) => Math.hypot(t[0] - spot[0], t[1] - spot[1]))));
    const best = usable.reduce((a, b) => (score(b) > score(a) + 1e-9 ? b : a));
    put(`tree:${i}`, id, best, 'tree');
    trees.push(best);
  }
  shortfall(trees.length, plan.trees, 'trees');

  // ----------------------------------------------------------------- shrubs
  const [bushW, bushD] = kit.footprint(PIECES.bush, 0);
  const shrubSpots: Spot[] = [[-(GATE / 2 + bushW), hd - EDGE - bushD / 2 - 1, 0], [GATE / 2 + bushW, hd - EDGE - bushD / 2 - 1, 0]];
  for (let x = GATE / 2 + 2 * bushW + 6; x <= hw - EDGE - bushW / 2; x += 15) shrubSpots.push([-x, hd - EDGE - bushD / 2 - 1, 0], [x, hd - EDGE - bushD / 2 - 1, 0]);
  for (let z = hd - 20; z >= -hd + 10; z -= 15) shrubSpots.push([-hw + EDGE + bushD / 2 + 1, z, QUARTER], [hw - EDGE - bushD / 2 - 1, z, QUARTER]);
  for (let x = -hw + 10; x <= hw - 10; x += 15) shrubSpots.push([x, -hd + EDGE + bushD / 2 + 1, 0]);
  let shrubs = 0;
  for (; shrubs < plan.shrubs; shrubs++) {
    const spot = first(PIECES.bush, shrubSpots, 2);
    if (!spot) break;
    put(`bush:${shrubs}`, PIECES.bush, spot, 'shrub');
  }
  shortfall(shrubs, plan.shrubs, 'bushes');

  // ------------------------------------------------------------------ facts
  const objects = out.objects;
  const occupied = ground.taken.filter((t) => !['fence', 'play-zone', 'bench-front'].includes(t.tag)).reduce((sum, t) => sum + (t.rect.maxX - t.rect.minX) * (t.rect.maxZ - t.rect.minZ), 0);
  const minPlay = playRects.length
    ? Math.min(...playRects.map((rect) => Math.min(...ground.taken.filter((t) => t.tag !== 'play-zone' && t.rect !== rect).map((t) => rectDistance(rect, t.rect)), Infinity)))
    : 0;
  const benchFacesFlowers = benchRects.some(({ rect, spot }) => bedRects.some((bed) => rectsOverlap(frontOf(rect, spot[2], BENCH_VIEW), bed)));
  const minTreeGap = trees.length > 1 ? Math.min(...trees.flatMap((a, i) => trees.slice(i + 1).map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])))) : 0;
  const plot: LocalRect = { minX: -hw, maxX: hw, minZ: -hd, maxZ: hd };
  return {
    objects,
    keys: out.keys,
    rooms: [],
    footprint: { width: plan.size.width, depth: plan.size.depth },
    extent: toMetres(plot),
    notes,
    facts: {
      counts: countTypes(objects, kit),
      measures: {
        width: plan.size.width,
        depth: plan.size.depth,
        area: plan.size.width * plan.size.depth,
        pathWidth,
        lawnArea: Math.max(0, Math.round((W * D - occupied) / (DM * DM))),
        minPlayClearance: Number.isFinite(minPlay) ? Math.floor(minPlay) / DM : 0,
        minTreeGap: Math.floor(minTreeGap) / DM,
        playPieces: playPlaced,
        lamps,
      },
      flags: { fence: plan.fence, gate: plan.fence, path: pathWidth > 0, benchFacesFlowers, playground: playPlaced > 0 },
    },
  };
}

// ----------------------------------------------------------------- objects

const ITEM_PIECES: Record<ObjectItem, readonly string[]> = {
  tree: PIECES.trees,
  bush: [PIECES.bush],
  flower_bed: [PIECES.flowerBed],
  flowers: [PIECES.flower],
  bench: [PIECES.bench],
  lamp: [PIECES.lamp],
  bin: [PIECES.bin],
  rock: [PIECES.rock],
  swing: [PIECES.swing],
  slide: [PIECES.slide],
  sandpit: [PIECES.sandpit],
};
/** Gap between neighbours in a row, dm: play equipment keeps its safe space. */
const ITEM_GAP: Partial<Record<ObjectItem, number>> = { swing: 2 * PLAY_SAFETY, slide: 2 * PLAY_SAFETY, sandpit: 2 * PLAY_SAFETY, tree: 20, flowers: 3 };
const PER_ROW = 6;

/** A few loose things in neat rows, all facing the front, with walking room between them. */
export function layoutObjects(plan: ObjectsPlan, registry: ObjectRegistry): PlanLayout {
  const kit = pieceKit(registry, [...Object.values(ITEM_PIECES).flat()]);
  const out = new LayoutWriter();
  const things = plan.items.flatMap(({ item, count }) => Array.from({ length: count }, (_, i) => ({ item, id: ITEM_PIECES[item][i % ITEM_PIECES[item].length], index: i })));
  const rows: Array<typeof things> = [];
  for (let i = 0; i < things.length; i += PER_ROW) rows.push(things.slice(i, i + PER_ROW));
  const rects: LocalRect[] = [];
  let z = 0;
  for (const row of rows) {
    const gaps = row.map((t) => ITEM_GAP[t.item] ?? 10);
    const widths = row.map((t) => kit.footprint(t.id, 0)[0]);
    const depth = Math.max(...row.map((t) => kit.footprint(t.id, 0)[1]));
    const total = widths.reduce((s, w) => s + w, 0) + gaps.slice(1).reduce((s, g) => s + g, 0);
    let x = -total / 2;
    row.forEach((t, i) => {
      if (i > 0) x += gaps[i];
      const cx = x + widths[i] / 2;
      const cz = z - depth / 2;
      out.add(`item:${t.item}#${t.index}`, t.id, cx, 0, cz, 0);
      rects.push(rectAt(cx, cz, kit.footprint(t.id, 0)));
      x += widths[i];
    });
    z -= depth + Math.max(...gaps);
  }
  // Centre the whole group on the origin.
  const box = unionRect(rects);
  const dx = (box.minX + box.maxX) / 2;
  const dz = (box.minZ + box.maxZ) / 2;
  for (const spec of out.objects) {
    spec.position.x = Math.round((spec.position.x * DM - dx) * 1000) / (1000 * DM);
    spec.position.z = Math.round((spec.position.z * DM - dz) * 1000) / (1000 * DM);
  }
  const extent = toMetres({ minX: box.minX - dx, maxX: box.maxX - dx, minZ: box.minZ - dz, maxZ: box.maxZ - dz });
  const counts = countTypes(out.objects, kit);
  return {
    objects: out.objects,
    keys: out.keys,
    rooms: [],
    footprint: { width: Math.round((extent.maxX - extent.minX) * 10) / 10, depth: Math.round((extent.maxZ - extent.minZ) * 10) / 10 },
    extent,
    notes: [],
    facts: {
      counts,
      measures: { items: things.length, spacing: Math.min(...things.map((t) => ITEM_GAP[t.item] ?? 10)) / DM },
      flags: {},
    },
  };
}

/** Child-friendly list of what an objects plan adds ("3 benches and a tree"). */
export function describeItems(plan: ObjectsPlan): string {
  const parts = plan.items.map(({ item, count }) => (count === 1 ? `a ${itemName(item)}` : `${count} ${itemName(item, count)}`));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] ?? 'something';
}
