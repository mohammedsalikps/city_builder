import type { GameState } from './GameState';
import {
  createInitialProgress,
  createInitialUnlocks,
  createEmptyWallet,
  type PlayerProgress,
} from '@/progression/Progression';

/** `progress` may be supplied from persistent storage. */
export function createInitialState(progress: PlayerProgress = createInitialProgress()): GameState {
  return {
    mode: 'boot',
    player: null,
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
  };
}
