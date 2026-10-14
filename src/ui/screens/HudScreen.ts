import { Screen, el } from '../Screen';
import { returnFocusTo } from '../keyboard';
import { isPlacementMode, type GameState } from '@/state/GameState';
import { describePlacementStatus } from '@/construction/PlacementResolver';
import { roleOf } from '@/construction/ConstructionObjectDefinition';
import { transformCapabilitiesOf, type TransformMode } from '@/construction/TransformCapabilities';
import { icon } from '../studio/icons';
import { actionButton } from '../studio/dom';

/**
 * Challenge Mode's own head-up display (Step 27.1 visual pass - same
 * actions and state reads as before, new presentation only):
 *
 *   ev-header (top-left)  world/level, the level's title, best stars and
 *                         this attempt's live match progress, plus Pause
 *                         and Exit in a small dock (top-right).
 *   ev-flow (bottom)      contextual: hidden while nothing is happening,
 *                         a placement pill (with a big, always-visible
 *                         Cancel) while placing, or the selected object's
 *                         Move / Turn / Size / Copy / Remove row while
 *                         something is selected.
 *
 * Every button still calls the exact same `context.actions` method it did
 * before; only the DOM/CSS changed.
 */
export class HudScreen extends Screen {
  readonly id = 'hud';

  private headerTitle: HTMLElement | null = null;
  private headerEyebrow: HTMLElement | null = null;
  private headerStars: HTMLElement | null = null;
  private headerPct: HTMLElement | null = null;
  private pauseButton: HTMLButtonElement | null = null;

  private flow: HTMLElement | null = null;
  private flowThumb: HTMLElement | null = null;
  private flowTitle: HTMLElement | null = null;
  private flowHint: HTMLElement | null = null;
  private flowButtons: HTMLElement | null = null;
  private rotateButton: HTMLButtonElement | null = null;
  private cancelButton: HTMLButtonElement | null = null;

  private actionRow: HTMLElement | null = null;
  private moveButton: HTMLButtonElement | null = null;
  private turnButton: HTMLButtonElement | null = null;
  private sizeButton: HTMLButtonElement | null = null;
  private copyButton: HTMLButtonElement | null = null;
  private stepper: HTMLElement | null = null;
  private scaleDownButton: HTMLButtonElement | null = null;
  private scaleUpButton: HTMLButtonElement | null = null;

  private pauseOverlay: HTMLElement | null = null;

  /** Latest state, so the fixed button closures below can branch on it. */
  private latestState: GameState | null = null;
  private lastFlowKey = '';

  private readonly onMenu = () => {
    returnFocusTo('.mode-card--challenge');
    this.context.actions.returnToMenu();
  };
  private readonly onPause = () => this.context.actions.pause();
  private readonly onResume = () => this.context.actions.resume();
  private readonly onRotate = () => {
    if (this.latestState?.templatePlacement) this.context.actions.rotateTemplatePlacement(1);
    else this.context.actions.rotatePlacement(1);
  };
  private readonly onCancel = () => {
    if (this.latestState?.templatePlacement) this.context.actions.cancelTemplatePlacement();
    else this.context.actions.cancelPlacement();
  };
  private readonly onDelete = () => this.context.actions.removeSelectedPlacedObject();
  private readonly onDuplicate = () => this.context.actions.duplicateSelectedPlacedObject();
  private readonly onSetMode = (mode: TransformMode) => () => this.context.actions.setTransformMode(mode);
  private readonly onScaleDown = () => this.context.actions.scaleSelectedPlacedObject(-1);
  private readonly onScaleUp = () => this.context.actions.scaleSelectedPlacedObject(1);

