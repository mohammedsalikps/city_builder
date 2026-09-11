import { EventEmitter } from '@/utils/EventEmitter';

/** Pointer position in normalized device coordinates (-1..1 on both axes). */
export interface PointerPosition {
  ndcX: number;
  ndcY: number;
}

export interface PointerClick extends PointerPosition {
  /** 0 = left, 1 = middle, 2 = right. */
  button: number;
}

export interface PointerEvents extends Record<string, unknown> {
  move: PointerPosition;
  /** A press-and-release without meaningful movement (i.e. not a camera drag). */
  click: PointerClick;
  leave: void;
}

/**
 * Listens to pointer events on the game canvas only. Because the UI layer sits
 * above the canvas and its controls receive their own events, clicks on UI
 * never arrive here, which is what prevents accidental placement.
 *
 * Distinguishes a click from a drag: OrbitControls also listens on the canvas
 * and drags rotate the camera, so a "click" is only emitted when the pointer
 * barely moved between down and up.
 */
export class PointerInput extends EventEmitter<PointerEvents> {
  /** Pixels of movement allowed before a press stops counting as a click. */
  private static readonly CLICK_MOVE_TOLERANCE = 5;

  private downPosition: { x: number; y: number; button: number } | null = null;
  private lastPosition: PointerPosition | null = null;
  private pointerInside = false;

  constructor(private readonly element: HTMLElement) {
    super();
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointerleave', this.onPointerLeave);
    element.addEventListener('contextmenu', this.onContextMenu);
  }

  /** Most recent pointer position while over the canvas; null when outside. */
  get position(): PointerPosition | null {
    return this.pointerInside ? this.lastPosition : null;
  }

  dispose(): void {
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointerleave', this.onPointerLeave);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
    this.clear();
  }

  private toNdc(event: PointerEvent): PointerPosition {
    const rect = this.element.getBoundingClientRect();
    return {
      ndcX: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      ndcY: -((event.clientY - rect.top) / rect.height) * 2 + 1,
    };
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.pointerInside = true;
    this.lastPosition = this.toNdc(event);
    this.emit('move', this.lastPosition);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.downPosition = { x: event.clientX, y: event.clientY, button: event.button };
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const down = this.downPosition;
    this.downPosition = null;
    if (!down || down.button !== event.button) return;

    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (moved > PointerInput.CLICK_MOVE_TOLERANCE) return;

    this.emit('click', { ...this.toNdc(event), button: event.button });
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    this.downPosition = null;
    this.emit('leave', undefined);
  };

  /** Right-click is reserved for camera panning; suppress the browser menu. */
  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };
}
