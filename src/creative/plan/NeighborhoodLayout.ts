import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import type { TemplateObjectSpec } from '@/creative/Template';
import { rotateAroundY } from '@/utils/math';
import { SIZE_LIMITS, type HousePlan, type NeighborhoodPlan, type OutdoorPlan } from './ConstructionPlan';
import { layoutHouse } from './HouseLayout';
import { DM, LayoutWriter, QUARTER, countTypes, pieceKit, rectDistance, specRect, toMetres, unionRect, type LocalRect, type PlanLayout } from './LayoutKit';
import { layoutOutdoor } from './OutdoorLayout';

/**
 * A neighbourhood: real planned houses (rooms, furniture, roof, garden and
 * driveway - the same HouseLayout a single house gets) in two rows facing a
 * street with pavements and lamps, and a small shared park in one plot.
 *
 * Local frame (dm): the street runs along X through the origin. Houses on
 * the far side (-Z) face +Z, houses on the near side face -Z, each set back
 * so its front path and driveway end exactly at the pavement. Neighbouring
 * plots keep at least PLOT_GAP between everything in them.
 *
 * Every plot is as wide as the neighbourhood's own house size makes it, so a
 * house the child changed on its own (`customHouses`) stays on its plot and
 * nothing else moves: it may be deeper (it grows backwards, its front still
 * at the pavement) or narrower, never wider than the plot.
 */

const PIECES = {
  road: 'road_segment',
  pavement: 'sidewalk_segment',
  lamp: 'streetlight_single',
} as const;

/** Gap between neighbouring plots (their gardens included), dm. */
const PLOT_GAP = 10;
/** Distance from a house's front wall to the pavement: its path and driveway are two 4 m slabs. */
const SETBACK = 80;
/** Lamps along each pavement, one every this many dm. */
const LAMP_SPACING = 120;

interface Plot {
  /** Template objects in plot-local coordinates (front towards +Z). */
  objects: TemplateObjectSpec[];
  keys: string[];
  prefix: string;
  extent: LocalRect;
  /** Distance from the plot origin to its front edge (where it meets the pavement), dm. */
  front: number;
  notes: string[];
  house: boolean;
}

