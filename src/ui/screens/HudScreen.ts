import { Screen, el } from '../Screen';
import { isPlacementMode, type GameState } from '@/state/GameState';
import { describePlacementStatus } from '@/construction/PlacementResolver';

/**
 * In-game heads-up display: session facts on top, construction status and
 * context actions at the bottom. Objectives/rewards panels attach later.
 */
export class HudScreen extends Screen {
  readonly id = 'hud';

  private playerLabel: HTMLElement | null = null;
  private worldLabel: HTMLElement | null = null;
  private levelLabel: HTMLElement | null = null;
  private placedLabel: HTMLElement | null = null;
  private statusLabel: HTMLElement | null = null;
  private hintLabel: HTMLElement | null = null;
  private rotateButton: HTMLButtonElement | null = null;
  private cancelButton: HTMLButtonElement | null = null;
  private deleteButton: HTMLButtonElement | null = null;
  private pauseOverlay: HTMLElement | null = null;

  private readonly onMenu = () => this.context.actions.returnToMenu();
  private readonly onPause = () => this.context.actions.pause();
  private readonly onResume = () => this.context.actions.resume();
  private readonly onRotate = () => this.context.actions.rotatePlacement(1);
  private readonly onCancel = () => this.context.actions.cancelPlacement();
  private readonly onDelete = () => this.context.actions.removeSelectedPlacedObject();

  protected build(): HTMLElement {
    const root = el('div', 'screen screen--hud');

    const topBar = el('div', 'hud__top');
    this.playerLabel = el('span', 'hud__stat');
    this.worldLabel = el('span', 'hud__stat');
    this.levelLabel = el('span', 'hud__stat');
    this.placedLabel = el('span', 'hud__stat');
    topBar.append(this.playerLabel, this.worldLabel, this.levelLabel, this.placedLabel);
    topBar.appendChild(el('span', 'hud__spacer'));
    topBar.appendChild(this.button('Pause', this.onPause));
    topBar.appendChild(this.button('Menu', this.onMenu));
    root.appendChild(topBar);

    const bottomBar = el('div', 'hud__bottom');
    this.statusLabel = el('span', 'hud__status');
    this.hintLabel = el('span', 'hud__hint');
    bottomBar.append(this.statusLabel, this.hintLabel);
    bottomBar.appendChild(el('span', 'hud__spacer'));
    this.rotateButton = this.button('Rotate (R)', this.onRotate);
    this.cancelButton = this.button('Cancel (Esc)', this.onCancel);
    this.deleteButton = this.button('Delete (Del)', this.onDelete, 'button--danger');
    bottomBar.append(this.rotateButton, this.cancelButton, this.deleteButton);
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
    if (this.playerLabel) this.playerLabel.textContent = `Player: ${state.player?.name ?? '-'}`;
    if (this.worldLabel) this.worldLabel.textContent = `World: ${state.world?.name ?? '-'}`;
    if (this.levelLabel) this.levelLabel.textContent = `Level: ${state.level?.index ?? '-'}`;
    if (this.placedLabel) this.placedLabel.textContent = `Placed: ${state.placedObjects.length}`;
    if (this.pauseOverlay) this.pauseOverlay.hidden = state.mode !== 'paused';

    const placing = isPlacementMode(state);
    const selected = state.selectedInstanceId
      ? state.placedObjects.find((p) => p.id === state.selectedInstanceId) ?? null
      : null;

    let status = 'Nothing selected';
    let hint = 'Pick an object in the toolbar to build, or click a placed object to select it. Drag to orbit, right-drag to pan, wheel to zoom, keys 1-4 for views.';
    if (placing && state.selectedObjectId) {
      const definition = this.context.registry.get(state.selectedObjectId);
      status = `Placing: ${definition?.name ?? state.selectedObjectId}`;
      hint = state.placementStatus
        ? `${describePlacementStatus(state.placementStatus)} Click to place, R to rotate.`
        : 'Point at the ground or an existing object. R to rotate, Esc to cancel.';
    } else if (selected) {
      const definition = this.context.registry.get(selected.definitionId);
      status = `Selected: ${definition?.name ?? selected.definitionId}`;
      hint = `#${selected.id.slice(-6)} at (${selected.position.x}, ${selected.position.z}). Press Delete to remove.`;
    }
    if (this.statusLabel) this.statusLabel.textContent = status;
    if (this.hintLabel) {
      this.hintLabel.classList.toggle('hud__hint--invalid', placing && state.placementStatus?.valid === false);
    }
    if (this.hintLabel) this.hintLabel.textContent = hint;

    if (this.rotateButton) this.rotateButton.hidden = !placing;
    if (this.cancelButton) this.cancelButton.hidden = !placing;
    if (this.deleteButton) this.deleteButton.hidden = selected === null;
  }

  protected onUnmount(): void {
    this.playerLabel = null;
    this.worldLabel = null;
    this.levelLabel = null;
    this.placedLabel = null;
    this.statusLabel = null;
    this.hintLabel = null;
    this.rotateButton = null;
    this.cancelButton = null;
    this.deleteButton = null;
    this.pauseOverlay = null;
  }

  private button(label: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
    const button = el('button', `button button--small ${extraClass}`.trim(), label);
    button.type = 'button';
    button.addEventListener('click', onClick);
    return button;
  }
}
