import type { GameStore } from '@/state/GameStore';
import type { GameActions } from '@/state/actions';
import type { World } from '@/world/World';
import type { InputManager } from '@/input/InputManager';
import type { RealWorldProgressStore } from '@/realworld/RealWorldProgress';
import type { RealWorldScene } from './RealWorldScene';

/** Where RealWorld Explorer's code is: not asked for yet, on its way, ready, or failed to arrive. */
export type RealWorldLoadState = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * Keeps RealWorld Explorer out of the app's first download. The landmark
 * scene, the landmark content, lessons and 3D models live in their own
 * chunk, fetched the first time the child opens RealWorld Explorer (or a
 * little earlier, when they point at its card on the Home screen). My World
 * and Challenge Mode never load it.
 *
 * The host is the small, always-present part: it owns the learning-progress
 * store ("Delete everything" and the library need it without the chunk),
 * starts loading when the game enters RealWorld mode, and hands the scene to
 * the screen once it has arrived. If the chunk cannot be fetched (offline,
 * a new deployment), `load()` rejects and can simply be tried again.
 */
export class RealWorldHost {
  private sceneInstance: RealWorldScene | null = null;
  private pending: Promise<RealWorldScene> | null = null;
  private loadState: RealWorldLoadState = 'idle';
  private unsubscribe: (() => void) | null = null;
  private disposed = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: GameStore,
    private readonly actions: GameActions,
    private readonly world: World,
    private readonly input: InputManager,
    readonly progress: RealWorldProgressStore,
    /** How the scene's code is fetched; tests pass their own. */
    private readonly importScene: () => Promise<{ RealWorldScene: typeof RealWorldScene }> = () => import('./RealWorldScene'),
  ) {}

  start(): void {
    this.progress.load();
    this.unsubscribe = this.store.subscribe((state) => {
      if (state.mode === 'realworld') void this.load().catch(() => undefined);
    });
  }

  /** The scene, once its code has arrived (null before). */
  get scene(): RealWorldScene | null {
    return this.sceneInstance;
  }

  get state(): RealWorldLoadState {
    return this.loadState;
  }

  /** Called when the load state changes (the loading screen listens). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Fetches RealWorld Explorer's code (once) and starts its scene. The scene
   * catches up with the game's current state as it starts, so it does not
   * matter whether the child is already in RealWorld mode by then.
   */
  load(): Promise<RealWorldScene> {
    if (this.sceneInstance) return Promise.resolve(this.sceneInstance);
    if (this.pending) return this.pending;
    this.setState('loading');
    this.pending = this.importScene().then(
      ({ RealWorldScene }) => {
        if (this.disposed) throw new Error('RealWorld Explorer was closed while it loaded');
        const scene = new RealWorldScene(this.store, this.actions, this.world, this.input, this.progress);
        scene.start();
        this.sceneInstance = scene;
        this.setState('ready');
        return scene;
      },
      (error: unknown) => {
        console.warn('[realworld] RealWorld Explorer could not be loaded', error);
        this.pending = null;
        this.setState('failed');
        throw error;
      },
    );
    return this.pending;
  }

  /** A hint that the child may open RealWorld Explorer soon: start fetching, quietly. */
  preload(): void {
    if (this.loadState === 'idle') void this.load().catch(() => undefined);
  }

  update(deltaSeconds: number): void {
    this.sceneInstance?.update(deltaSeconds);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.sceneInstance?.dispose();
    this.sceneInstance = null;
    this.listeners.clear();
  }

  private setState(state: RealWorldLoadState): void {
    this.loadState = state;
    this.listeners.forEach((listener) => listener());
  }
}
