import { Game } from '@/game/Game';
import { installAndroidBackButton } from '@/android/backButtonHandler';
import { applyMotionToDocument } from '@/accessibility/motion';

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

function boot(): void {
  // <html data-motion="reduce|full"> before anything animates (see src/accessibility/motion.ts).
  applyMotionToDocument();
  const canvas = requireElement<HTMLCanvasElement>('world-canvas');
  const uiRoot = requireElement<HTMLElement>('ui-root');

  const game = new Game({ canvas, uiRoot });
  game.start();
  installAndroidBackButton(game.store, game.actions);

  // Exposed for debugging in the browser console during development only.
  if (import.meta.env.DEV) {
    (window as unknown as { game: Game }).game = game;
  }
}

// iPad Safari ignores user-scalable=no; a pinch that starts on a UI panel
// would otherwise zoom the whole page. Canvas pinch (OrbitControls) uses
// pointer events and is unaffected.
document.addEventListener('gesturestart', (event) => event.preventDefault());

try {
  boot();
} catch (error) {
  console.error('[boot] City Builder failed to start', error);
  const uiRoot = document.getElementById('ui-root');
  if (uiRoot) {
    uiRoot.textContent = `City Builder failed to start: ${(error as Error).message}`;
    uiRoot.style.cssText = 'padding:24px;color:#fff;font-family:system-ui;pointer-events:auto';
  }
}
