import { Screen, el } from '../Screen';
import { isFreeBuildMode, isPlacementMode, type GameState } from '@/state/GameState';
import { describePlacementStatus } from '@/construction/PlacementResolver';
import { roleOf } from '@/construction/ConstructionObjectDefinition';
import { transformCapabilitiesOf, hasAnyCapability, type TransformMode } from '@/construction/TransformCapabilities';

/**
 * In-game heads-up display: session facts on top, construction status and
 * context actions at the bottom. Every context button pairs a plain icon
 * with a short, child-facing label (Move / Turn / Size / Copy / Remove) -
 * never a raw keyboard hint or an engine term. Objectives/rewards panels
 * attach later.
 */
export class HudScreen extends Screen {
  readonly id = 'hud';

  private playerLabel: HTMLElement | null = null;
  private worldLabel: HTMLElement | null = null;
  private levelLabel: HTMLElement | null = null;
  private placedLabel: HTMLElement | null = null;
  private savedLabel: HTMLElement | null = null;
  private lastPlacedObjects: GameState['placedObjects'] | null = null;
  private savedTimeout: ReturnType<typeof setTimeout> | null = null;
  private statusLabel: HTMLElement | null = null;
  private hintLabel: HTMLElement | null = null;
  private rotateButton: HTMLButtonElement | null = null;
  private cancelButton: HTMLButtonElement | null = null;
  private deleteButton: HTMLButtonElement | null = null;
  private duplicateButton: HTMLButtonElement | null = null;
  private pauseOverlay: HTMLElement | null = null;
  private transformGroup: HTMLElement | null = null;
  private moveModeButton: HTMLButtonElement | null = null;
  private rotateModeButton: HTMLButtonElement | null = null;
  private scaleModeButton: HTMLButtonElement | null = null;
  private scaleStepper: HTMLElement | null = null;
  private scaleDownButton: HTMLButtonElement | null = null;
  private scaleUpButton: HTMLButtonElement | null = null;
  /** Latest state, so the fixed button closures below can branch on it. */
  private latestState: GameState | null = null;

  private readonly onMenu = () => this.context.actions.returnToMenu();
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

    const topBar = el('div', 'hud__top');
    this.playerLabel = el('span', 'hud__stat');
    this.worldLabel = el('span', 'hud__stat');
    this.levelLabel = el('span', 'hud__stat');
    this.placedLabel = el('span', 'hud__stat');
    this.savedLabel = el('span', 'hud__saved', '✓ Saved');
    this.savedLabel.hidden = true;
    topBar.append(this.playerLabel, this.worldLabel, this.levelLabel, this.placedLabel, this.savedLabel);
    topBar.appendChild(el('span', 'hud__spacer'));
    topBar.appendChild(this.button('Pause', this.onPause));
    topBar.appendChild(this.button('Menu', this.onMenu));
    root.appendChild(topBar);

    const bottomBar = el('div', 'hud__bottom');
    this.statusLabel = el('span', 'hud__status');
    this.hintLabel = el('span', 'hud__hint');
    bottomBar.append(this.statusLabel, this.hintLabel);
    bottomBar.appendChild(el('span', 'hud__spacer'));
    this.rotateButton = this.iconButton('↻', 'Rotate', this.onRotate);
    this.cancelButton = this.iconButton('✕', 'Cancel', this.onCancel);

    this.transformGroup = el('span', 'hud__transform');
    this.moveModeButton = this.iconButton('↔', 'Move', this.onSetMode('move'));
    this.rotateModeButton = this.iconButton('↻', 'Turn', this.onSetMode('rotate'));
    this.scaleModeButton = this.iconButton('⤢', 'Size', this.onSetMode('scale'));
    this.scaleStepper = el('span', 'hud__scale-stepper');
    this.scaleDownButton = this.button('−', this.onScaleDown, 'hud__scale-btn');
    this.scaleUpButton = this.button('+', this.onScaleUp, 'hud__scale-btn');
    this.scaleStepper.append(this.scaleDownButton, this.scaleUpButton);
    this.transformGroup.append(this.moveModeButton, this.rotateModeButton, this.scaleModeButton, this.scaleStepper);

