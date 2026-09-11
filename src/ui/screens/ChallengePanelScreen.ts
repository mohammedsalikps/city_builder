import { Screen, el } from '../Screen';
import type { GameState } from '@/state/GameState';
import type { ChallengeMatchResult } from '@/challenges/ChallengeMatcher';
import { nextChallenge } from '@/progression/levelState';
import { describeStars, starString } from '@/progression/stars';

/**
 * Challenge panel: what to build, per-kind progress ("Walls 3 / 4"), a
 * progress bar, extras, and restart / exit controls. When the attempt is
 * completed it shows the result: stars, a short verdict, and Replay /
 * Next Level / Back to Levels.
 * Mounted whenever the game is playing; hides itself when no challenge is
 * active. Reads everything from state; never computes or stores progress.
 */
export class ChallengePanelScreen extends Screen {
  readonly id = 'challenge';

  private titleLabel: HTMLElement | null = null;
  private captionLabel: HTMLElement | null = null;
  private groupsList: HTMLElement | null = null;
  private progressBar: HTMLElement | null = null;
  private progressLabel: HTMLElement | null = null;
  private extrasLabel: HTMLElement | null = null;
  private result: HTMLElement | null = null;
  private resultTitle: HTMLElement | null = null;
  private resultStars: HTMLElement | null = null;
  private resultVerdict: HTMLElement | null = null;
  private resultBest: HTMLElement | null = null;
  private nextButton: HTMLButtonElement | null = null;

  private panel: HTMLElement | null = null;
  private collapseButton: HTMLButtonElement | null = null;
  private collapsed = false;

