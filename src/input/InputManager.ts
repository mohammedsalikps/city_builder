import { PointerInput } from './PointerInput';
import { KeyboardInput } from './KeyboardInput';

/**
 * Owns every raw input source for the game. Systems subscribe to the typed
 * emitters here instead of attaching their own DOM listeners.
 *
 * Camera input is the one exception: three.js OrbitControls attaches to the
 * canvas itself (see CameraController). PointerInput is designed to coexist
 * with it by only reporting drags-that-did-not-move as clicks.
 */
export class InputManager {
  readonly pointer: PointerInput;
  readonly keyboard: KeyboardInput;

  constructor(canvas: HTMLCanvasElement) {
    this.pointer = new PointerInput(canvas);
    this.keyboard = new KeyboardInput();
  }

  dispose(): void {
    this.pointer.dispose();
    this.keyboard.dispose();
  }
}