    this.duplicateButton = this.iconButton('⧉', 'Copy', this.onDuplicate);
    this.deleteButton = this.iconButton('🗑', 'Remove', this.onDelete, 'hud-btn--danger');
    bottomBar.append(this.rotateButton, this.cancelButton, this.transformGroup, this.duplicateButton, this.deleteButton);
    root.appendChild(bottomBar);

    this.pauseOverlay = el('div', 'hud__pause');
    this.pauseOverlay.appendChild(el('h2', 'title', 'Paused'));
    const resumeButton = el('button', 'button button--primary', 'Resume');
    resumeButton.type = 'button';
    resumeButton.addEventListener('click', this.onResume);
    this.pauseOverlay.appendChild(resumeButton);
    root.appendChild(this.pauseOverlay);

    return root;
  }

  update(state: GameState): void {
    this.latestState = state;
    if (this.playerLabel) this.playerLabel.textContent = `Player: ${state.player?.name ?? '-'}`;
    if (this.worldLabel) this.worldLabel.textContent = `World: ${state.world?.name ?? '-'}`;
    if (this.levelLabel) this.levelLabel.textContent = `Level: ${state.level?.index ?? '-'}`;
    if (this.placedLabel) this.placedLabel.textContent = `Placed: ${state.placedObjects.length}`;
    if (this.pauseOverlay) this.pauseOverlay.hidden = state.mode !== 'paused';
    this.updateSavedIndicator(state);

    const placing = isPlacementMode(state);
    const templatePlacing = state.templatePlacement !== null;
    const selected = state.selectedInstanceId
      ? state.placedObjects.find((p) => p.id === state.selectedInstanceId) ?? null
      : null;

    let status = 'Nothing selected';
    let hint = 'Pick a piece below to build, or tap something you built to change it. Drag to look around, wheel to zoom.';
    if (templatePlacing) {
      const template = this.context.templates.get(state.templatePlacement!.templateId);
      status = template ? `Building: ${template.icon} ${template.name}` : 'Building...';
      hint = 'Point at the ground, then tap to place it. Rotate turns it, Cancel puts it away.';
    } else if (placing && state.selectedObjectId) {
      const definition = this.context.registry.get(state.selectedObjectId);
      status = `Placing: ${definition?.name ?? state.selectedObjectId}`;
      hint = state.placementStatus
        ? `${describePlacementStatus(state.placementStatus)} Tap to place.`
        : 'Point at the ground or something you built. Rotate turns it, Cancel puts it away.';
    } else if (selected) {
      const definition = this.context.registry.get(selected.definitionId);
      status = `Selected: ${definition?.name ?? selected.definitionId}`;
      hint = 'Move, Turn or Copy it, or tap Remove to take it away.';
    }
    if (this.statusLabel) this.statusLabel.textContent = status;
    if (this.hintLabel) {
      this.hintLabel.classList.toggle('hud__hint--invalid', placing && state.placementStatus?.valid === false);
    }
    if (this.hintLabel) this.hintLabel.textContent = hint;

    const inPlacementFlow = placing || templatePlacing;
    if (this.rotateButton) this.rotateButton.hidden = !inPlacementFlow;
    if (this.cancelButton) this.cancelButton.hidden = !inPlacementFlow;
    if (this.deleteButton) this.deleteButton.hidden = selected === null;
    if (this.duplicateButton) {
      const selectedDefinition = selected ? this.context.registry.get(selected.definitionId) : undefined;
      this.duplicateButton.hidden = selected === null || !selectedDefinition || roleOf(selectedDefinition) === 'opening';
    }
    this.updateTransformControls(state, selected);
  }

  /**
   * Subtle "Saved" flash whenever My World's build actually changes - the
   * only player-visible sign that persistence happened (see
   * MyWorldPersistenceService). Never shown in Challenge Mode, where
   * placedObjects isn't durable and saving would be meaningless.
   */
  private updateSavedIndicator(state: GameState): void {
    if (!isFreeBuildMode(state) || state.mode !== 'playing') {
      this.lastPlacedObjects = null;
      return;
    }
    if (this.lastPlacedObjects !== null && state.placedObjects !== this.lastPlacedObjects) {
      if (this.savedLabel) this.savedLabel.hidden = false;
      if (this.savedTimeout !== null) clearTimeout(this.savedTimeout);
      this.savedTimeout = setTimeout(() => {
        if (this.savedLabel) this.savedLabel.hidden = true;
        this.savedTimeout = null;
      }, 1600);
    }
    this.lastPlacedObjects = state.placedObjects;
  }

  /** Move / Turn / Size indicator: only the modes this selection actually supports. */
  private updateTransformControls(state: GameState, selected: GameState['placedObjects'][number] | null): void {
    const definition = selected ? this.context.registry.get(selected.definitionId) : undefined;
    if (!selected || !definition) {
      if (this.transformGroup) this.transformGroup.hidden = true;
      return;
    }
    const hostsOpenings = state.placedObjects.some((p) => p.hostId === selected.id);
    const caps = transformCapabilitiesOf(definition, state.challenge ? 'challenge' : 'freeplay', hostsOpenings);
    if (this.transformGroup) this.transformGroup.hidden = !hasAnyCapability(caps);

    if (this.moveModeButton) {
      this.moveModeButton.hidden = !caps.movable;
      this.moveModeButton.classList.toggle('hud-btn--active', state.transformMode === 'move');
    }
    if (this.rotateModeButton) {
      this.rotateModeButton.hidden = !caps.rotatableY;
      this.rotateModeButton.classList.toggle('hud-btn--active', state.transformMode === 'rotate');
    }
    if (this.scaleModeButton) {
      this.scaleModeButton.hidden = !caps.scalable;
      this.scaleModeButton.classList.toggle('hud-btn--active', state.transformMode === 'scale');
    }
    const showStepper = caps.scalable && state.transformMode === 'scale';
    if (this.scaleStepper) this.scaleStepper.hidden = !showStepper;
    if (this.scaleDownButton) this.scaleDownButton.disabled = selected.scale.x <= caps.minScale + 1e-6;
    if (this.scaleUpButton) this.scaleUpButton.disabled = selected.scale.x >= caps.maxScale - 1e-6;
  }

  protected onUnmount(): void {
    if (this.savedTimeout !== null) clearTimeout(this.savedTimeout);
    this.savedTimeout = null;
    this.lastPlacedObjects = null;
    this.latestState = null;
    this.playerLabel = null;
    this.worldLabel = null;
    this.levelLabel = null;
    this.placedLabel = null;
    this.savedLabel = null;
    this.statusLabel = null;
    this.hintLabel = null;
    this.rotateButton = null;
    this.cancelButton = null;
    this.deleteButton = null;
    this.duplicateButton = null;
    this.pauseOverlay = null;
    this.transformGroup = null;
    this.moveModeButton = null;
    this.rotateModeButton = null;
    this.scaleModeButton = null;
    this.scaleStepper = null;
    this.scaleDownButton = null;
    this.scaleUpButton = null;
  }

  private button(label: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
    const button = el('button', `button button--small ${extraClass}`.trim(), label);
    button.type = 'button';
    button.addEventListener('click', onClick);
    return button;
  }

  /** A context button: a plain icon over a short, child-facing label - never a technical term or raw shortcut. */
  private iconButton(icon: string, label: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
    const button = el('button', `hud-btn ${extraClass}`.trim());
    button.type = 'button';
    button.appendChild(el('span', 'hud-btn__icon', icon));
    button.appendChild(el('span', 'hud-btn__label', label));
    button.addEventListener('click', onClick);
    return button;
  }
}
