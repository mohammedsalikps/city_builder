import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import { KIND_NAMES, ROOM_TYPES, roomName, type ConstructionPlan, type PlanKind, type PlanSite } from './ConstructionPlan';
import { layoutHouse } from './HouseLayout';
import type { PlanLayout } from './LayoutKit';
import { layoutNeighborhood } from './NeighborhoodLayout';
import { describeItems, layoutObjects, layoutOutdoor } from './OutdoorLayout';
import { layoutTreehouse } from './TreehouseLayout';

/** One plan in, one layout out - every kind through the same pipeline. */
export function layoutPlan(plan: ConstructionPlan, registry: ObjectRegistry): PlanLayout {
  switch (plan.kind) {
    case 'house':
      return layoutHouse(plan, registry);
    case 'garden':
    case 'park':
      return layoutOutdoor(plan, registry);
    case 'neighborhood':
      return layoutNeighborhood(plan, registry);
    case 'treehouse':
      return layoutTreehouse(plan, registry);
    case 'objects':
      return layoutObjects(plan, registry);
  }
}

/** World Studio creation each kind joins (object bubble, "Make it yours"). */
export const KIND_CREATION: Record<PlanKind, string> = {
  house: 'house',
  garden: 'park',
  park: 'park',
  neighborhood: 'neighborhood',
  treehouse: 'park',
  objects: 'park',
};

const KIND_ICON: Record<PlanKind, string> = { house: '🏡', garden: '🌷', park: '🌳', neighborhood: '🏘️', treehouse: '🌲', objects: '✨' };

/**
 * What a creation card says about a piece of a planned creation - from the
 * creation's real kind, never from the World Studio group it shares (a
 * treehouse, a garden and a few loose benches all join the "park" group).
 */
export function creationCardText(kind: PlanKind, pieces: number): { subtitle: string; improveTitle: string } {
  const subtitle = kind === 'objects' ? `One of ${pieces} things you added` : `Part of your ${KIND_NAMES[kind]} · ${pieces} pieces`;
  const improveTitle: Record<PlanKind, string> = {
    house: 'Make it yours',
    garden: 'Grow your garden',
    park: 'Grow your park',
    neighborhood: 'Grow your street',
    treehouse: 'Around your treehouse',
    objects: 'Add more',
  };
  return { subtitle, improveTitle: improveTitle[kind] };
}

export function kindIcon(kind: PlanKind): string {
  return KIND_ICON[kind];
}

/** One line for the template description ("A 12 × 8 m garden, planned for you."). */
export function describeTemplate(plan: ConstructionPlan, layout: PlanLayout): string {
  if (plan.kind === 'objects') return `${capitalise(describeItems(plan))}, planned for you.`;
  if (plan.kind === 'neighborhood') return `${plan.houses} houses along a street, planned for you.`;
  return `A ${layout.footprint.width} × ${layout.footprint.depth} m ${KIND_NAMES[plan.kind]}, planned for you.`;
}

/**
 * Short chips describing what was understood AND laid out - read from the
 * validated plan and the layout's measured facts, never the model's own
 * words, so a chip can only name something that is really there.
 */
export function describePlan(plan: ConstructionPlan, layout: PlanLayout): string[] {
  const { counts, measures, flags } = layout.facts;
  const chips: string[] = [];
  const count = (n: number | undefined, one: string, many: string) => {
    if (n && n > 0) chips.push(n === 1 ? one : `${n} ${many}`);
  };
  switch (plan.kind) {
    case 'house': {
      chips.push(`${layout.footprint.width} × ${layout.footprint.depth} m`);
      for (const type of ROOM_TYPES) {
        const n = layout.rooms.filter((r) => r.type === type).length;
        if (n > 0) chips.push(n === 1 ? roomName(type) : `${n} ${roomName(type, n)}`);
      }
      chips.push(...siteChip(plan.site));
      chips.push(plan.roof === 'gable' ? 'pitched roof' : plan.roof === 'flat' ? 'flat roof' : 'no roof');
      if (plan.garden) chips.push('garden');
      if (plan.driveway && counts.road) chips.push('driveway');
      if (plan.balcony) chips.push('balcony');
      if (measures.bathroomFittings > 0) chips.push('bathroom fittings');
      break;
    }
    case 'garden':
    case 'park': {
      chips.push(`${layout.footprint.width} × ${layout.footprint.depth} m`);
      chips.push(...siteChip(plan.site));
      count(counts.flowerbed, 'a flower bed', 'flower beds');
      count(counts.tree, 'a tree', 'trees');
      count(counts.bush, 'a bush', 'bushes');
      count(counts.bench, 'a bench', 'benches');
      if (flags.path) chips.push(`${measures.pathWidth} m path`);
      if (counts.fence) chips.push('fence with a gate');
      if (flags.playground) chips.push('playground');
      count(counts.streetlight, 'a lamp', 'lamps');
      break;
    }
    case 'neighborhood': {
      chips.push(`${measures.houses} houses`, `${plan.houseSize.width} × ${plan.houseSize.depth} m each`);
      for (const type of ROOM_TYPES) {
        const n = plan.rooms.filter((r) => r === type).length;
        if (n > 0) chips.push(n === 1 ? roomName(type) : `${n} ${roomName(type, n)}`);
      }
      if (flags.street) chips.push('street with pavements');
      if (flags.park) chips.push('shared park');
      chips.push(...siteChip(plan.site));
      break;
    }
    case 'treehouse':
      chips.push(`${layout.footprint.width} × ${layout.footprint.depth} m deck`, `${measures.deckHeight} m up`, flags.ladder ? 'ladder' : 'stairs', 'railings');
      if (flags.hut) chips.push(flags.roof ? 'hut with a roof' : 'open-top hut');
      chips.push(...siteChip(plan.site));
      break;
    case 'objects':
      chips.push(describeItems(plan), ...siteChip(plan.site));
      break;
  }
  return chips;
}

function siteChip(site: PlanSite): string[] {
  if ('beside' in site) return [site.beside === 'back' ? 'behind your house' : site.beside === 'front' ? 'in front of your house' : 'beside your house'];
  if ('near' in site) return [site.near === 'lake' ? 'by the lake' : site.near === 'home' ? 'near your home' : 'where you are looking'];
  return [];
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
