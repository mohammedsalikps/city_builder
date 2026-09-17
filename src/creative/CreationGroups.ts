import type { PlacedObject } from '@/construction/PlacedObject';

/**
 * Creation Groups, read straight from `placedObjects` - there is no second
 * store. A group is simply every placed object sharing a `group.id`.
 */
export interface CreationGroup {
  id: string;
  creation: string;
  memberIds: string[];
  center: { x: number; z: number };
}

export function listCreationGroups(placedObjects: readonly PlacedObject[]): CreationGroup[] {
  const groups = new Map<string, CreationGroup & { sumX: number; sumZ: number }>();
  for (const placed of placedObjects) {
    if (!placed.group) continue;
    let group = groups.get(placed.group.id);
    if (!group) {
      group = { id: placed.group.id, creation: placed.group.creation, memberIds: [], center: { x: 0, z: 0 }, sumX: 0, sumZ: 0 };
      groups.set(placed.group.id, group);
    }
    group.memberIds.push(placed.id);
    group.sumX += placed.position.x;
    group.sumZ += placed.position.z;
  }
  return [...groups.values()].map(({ sumX, sumZ, ...group }) => ({
    ...group,
    center: { x: sumX / group.memberIds.length, z: sumZ / group.memberIds.length },
  }));
}

/** The group a placed object belongs to, if any. */
export function creationGroupOf(placedObjects: readonly PlacedObject[], instanceId: string): CreationGroup | null {
  const placed = placedObjects.find((p) => p.id === instanceId);
  if (!placed?.group) return null;
  return listCreationGroups(placedObjects.filter((p) => p.group?.id === placed.group!.id))[0] ?? null;
}
