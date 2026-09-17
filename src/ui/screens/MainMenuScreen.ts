import { Screen, el } from '../Screen';
import type { GameState } from '@/state/GameState';
import { listLevels } from '@/progression/levelState';

/** Small inline icon: a house sitting on a blueprint sheet (Challenge Mode). */
const BLUEPRINT_ICON = `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="4" y="8" width="56" height="48" rx="6" fill="#2f5fa8" opacity="0.35"/>
  <path d="M12 16h18M12 24h12M44 16h8M44 24h8" stroke="#cfe3ff" stroke-width="2" stroke-linecap="round" opacity="0.8"/>
  <path d="M18 50V34l14-10 14 10v16z" fill="#f2f5f7"/>
  <path d="M18 34l14-10 14 10" stroke="#1c2836" stroke-width="2.5" stroke-linejoin="round" fill="none"/>
  <rect x="27" y="40" width="10" height="10" fill="#8b5a2b"/>
  <rect x="21" y="36" width="6" height="6" fill="#a7d8f0" stroke="#1c2836" stroke-width="1"/>
</svg>`;

/** Small inline icon: houses and a tree around a winding path (My World). */
const SANDBOX_ICON = `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M6 50c8-10 18-10 26-2s20 8 26-4" stroke="#e7c07a" stroke-width="6" stroke-linecap="round" opacity="0.55"/>
  <path d="M12 46V34l9-7 9 7v12z" fill="#f2f5f7"/>
  <path d="M12 34l9-7 9 7" stroke="#1c2836" stroke-width="2" stroke-linejoin="round" fill="none"/>
  <path d="M36 44V30l8-6 8 6v14z" fill="#cfd8ea"/>
  <path d="M36 30l8-6 8 6" stroke="#1c2836" stroke-width="2" stroke-linejoin="round" fill="none"/>
  <circle cx="50" cy="16" r="6" fill="#5fae5a"/>
  <rect x="48.5" y="20" width="3" height="7" fill="#6b4a2b"/>
</svg>`;

/** Small mark for the Eavara parent-brand lockup: an arched doorway, echoing the main badge. */
const EAVARA_MARK = `
<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="30" height="30" rx="9" fill="none" stroke="url(#cb-eavara-grad)" stroke-width="2"/>
  <path d="M11 23v-7a5 5 0 0 1 10 0v7" stroke="url(#cb-eavara-grad)" stroke-width="2.4" stroke-linecap="round"/>
  <circle cx="16" cy="9" r="1.6" fill="url(#cb-eavara-grad)"/>
  <defs>
    <linearGradient id="cb-eavara-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
      <stop stop-color="#ffe3a1"/>
      <stop offset="1" stop-color="#f2a541"/>
    </linearGradient>
  </defs>
</svg>`;

/** Logo badge: a friendly little rooftop-and-sun mark, not a wordmark substitute. */
const LOGO_BADGE = `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="16" fill="url(#cb-badge-grad)"/>
  <circle cx="46" cy="20" r="7" fill="#ffe3a1"/>
  <path d="M12 44l20-15 20 15v10a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2z" fill="#fff" opacity="0.95"/>
  <path d="M12 44l20-15 20 15" stroke="#1c2836" stroke-width="3" stroke-linejoin="round" fill="none"/>
  <rect x="27" y="44" width="10" height="12" fill="#8b5a2b"/>
  <defs>
    <linearGradient id="cb-badge-grad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop stop-color="#ffb95a"/>
      <stop offset="1" stop-color="#f2a541"/>
    </linearGradient>
  </defs>
</svg>`;

function icon(markup: string, className: string): HTMLSpanElement {
  const span = el('span', className);
  span.innerHTML = markup;
  return span;
}

/**
 * The home screen: a gateway into the two existing modes (Challenge Mode's
 * World 1 map, and My World's sandbox), presented over the live 3D city
 * rather than a boxed form. Holds no game logic of its own - every click
 * calls the same actions the old panel did.
 */
export class MainMenuScreen extends Screen {
  readonly id = 'main-menu';

  private nameInput: HTMLInputElement | null = null;
  private continueButton: HTMLButtonElement | null = null;
  private noticeLabel: HTMLElement | null = null;
  private campaignSummary: HTMLElement | null = null;

  private readonly onStartSandbox = () => {
    // Resumes the player's saved world if one exists, otherwise starts a
    // fresh one - see GameActions.enterMyWorld.
    this.context.actions.enterMyWorld(this.nameInput?.value ?? '');
  };
  private readonly onContinue = () => {
    this.context.actions.continueGame();
  };
  private readonly onResetProgress = () => {
    this.context.actions.resetProgress();
  };
  private readonly onChallengeMode = () => {
    this.context.actions.openWorldMap();
  };