  protected build(): HTMLElement {
    const root = el('div', 'screen screen--hud');

    // ------------------------------------------------------------ header
    const header = el('div', 'ev-header');
    const mark = el('div', 'ev-header__mark');
    mark.appendChild(icon('target'));
    const text = el('div', 'ev-header__text');
    this.headerEyebrow = el('div', 'ev-header__eyebrow');
    this.headerTitle = el('div', 'ev-header__title');
    text.append(this.headerEyebrow, this.headerTitle);
    const progress = el('div', 'ev-header__progress');
    this.headerStars = el('div', 'ev-stars');
    for (let i = 0; i < 3; i++) this.headerStars.appendChild(this.starIcon());
    this.headerPct = el('span', 'ev-header__pct');
    progress.append(this.headerStars, this.headerPct);
    header.append(mark, text, progress);
    root.appendChild(header);

    const dock = el('div', 'ev-dock');
    this.pauseButton = el('button', 'ev-round');
    this.pauseButton.type = 'button';
    this.pauseButton.setAttribute('aria-label', 'Pause');
    this.pauseButton.title = 'Pause';
    this.pauseButton.appendChild(icon('pause'));
    this.pauseButton.addEventListener('click', this.onPause);
    const menuButton = el('button', 'ev-round');
    menuButton.type = 'button';
    menuButton.setAttribute('aria-label', 'Back to levels');
    menuButton.title = 'Back to levels';
    menuButton.appendChild(icon('home'));
    menuButton.addEventListener('click', this.onMenu);
    dock.append(this.pauseButton, menuButton);
    root.appendChild(dock);

    // -------------------------------------------------------- bottom flow
    this.flow = el('div', 'ev-flow');
    this.flow.hidden = true;
    this.flowThumb = el('span', 'ev-flow__thumb');
    const flowText = el('div', 'ev-flow__text');
    this.flowTitle = el('strong', 'ev-flow__title');
    this.flowHint = el('span', 'ev-flow__hint');
    flowText.append(this.flowTitle, this.flowHint);
    this.flowButtons = el('div', 'ev-flow__buttons');
    this.flow.append(this.flowThumb, flowText, this.flowButtons);
    root.appendChild(this.flow);

    this.rotateButton = this.roundButton('turn', 'Rotate', this.onRotate);
    this.cancelButton = el('button', 'ev-cancel');
    this.cancelButton.type = 'button';
    this.cancelButton.appendChild(icon('close'));
    this.cancelButton.appendChild(el('span', '', 'Cancel'));
    this.cancelButton.addEventListener('click', this.onCancel);

    this.actionRow = el('div', 'ev-flow__buttons');
    this.moveButton = actionButton('move', 'Move', this.onSetMode('move'));
    this.turnButton = actionButton('turn', 'Turn', this.onSetMode('rotate'));
    this.sizeButton = actionButton('size', 'Size', this.onSetMode('scale'));
    const copy = actionButton('copy', 'Copy', this.onDuplicate);
    this.copyButton = copy;
    const remove = actionButton('remove', 'Remove', this.onDelete, 'ev-action--danger');
    this.actionRow.append(this.moveButton, this.turnButton, this.sizeButton, copy, remove);

    this.stepper = el('span', 'ev-stepper');
    this.stepper.appendChild(el('span', 'ev-stepper__label', 'Size'));
    this.scaleDownButton = this.roundButton('minus', 'Smaller', this.onScaleDown, 'ev-round--small');
    this.scaleUpButton = this.roundButton('plus', 'Bigger', this.onScaleUp, 'ev-round--small');
    this.stepper.append(this.scaleDownButton, this.scaleUpButton);

    // ------------------------------------------------------------- pause
    this.pauseOverlay = el('div', 'hud__pause');
    this.pauseOverlay.appendChild(el('h2', 'title', 'Paused'));
    const resumeButton = el('button', 'ev-pill ev-pill--primary');
    resumeButton.type = 'button';
    resumeButton.appendChild(icon('check'));
    resumeButton.appendChild(el('span', '', 'Resume'));
    resumeButton.addEventListener('click', this.onResume);
    this.pauseOverlay.appendChild(resumeButton);
    root.appendChild(this.pauseOverlay);

    return root;
  }

  update(state: GameState): void {
    this.latestState = state;
    if (this.pauseOverlay) this.pauseOverlay.hidden = state.mode !== 'paused';

    const challenge = state.challenge ? this.context.challenges.get(state.challenge.challengeId) : undefined;
    if (challenge) {
      const world = this.context.challenges.getWorld(challenge.worldId);
      if (this.headerEyebrow) {
        this.headerEyebrow.textContent = world ? `World ${world.index} · Level ${String(challenge.index).padStart(2, '0')}` : `Level ${challenge.index}`;
      }
      if (this.headerTitle) this.headerTitle.textContent = challenge.title;
      const best = state.progress.bestStars[challenge.id] ?? 0;
      this.headerStars?.querySelectorAll('.ev-stars__star').forEach((star, i) => {
        star.classList.toggle('ev-stars__star--on', i < best);
      });
      const live = state.challengeMatch ? Math.round(state.challengeMatch.progress * 100) : 0;
      if (this.headerPct) {
        this.headerPct.hidden = state.challengeMatch === null || state.challengeMatch.progress <= 0;
        this.headerPct.textContent = `${live}%`;
      }
    }

    const placing = isPlacementMode(state);
    const templatePlacing = state.templatePlacement !== null;
    const selected = state.selectedInstanceId
      ? state.placedObjects.find((p) => p.id === state.selectedInstanceId) ?? null
      : null;

    this.updateFlow(state, placing, templatePlacing, selected);
  }

