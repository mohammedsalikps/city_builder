import { MY_WORLD_SAVE_KEY } from './MyWorldStorage';
import { SAVE_KEY } from '@/progression/ProgressStorage';
import { PLAN_STORE_KEY } from '@/creative/plan/PlanRecords';
import { REALWORLD_PROGRESS_KEY, type RealWorldProgressStore } from '@/realworld/RealWorldProgress';
import { MOTION_STORAGE_KEY } from '@/accessibility/motion';
import { VOICE_SETTING_KEY } from '@/creative/ai/VoiceSetting';
import type { GameActions } from './actions';
import type { HistoryService } from '@/creative/HistoryService';
import type { PlanBuilder } from '@/creative/plan/PlanBuilder';
import type { BuildAssistant } from '@/creative/ai/BuildAssistant';
import type { MyWorldPersistenceService } from '@/creative/MyWorldPersistenceService';

/**
 * Everything EAVARA keeps about the child on this device, and "Delete
 * everything on this device", which removes it.
 *
 * Stored (localStorage only - no cookies, sessionStorage or IndexedDB):
 *   city-builder.world     the builder (id, name, when created), everything built, the world's name and story
 *   city-builder.progress  Challenge Mode: finished levels, best stars, xp, rank
 *   city-builder.plans     the plans behind planned creations: names, sizes, places, pieces moved or removed
 *   city-builder.realworld RealWorld Explorer: missions, lessons and questions finished at each landmark
 *   city-builder.motion    the Home screen's Animations choice (reduce / full), a device setting; absent when it follows the device
 *   city-builder.voice     "on" after a grown-up switched talking on (Home screen, "Talking to EAVARA"); absent means off
 *
 * In memory while the game runs: the game state (the same things, plus what
 * is selected or being placed), PlanBuilder's plan records and the
 * templates made from them, the undo/redo history, the autosave's last
 * copy, and the AI helper's pending offer. The AI chat (at most 10
 * messages, never stored) exists only while My World's studio is open.
 *
 * NOT on this device, so this cannot delete it: what was already sent to
 * the AI services (typed words and voice recordings go through our server
 * to Anthropic and Groq, which keep them under their own retention rules)
 * and the hosting provider's request logs. Our server stores nothing.
 */
export const DEVICE_STORAGE_KEYS: readonly string[] = [MY_WORLD_SAVE_KEY, SAVE_KEY, PLAN_STORE_KEY, REALWORLD_PROGRESS_KEY, MOTION_STORAGE_KEY, VOICE_SETTING_KEY];
/** Every key EAVARA has used starts with this; deleting removes them all, including any from older versions. */
const KEY_PREFIX = 'city-builder.';

/** The parts that hold the child's things in memory, and the stored copies. */
export interface DeviceDataParts {
  actions: Pick<GameActions, 'eraseEverything'>;
  history: Pick<HistoryService, 'clear'>;
  planBuilder: Pick<PlanBuilder, 'forgetAll'>;
  assistant: Pick<BuildAssistant, 'reset'>;
  persistence: Pick<MyWorldPersistenceService, 'forget'>;
  /** RealWorld Explorer's learning progress held in memory (optional for older callers). */
  realWorld?: Pick<RealWorldProgressStore, 'forget'>;
  /** World, progress, plan and RealWorld storage. */
  storages: Array<{ clear(): void }>;
}

export interface EraseResult {
  /** EAVARA keys still stored afterwards: empty when everything was deleted. */
  remaining: string[];
}

/** EAVARA's keys in this browser's storage right now. */
export function storedKeys(): string[] {
  const found = new Set<string>();
  try {
    const storage = window.localStorage;
    for (const key of DEVICE_STORAGE_KEYS) if (storage.getItem(key) !== null) found.add(key);
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(KEY_PREFIX)) found.add(key);
    }
  } catch {
    // Storage cannot be read (blocked by the browser): nothing of ours can be read back either.
  }
  return [...found];
}

/**
 * Delete everything on this device. Memory goes first - the game state and
 * every service that could save it again (autosave, plan records, undo
 * history) - so nothing still running can write the old world back; then
 * the stored copies and any other key of ours. The result says what, if
 * anything, could not be removed. The page should then be reloaded, which
 * also drops what the renderer and the screens still show.
 */
export function eraseDeviceData(parts: DeviceDataParts): EraseResult {
  parts.actions.eraseEverything();
  parts.history.clear();
  parts.planBuilder.forgetAll();
  parts.assistant.reset();
  parts.persistence.forget();
  parts.realWorld?.forget();
  for (const storage of parts.storages) storage.clear();
  for (const key of storedKeys()) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Reported through `remaining`.
    }
  }
  return { remaining: storedKeys() };
}
