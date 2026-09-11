import { Game } from '@/game/Game';

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

function boot(): void {
  const canvas = requireElement<HTMLCanvasElement>('world-canvas');
  const uiRoot = requireElement<HTMLElement>('ui-root');

  const game = new Game({ canvas, uiRoot });
  game.start();

  // Exposed for debugging in the browser console during development only.
  if (import.meta.env.DEV) {
    (window as unknown as { game: Game }).game = game;
  }
}

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
