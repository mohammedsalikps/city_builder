import { Screen, el } from '../Screen';
import type { GameState } from '@/state/GameState';
import { listLevels } from '@/progression/levelState';

/**
 * Main menu and the simple level selector. Every level is listed with its
 * state (locked / available / completed) and best stars, derived from
 * `state.progress` on each update. Locked levels are still clickable so the
 * player gets a friendly explanation instead of silence.
 */
export class MainMenuScreen extends Screen {
  readonly id = 'main-menu';

  private nameInput: HTMLInputElement | null = null;
  private continueButton: HTMLButtonElement | null = null;
  private noticeLabel: HTMLElement | null = null;
  private campaignTitle: HTMLElement | null = null;
  private campaignSummary: HTMLElement | null = null;

  private readonly onStart = () => {
    this.context.actions.startNewGame(this.nameInput?.value ?? '');
  };
  private readonly onContinue = () => {
    this.context.actions.continueGame();
  };
  private readonly onResetProgress = () => {
    this.context.actions.resetProgress();
  };

  protected build(): HTMLElement {
    const root = el('div', 'screen screen--menu');
    const panel = el('div', 'panel');

    panel.appendChild(el('h1', 'title', 'City Builder'));
    panel.appendChild(el('p', 'subtitle', 'Learn construction. Build your world.'));

    const label = el('label', 'field');
    label.appendChild(el('span', 'field__label', 'Builder name'));
    this.nameInput = el('input', 'field__input');
    this.nameInput.type = 'text';
    this.nameInput.placeholder = 'Builder';
    this.nameInput.maxLength = 24;
    label.appendChild(this.nameInput);
    panel.appendChild(label);

    panel.appendChild(el('div', 'field__label', 'Challenge mode'));
    const campaignButton = el('button', 'level level--available');
    campaignButton.type = 'button';
    campaignButton.dataset.action = 'challenge-mode';
    const campaignBadge = el('span', 'level__badge', '▶');
    const campaignText = el('span', 'level__text');
    this.campaignTitle = el('span', 'level__title', 'Play the campaign');
    this.campaignSummary = el('span', 'level__stars');
    campaignText.append(this.campaignTitle, this.campaignSummary);
    campaignButton.append(campaignBadge, campaignText);
    campaignButton.addEventListener('click', () => this.context.actions.openWorldMap());
    panel.appendChild(campaignButton);

    this.noticeLabel = el('div', 'menu__notice');
    this.noticeLabel.hidden = true;
    panel.appendChild(this.noticeLabel);

    panel.appendChild(el('div', 'field__label', 'My World · free building'));
    const startButton = el('button', 'button', 'New Sandbox');
    startButton.type = 'button';
    startButton.addEventListener('click', this.onStart);
    panel.appendChild(startButton);

    this.continueButton = el('button', 'button', 'Continue');
    this.continueButton.type = 'button';
    this.continueButton.addEventListener('click', this.onContinue);
    panel.appendChild(this.continueButton);

    const reset = el('button', 'menu__reset', 'Reset level progress');
    reset.type = 'button';
    reset.addEventListener('click', this.onResetProgress);
    panel.appendChild(reset);

    root.appendChild(panel);
    return root;
  }

  update(state: GameState): void {
    if (this.continueButton) this.continueButton.hidden = state.player === null;
    if (this.nameInput && state.player && this.nameInput.value === '') {
      this.nameInput.value = state.player.name;
    }
    if (this.noticeLabel) {
      this.noticeLabel.textContent = state.menuNotice ?? '';
      this.noticeLabel.hidden = state.menuNotice === null;
    }

    const entries = listLevels(this.context.challenges.list(), state.progress);
    const completed = entries.filter((e) => e.status === 'completed').length;
    const next = entries.find((e) => e.status === 'available');
    const world = this.context.challenges.worlds()[0];
    if (this.campaignTitle && world) this.campaignTitle.textContent = `World ${world.index}: ${world.title}`;
    if (this.campaignSummary) {
      this.campaignSummary.textContent = next
        ? `${completed} / ${entries.length} levels · next: Level ${next.challenge.index}`
        : `${completed} / ${entries.length} levels · all done!`;
    }
  }

  protected onUnmount(): void {
    this.nameInput = null;
    this.continueButton = null;
    this.noticeLabel = null;
    this.campaignTitle = null;
    this.campaignSummary = null;
  }
}