  /**
   * Collapse the panel to its header while building so the objective list
   * never hides the construction area. Pure view state: nothing in the game
   * state changes, and the panel expands again when a level is completed.
   */
  private readonly onToggleCollapse = () => this.setCollapsed(!this.collapsed);

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.panel?.classList.toggle('challenge--collapsed', collapsed);
    if (this.collapseButton) {
      this.collapseButton.textContent = collapsed ? 'Show' : 'Hide';
      this.collapseButton.setAttribute('aria-expanded', String(!collapsed));
    }
  }

  private readonly onExit = () => this.context.actions.exitChallenge();
  private readonly onRestart = () => this.context.actions.restartChallenge();
  private readonly onNext = () => this.context.actions.startNextChallenge();

  protected build(): HTMLElement {
    const root = el('div', 'screen screen--challenge');
    const panel = el('div', 'challenge');

    const header = el('div', 'challenge__header');
    this.titleLabel = el('div', 'challenge__title');
    header.appendChild(this.titleLabel);
    const buttons = el('div', 'challenge__buttons');
    this.collapseButton = this.button('Hide', this.onToggleCollapse);
    this.collapseButton.setAttribute('aria-expanded', 'true');
    buttons.appendChild(this.collapseButton);
    buttons.appendChild(this.button('Restart', this.onRestart));
    buttons.appendChild(this.button('Exit', this.onExit));
    header.appendChild(buttons);
    panel.appendChild(header);
    this.panel = panel;

    this.captionLabel = el('p', 'challenge__description');
    panel.appendChild(this.captionLabel);

    this.groupsList = el('div', 'challenge__groups');
    panel.appendChild(this.groupsList);

    const progressRow = el('div', 'challenge__progress-row');
    const track = el('div', 'challenge__track');
    this.progressBar = el('div', 'challenge__bar');
    track.appendChild(this.progressBar);
    this.progressLabel = el('span', 'challenge__progress');
    progressRow.append(track, this.progressLabel);
    panel.appendChild(progressRow);

    this.extrasLabel = el('div', 'challenge__detail');
    panel.appendChild(this.extrasLabel);

    this.result = el('div', 'result');
    this.result.hidden = true;
    this.result.appendChild(el('div', 'result__banner', '🎉 CHALLENGE COMPLETE!'));
    this.resultTitle = el('div', 'result__title');
    this.resultStars = el('div', 'result__stars');
    this.resultVerdict = el('div', 'result__verdict');
    this.resultBest = el('div', 'result__best');
    this.result.append(this.resultTitle, this.resultStars, this.resultVerdict, this.resultBest);
    const resultButtons = el('div', 'result__buttons');
    resultButtons.appendChild(this.button('Replay', this.onRestart));
    this.nextButton = this.button('Next Level', this.onNext, 'button--primary');
    resultButtons.appendChild(this.nextButton);
    resultButtons.appendChild(this.button('Back to Levels', this.onExit));
    this.result.appendChild(resultButtons);
    panel.appendChild(this.result);

    root.appendChild(panel);
    return root;
  }

  update(state: GameState): void {
    if (!this.root) return;
    const challenge = state.challenge ? this.context.challenges.get(state.challenge.challengeId) : undefined;
    this.root.hidden = !challenge;
    if (!challenge) return;

    if (this.titleLabel) this.titleLabel.textContent = `Level ${challenge.index}: ${challenge.title}`;
    if (this.captionLabel) this.captionLabel.textContent = challenge.reference.caption;

    const match = state.challengeMatch;
    this.renderGroups(match, challenge.blueprint.objects.length);

    const progress = match ? match.progress : 0;
    if (this.progressBar) this.progressBar.style.width = `${Math.round(progress * 100)}%`;
    if (this.progressLabel) this.progressLabel.textContent = `${Math.round(progress * 100)}%`;

    if (this.extrasLabel) {
      const parts: string[] = [];
      if (match && match.wrongCount > 0) parts.push(`${match.wrongCount} misplaced`);
      if (match && match.extraCount > 0) parts.push(`${match.extraCount} extra`);
      this.extrasLabel.textContent = parts.length > 0 ? parts.join(' · ') : '';
      this.extrasLabel.hidden = parts.length === 0;
    }

    const result = state.challengeResult;
    const showResult = result !== null && result.challengeId === challenge.id;
    if (showResult && this.collapsed) this.setCollapsed(false);
    if (this.result) this.result.hidden = !showResult;
    this.root.classList.toggle('screen--challenge-complete', showResult);
    if (showResult && result) {
      if (this.resultTitle) this.resultTitle.textContent = challenge.title.toUpperCase();
      if (this.resultStars) this.resultStars.textContent = starString(result.stars);
      if (this.resultVerdict) this.resultVerdict.textContent = describeStars(result.stars);
      if (this.resultBest) {
        this.resultBest.textContent = result.isNewBest
          ? 'New best!'
          : result.bestStars > result.stars
            ? `Your best: ${starString(result.bestStars)}`
            : '';
      }
      if (this.nextButton) {
        const next = nextChallenge(challenge.id, this.context.challenges.list());
        this.nextButton.textContent = next ? `Next Level: ${next.title}` : 'Next Level';
        this.nextButton.hidden = next === null;
      }
    }
  }

  private renderGroups(match: ChallengeMatchResult | null, requiredTotal: number): void {
    if (!this.groupsList) return;
    this.groupsList.replaceChildren();
    if (!match) {
      this.groupsList.appendChild(el('div', 'challenge__group', `0 / ${requiredTotal} built`));
      return;
    }
    for (const group of match.groups) {
      const row = el('div', 'challenge__group');
      row.classList.toggle('challenge__group--done', group.matched >= group.required);
      row.appendChild(el('span', 'challenge__group-label', group.label));
      row.appendChild(el('span', 'challenge__group-count', `${group.matched} / ${group.required}`));
      this.groupsList.appendChild(row);
    }
  }

  protected onUnmount(): void {
    this.titleLabel = null;
    this.captionLabel = null;
    this.groupsList = null;
    this.progressBar = null;
    this.progressLabel = null;
    this.extrasLabel = null;
    this.result = null;
    this.resultTitle = null;
    this.resultStars = null;
    this.resultVerdict = null;
    this.resultBest = null;
    this.nextButton = null;
  }

  private button(label: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
    const button = el('button', `button button--small ${extraClass}`.trim(), label);
    button.type = 'button';
    button.addEventListener('click', onClick);
    return button;
  }
}
