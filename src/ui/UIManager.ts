import type { GameStore } from '@/state/GameStore';
import type { GameState } from '@/state/GameState';
import type { GameMode } from '@/game/GameMode';
import type { Screen, ScreenContext } from './Screen';
import { MainMenuScreen } from './screens/MainMenuScreen';
import { HudScreen } from './screens/HudScreen';
import { ToolbarScreen } from './screens/ToolbarScreen';
import { ChallengePanelScreen } from './screens/ChallengePanelScreen';
import { WorldMapScreen } from './screens/WorldMapScreen';
import { StudioScreen } from './screens/StudioScreen';
import './styles.css';
import './studio/studio.css';

/**
 * Decides which screens are visible for the current game mode and keeps
 * them in sync with the store. Screens never subscribe to the store
 * themselves; the manager pushes state into them.
 *
 * To add a screen: create a Screen subclass, register it in `createScreens`,
 * and list it under the modes it belongs to in `SCREENS_BY_MODE`.
 */
export class UIManager {
  private readonly root: HTMLElement;
  private readonly screens: Map<string, Screen>;
  private unsubscribe: (() => void) | null = null;

  private static readonly SCREENS_BY_MODE: Record<GameMode, string[]> = {
    boot: [],
    menu: ['main-menu'],
    'world-map': ['world-map'],
    playing: ['hud', 'toolbar', 'challenge'],
    paused: ['hud', 'toolbar', 'challenge'],
  };

  /** My World is its own experience (World Studio); Challenge Mode keeps the level HUD. */
  private static readonly STUDIO_SCREENS = ['studio'];

  constructor(root: HTMLElement, private readonly store: GameStore, context: ScreenContext) {
    this.root = root;
    this.screens = this.createScreens(context);
  }

  start(): void {
    this.apply(this.store.getState());
    this.unsubscribe = this.store.subscribe((state) => this.apply(state));
  }

  /** Per-frame hook for screens that follow the 3D view. */
  frame(): void {
    this.screens.forEach((screen) => {
      if (screen.isMounted) screen.frame();
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.screens.forEach((screen) => screen.unmount());
  }

  private createScreens(context: ScreenContext): Map<string, Screen> {
    const list: Screen[] = [
      new MainMenuScreen(context),
      new HudScreen(context),
      new ToolbarScreen(context),
      new ChallengePanelScreen(context),
      new WorldMapScreen(context),
      new StudioScreen(context),
    ];
    return new Map(list.map((screen) => [screen.id, screen]));
  }

  private apply(state: GameState): void {
    const inStudio = (state.mode === 'playing' || state.mode === 'paused') && state.challenge === null;
    const wanted = new Set(inStudio ? UIManager.STUDIO_SCREENS : UIManager.SCREENS_BY_MODE[state.mode] ?? []);

    this.screens.forEach((screen, id) => {
      const shouldShow = wanted.has(id);
      if (shouldShow && !screen.isMounted) {
        screen.mount(this.root, state);
      } else if (!shouldShow && screen.isMounted) {
        screen.unmount();
      } else if (shouldShow) {
        screen.update(state);
      }
    });
  }
}
