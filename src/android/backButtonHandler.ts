import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import type { GameStore } from '@/state/GameStore';
import type { GameActions } from '@/state/actions';

/**
 * Android-only: without this, the hardware/gesture back button falls through
 * to Capacitor's default (exit the app immediately), since this is a
 * single-page app with no browser history to pop. Maps it instead to the
 * same "go back" the in-game UI already offers at each level, only exiting
 * the app from the true top-level Home screen. No-op in the browser.
 */
export function installAndroidBackButton(store: GameStore, actions: GameActions): void {
  if (!Capacitor.isNativePlatform()) return;
  void App.addListener('backButton', () => {
    const state = store.getState();
    if (state.mode === 'world-map') {
      actions.closeWorldMap();
    } else if (state.mode === 'realworld') {
      // A landmark goes back to the landmark library; the library goes back home.
      if (state.realWorld.landmarkId !== null) actions.openLandmark(null);
      else actions.exitRealWorld();
    } else if (state.interior !== null) {
      // Inside a house, back means "go outside" first.
      actions.exitInterior();
    } else if (state.mode === 'playing' || state.mode === 'paused') {
      actions.returnToMenu();
    } else {
      void App.exitApp();
    }
  });
}
