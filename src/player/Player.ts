import { createId } from '@/utils/id';

/** Identity of the person playing. Progress/unlocks live in the progression slice. */
export interface PlayerProfile {
  id: string;
  name: string;
  /** ISO timestamp of profile creation. */
  createdAt: string;
}

export function createPlayer(name: string): PlayerProfile {
  const trimmed = name.trim();
  return {
    id: createId('player'),
    name: trimmed.length > 0 ? trimmed : 'Builder',
    createdAt: new Date().toISOString(),
  };
}
