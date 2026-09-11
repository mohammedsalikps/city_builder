export type FrameCallback = (deltaSeconds: number, elapsedSeconds: number) => void;

/**
 * requestAnimationFrame-driven loop with clamped delta time.
 * Delta is capped so a backgrounded tab does not produce a giant step
 * when it resumes.
 */
export class GameLoop {
  private running = false;
  private frameHandle = 0;
  private lastTime = 0;
  private elapsed = 0;
  private readonly maxDelta = 1 / 20;

  constructor(private readonly onFrame: FrameCallback) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.frameHandle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
  }

  get isRunning(): boolean {
    return this.running;
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    const rawDelta = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const delta = Math.min(rawDelta, this.maxDelta);
    this.elapsed += delta;
    this.onFrame(delta, this.elapsed);
    this.frameHandle = requestAnimationFrame(this.tick);
  };
}
