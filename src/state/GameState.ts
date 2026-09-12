import type { GameMode } from '@/game/GameMode';
import type { PlayerProfile } from '@/player/Player';
import type { PlayerProgress, Unlocks, RewardWallet } from '@/progression/Progression';
import type { ChallengeAttemptResult, ChallengeState } from '@/challenges/Challenge';
import type { PlacedObject } from '@/construction/PlacedObject';
import type { PlacementStatus } from '@/construction/PlacementResolver';
import type { ChallengeMatchResult } from '@/challenges/ChallengeMatcher';
import type { TransformMode } from '@/construction/TransformCapabilities';

/** Identifies which world is loaded. Terrain/content will be added later. */
export interface WorldState {
  id: string;
  name: string;
}

/** Identifies the current level within the progression. */
export interface LevelState {
  id: string;
  index: number;
}

/**
 * The single source of truth for the game's logical state.
 * Rendering (three.js) and UI (DOM) derive from this; they never own state.
 *
 * Every slice is present from the start even if only partly used, so that later
 * steps (construction, challenges, rewards) plug in without reshaping the store.
 */
export interface GameState {
  mode: GameMode;
  player: PlayerProfile | null;
  world: WorldState | null;
  level: LevelState | null;
  challenge: ChallengeState | null;
  /**
   * Latest matcher output for the active challenge. Derived from
   * `placedObjects`; recomputed by the challenge system when construction
   * changes. Null when no challenge is active.
   */
  challengeMatch: ChallengeMatchResult | null;
  /**
   * Stars recorded for the current attempt once it was completed. Drives the
   * completion panel. Null until the attempt completes; cleared on restart/exit.
   */
  challengeResult: ChallengeAttemptResult | null;
  /** One-line message for the menu (e.g. why a level is locked). */
  menuNotice: string | null;
  progress: PlayerProgress;
  unlocks: Unlocks;
  rewards: RewardWallet;
  /**
   * ID of the construction object definition the player currently has
   * selected in the toolbar. Non-null means the player is in placement mode.
   */
  selectedObjectId: string | null;
  /** Rotation step (0..PLACEMENT_ROTATION_STEPS-1) applied to the next placement. */
  placementRotationStep: number;
  /** Everything the player has built in the current world. */
  placedObjects: PlacedObject[];
  /** Instance id of the placed object the player has clicked, if any. */
  selectedInstanceId: string | null;
  /**
   * Which transform gizmo/indicator is active for the current selection.
   * Meaningless while nothing is selected; reset to 'move' on every new
   * selection so the gizmo is always predictable.
   */
  transformMode: TransformMode;
  /**
   * Where the pending placement would land and whether it is allowed.
   * Updated by the construction controller only when it changes, so the HUD
   * can explain the preview. Null when not pointing at a valid surface.
   */
  placementStatus: PlacementStatus | null;
}

/** True while the player has a construction object chosen for placement. */
export function isPlacementMode(state: GameState): boolean {
  return state.mode === 'playing' && state.selectedObjectId !== null;
}

/** True while no challenge is active: My World's free-building session. */
export function isFreeBuildMode(state: GameState): boolean {
  return state.challenge === null;
}

/**
 * Whether the player may select/place this object right now. Challenge Mode
 * gates the catalogue by the active level's own unlock list, so each level
 * only offers the pieces it teaches. My World has no such curriculum - it is
 * meant to be open-ended creative building - so every registered object is
 * available there regardless of `unlocks` (which stays untouched and keeps
 * gating Challenge Mode exactly as before).
 */
export function isObjectUnlocked(state: GameState, objectId: string): boolean {
  return isFreeBuildMode(state) || state.unlocks.objectIds.includes(objectId);
}
