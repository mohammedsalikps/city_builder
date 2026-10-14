import { roleOf, type ConstructionObjectDefinition } from './ConstructionObjectDefinition';

/**
 * Which wave of the construction celebration a definition reveals in (see
 * `ConstructionRenderer.beginGroupReveal`). Purely a presentation order -
 * derived from the same `role`/`category` fields gameplay already uses, so
 * it needs no new object data and never affects placement or validation.
 *
 * 0 foundation / ground   floors, roads - what everything else sits on
 * 1 structure              walls, and free-standing buildings/utilities
 * 2 openings                doors, windows
 * 3 roof                    roofs
 * 4 vegetation               trees, bushes, flowers
 * 5 furniture / details      everything else: furniture, decoration, vehicles
 */
export function revealTierOf(definition: ConstructionObjectDefinition): number {
  const role = roleOf(definition);
  if (role === 'floor') return 0;
  if (role === 'wall') return 1;
  if (role === 'opening') return 2;
  if (role === 'roof') return 3;
  if (definition.category === 'roads') return 0;
  if (definition.category === 'nature') return 4;
  if (definition.category === 'buildings' || definition.category === 'utilities') return 1;
  return 5; // furniture, decoration, vehicles, and any future/unknown category
}