  protected build(): HTMLElement {
    const root = el('div', 'screen screen--home');

    const topbar = el('div', 'home__topbar');
    const profile = el('div', 'home__profile');
    this.nameInput = el('input', 'home__name-input');
    this.nameInput.type = 'text';
    this.nameInput.placeholder = 'Builder';
    this.nameInput.maxLength = 24;
    this.nameInput.setAttribute('aria-label', 'Builder name');
    profile.appendChild(icon('<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="8" r="4" fill="#f2a541"/><path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="#f2a541"/></svg>', 'home__avatar'));
    profile.appendChild(this.nameInput);
    topbar.appendChild(profile);
    root.appendChild(topbar);

    const hero = el('div', 'home__hero');
    const brand = el('div', 'brand__eyebrow');
    brand.appendChild(icon(EAVARA_MARK, 'brand__mark'));
    brand.appendChild(el('span', 'brand__name', 'EAVARA'));
    hero.appendChild(brand);
    const logo = el('div', 'logo');
    logo.appendChild(icon(LOGO_BADGE, 'logo__badge'));
    const word = el('div', 'logo__word');
    word.appendChild(el('span', 'logo__line', 'CITY'));
    word.appendChild(el('span', 'logo__line logo__line--accent', 'BUILDER'));
    logo.appendChild(word);
    hero.appendChild(logo);
    hero.appendChild(el('p', 'logo__tagline', 'Learn. Build. Create.'));
    root.appendChild(hero);

    const modes = el('div', 'home__modes');

    const challengeCard = el('button', 'mode-card mode-card--challenge');
    challengeCard.type = 'button';
    challengeCard.appendChild(el('span', 'mode-card__eyebrow', 'Learn'));
    challengeCard.appendChild(icon(BLUEPRINT_ICON, 'mode-card__icon'));
    challengeCard.appendChild(el('span', 'mode-card__title', 'Challenge Mode'));
    challengeCard.appendChild(el('span', 'mode-card__desc', 'Learn to build, one level at a time.'));
    this.campaignSummary = el('span', 'mode-card__meta');
    challengeCard.appendChild(this.campaignSummary);
    challengeCard.appendChild(el('span', 'mode-card__cta', 'Learn to Build'));
    challengeCard.addEventListener('click', this.onChallengeMode);
    modes.appendChild(challengeCard);

    const sandboxCard = el('button', 'mode-card mode-card--sandbox');
    sandboxCard.type = 'button';
    sandboxCard.appendChild(el('span', 'mode-card__eyebrow', 'Create'));
    sandboxCard.appendChild(icon(SANDBOX_ICON, 'mode-card__icon'));
    sandboxCard.appendChild(el('span', 'mode-card__title', 'My World'));
    sandboxCard.appendChild(el('span', 'mode-card__desc', 'Create your own world - houses, streets, parks.'));
    sandboxCard.appendChild(el('span', 'mode-card__meta', 'Create · no limits'));
    sandboxCard.appendChild(el('span', 'mode-card__cta', 'Open My World'));
    sandboxCard.addEventListener('click', this.onStartSandbox);
    modes.appendChild(sandboxCard);

    root.appendChild(modes);

    const footer = el('div', 'home__footer');
    this.noticeLabel = el('div', 'menu__notice home__notice');
    this.noticeLabel.hidden = true;
    footer.appendChild(this.noticeLabel);

    this.continueButton = el('button', 'home__continue', 'Continue where you left off');
    this.continueButton.type = 'button';
    this.continueButton.hidden = true;
    this.continueButton.addEventListener('click', this.onContinue);
    footer.appendChild(this.continueButton);

    const reset = el('button', 'home__reset', 'Reset level progress');
    reset.type = 'button';
    reset.addEventListener('click', this.onResetProgress);
    footer.appendChild(reset);
    root.appendChild(footer);

    return root;
  }

  update(state: GameState): void {
    if (this.nameInput && state.player && this.nameInput.value === '') {
      this.nameInput.value = state.player.name;
    }
    if (this.continueButton) this.continueButton.hidden = state.player === null;
    if (this.noticeLabel) {
      this.noticeLabel.textContent = state.menuNotice ?? '';
      this.noticeLabel.hidden = state.menuNotice === null;
    }

    const entries = listLevels(this.context.challenges.list(), state.progress);
    const completed = entries.filter((e) => e.status === 'completed').length;
    const next = entries.find((e) => e.status === 'available');
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
    this.campaignSummary = null;
  }
}