export function layoutNeighborhood(plan: NeighborhoodPlan, registry: ObjectRegistry): PlanLayout {
  const kit = pieceKit(registry, Object.values(PIECES));
  const out = new LayoutWriter();
  const notes: string[] = [];
  const [tile, pavementDepth] = kit.footprint(PIECES.pavement, 0);
  const roadDepth = plan.street ? kit.footprint(PIECES.road, 0)[1] : 0;

  // ------------------------------------------------------------------ plots
  // A plot is the ground the neighbourhood's own house size needs; a changed house is laid out inside it.
  // Houses of the same shape are laid out once (a house layout depends only on its shape, not its name).
  const layouts = new Map<string, PlanLayout>();
  const layoutOf = (house: HousePlan) => {
    const key = JSON.stringify([house.size, house.rooms, house.roof, house.balcony, house.garden, house.driveway]);
    let layout = layouts.get(key);
    if (!layout) layouts.set(key, (layout = layoutHouse(house, registry)));
    return layout;
  };
  const slot = plotExtent(layoutOf(neighborhoodHouse({ ...plan, customHouses: [] }, 0)).extent, plan.houseSize.depth);
  const plots: Plot[] = [];
  for (let i = 0; i < plan.houses; i++) {
    const house = neighborhoodHouse(plan, i);
    const layout = layoutOf(house);
    const ground = plotExtent(layout.extent, house.size.depth);
    const houseNotes = house.size.width < (plan.customHouses.find((c) => c.house === i)?.size?.width ?? 0) ? [...layout.notes, `House ${i + 1} stays ${house.size.width} m wide so it fits its plot.`] : layout.notes;
    plots.push({ objects: layout.objects, keys: layout.keys, prefix: `h${i}`, extent: { minX: slot.minX, maxX: slot.maxX, minZ: ground.minZ, maxZ: ground.maxZ }, front: (house.size.depth * DM) / 2 + SETBACK, notes: houseNotes, house: true });
  }
  let parkPlot: Plot | null = null;
  if (plan.park) {
    // As wide as a house plot (in 4 m park steps) and as deep, with a playground.
    const houseWidth = slot.maxX - slot.minX;
    const width = Math.max(SIZE_LIMITS.park.min, Math.floor(houseWidth / DM / SIZE_LIMITS.park.step) * SIZE_LIMITS.park.step);
    const depth = Math.max(SIZE_LIMITS.park.min, Math.floor((slot.maxZ - slot.minZ) / DM / SIZE_LIMITS.park.step) * SIZE_LIMITS.park.step);
    const park: OutdoorPlan = {
      version: plan.version,
      kind: 'park',
      name: `${plan.name} Park`,
      size: { width, depth },
      site: { near: 'view' },
      trees: 4,
      flowerBeds: 4,
      shrubs: 4,
      benches: 2,
      path: true,
      fence: false,
      playground: true,
      lamps: false,
    };
    const layout = layoutOutdoor(park, registry);
    // Its entrance edge (local +Z) meets the pavement, like a house's path end.
    parkPlot = { objects: layout.objects, keys: layout.keys, prefix: 'park', extent: dm(layout.extent), front: (depth * DM) / 2, notes: layout.notes, house: false };
  }

  // Far row (-Z, facing +Z) and near row (+Z, facing -Z); the park closes the near row.
  const far = plots.filter((_, i) => i % 2 === 0);
  const nearRow = plots.filter((_, i) => i % 2 === 1);
  if (parkPlot) nearRow.push(parkPlot);
  const rowWidth = (row: Plot[]) => row.reduce((sum, p) => sum + (p.extent.maxX - p.extent.minX), 0) + Math.max(0, row.length - 1) * PLOT_GAP;
  const length = Math.ceil(Math.max(rowWidth(far), rowWidth(nearRow)) / tile) * tile;

  // ---------------------------------------------------------- street, pavements
  const pavementAt = plan.street ? roadDepth / 2 + pavementDepth / 2 : 0;
  const tiles = length / tile;
  for (let k = 0; k < tiles; k++) {
    const x = -length / 2 + tile / 2 + k * tile;
    if (plan.street) {
      out.add(`road:${k}`, PIECES.road, x, 0, 0, 0);
      // Kerbs face the road on both sides.
      out.add(`pave:far#${k}`, PIECES.pavement, x, 0, -pavementAt, Math.PI, { localId: `pf${k}` });
      out.add(`pave:near#${k}`, PIECES.pavement, x, 0, pavementAt, 0, { localId: `pn${k}` });
    } else {
      out.add(`pave:mid#${k}`, PIECES.pavement, x, 0, 0, 0, { localId: `pm${k}` });
    }
  }
  const curb = plan.street ? roadDepth / 2 + pavementDepth : pavementDepth / 2;

  // ------------------------------------------------------------------- lamps
  let lamps = 0;
  if (plan.street) {
    const pavementTop = kit.height(PIECES.pavement);
    for (let x = -length / 2 + tile / 2, k = 0; x < length / 2; x += LAMP_SPACING, k++) {
      const index = Math.round((x + length / 2 - tile / 2) / tile);
      const side = k % 2 === 0 ? 'near' : 'far';
      const z = side === 'near' ? pavementAt : -pavementAt;
      // The lamp head leans out over the road.
      out.add(`lamp:${lamps++}`, PIECES.lamp, x, pavementTop, z, side === 'near' ? QUARTER : -QUARTER, { supportRef: `${side === 'near' ? 'pn' : 'pf'}${index}`, surface: 'top' });
    }
  }

  // ------------------------------------------------------------------ houses
  const houses: NonNullable<PlanLayout['houses']> = [];
  const placeRow = (row: Plot[], facing: 1 | -1) => {
    let cursor = -rowWidth(row) / 2;
    for (const plot of row) {
      const width = plot.extent.maxX - plot.extent.minX;
      // Facing -Z (near row) is a half turn, which mirrors the plot's extent in X.
      const turn = facing === 1 ? 0 : Math.PI;
      const originX = facing === 1 ? cursor - plot.extent.minX : cursor + plot.extent.maxX;
      // The plot's front edge meets the pavement.
      const originZ = facing === 1 ? -(curb + plot.front) : curb + plot.front;
      if (plot.house) houses.push({ index: Number(plot.prefix.slice(1)), prefix: plot.prefix, origin: { x: originX / DM, z: originZ / DM }, rotationY: turn });
      const ids = new Map<string, string>();
      for (const spec of plot.objects) if (spec.localId) ids.set(spec.localId, `${plot.prefix}:${spec.localId}`);
      plot.objects.forEach((spec, i) => {
        const local = rotateAroundY(spec.position.x * DM, spec.position.z * DM, turn);
        out.add(`${plot.prefix}/${plot.keys[i]}`, spec.definitionId, originX + local.x, spec.position.y, originZ + local.z, (spec.rotationY ?? 0) + turn, {
          ...(spec.localId ? { localId: ids.get(spec.localId) } : {}),
          ...(spec.hostRef ? { hostRef: ids.get(spec.hostRef) ?? spec.hostRef } : {}),
          ...(spec.supportRef ? { supportRef: ids.get(spec.supportRef) ?? spec.supportRef } : {}),
          ...(spec.surface ? { surface: spec.surface } : {}),
          ...(spec.scale ? { scale: { ...spec.scale } } : {}),
        });
      });
      cursor += width + PLOT_GAP;
    }
  };
  placeRow(far, 1);
  placeRow(nearRow, -1);
  for (const plot of [...plots, ...(parkPlot ? [parkPlot] : [])]) for (const note of plot.notes) if (!notes.includes(note)) notes.push(note);

  // ------------------------------------------------------------------- facts
  const all = pieceKit(registry, []);
  const rects = out.objects.map((spec) => specRect(spec, all));
  // The smallest distance between the walls of any two houses (next door, or across the street).
  const houseRects = plots.map((plot) => unionRect(out.objects.flatMap((_, i) => (out.keys[i].startsWith(`${plot.prefix}/wall:`) ? [rects[i]] : []))));
  const minGap = Math.min(...houseRects.flatMap((a, i) => houseRects.slice(i + 1).map((b) => rectDistance(a, b))));
  const counts = countTypes(out.objects, all);
  return {
    objects: out.objects,
    keys: out.keys,
    rooms: [],
    houses: houses.sort((a, b) => a.index - b.index),
    footprint: { width: length / DM, depth: Math.round((unionRect(rects).maxZ - unionRect(rects).minZ) / DM) },
    extent: toMetres(unionRect(rects)),
    notes,
    facts: {
      counts,
      measures: {
        houses: plots.length,
        minHouseGap: Number.isFinite(minGap) ? Math.floor(minGap) / DM : 0,
        streetWidth: roadDepth / DM,
        pavementWidth: pavementDepth / DM,
        streetLength: length / DM,
        lamps,
        houseWidth: plan.houseSize.width,
        houseDepth: plan.houseSize.depth,
      },
      flags: { street: plan.street, park: parkPlot !== null, frontPaths: true },
    },
  };
}

