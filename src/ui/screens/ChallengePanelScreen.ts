import { Screen, el } from '../Screen';
import type { GameState } from '@/state/GameState';
import type { ChallengeMatchResult } from '@/challenges/ChallengeMatcher';
import { nextChallenge } from '@/progression/levelState';
import { describeStars } from '@/progression/stars';
import { icon } from '../studio/icons';

/**
 * Challenge Mode's mission card (Step 27.1 visual pass - same data and
 * actions as before, new presentation only): what to build, a blueprint
 * indicator, per-kind progress, and - once the attempt is completed - a
 * proper completion moment (stars, verdict, next steps). Reads everything
 * from state; never computes or stores progress itself.
 */
export class ChallengePanelScreen extends Screen {
  readonly id = 'challenge';

  private card: HTMLElement | null = null;
  private titleLabel: HTMLElement | null = null;
  private captionLabel: HTMLElement | null = null;
  private targetCount: HTMLElement | null = null;
  private groupsList: HTMLElement | null = null;
  private progressBar: HTMLElement | null = null;
  private progressLabel: HTMLElement | null = null;
  private extrasLabel: HTMLElement | null = null;
  private result: HTMLElement | null = null;
  private resultStars: HTMLElement | null = null;
  private resultVerdict: HTMLElement | null = null;
  private resultBest: HTMLElement | null = null;
  private nextButton: HTMLButtonElement | null = null;

  private collapseButton: HTMLButtonElement | null = null;
  private collapsed = false;

