import type { AssetDefinition } from './AssetRegistry';

/**
 * VISUAL SCALE POLICY - how every model in the world is sized.
 *
 * 1. Gameplay geometry is authoritative. An object's `dimensions`
 *    (objects.json) are what placement, collision, support and challenge
 *    matching use. Nothing in this file changes them.
 *
 * 2. Every pack is converted to metres exactly once, by its registry
 *    `scale` (see PACK_SCALE). The references that make packs agree:
 *      - a door is about 2.1 m tall, a storey about 2.7 m;
 *      - the city kits (suburban, commercial, industrial, roads) share one
 *        unit = one 7 m road tile, so their houses, shops and streets line up;
 *      - the building kit is already in metres (2.7 m walls, 2.1 m doors),
 *        so hand-built walls and doors match the premade houses' doors.
 *    A pack with no fixed unit (nature, factory, furniture) lists the few
 *    scales its models are authored at.
 *
 * 3. A model drawn for a construction object is fitted into the object's
 *    gameplay box, then multiplied by DISPLAY_SCALE for its kind. That is
 *    for kits whose models are smaller than the real thing (the car kit's
 *    cars are 2.5 m long; a tree's box is its trunk, not its crown): the
 *    picture grows around its bottom centre, the gameplay box does not.
 *    World scenery uses the same factors, so a car the child parks is the
 *    same size as the cars already in the street.
 *
 * 4. Hand-built creations are sized like real rooms (a Cozy House is a
 *    6 m x 6 m single-storey home with a 2 m roof), never as miniatures.
 *    See HOME_MIN_FOOTPRINT and the house templates in templates.json.
 */

/** Allowed registry scales by pack folder (under public/assets/3d/). */
export const PACK_SCALE: Record<string, readonly number[]> = {
  'kenney/building-kit': [1],
  'kenney/suburban': [7],
  'kenney/commercial': [7],
  'kenney/industrial': [7],
  'kenney/roads': [7],
  'kenney/cars': [1],
  'kenney/nature': [1, 5],
  'kenney/factory': [1, 2, 4, 5],
  'kenney/furniture': [1, 2, 3],
};

/** Display multiplier by asset kind (rule 3). Kinds not listed draw at 1. */
export const DISPLAY_SCALE: Partial<Record<AssetDefinition['kind'], number>> = {
  vehicle: 1.6,
  tree: 1.45,
};

/** Smallest floor area (m²) a hand-built home template may have (rule 4). */
export const HOME_MIN_FOOTPRINT = 30;

export function displayScaleOf(asset: AssetDefinition | undefined): number {
  return (asset && DISPLAY_SCALE[asset.kind]) ?? 1;
}

/** Registry entries whose scale breaks rule 2 (empty when all agree). */
export function packScaleProblems(assets: readonly AssetDefinition[]): string[] {
  const problems: string[] = [];
  for (const asset of assets) {
    const folder = asset.path.slice(0, asset.path.lastIndexOf('/'));
    const allowed = PACK_SCALE[folder];
    if (allowed && !allowed.includes(asset.scale ?? 1)) {
      problems.push(`${asset.id}: scale ${asset.scale ?? 1} not in ${folder} scales [${allowed.join(', ')}]`);
    }
  }
  return problems;
}