/**
 * House `index` of a neighbourhood as a house plan: the neighbourhood's
 * house, with whatever the child changed on that house alone. A changed
 * house is never wider than the neighbourhood's houses (its plot).
 */
export function neighborhoodHouse(plan: NeighborhoodPlan, index: number): HousePlan {
  const edit = plan.customHouses.find((c) => c.house === index);
  return {
    version: plan.version,
    kind: 'house',
    name: `${plan.name} ${index + 1}`,
    size: { width: Math.min(edit?.size?.width ?? plan.houseSize.width, plan.houseSize.width), depth: edit?.size?.depth ?? plan.houseSize.depth },
    site: { near: 'view' },
    rooms: [...(edit?.rooms ?? plan.rooms)],
    roof: edit?.roof ?? plan.roof,
    garden: true,
    driveway: true,
    balcony: edit?.balcony ?? false,
  };
}

/** The ground one house plot covers, dm (its front reaching the pavement). */
function plotExtent(layoutExtent: LocalRect, depth: number): LocalRect {
  const extent = dm(layoutExtent);
  return { ...extent, maxZ: Math.max(extent.maxZ, (depth * DM) / 2 + SETBACK) };
}

function dm(rect: LocalRect): LocalRect {
  return { minX: Math.round(rect.minX * DM), maxX: Math.round(rect.maxX * DM), minZ: Math.round(rect.minZ * DM), maxZ: Math.round(rect.maxZ * DM) };
}