  /**
   * Collapse the card to its header while building so the objective list
   * never hides the construction area. Pure view state: nothing in the game
   * state changes, and the card expands again when a level is completed.
   */
  private readonly onToggleCollapse = () => this.setCollapsed(!this.collapsed);

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.card?.classList.toggle('ev-mission--collapsed', collapsed);
    if (this.collapseButton) {
      this.collapseButton.setAttribute('aria-expanded', String(!collapsed));
      const label = collapsed ? 'Show the mission' : 'Hide the mission';
      this.collapseButton.title = label;
      this.collapseButton.setAttribute('aria-label', label);
      this.collapseButton.replaceChildren(icon(collapsed ? 'plus' : 'minus'));
    }
  }

  private readonly onExit = () => this.context.actions.exitChallenge();
  private readonly onRestart = () => this.context.actions.restartChallenge();
  private readonly onNext = () => this.context.actions.startNextChallenge();

  protected build(): HTMLElement {
    const root = el('div', 'screen screen--challenge');
    const card = el('div', 'ev-mission');
    this.card = card;

    const header = el('div', 'ev-mission__header');
    this.titleLabel = el('div', 'ev-mission__title');
    header.appendChild(this.titleLabel);
    const buttons = el('div', 'ev-mission__buttons');
    this.collapseButton = this.roundButton('minus', 'Hide the mission', this.onToggleCollapse);
    this.collapseButton.setAttribute('aria-expanded', 'true');
    buttons.appendChild(this.collapseButton);
    buttons.appendChild(this.roundButton('turn', 'Restart', this.onRestart));
    buttons.appendChild(this.roundButton('close', 'Exit', this.onExit));
    header.appendChild(buttons);
    card.appendChild(header);

    this.captionLabel = el('p', 'ev-mission__description');
    card.appendChild(this.captionLabel);

    const target = el('div', 'ev-target');
    target.appendChild(icon('target'));
    const targetText = el('div', 'ev-target__text');
    targetText.appendChild(el('span', 'ev-target__label', 'Blueprint'));
    this.targetCount = el('span', 'ev-target__count');
    targetText.appendChild(this.targetCount);
    target.appendChild(targetText);
    card.appendChild(target);

    this.groupsList = el('div', 'ev-groups');
    card.appendChild(this.groupsList);

    const progressRow = el('div', 'ev-progress-row');
    const track = el('div', 'ev-track');
    this.progressBar = el('div', 'ev-bar');
    track.appendChild(this.progressBar);
    this.progressLabel = el('span', 'ev-progress-pct');
    progressRow.append(track, this.progressLabel);
    card.appendChild(progressRow);

    this.extrasLabel = el('div', 'ev-extras');
    card.appendChild(this.extrasLabel);

    this.result = this.buildResult();
    card.appendChild(this.result);

    root.appendChild(card);
    return root;
  }

  private buildResult(): HTMLElement {
    const result = el('div', 'ev-result');
    result.hidden = true;
    const badge = el('div', 'ev-result__badge');
    badge.appendChild(icon('trophy'));
    result.appendChild(badge);
    result.appendChild(el('div', 'ev-result__banner', 'CHALLENGE COMPLETE'));
    const title = el('div', 'ev-result__title');
    result.appendChild(title);
    this.resultStars = el('div', 'ev-result__stars');
    for (let i = 0; i < 3; i++) {
      const star = el('span', 'ev-stars__star');
      star.appendChild(icon('star'));
      this.resultStars.appendChild(star);
    }
    result.appendChild(this.resultStars);
    this.resultVerdict = el('div', 'ev-result__verdict');
    result.appendChild(this.resultVerdict);
    this.resultBest = el('div', 'ev-result__best');
    result.appendChild(this.resultBest);

    const resultButtons = el('div', 'ev-result__buttons');
    resultButtons.appendChild(this.pillButton('turn', 'Replay', this.onRestart, 'ev-pill--ghost'));
    this.nextButton = this.pillButton('check', 'Next Level', this.onNext, 'ev-pill--primary');
    resultButtons.appendChild(this.nextButton);
    resultButtons.appendChild(this.pillButton('home', 'Back to Levels', this.onExit, 'ev-pill--ghost'));
    result.appendChild(resultButtons);

    // The title element must exist before update() runs; stash it for reuse.
    this.resultTitleEl = title;
    return result;
  }

  private resultTitleEl: HTMLElement | null = null;

  update(state: GameState): void {
    if (!this.root) return;
    const challenge = state.challenge ? this.context.challenges.get(state.challenge.challengeId) : undefined;
    this.root.hidden = !challenge;
    if (!challenge) return;

    if (this.titleLabel) this.titleLabel.textContent = challenge.title;
    if (this.captionLabel) this.captionLabel.textContent = challenge.reference.caption;

    const match = state.challengeMatch;
    this.renderGroups(match, challenge.blueprint.objects.length);
    if (this.targetCount) {
      const required = challenge.blueprint.objects.length;
      const matched = match?.matchedCount ?? 0;
      this.targetCount.textContent = `${matched} / ${required} pieces`;
    }

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
      if (this.resultTitleEl) this.resultTitleEl.textContent = challenge.title;
      this.resultStars?.querySelectorAll('.ev-stars__star').forEach((star, i) => {
        star.classList.toggle('ev-stars__star--on', i < result.stars);
      });
      if (this.resultVerdict) this.resultVerdict.textContent = describeStars(result.stars);
      if (this.resultBest) {
        this.resultBest.textContent = result.isNewBest
          ? 'New best!'
          : result.bestStars > result.stars
            ? `Your best: ${'★'.repeat(result.bestStars)}${'☆'.repeat(3 - result.bestStars)}`
            : '';
      }
      if (this.nextButton) {
        const next = nextChallenge(challenge.id, this.context.challenges.list());
        const label = this.nextButton.querySelector('.ev-pill__label');
        if (label) label.textContent = next ? `Next: ${next.title}` : 'Next Level';
        this.nextButton.hidden = next === null;
      }
    }
  }

  private renderGroups(match: ChallengeMatchResult | null, requiredTotal: number): void {
    if (!this.groupsList) return;
    this.groupsList.replaceChildren();
    if (!match) {
      const row = el('div', 'ev-group');
      row.appendChild(this.groupDot(false));
      row.appendChild(el('span', 'ev-group__label', 'Pieces'));
      row.appendChild(el('span', 'ev-group__count', `0 / ${requiredTotal}`));
      this.groupsList.appendChild(row);
      return;
    }
    for (const group of match.groups) {
      const done = group.matched >= group.required;
      const row = el('div', 'ev-group');
      row.classList.toggle('ev-group--done', done);
      row.appendChild(this.groupDot(done));
      row.appendChild(el('span', 'ev-group__label', group.label));
      row.appendChild(el('span', 'ev-group__count', `${group.matched} / ${group.required}`));
      this.groupsList.appendChild(row);
    }
  }

  private groupDot(done: boolean): HTMLElement {
    const dot = el('span', 'ev-group__dot');
    if (done) dot.appendChild(icon('check'));
    return dot;
  }

  protected onUnmount(): void {
    this.card = null;
    this.titleLabel = null;
    this.captionLabel = null;
    this.targetCount = null;
    this.groupsList = null;
    this.progressBar = null;
    this.progressLabel = null;
    this.extrasLabel = null;
    this.result = null;
    this.resultStars = null;
    this.resultVerdict = null;
    this.resultBest = null;
    this.resultTitleEl = null;
    this.nextButton = null;
    this.collapseButton = null;
    this.collapsed = false;
  }

  private roundButton(iconName: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = el('button', 'ev-round ev-round--small');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.appendChild(icon(iconName));
    button.addEventListener('click', onClick);
    return button;
  }

  private pillButton(iconName: string, label: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
    const button = el('button', `ev-pill ${extraClass}`.trim());
    button.type = 'button';
    button.appendChild(icon(iconName));
    button.appendChild(el('span', 'ev-pill__label', label));
    button.addEventListener('click', onClick);
    return button;
  }
}
