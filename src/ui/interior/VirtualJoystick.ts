/** Pad diameter and knob diameter, CSS pixels. */
const PAD_SIZE = 112;
const KNOB_SIZE = 48;
/** How far the knob's centre may travel from the pad's centre. */
const KNOB_TRAVEL = (PAD_SIZE - KNOB_SIZE) / 2;
/** A small wobble around the centre counts as "not pushing". */
const DEAD_ZONE = 0.1;
const STYLE_ID = 'ev-joy-style';
const DEFAULT_LABEL = 'Walk: drag to move, or use the arrow keys';

const STYLES = `
.ev-joy {
  position: absolute;
  left: max(20px, env(safe-area-inset-left));
  bottom: max(24px, env(safe-area-inset-bottom));
  width: ${PAD_SIZE}px;
  height: ${PAD_SIZE}px;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 40%, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.22));
  border: 2px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 8px 22px rgba(36, 48, 72, 0.18), inset 0 0 0 7px rgba(255, 255, 255, 0.14);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  pointer-events: auto;
  z-index: 5;
  box-sizing: border-box;
}
.ev-joy[hidden] { display: none; }
.ev-joy::before {
  content: '';
  position: absolute;
  inset: 22%;
  border-radius: 50%;
  border: 2px dashed rgba(255, 255, 255, 0.55);
}
.ev-joy__knob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: ${KNOB_SIZE}px;
  height: ${KNOB_SIZE}px;
  margin: -${KNOB_SIZE / 2}px 0 0 -${KNOB_SIZE / 2}px;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 35%, #ffffff, rgba(244, 247, 252, 0.96));
  box-shadow: 0 4px 12px rgba(36, 48, 72, 0.26);
  transition: transform 0.2s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  pointer-events: none;
}
.ev-joy--active .ev-joy__knob { transition: none; }
@media (prefers-reduced-motion: reduce) {
  .ev-joy__knob { transition: none; }
}
`;

/**
 * Turn the finger's offset from the pad centre (pixels, screen y down) into
 * a joystick value: x right, y up-is-forward, each -1..1. Pushes past the
 * rim count as full; the inner 10% is a dead zone, and the rest is rescaled
 * so the value still starts from 0 just outside it.
 */
export function joystickValue(dx: number, dy: number, travel = KNOB_TRAVEL, deadZone = DEAD_ZONE): { x: number; y: number } {
  const length = Math.hypot(dx, dy);
  if (!(length > 0) || !(travel > 0)) return { x: 0, y: 0 };
  const push = Math.min(1, length / travel);
  if (push <= deadZone) return { x: 0, y: 0 };
  const strength = (push - deadZone) / (1 - deadZone);
  // `+ 0` turns a -0 (straight up or sideways) into a plain 0.
  return { x: (dx / length) * strength + 0, y: (-dy / length) * strength + 0 };
}

/**
 * A soft, round on-screen thumb-stick for walking on touch screens. Drag the
 * knob: `onChange(x, y)` reports x = right, y = forward (each -1..1), and
 * (0, 0) when the finger lifts. The pointer is captured, so a thumb sliding
 * off the pad keeps steering.
 *
 * Only the constructor creates DOM (and adds the shared stylesheet once),
 * so importing this module is safe anywhere, including headless tests.
 */
export class VirtualJoystick {
  private readonly root: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private pointerId: number | null = null;
  private value = { x: 0, y: 0 };

  constructor(
    parent: HTMLElement,
    private readonly onChange: (x: number, y: number) => void,
    opts: { label?: string } = {},
  ) {
    const doc = parent.ownerDocument;
    ensureStyles(doc);
    this.root = doc.createElement('div');
    this.root.className = 'ev-joy';
    // A pointer-only pad (it takes no focus): keyboard users walk with W A S D or the arrow
    // keys, which the label says, so 'group' rather than an 'application' nobody could reach.
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', opts.label ?? DEFAULT_LABEL);
    this.knob = doc.createElement('div');
    this.knob.className = 'ev-joy__knob';
    this.root.appendChild(this.knob);
    this.root.addEventListener('pointerdown', this.onPointerDown);
    this.root.addEventListener('pointermove', this.onPointerMove);
    this.root.addEventListener('pointerup', this.onPointerEnd);
    this.root.addEventListener('pointercancel', this.onPointerEnd);
    this.root.addEventListener('lostpointercapture', this.onPointerEnd);
    parent.appendChild(this.root);
  }

  /** Show or hide the pad; hiding lets go of the knob (and reports 0, 0). */
  setVisible(on: boolean): void {
    if (!on) this.release();
    this.root.hidden = !on;
  }

  dispose(): void {
    this.release();
    this.root.removeEventListener('pointerdown', this.onPointerDown);
    this.root.removeEventListener('pointermove', this.onPointerMove);
    this.root.removeEventListener('pointerup', this.onPointerEnd);
    this.root.removeEventListener('pointercancel', this.onPointerEnd);
    this.root.removeEventListener('lostpointercapture', this.onPointerEnd);
    this.root.remove();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    // The pad is ours: no scrolling, no text selection, no tap reaching the game behind.
    event.preventDefault();
    event.stopPropagation();
    if (this.pointerId !== null) return;
    // Only a finger, a pen or the main mouse button steers; a right or middle click does nothing.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.pointerId = event.pointerId;
    try {
      this.root.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety (the thumb may slide off the pad); steering works without it.
    }
    this.root.classList.add('ev-joy--active');
    this.follow(event);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    this.follow(event);
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.release();
  };

  /** Put the knob under the finger (kept inside the rim) and report the new value. */
  private follow(event: PointerEvent): void {
    const rect = this.root.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(dx, dy);
    const reach = length > KNOB_TRAVEL ? KNOB_TRAVEL / length : 1;
    this.knob.style.transform = `translate(${dx * reach}px, ${dy * reach}px)`;
    const value = joystickValue(dx, dy);
    this.report(value.x, value.y);
  }

  /** Let go: the knob springs back to the centre and the walker stops. */
  private release(): void {
    const id = this.pointerId;
    this.pointerId = null;
    if (id !== null) {
      try {
        if (this.root.hasPointerCapture(id)) this.root.releasePointerCapture(id);
      } catch {
        // Already released by the browser.
      }
    }
    this.root.classList.remove('ev-joy--active');
    this.knob.style.transform = '';
    // Every lift is reported, even from inside the dead zone, so a listener can rely on it.
    this.report(0, 0, id !== null);
  }

  /** Tell the listener about a new value (repeats are skipped unless `always`). */
  private report(x: number, y: number, always = false): void {
    if (!always && x === this.value.x && y === this.value.y) return;
    this.value = { x, y };
    this.onChange(x, y);
  }
}

/** Add the joystick stylesheet to the document once, however many pads are made. */
function ensureStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  doc.head.appendChild(style);
}
