import './intro.css';

/**
 * The intro's only DOM presence: a transparent, full-viewport layer that (a)
 * physically sits above #world-canvas so no startup tap ever reaches
 * PointerInput/OrbitControls/TransformControls (all three attach straight to
 * the canvas - see Step 29), and (b) shows the tagline, since crisp
 * always-horizontal text is simpler as DOM than as a 3D mesh. The 3D scene
 * itself is drawn by IntroSequence directly into the shared canvas.
 */
export class IntroOverlay {
  private readonly root: HTMLElement;
  private readonly tagline: HTMLParagraphElement;
  private readonly onTap: () => void;

  constructor(parent: HTMLElement, onTap: () => void) {
    this.onTap = onTap;
    this.root = document.createElement('div');
    this.root.className = 'ev-intro';
    this.tagline = document.createElement('p');
    this.tagline.className = 'ev-intro__tagline';
    this.tagline.textContent = 'Learn. Build. Create.';
    this.root.appendChild(this.tagline);
    this.root.addEventListener('pointerdown', this.handleTap);
    parent.appendChild(this.root);
  }

  private readonly handleTap = (event: PointerEvent): void => {
    event.preventDefault();
    this.onTap();
  };

  setTaglineOpacity(opacity: number): void {
    this.tagline.style.opacity = String(opacity);
  }

  /** Fades the overlay's own pointer-blocking away; the 3D dissolve is separate (see IntroSequence.renderBlend). */
  async fadeOut(durationMs: number): Promise<void> {
    this.root.style.transition = `opacity ${durationMs}ms ease`;
    this.root.style.opacity = '0';
    this.root.style.pointerEvents = 'none';
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  }

  dispose(): void {
    this.root.removeEventListener('pointerdown', this.handleTap);
    this.root.remove();
  }
}