  private updateFlow(
    state: GameState,
    placing: boolean,
    templatePlacing: boolean,
    selected: GameState['placedObjects'][number] | null,
  ): void {
    const inPlacementFlow = placing || templatePlacing;
    const showFlow = inPlacementFlow || selected !== null;
    if (this.flow) this.flow.hidden = !showFlow;
    if (!showFlow) return;

    if (inPlacementFlow) {
      this.setFlowButtons([this.rotateButton!, this.cancelButton!]);
      let definitionId = state.selectedObjectId;
      let name = 'Building';
      let iconName = 'sparkle';
      if (templatePlacing) {
        const template = this.context.templates.get(state.templatePlacement!.templateId);
        name = template?.name ?? 'Building';
        iconName = 'sparkle';
      } else if (definitionId) {
        const definition = this.context.registry.get(definitionId);
        name = definition?.name ?? definitionId;
        iconName = 'bricks';
      }
      if (this.flowThumb) this.flowThumb.replaceChildren(icon(iconName));
      if (this.flowTitle) this.flowTitle.textContent = `Placing: ${name}`;
      const hint = templatePlacing
        ? 'Tap the ground to place it'
        : state.placementStatus
          ? describePlacementStatus(state.placementStatus)
          : 'Point at the ground, then tap';
      if (this.flowHint) {
        this.flowHint.textContent = hint;
        this.flowHint.classList.toggle('ev-flow__hint--invalid', !templatePlacing && state.placementStatus?.valid === false);
      }
      return;
    }

    // Selected: Move / Turn / Size / Copy / Remove.
    const definition = selected ? this.context.registry.get(selected.definitionId) : undefined;
    if (!selected || !definition) {
      if (this.flow) this.flow.hidden = true;
      return;
    }
    if (this.flowThumb) this.flowThumb.replaceChildren(icon('target'));
    if (this.flowTitle) this.flowTitle.textContent = definition.name;
    if (this.flowHint) {
      this.flowHint.textContent = 'Move, Turn or Copy it';
      this.flowHint.classList.remove('ev-flow__hint--invalid');
    }

    const hostsOpenings = state.placedObjects.some((p) => p.hostId === selected.id);
    const caps = transformCapabilitiesOf(definition, state.challenge ? 'challenge' : 'freeplay', hostsOpenings);
    if (this.moveButton) {
      this.moveButton.hidden = !caps.movable;
      this.moveButton.classList.toggle('ev-action--on', state.transformMode === 'move');
    }
    if (this.turnButton) {
      this.turnButton.hidden = !caps.rotatableY;
      this.turnButton.classList.toggle('ev-action--on', state.transformMode === 'rotate');
    }
    if (this.sizeButton) {
      this.sizeButton.hidden = !caps.scalable;
      this.sizeButton.classList.toggle('ev-action--on', state.transformMode === 'scale');
    }
    if (this.copyButton) this.copyButton.hidden = roleOf(definition) === 'opening';

    const showStepper = caps.scalable && state.transformMode === 'scale';
    if (this.stepper) this.stepper.hidden = !showStepper;
    if (this.scaleDownButton) this.scaleDownButton.disabled = selected.scale.x <= caps.minScale + 1e-6;
    if (this.scaleUpButton) this.scaleUpButton.disabled = selected.scale.x >= caps.maxScale - 1e-6;

    this.setFlowButtons([this.actionRow!, this.stepper!]);
  }

  private setFlowButtons(children: HTMLElement[]): void {
    if (!this.flowButtons) return;
    const key = children.map((c) => c === this.actionRow ? 'a' : c === this.stepper ? 's' : 'p').join('');
    if (key === this.lastFlowKey) return;
    this.lastFlowKey = key;
    this.flowButtons.replaceChildren(...children);
  }

  protected onUnmount(): void {
    this.latestState = null;
    this.lastFlowKey = '';
    this.headerTitle = null;
    this.headerEyebrow = null;
    this.headerStars = null;
    this.headerPct = null;
    this.pauseButton = null;
    this.flow = null;
    this.flowThumb = null;
    this.flowTitle = null;
    this.flowHint = null;
    this.flowButtons = null;
    this.rotateButton = null;
    this.cancelButton = null;
    this.actionRow = null;
    this.moveButton = null;
    this.turnButton = null;
    this.sizeButton = null;
    this.copyButton = null;
    this.stepper = null;
    this.scaleDownButton = null;
    this.scaleUpButton = null;
    this.pauseOverlay = null;
  }

  private starIcon(): HTMLElement {
    const star = el('span', 'ev-stars__star');
    star.appendChild(icon('star'));
    return star;
  }

  private roundButton(iconName: string, label: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
    const button = el('button', `ev-round ${extraClass}`.trim());
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.appendChild(icon(iconName));
    button.addEventListener('click', onClick);
    return button;
  }
}
