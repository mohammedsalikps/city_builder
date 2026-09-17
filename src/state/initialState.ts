import { DEFAULT_WORLD_NAME, type GameState, type MyWorldIdentity } from './GameState';
import type { PlayerProfile } from '@/player/Player';
import {
  createInitialProgress,
  createInitialUnlocks,
  createEmptyWallet,
  type PlayerProgress,
} from '@/progression/Progression';

/**
 * `progress` may be supplied from persistent storage (Challenge Mode's
 * stars/unlocks). `player` may likewise be supplied from a saved My World
 * (see MyWorldStorage) so "Continue where you left off" and the My World
 * card can resume it instead of starting over after a reload; `placedObjects`
 * stays empty here regardless - MyWorldPersistenceService restores it the
 * moment free-build actually starts, the same path used mid-session.
 */
export function createInitialState(
  progress: PlayerProgress = createInitialProgress(),
  player: PlayerProfile | null = null,
  myWorld: MyWorldIdentity = { name: DEFAULT_WORLD_NAME, story: null },
): GameState {
  return {
    mode: 'boot',
    player,
    world: null,
    level: null,
    challenge: null,
    challengeMatch: null,
    challengeResult: null,
    menuNotice: null,
    progress,
    unlocks: createInitialUnlocks(),
    rewards: createEmptyWallet(),
    selectedObjectId: null,
    placementRotationStep: 0,
    placedObjects: [],
    selectedInstanceId: null,
    transformMode: 'move',
    placementStatus: null,
    templatePlacement: null,
    streetDrawing: false,
    creationFocus: null,
    myWorld,
  };
}
