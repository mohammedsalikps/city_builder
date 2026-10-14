import { Screen, el, type ScreenContext } from '../Screen';
import type { GameState } from '@/state/GameState';
import {
  FOUNDATION_SIMULATION,
  GOLDEN_GATE_SAG_RATIO,
  WIND_LABELS,
  cableUnderLoad,
  foundationScenario,
  lessonFrame,
  relativeWindPush,
  solveTruss,
  type CableLoadResult,
  type CompanionChoice,
  type Lesson,
  type LessonStep,
  type RealLandmark,
  type Source,
} from '@/realworld';
import type { RealWorldScene, RealWorldSnapshot } from '@/game/RealWorldScene';
import type { LandmarkView } from '@/realworld/models/BurjKhalifaModel';
import { icon } from '../studio/icons';
import { blocksEscape, focusIfPresent, realWorldBackStep, returnFocusTo } from '../keyboard';
import { motion } from '@/accessibility/motion';
import '../realworld/realworld.css';

/** Icons for library cards (generic, never a brand). */
const LANDMARK_ICON: Record<string, string> = {
  'burj-khalifa': 'tower',
  'eiffel-tower': 'tower',
  'golden-gate-bridge': 'road',
  'dam-and-reservoir': 'wave',
  'wind-turbine': 'sparkle',
  'hydroelectric-power-station': 'wave',
  'rocket-launch-vehicle': 'target',
  'skyscraper-under-construction': 'bricks',
  stadium: 'trophy',
  'solar-power-plant': 'sparkle',
  'railway-station': 'road',
};

const VIEWS: Array<{ id: LandmarkView; label: string; icon: string; hint: string }> = [
  { id: 'complete', label: 'Complete', icon: 'tower', hint: 'The finished landmark' },
  { id: 'construction', label: 'Construction', icon: 'bricks', hint: 'How it was built, step by step' },
  { id: 'cutaway', label: 'Cutaway', icon: 'eye', hint: 'See inside to the structure and down to the foundations' },
  { id: 'inspect', label: 'Inspect', icon: 'zoom', hint: 'Look closely at one part' },
];

const STEP_LABEL: Record<LessonStep['kind'], string> = {
  experience: 'Experience',
  interact: 'Try it',
  explain: 'Why it happens',
  check: 'Check',
};

/** How the pressure meter describes each teaching level (thresholds in PRESSURE_LEVELS). */
const PRESSURE_WORDS = { low: 'gentle', medium: 'medium', high: 'very strong' } as const;

/** Said wherever the model is described, when the downloaded model could not be used. */
const FALLBACK_NOTE = 'The downloaded 3D model could not be loaded, so a simpler model built into the app is shown.';

/** Bridge forces lesson: what the model's arrows on each part show (simplified teaching words). */
const BRIDGE_FORCE_WORDS: Record<string, { kind: 'tension' | 'compression' | 'both'; text: string }> = {
  'main-cables': { kind: 'tension', text: 'The main cables are pulled tight (tension): the blue arrows point apart along them.' },
  suspenders: { kind: 'tension', text: 'The suspender ropes are pulled (tension): the deck hangs from them.' },
  towers: { kind: 'compression', text: 'The towers are squeezed (compression): the cables press down on their tops, and the towers carry that load down toward their foundations.' },
  deck: { kind: 'both', text: 'The deck\u2019s weight (purple) hangs on the suspender ropes, which pull up on it (blue).' },
  anchorages: { kind: 'both', text: 'The cables pull on the anchorages (blue). Each anchorage\u2019s huge weight presses down (orange) and holds the cable ends in place.' },
  piers: { kind: 'compression', text: 'The tower piers are squeezed (compression): the towers press down on them, and they pass the load to the ground under the water.' },
};

/** Seconds between timeline steps while playing. */
const PLAY_SECONDS = 2.5;

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Triangulation lesson: how far the square leans once it folds (it would keep going), and how much bigger the braced frame's tiny movement is drawn. */
const FOLD_ANGLE = (35 * Math.PI) / 180;
const BRACED_EXAGGERATION = 30;
/** Pretend bar stiffness (EA) of the lesson's frame. */
const FRAME_STIFFNESS = 1000;
/** Pushes smaller than this (slider fraction) count as no push; at least this much counts as a real try. */
const PUSH_DEAD_ZONE = 0.02;
const PUSH_COUNTS = 0.3;

interface LessonState {
  lesson: Lesson;
  step: number;
  floors: number;
  area: number;
  triedLow: boolean;
  triedTall: boolean;
  wind: number;
  /** Triangulation: is the diagonal in, the push (-1..1), and which frames the child has really pushed. */
  braced: boolean;
  push: number;
  pushedSquare: boolean;
  pushedBraced: boolean;
  /** Bridge lessons: the part whose forces are shown; the load's place on the main span (0..1), the pretend flat cable, and which cables the child has tried. */
  forcesPart: string | null;
  loadAt: number;
  flatCable: boolean;
  triedNormal: boolean;
  triedFlat: boolean;
  answered: number | null;
  finished: boolean;
}

/**
 * RealWorld Explorer's screen. The library of landmarks (only implemented
 * ones can be opened; the rest honestly say "Coming soon"), and - for an
 * open landmark - an exploration view over the 3D scene: a floor navigator,
 * view switcher (complete / construction / cutaway / inspect), the
 * construction timeline, a card for the tapped part, and a learn panel with
 * lessons (experience, try it, why it happens, check), missions and sourced
 * facts. EAVARA's line follows what is really on screen.
 *
 * Holds no game logic: everything is asked of RealWorldScene, and all the
 * words and numbers come from the landmark's sourced content.
 */
export class RealWorldScreen extends Screen {
  readonly id = 'realworld';

  /** Mounted by RealWorldLoaderScreen once RealWorld Explorer's code and scene have arrived. */
  constructor(
    context: ScreenContext,
    private readonly scene: RealWorldScene,
  ) {
    super(context);
  }

  private library!: HTMLElement;
  private grid!: HTMLElement;
  private explore!: HTMLElement;
  private titleLabel!: HTMLElement;
  private placeLabel!: HTMLElement;
  private honesty!: HTMLButtonElement;
  private honestyText!: HTMLElement;
  private companion!: HTMLElement;
  private companionText!: HTMLElement;
  private companionChoices!: HTMLElement;
  private stops!: HTMLElement;
  private stopsTitle!: HTMLElement;
  private stopInfo!: HTMLElement;
  private views!: HTMLElement;
  private viewHint!: HTMLElement;
  private timeline!: HTMLElement;
  private partCard!: HTMLElement;
  private learn!: HTMLElement;
  private learnBody!: HTMLElement;
  private learnToggle!: HTMLButtonElement;
  private tabs: Record<'lessons' | 'missions' | 'facts' | 'parts', HTMLButtonElement> = {} as never;
  private unavailable!: HTMLElement;
  private toast!: HTMLElement;

  private tab: 'lessons' | 'missions' | 'facts' | 'parts' = 'lessons';
  /** Keyboard focus to restore after the next render (a CSS selector inside this screen). */
  private pendingFocus: string | null = null;
  /** Where focus goes back to when the part card closes (the parts-list button that opened it). */
  private partReturnFocus: HTMLElement | null = null;
  /** The landmark whose Explore button gets focus when the library comes back. */
  private libraryReturnId: string | null = null;
  private lessonState: LessonState | null = null;
  private learnOpen = true;
  private playTimer: ReturnType<typeof setInterval> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private libraryKey = '';
  private landmarkKey = '';
  private stopsKey = '';
  private timelineKey = '';
  private partKey = '';
  private learnKey = '';
  private companionKey = '';
  private readonly disposers: Array<() => void> = [];
  private readonly onResize = () => this.reportInsets();

  protected build(): HTMLElement {
    const root = el('div', 'screen studio realworld');
    const scene = this.scene;

    // ------------------------------------------------------------ library
    this.library = el('section', 'rw-library');
    this.library.setAttribute('aria-label', 'Landmark library');
    const head = el('header', 'rw-library__head');
    const home = el('button', 'rw-btn');
    home.type = 'button';
    home.append(icon('back'), el('span', '', 'Home'));
    home.addEventListener('click', () => {
      returnFocusTo('.mode-card--explorer');
      scene.exit();
    });
    const titles = el('div', 'rw-library__titles');
    const libraryTitle = el('h1', 'rw-library__title', 'RealWorld Explorer');
    libraryTitle.tabIndex = -1;
    titles.append(libraryTitle, el('p', 'rw-library__subtitle', 'Explore real places and discover how they stand up'));
    head.append(home, titles);
    this.grid = el('div', 'rw-grid');
    this.grid.setAttribute('role', 'list');
    // Credits for the downloaded assets (all CC0; Poly Haven asks apps to say where its assets come from).
    const credits = el('p', 'rw-credits', 'Sky and ground photos: Poly Haven (CC0). Eiffel Tower 3D model: ingoenius, via the 3D Model Repository (CC0). Burj Khalifa and Golden Gate Bridge models: built by EAVARA.');
    this.library.append(head, this.grid, credits);
    root.appendChild(this.library);

    // ------------------------------------------------------------ explore view
    this.explore = el('section', 'rw-explore');
    const top = el('header', 'rw-top');
    const back = el('button', 'rw-btn');
    back.type = 'button';
    back.append(icon('back'), el('span', '', 'All landmarks'));
    back.addEventListener('click', () => {
      this.libraryReturnId = scene.snapshotState().landmark?.id ?? null;
      this.closeLesson();
      scene.open(null);
    });
    const name = el('div', 'rw-top__titles');
    this.titleLabel = el('strong', 'rw-top__title');
    // Focus lands here when a landmark opens, so screen readers say where the child is.
    this.titleLabel.tabIndex = -1;
    this.placeLabel = el('span', 'rw-top__place');
    name.append(this.titleLabel, this.placeLabel);
    const reset = el('button', 'st-round rw-round');
    reset.type = 'button';
    reset.title = 'Reset view';
    reset.setAttribute('aria-label', 'Reset view');
    reset.appendChild(icon('globe'));
    reset.addEventListener('click', () => scene.resetView());
    this.honesty = el('button', 'rw-honesty');
    this.honesty.type = 'button';
    this.honesty.setAttribute('aria-expanded', 'false');
    this.honesty.setAttribute('aria-label', 'Simplified learning model: about this 3D model');
    this.honesty.append(icon('eye'), el('span', '', 'Simplified learning model'));
    this.honestyText = el('div', 'rw-honesty__text');
    this.honestyText.hidden = true;
    this.honesty.addEventListener('click', () => {
      this.honestyText.hidden = !this.honestyText.hidden;
      this.honesty.setAttribute('aria-expanded', String(!this.honestyText.hidden));
    });
    top.append(back, name, reset, this.honesty, this.honestyText);
    this.explore.appendChild(top);

    this.companion = el('div', 'rw-companion');
    this.companion.setAttribute('aria-live', 'polite');
    this.companionText = el('p', 'rw-companion__text');
    this.companionChoices = el('div', 'rw-companion__choices');
    this.companion.append(this.companionText, this.companionChoices);
    this.explore.appendChild(this.companion);

    const nav = el('nav', 'rw-stops');
    nav.setAttribute('aria-label', 'Floor navigator');
    this.stopsTitle = el('div', 'rw-panel-title', 'Floors');
    nav.appendChild(this.stopsTitle);
    this.stops = el('div', 'rw-stops__list');
    this.stopInfo = el('p', 'rw-stops__info');
    nav.append(this.stops, this.stopInfo);
    this.explore.appendChild(nav);

    const bottom = el('div', 'rw-bottom');
    this.timeline = el('div', 'rw-timeline');
    this.timeline.setAttribute('aria-label', 'Construction timeline');
    this.timeline.hidden = true;
    this.views = el('div', 'rw-views');
    this.views.setAttribute('role', 'group');
    this.views.setAttribute('aria-label', 'How to show the landmark');
    for (const view of VIEWS) {
      const button = el('button', 'rw-view');
      button.type = 'button';
      button.dataset.view = view.id;
      button.title = view.hint;
      button.setAttribute('aria-pressed', 'false');
      button.append(icon(view.icon), el('span', '', view.label));
      button.addEventListener('click', () => {
        this.stopPlaying();
        if (view.id === 'construction') this.showConstruction();
        else scene.setView(view.id);
      });
      this.views.appendChild(button);
    }
    this.viewHint = el('div', 'rw-views__hint');
    this.viewHint.hidden = true;
    bottom.append(this.timeline, this.viewHint, this.views);
    this.explore.appendChild(bottom);

    this.partCard = el('aside', 'rw-part');
    this.partCard.hidden = true;
    this.partCard.setAttribute('aria-label', 'About this part');
    this.explore.appendChild(this.partCard);

    this.learn = el('aside', 'rw-learn');
    this.learn.setAttribute('aria-label', 'Learn');
    const tabs = el('div', 'rw-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [id, label] of [['lessons', 'Lessons'], ['missions', 'Missions'], ['facts', 'Facts'], ['parts', 'Parts']] as const) {
      const button = el('button', 'rw-tab', label);
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.addEventListener('click', () => {
        this.tab = id;
        this.learnKey = '';
        this.render();
      });
      this.tabs[id] = button;
      tabs.appendChild(button);
    }
    this.learnBody = el('div', 'rw-learn__body');
    this.learn.append(tabs, this.learnBody);
    this.explore.appendChild(this.learn);
    this.learnToggle = el('button', 'rw-btn rw-learn-toggle');
    this.learnToggle.type = 'button';
    this.learnToggle.addEventListener('click', () => {
      this.learnOpen = !this.learnOpen;
      this.render();
    });
    this.explore.appendChild(this.learnToggle);

    this.unavailable = el('div', 'rw-unavailable');
    this.unavailable.hidden = true;
    this.explore.appendChild(this.unavailable);
    root.appendChild(this.explore);

    this.toast = el('div', 'rw-toast');
    this.toast.hidden = true;
    this.toast.setAttribute('role', 'status');
    root.appendChild(this.toast);

    window.addEventListener('resize', this.onResize);
    this.disposers.push(() => window.removeEventListener('resize', this.onResize));
    window.addEventListener('keydown', this.onKeyDown);
    this.disposers.push(() => window.removeEventListener('keydown', this.onKeyDown));
    this.disposers.push(scene.onChange(() => this.render()));
    this.disposers.push(scene.onMission(({ mission }) => this.celebrate(mission.reward)));
    this.disposers.push(scene.onPartTapped(() => this.render()));
    return root;
  }

  update(_state: GameState): void {
    this.render();
  }

  protected onUnmount(): void {
    this.stopPlaying();
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.disposers.forEach((d) => d());
    this.disposers.length = 0;
    this.lessonState = null;
    this.libraryKey = '';
    this.landmarkKey = '';
    this.stopsKey = '';
    this.timelineKey = '';
    this.partKey = '';
    this.learnKey = '';
    this.companionKey = '';
  }

  // ------------------------------------------------------------ rendering

  private render(): void {
    if (!this.root) return;
    const snapshot = this.scene.snapshotState();
    const landmark = snapshot.landmark;
    this.library.hidden = landmark !== null;
    this.explore.hidden = landmark === null;
    if (!landmark) {
      this.stopPlaying();
      if (this.lessonState) this.closeLesson();
      this.renderLibrary();
      this.landmarkKey = '';
      if (this.libraryReturnId) {
        focusIfPresent(this.grid.querySelector(`[data-landmark-id="${this.libraryReturnId}"]`));
        this.libraryReturnId = null;
      }
      // Arriving from the Home screen (its card is gone): focus goes to the library's heading, not nowhere.
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) focusIfPresent(this.library.querySelector('.rw-library__title'));
      this.reportInsets();
      return;
    }
    if (landmark.id !== this.landmarkKey) {
      this.pendingFocus ??= '.rw-top__title';
      this.landmarkKey = landmark.id;
      this.titleLabel.textContent = landmark.name;
      this.placeLabel.textContent = landmark.place;
      this.lessonState = null;
      this.tab = 'lessons';
      // On a phone the learn panel is a bottom sheet: start with the landmark in full view.
      this.learnOpen = !window.matchMedia('(max-width: 760px)').matches;
      this.stopsKey = '';
      this.timelineKey = '';
      this.partKey = '';
      this.learnKey = '';
      this.companionKey = '';
    }
    const honesty = snapshot.model === 'fallback' ? `${landmark.disclaimer} ${FALLBACK_NOTE}` : landmark.disclaimer;
    if (this.honestyText.textContent !== honesty) {
      this.honestyText.textContent = honesty;
      this.honesty.title = honesty;
    }
    const ready = snapshot.model !== 'unavailable' && snapshot.model !== 'loading';
    this.explore.classList.toggle('rw-explore--learn', ready && this.learnOpen);
    this.explore.classList.toggle('rw-explore--timeline', ready && snapshot.view === 'construction');
    this.explore.classList.toggle('rw-explore--part', ready && snapshot.selectedPart !== null);
    this.unavailable.hidden = ready;
    this.unavailable.textContent = ready ? '' : snapshot.model === 'loading' ? `Getting the ${landmark.name} model ready...` : `${landmark.name}'s 3D model is not ready yet.`;
    this.unavailable.classList.toggle('rw-unavailable--loading', snapshot.model === 'loading');
    for (const part of [this.stops.parentElement!, this.views.parentElement!, this.learn, this.learnToggle]) part.hidden = !ready;
    if (!ready) {
      this.reportInsets();
      return;
    }

    this.renderStops(landmark, snapshot);
    this.renderViews(snapshot);
    this.renderTimeline(landmark, snapshot);
    this.renderPart(landmark, snapshot);
    this.renderLearn(landmark, snapshot);
    this.renderCompanion(landmark, snapshot);
    this.learnBody.querySelectorAll<HTMLElement>('[data-part-id]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.partId === snapshot.selectedPart)));
    this.renderInlinePart(landmark, snapshot);
    this.reportInsets();
    this.applyPendingFocus();
  }

  /** Moves focus where the last action asked for it (a lesson step, a lesson card, the landmark title). */
  private applyPendingFocus(): void {
    const selector = this.pendingFocus;
    if (!selector || !this.root) return;
    this.pendingFocus = null;
    focusIfPresent(this.root.querySelector(selector));
  }

  /** The chosen part's notes and sources, opened under its entry in the Parts list. */
  private renderInlinePart(landmark: RealLandmark, snapshot: RealWorldSnapshot): void {
    const list = this.learnBody.querySelector<HTMLElement>('.rw-parts');
    if (!list) return;
    const current = list.querySelector<HTMLElement>('.rw-part-inline');
    const partId = snapshot.selectedPart;
    if ((current?.dataset.partFor ?? null) === partId) return;
    current?.remove();
    list.querySelectorAll('[data-part-id]').forEach((button) => button.removeAttribute('aria-describedby'));
    const part = partId ? landmark.parts.find((p) => p.id === partId) : undefined;
    const button = part ? list.querySelector<HTMLElement>(`[data-part-id="${part.id}"]`) : null;
    if (!part || !button) return;
    const block = el('div', 'rw-part-inline');
    block.id = `rw-part-inline-${part.id}`;
    block.dataset.partFor = part.id;
    const hotspots = landmark.hotspots.filter((h) => h.partId === part.id);
    for (const h of hotspots) {
      const note = el('div', 'rw-part__hotspot');
      note.append(el('strong', '', h.title), el('p', '', h.text));
      block.appendChild(note);
    }
    const sources = el('details', 'rw-sources');
    sources.appendChild(el('summary', '', 'Sources (for grown-ups)'));
    for (const source of this.sourcesOf(landmark, [...part.sourceIds, ...hotspots.flatMap((h) => h.sourceIds)])) sources.appendChild(this.sourceLine(source));
    block.appendChild(sources);
    button.after(block);
    button.setAttribute('aria-describedby', block.id);
  }

  private restorePartFocus(): void {
    const target = this.partReturnFocus;
    this.partReturnFocus = null;
    if (target?.isConnected) focusIfPresent(target);
    else if (this.tab === 'parts') focusIfPresent(this.learnBody.querySelector('[data-part-id]'));
  }

  /**
   * The landmark's parts as a list: a way to pick a part without aiming at
   * it in 3D (keyboard, screen reader, or a cable too thin to tap). Picking
   * here is the same as tapping, missions included.
   */
  private partsList(landmark: RealLandmark): HTMLElement {
    const list = el('div', 'rw-parts');
    list.appendChild(el('p', 'rw-muted', 'Choose a part to find out what it does. Tapping it on the model works too.'));
    for (const part of landmark.parts) {
      const button = el('button', 'rw-lesson-card rw-part-option');
      button.type = 'button';
      button.dataset.partId = part.id;
      button.setAttribute('aria-pressed', 'false');
      button.append(el('strong', '', part.name), el('span', 'rw-lesson-card__summary', part.description));
      button.addEventListener('click', () => {
        this.partReturnFocus = button;
        this.scene.choosePart(part.id);
      });
      list.appendChild(button);
    }
    return list;
  }

  /** Escape steps back: lesson, then part card, then landmark, then RealWorld Explorer itself. */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented || !this.root || blocksEscape(event.target)) return;
    // A question dialog (confirmDialog) answers its own Escape.
    if (document.querySelector('.confirm')) return;
    const snapshot = this.scene.snapshotState();
    const step = realWorldBackStep({ lessonOpen: this.lessonState !== null, partOpen: snapshot.selectedPart !== null, landmarkOpen: snapshot.landmark !== null });
    event.preventDefault();
    if (step === 'close-lesson') {
      const id = this.lessonState?.lesson.id;
      this.closeLesson();
      this.pendingFocus = id ? `[data-lesson-id="${id}"]` : null;
      this.render();
    } else if (step === 'close-part') {
      this.scene.selectPart(null);
      this.restorePartFocus();
    } else if (step === 'close-landmark') {
      this.libraryReturnId = snapshot.landmark?.id ?? null;
      this.closeLesson();
      this.scene.open(null);
    } else {
      returnFocusTo('.mode-card--explorer');
      this.scene.exit();
    }
  };

  /**
   * Tell the 3D scene which parts of the screen the panels cover, so the
   * landmark stays in view: side columns (desktop floors and learn panels)
   * narrow it from the sides, full-width bands (the phone floors strip, the
   * timeline, bottom sheets) from the top or bottom.
   */
  private reportInsets(): void {
    const scene = this.scene;
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (!this.root || this.explore.hidden || width <= 0 || height <= 0) {
      scene.setScreenInsets({ left: 0, top: 0, right: 0, bottom: 0 });
      return;
    }
    const insets = { left: 0, top: 0, right: 0, bottom: 0 };
    const panels = [this.stops.parentElement, this.learn, this.partCard, this.timeline, this.views, this.companionText];
    for (const panel of panels) {
      if (!panel) continue;
      const rect = panel.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.width >= width * 0.6) {
        // A band across the screen.
        if (rect.top + rect.height / 2 < height / 2) insets.top = Math.max(insets.top, rect.bottom / height);
        else insets.bottom = Math.max(insets.bottom, 1 - rect.top / height);
      } else if (rect.height >= height * 0.35) {
        // A column down one side.
        if (rect.left + rect.width / 2 < width / 2) insets.left = Math.max(insets.left, rect.right / width);
        else insets.right = Math.max(insets.right, 1 - rect.left / width);
      } else if (rect.top + rect.height / 2 > height / 2) {
        // Something small low down (the view switcher, EAVARA's line).
        insets.bottom = Math.max(insets.bottom, 1 - rect.top / height);
      }
    }
    scene.setScreenInsets(insets);
  }

  private renderLibrary(): void {
    const scene = this.scene;
    const landmarks = scene.landmarks();
    const key = landmarks.map((l) => `${l.id}:${l.status}:${scene.progress.get(l.id).missions.length}`).join('|');
    if (key === this.libraryKey) return;
    this.libraryKey = key;
    this.grid.replaceChildren(
      ...landmarks.map((landmark) => {
        const card = el('article', `rw-card${landmark.status === 'available' ? '' : ' rw-card--soon'}`);
        card.setAttribute('role', 'listitem');
        const art = el('div', 'rw-card__art');
        art.appendChild(icon(LANDMARK_ICON[landmark.id] ?? 'globe'));
        const body = el('div', 'rw-card__body');
        body.append(el('h2', 'rw-card__title', landmark.name), el('div', 'rw-card__place', landmark.place), el('p', 'rw-card__tagline', landmark.tagline));
        const chips = el('div', 'rw-card__chips');
        for (const subject of landmark.subjects) chips.appendChild(el('span', 'rw-chip', subject));
        body.appendChild(chips);
        if (landmark.status === 'available') {
          const done = scene.progress.get(landmark.id).missions.filter((id) => landmark.missions.some((m) => m.id === id)).length;
          body.appendChild(el('div', 'rw-card__progress', `${done} of ${landmark.missions.length} missions done`));
          const open = el('button', 'rw-btn rw-btn--violet');
          open.type = 'button';
          open.append(icon('globe'), el('span', '', 'Explore'));
          open.dataset.landmarkId = landmark.id;
          open.addEventListener('click', () => scene.open(landmark.id));
          body.appendChild(open);
        } else {
          const soon = el('span', 'rw-soon', 'Coming soon');
          soon.setAttribute('aria-label', `${landmark.name}: coming soon`);
          body.appendChild(soon);
        }
        card.append(art, body);
        return card;
      }),
    );
  }

  private renderStops(landmark: RealLandmark, snapshot: RealWorldSnapshot): void {
    const key = `${landmark.id}:${snapshot.stopId}`;
    if (key === this.stopsKey) return;
    this.stopsKey = key;
    const scene = this.scene;
    const sorted = [...landmark.stops].sort((a, b) => b.heightM - a.heightM);
    // A bridge's stops are places along it, not floors.
    const places = landmark.stops.some((s) => s.focusM);
    this.stopsTitle.textContent = places ? 'Places' : 'Floors';
    this.stops.parentElement?.setAttribute('aria-label', places ? 'Places to visit' : 'Floor navigator');
    this.stops.replaceChildren(
      ...sorted.map((stop) => {
        const button = el('button', 'rw-stop');
        button.type = 'button';
        if (stop.id === snapshot.stopId) button.setAttribute('aria-current', 'true');
        const height = stop.heightLabel ?? (stop.heightM < 0 ? 'Below ground' : `${Math.round(stop.heightM)} m`);
        button.append(el('span', 'rw-stop__name', stop.name), el('span', 'rw-stop__height', height));
        if (stop.reconstructed) button.appendChild(el('span', 'rw-stop__tag', 'learning view'));
        button.addEventListener('click', () => scene.goToStop(stop.id));
        return button;
      }),
    );
    const current = landmark.stops.find((s) => s.id === snapshot.stopId);
    this.stopInfo.textContent = current ? current.description : places ? 'Pick a place to travel there.' : 'Pick a floor to travel there.';
    const button = this.stops.querySelector<HTMLElement>('[aria-current="true"]');
    if (button) {
      const list = this.stops;
      if (list.scrollWidth > list.clientWidth) list.scrollLeft = button.offsetLeft - (list.clientWidth - button.offsetWidth) / 2;
      if (button.offsetTop < list.scrollTop || button.offsetTop + button.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = button.offsetTop - 8;
    }
  }

  private renderViews(snapshot: RealWorldSnapshot): void {
    this.views.querySelectorAll<HTMLButtonElement>('.rw-view').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.view === snapshot.view));
    });
    this.viewHint.hidden = !(snapshot.view === 'inspect' && !snapshot.selectedPart);
    this.viewHint.textContent = 'Tap a part of the model to inspect it.';
    if (snapshot.view !== 'construction') this.stopPlaying();
  }

  private renderTimeline(landmark: RealLandmark, snapshot: RealWorldSnapshot): void {
    const show = snapshot.view === 'construction' && landmark.timeline.length > 0;
    this.timeline.hidden = !show;
    if (!show) return;
    const key = `${landmark.id}:${snapshot.timelineIndex}:${this.playTimer !== null}`;
    if (key === this.timelineKey) return;
    this.timelineKey = key;
    const scene = this.scene;
    const index = snapshot.timelineIndex ?? 0;
    const entry = landmark.timeline[index];
    const stage = landmark.stages.find((s) => s.id === entry.stage);
    const strip = el('div', 'rw-timeline__strip');
    strip.setAttribute('role', 'list');
    landmark.timeline.forEach((item, i) => {
      const dot = el('button', 'rw-tl-dot');
      dot.type = 'button';
      dot.setAttribute('role', 'listitem');
      dot.title = `${item.dateLabel}: ${item.title}`;
      dot.setAttribute('aria-label', `${item.dateLabel}: ${item.title}`);
      if (i === index) dot.setAttribute('aria-current', 'true');
      if (i < index) dot.classList.add('rw-tl-dot--past');
      dot.addEventListener('click', () => {
        this.stopPlaying();
        scene.showTimelineEntry(i);
      });
      strip.appendChild(dot);
    });
    const controls = el('div', 'rw-timeline__controls');
    const prev = this.round('back', 'Previous step', () => {
      this.stopPlaying();
      scene.showTimelineEntry(Math.max(0, index - 1));
    });
    prev.disabled = index === 0;
    const play = this.round(this.playTimer ? 'pause' : 'play', this.playTimer ? 'Pause' : 'Play the timeline', () => (this.playTimer ? this.stopPlaying() : this.startPlaying(landmark)));
    const next = this.round('forward', 'Next step', () => {
      this.stopPlaying();
      scene.showTimelineEntry(Math.min(landmark.timeline.length - 1, index + 1));
    });
    next.disabled = index >= landmark.timeline.length - 1;
    controls.append(prev, play, next);
    const detail = el('div', 'rw-timeline__detail');
    detail.append(el('div', 'rw-timeline__date', `${entry.dateLabel}${stage ? ` · ${stage.name}` : ''}`), el('strong', 'rw-timeline__title', entry.title), el('p', 'rw-timeline__text', entry.text));
    if (entry.note) detail.appendChild(el('p', 'rw-note', `Sources differ: ${entry.note}`));
    detail.appendChild(el('p', 'rw-sources-line', `Source: ${this.publishers(landmark, entry.sourceIds)}`));
    this.timeline.replaceChildren(strip, controls, detail);
  }

  private renderPart(landmark: RealLandmark, snapshot: RealWorldSnapshot): void {
    const partId = snapshot.selectedPart;
    // On the Parts tab the details open inside the list (renderInlinePart), so the floating card never covers it.
    const inline = this.tab === 'parts' && this.learnOpen && !this.lessonState;
    const key = `${landmark.id}:${partId}:${inline}`;
    if (key === this.partKey) return;
    this.partKey = key;
    const part = partId ? landmark.parts.find((p) => p.id === partId) : undefined;
    this.partCard.hidden = !part || inline;
    if (!part || inline) return;
    const close = el('button', 'st-round st-round--tiny rw-part__close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.appendChild(icon('close'));
    close.addEventListener('click', () => {
      this.scene.selectPart(null);
      this.restorePartFocus();
    });
    const hotspots = landmark.hotspots.filter((h) => h.partId === part.id);
    const sources = el('details', 'rw-sources');
    sources.appendChild(el('summary', '', 'Sources (for grown-ups)'));
    for (const source of this.sourcesOf(landmark, [...part.sourceIds, ...hotspots.flatMap((h) => h.sourceIds)])) sources.appendChild(this.sourceLine(source));
    this.partCard.replaceChildren(
      close,
      el('div', 'rw-part__eyebrow', 'Structural part'),
      el('h3', 'rw-part__title', part.name),
      el('p', 'rw-part__text', part.description),
      ...hotspots.map((h) => {
        const block = el('div', 'rw-part__hotspot');
        block.append(el('strong', '', h.title), el('p', '', h.text));
        return block;
      }),
      sources,
    );
  }

  private renderLearn(landmark: RealLandmark, snapshot: RealWorldSnapshot): void {
    this.learn.classList.toggle('rw-learn--closed', !this.learnOpen);
    this.learnToggle.replaceChildren(icon(this.learnOpen ? 'close' : 'star'), el('span', '', this.learnOpen ? 'Hide' : 'Learn'));
    this.learnToggle.setAttribute('aria-expanded', String(this.learnOpen));
    for (const [id, button] of Object.entries(this.tabs)) button.setAttribute('aria-selected', String(id === this.tab && !this.lessonState));
    const progress = snapshot.progress;
    const lesson = this.lessonState;
    const key = lesson
      ? `lesson:${lesson.lesson.id}:${lesson.step}:${lesson.answered}:${lesson.finished}`
      : `${this.tab}:${progress?.missions.join(',')}:${progress?.lessons.join(',')}:${landmark.missions.map((m) => this.scene.sequenceProgress(m.id)).join(',')}`;
    if (key === this.learnKey) return;
    this.learnKey = key;
    if (lesson) {
      this.learnBody.replaceChildren(this.lessonView(landmark, lesson));
      return;
    }
    if (this.tab === 'lessons') {
      this.learnBody.replaceChildren(
        ...landmark.lessons.map((item) => {
          const card = el('button', 'rw-lesson-card');
          card.type = 'button';
          const done = progress?.lessons.includes(item.id);
          card.append(el('span', 'rw-lesson-card__subject', `${item.subject}${done ? ' · done' : ''}`), el('strong', '', item.title), el('span', 'rw-lesson-card__summary', item.summary));
          card.dataset.lessonId = item.id;
          card.addEventListener('click', () => this.openLesson(item));
          return card;
        }),
      );
    } else if (this.tab === 'parts') {
      this.learnBody.replaceChildren(this.partsList(landmark));
    } else if (this.tab === 'missions') {
      this.learnBody.replaceChildren(
        el('p', 'rw-muted', 'Missions are optional. Try them in any order.'),
        ...landmark.missions.map((mission) => {
          const done = progress?.missions.includes(mission.id) ?? false;
          const row = el('div', `rw-mission${done ? ' rw-mission--done' : ''}`);
          row.appendChild(icon(done ? 'check' : 'target'));
          const text = el('div', 'rw-mission__text');
          text.append(el('strong', '', mission.title), el('span', '', mission.description));
          if (mission.kind === 'tap-sequence' && mission.sequence && !done) {
            const stepsDone = this.scene.sequenceProgress(mission.id);
            if (stepsDone > 0) text.appendChild(el('span', 'rw-mission__step', `Step ${stepsDone} of ${mission.sequence.length} found`));
          }
          if (done) text.appendChild(el('span', 'rw-mission__reward', mission.reward));
          row.appendChild(text);
          return row;
        }),
      );
    } else {
      this.learnBody.replaceChildren(
        ...landmark.facts.map((fact) => {
          const card = el('div', 'rw-fact');
          card.append(el('span', 'rw-fact__label', fact.label), el('strong', 'rw-fact__value', fact.value));
          if (fact.note) card.appendChild(el('p', 'rw-note', fact.note));
          card.appendChild(el('p', 'rw-sources-line', `Source: ${this.publishers(landmark, fact.sourceIds)}`));
          return card;
        }),
        el('p', 'rw-muted', 'For grown-ups: every fact comes from the sources named under it. Where sources give different numbers, the fact says so.'),
      );
    }
  }

  // ------------------------------------------------------------ lessons

  private openLesson(lesson: Lesson): void {
    const scene = this.scene;
    // Lessons point at the structure (the core inside the glass, the raft and piles underground): show it.
    this.stopPlaying();
    const view = scene.snapshotState().view;
    if (view === 'complete' || view === 'construction') scene.setView('cutaway');
    const presets = FOUNDATION_SIMULATION.presets;
    this.lessonState = {
      lesson,
      step: 0,
      floors: presets.lowRise.floors,
      area: presets.lowRise.area,
      triedLow: false,
      triedTall: false,
      wind: 0.3,
      braced: false,
      push: 0,
      pushedSquare: false,
      pushedBraced: false,
      forcesPart: null,
      loadAt: 0.5,
      flatCable: false,
      triedNormal: false,
      triedFlat: false,
      answered: null,
      finished: false,
    };
    this.learnOpen = true;
    this.applyStep();
    this.learnKey = '';
    this.pendingFocus = '.rw-player__lesson';
    this.render();
    this.learnBody.scrollTop = 0;
  }

  private closeLesson(): void {
    const scene = this.scene;
    if (this.lessonState) {
      scene.setLoadPath(false);
      scene.setWind(null);
      scene.setForces(null);
      scene.setLoadPoint(null);
      scene.setHighlight(null);
    }
    this.lessonState = null;
    this.learnKey = '';
  }

  /** What the 3D scene shows for the current step: highlighted parts, a stop, the load path or wind. */
  private applyStep(): void {
    const state = this.lessonState;
    if (!state) return;
    const scene = this.scene;
    const step = state.lesson.steps[state.step];
    scene.setHighlight(step.focusPartIds ?? null);
    if (step.stopId) scene.goToStop(step.stopId);
    const foundation = state.lesson.steps.some((s) => s.simulation === 'foundation-pressure');
    const wind = state.lesson.steps.some((s) => s.simulation === 'wind');
    scene.setLoadPath(foundation && step.kind !== 'check');
    if (wind) scene.setWind(step.kind === 'check' ? null : step.simulation === 'wind' ? state.wind : 0.4);
    // Bridge lessons: the chosen part's force arrows while picking parts; the load (and its path) until the quiz.
    if (state.lesson.steps.some((s) => s.simulation === 'bridge-forces')) {
      const shown = step.simulation === 'bridge-forces' ? state.forcesPart : null;
      scene.setForces(shown);
      if (shown) scene.setHighlight([shown]);
    }
    if (state.lesson.steps.some((s) => s.simulation === 'suspension-load')) {
      scene.setLoadPoint(step.kind === 'check' ? null : state.loadAt, step.simulation === 'suspension-load' && state.flatCable ? 'flat' : 'normal');
    }
  }

  private goToStep(step: number): void {
    const state = this.lessonState;
    if (!state) return;
    state.step = Math.max(0, Math.min(state.lesson.steps.length - 1, step));
    state.answered = null;
    this.applyStep();
    this.pendingFocus = '.rw-player__title';
    this.render();
    this.learnBody.scrollTop = 0;
  }

  private lessonView(landmark: RealLandmark, state: LessonState): HTMLElement {
    const scene = this.scene;
    const view = el('div', 'rw-player');
    view.setAttribute('role', 'dialog');
    view.setAttribute('aria-label', state.lesson.title);
    const head = el('div', 'rw-player__head');
    const close = el('button', 'rw-btn rw-btn--quiet');
    close.type = 'button';
    close.append(icon('back'), el('span', '', 'All lessons'));
    close.addEventListener('click', () => {
      this.closeLesson();
      this.pendingFocus = `[data-lesson-id="${state.lesson.id}"]`;
      this.render();
    });
    head.append(close, el('span', 'rw-player__count', `${state.step + 1} / ${state.lesson.steps.length}`));
    view.appendChild(head);
    const lessonTitle = el('h3', 'rw-player__lesson', state.lesson.title);
    lessonTitle.tabIndex = -1;
    view.appendChild(lessonTitle);

    if (state.finished) {
      const done = el('p', 'rw-player__done', 'Lesson complete - well done! You can try the missions or another lesson.');
      done.tabIndex = -1;
      view.append(done, el('p', 'rw-caveat', state.lesson.caveat));
      return view;
    }
    const step = state.lesson.steps[state.step];
    view.appendChild(el('div', `rw-step-kind rw-step-kind--${step.kind}`, STEP_LABEL[step.kind]));
    const stepTitle = el('strong', 'rw-player__title', step.title);
    stepTitle.tabIndex = -1;
    view.appendChild(stepTitle);
    view.appendChild(el('p', 'rw-player__text', step.text));
    if (step.simulation === 'foundation-pressure') view.appendChild(this.foundationSimulation(state));
    if (step.simulation === 'wind') view.appendChild(this.windSimulation(state));
    if (step.simulation === 'triangulation') view.appendChild(this.triangulationSimulation(state));
    if (step.simulation === 'bridge-forces') view.appendChild(this.bridgeForcesSimulation(landmark, state));
    if (step.simulation === 'suspension-load') view.appendChild(this.suspensionLoadSimulation(state));
    if (step.kind === 'check' && step.quizId) view.appendChild(this.quizView(landmark, state, step.quizId));
    if (step.simulation || step.kind === 'explain') view.appendChild(el('p', 'rw-caveat', state.lesson.caveat));

    const nav = el('div', 'rw-player__nav');
    const back = el('button', 'rw-btn');
    back.type = 'button';
    back.disabled = state.step === 0;
    back.append(icon('back'), el('span', '', 'Back'));
    back.addEventListener('click', () => this.goToStep(state.step - 1));
    const last = state.step === state.lesson.steps.length - 1;
    const next = el('button', 'rw-btn rw-btn--violet');
    next.type = 'button';
    next.append(el('span', '', last ? 'Finish' : 'Next'), icon(last ? 'check' : 'forward'));
    next.addEventListener('click', () => {
      if (last) {
        state.finished = true;
        scene.completeLesson(state.lesson.id);
        scene.setLoadPath(false);
        scene.setWind(null);
        scene.setForces(null);
        scene.setLoadPoint(null);
        this.pendingFocus = '.rw-player__done';
        this.render();
      } else this.goToStep(state.step + 1);
    });
    nav.append(back, next);
    view.appendChild(nav);
    return view;
  }

  /** P = F / A with pretend weight blocks: floors and foundation area sliders, live meters, two quick comparisons. */
  private foundationSimulation(state: LessonState): HTMLElement {
    const sim = el('div', 'rw-sim');
    sim.appendChild(el('div', 'rw-sim__label', 'Hypothetical building - a simplified simulation, not the real landmark\u2019s figures'));
    const floors = this.slider('Floors', state.floors, FOUNDATION_SIMULATION.minFloors, FOUNDATION_SIMULATION.maxFloors, 1, (v) => {
      state.floors = v;
      this.checkCompared(state);
      refresh();
    });
    const area = this.slider('Foundation area (area squares)', state.area, FOUNDATION_SIMULATION.minArea, FOUNDATION_SIMULATION.maxArea, 1, (v) => {
      state.area = v;
      refresh();
    });
    const force = this.meter('Force: the total weight pushing down', FOUNDATION_SIMULATION.maxFloors);
    const pressure = this.meter('Average pressure = force \u00f7 area', 25);
    const insight = el('p', 'rw-sim__insight', 'Same foundation area, many more floors: the force is bigger, so the average pressure is bigger. Try a bigger foundation area for the tall tower!');
    const refresh = () => {
      const result = foundationScenario(state.floors, state.area);
      force.set(result.load, `${result.load} weight blocks`);
      const finite = Number.isFinite(result.pressure);
      pressure.set(finite ? result.pressure : 0, `${finite ? result.pressure.toFixed(1) : '-'} blocks per area square - ${PRESSURE_WORDS[result.level]}`, result.level);
      insight.hidden = !(state.triedLow && state.triedTall);
    };
    const preset = (which: 'lowRise' | 'tall') => {
      const chosen = FOUNDATION_SIMULATION.presets[which];
      state.floors = chosen.floors;
      state.area = chosen.area;
      if (which === 'lowRise') state.triedLow = true;
      else state.triedTall = true;
      floors.set(chosen.floors);
      area.set(chosen.area);
      this.checkCompared(state);
      refresh();
    };
    const presets = el('div', 'rw-sim__presets');
    const low = el('button', 'rw-chip rw-chip--button', `Low-rise (${FOUNDATION_SIMULATION.presets.lowRise.floors} floors)`);
    low.type = 'button';
    low.addEventListener('click', () => preset('lowRise'));
    const tall = el('button', 'rw-chip rw-chip--button', `Tall tower (${FOUNDATION_SIMULATION.presets.tall.floors} floors)`);
    tall.type = 'button';
    tall.addEventListener('click', () => preset('tall'));
    presets.append(low, tall);
    sim.append(floors.row, area.row, force.row, pressure.row, presets, insight);
    refresh();
    return sim;
  }

  /** Remember when the child has tried both a low and a tall building (either way) - the "compare" mission. */
  private checkCompared(state: LessonState): void {
    if (state.floors <= 10) state.triedLow = true;
    if (state.floors >= 100) state.triedTall = true;
    if (state.triedLow && state.triedTall) this.scene.compared(state.lesson.id);
  }

  /** Wind strength slider: the push grows with the square of the speed; the sway is exaggerated. */
  private windSimulation(state: LessonState): HTMLElement {
    const sim = el('div', 'rw-sim');
    const word = el('div', 'rw-sim__wind-word');
    // Relative to a gentle breeze (slider at 25%): twice the speed, four times the push.
    const push = this.meter('Sideways push (compared with a gentle breeze)', 16);
    const refresh = () => {
      const band = [...WIND_LABELS].reverse().find((b) => state.wind >= b.from) ?? WIND_LABELS[0];
      word.textContent = band.text;
      const times = relativeWindPush(state.wind, 0.25);
      push.set(times, `${times.toFixed(1)} x`, times >= 9 ? 'high' : times >= 3 ? 'medium' : 'low');
    };
    const strength = this.slider('Wind strength', Math.round(state.wind * 100), 0, 100, 1, (v) => {
      state.wind = v / 100;
      this.scene.setWind(state.wind);
      refresh();
    });
    sim.append(strength.row, word, push.row, el('p', 'rw-sim__insight', 'Twice as fast pushes about four times as hard. The sway you see is exaggerated so you can notice it.'));
    refresh();
    return sim;
  }

  /**
   * Pin-jointed frames: push the top sideways. Without a diagonal the frame
   * is a mechanism (the truss model finds no stiffness at all), so it folds
   * over while every bar keeps its length; with the diagonal the model's real
   * (tiny) movement is drawn bigger, and each bar shows whether it is pulled
   * or squashed, with the diagonal's force in multiples of the push.
   */
  private triangulationSimulation(state: LessonState): HTMLElement {
    const sim = el('div', 'rw-sim rw-truss');
    sim.appendChild(el('div', 'rw-sim__label', 'A pretend frame of bars joined with pins - a simplified simulation'));
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 240 175');
    svg.setAttribute('class', 'rw-truss__svg');
    svg.setAttribute('role', 'img');
    const make = <K extends keyof SVGElementTagNameMap>(tag: K, className: string): SVGElementTagNameMap[K] => {
      const node = document.createElementNS(SVG_NS, tag);
      node.setAttribute('class', className);
      svg.appendChild(node);
      return node;
    };
    const toSvg = (x: number, y: number) => ({ x: 70 + x * 100, y: 152 - y * 100 });
    const ground = make('line', 'rw-truss__ground');
    ground.setAttribute('x1', '20');
    ground.setAttribute('x2', '220');
    ground.setAttribute('y1', '160');
    ground.setAttribute('y2', '160');
    for (const x of [0, 1]) {
      const at = toSvg(x, 0);
      make('polygon', 'rw-truss__support').setAttribute('points', `${at.x},${at.y} ${at.x - 9},${at.y + 8} ${at.x + 9},${at.y + 8}`);
    }
    const frame = lessonFrame(true);
    const bars = frame.bars.map(() => make('line', 'rw-truss__bar'));
    const pushLine = make('line', 'rw-truss__push');
    const pushHead = make('polygon', 'rw-truss__push-head');
    const pins = frame.nodes.map(() => make('circle', 'rw-truss__pin'));
    pins.forEach((pin) => pin.setAttribute('r', '5'));
    sim.appendChild(svg);

    const legend = el('div', 'rw-truss__legend');
    legend.append(el('span', 'rw-truss__key rw-truss__key--tension', 'pulled (tension)'), el('span', 'rw-truss__key rw-truss__key--compression', 'squashed (compression)'));
    const caption = el('p', 'rw-sim__insight');
    caption.setAttribute('aria-live', 'polite');
    const note = el('p', 'rw-truss__note');
    const toggle = el('button', 'rw-chip rw-chip--button');
    toggle.type = 'button';
    const push = this.slider('Push (left or right)', 0, -100, 100, 1, (v) => {
      state.push = v / 100;
      refresh();
    });
    toggle.addEventListener('click', () => {
      state.braced = !state.braced;
      refresh();
    });

    // Drawn positions (unit frame coordinates) glide to their targets.
    let shown = frame.nodes.map((n) => ({ x: n.x, y: n.y }));
    let animation = 0;
    const draw = (points: Array<{ x: number; y: number }>, forces: number[] | null) => {
      frame.bars.forEach((bar, i) => {
        const line = bars[i];
        const a = toSvg(points[bar.a].x, points[bar.a].y);
        const b = toSvg(points[bar.b].x, points[bar.b].y);
        line.setAttribute('x1', a.x.toFixed(1));
        line.setAttribute('y1', a.y.toFixed(1));
        line.setAttribute('x2', b.x.toFixed(1));
        line.setAttribute('y2', b.y.toFixed(1));
        const force = forces?.[i] ?? 0;
        const working = forces !== null && Math.abs(force) > 0.05 * Math.max(Math.abs(state.push), 1e-9);
        line.setAttribute('class', `rw-truss__bar${working ? (force > 0 ? ' rw-truss__bar--tension' : ' rw-truss__bar--compression') : ''}`);
        line.style.display = i === 4 && !state.braced ? 'none' : '';
      });
      points.forEach((point, i) => {
        const at = toSvg(point.x, point.y);
        pins[i].setAttribute('cx', at.x.toFixed(1));
        pins[i].setAttribute('cy', at.y.toFixed(1));
      });
      // The push arrow comes in from outside: at the top left when pushing right, at the top right when pushing left.
      const p = state.push;
      const visible = Math.abs(p) >= PUSH_DEAD_ZONE;
      pushLine.style.display = visible ? '' : 'none';
      pushHead.style.display = visible ? '' : 'none';
      if (visible) {
        const node = p > 0 ? points[3] : points[2];
        const tip = toSvg(node.x, node.y);
        const dir = Math.sign(p);
        const tipX = tip.x - dir * 7;
        const length = 14 + 40 * Math.abs(p);
        pushLine.setAttribute('x1', (tipX - dir * length).toFixed(1));
        pushLine.setAttribute('x2', (tipX - dir * 6).toFixed(1));
        pushLine.setAttribute('y1', tip.y.toFixed(1));
        pushLine.setAttribute('y2', tip.y.toFixed(1));
        pushHead.setAttribute('points', `${tipX},${tip.y} ${tipX - dir * 9},${tip.y - 6} ${tipX - dir * 9},${tip.y + 6}`);
      }
    };
    const refresh = () => {
      const p = state.push;
      const pushing = Math.abs(p) >= PUSH_DEAD_ZONE;
      // A real push counts for the frame on show (also when the diagonal goes in or out while pushing).
      if (Math.abs(p) >= PUSH_COUNTS) {
        if (state.braced) state.pushedBraced = true;
        else state.pushedSquare = true;
        if (state.pushedSquare && state.pushedBraced) this.scene.compared(state.lesson.id);
      }
      toggle.textContent = state.braced ? 'Take the diagonal out' : 'Add a diagonal bar';
      let target: Array<{ x: number; y: number }>;
      let forces: number[] | null = null;
      if (!state.braced) {
        // A mechanism: the posts turn about their pins, every bar keeps its length.
        const angle = pushing ? Math.sign(p) * FOLD_ANGLE : 0;
        const dx = Math.sin(angle);
        const dy = Math.cos(angle);
        target = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1 + dx, y: dy }, { x: dx, y: dy }];
        caption.textContent = pushing
          ? 'No triangle: the square folds over. No bar got longer or shorter, so nothing can stop it - it would keep folding.'
          : 'Push the top of the frame with the slider.';
        note.textContent = '';
        legend.hidden = true;
      } else {
        const loadNode = p > 0 ? 3 : 2;
        const result = pushing ? solveTruss(frame.nodes, frame.bars, [{ node: loadNode, fx: p, fy: 0 }], FRAME_STIFFNESS) : null;
        target = frame.nodes.map((n, i) => ({
          x: n.x + (result ? result.displacements[i].x * BRACED_EXAGGERATION : 0),
          y: n.y + (result ? result.displacements[i].y * BRACED_EXAGGERATION : 0),
        }));
        forces = result ? result.forces : null;
        if (result) {
          const diagonal = result.forces[4];
          const times = Math.abs(diagonal / p);
          caption.textContent = `The frame holds its shape. The diagonal is ${diagonal > 0 ? 'pulled (tension)' : 'squashed (compression)'}, about ${times.toFixed(1)} times as hard as your push.${state.pushedSquare ? '' : ' Now try the frame without the diagonal.'}`;
          note.textContent = `Movements of this frame are drawn ${BRACED_EXAGGERATION} times bigger so you can see them.`;
        } else {
          caption.textContent = 'Now push the frame with the diagonal.';
          note.textContent = '';
        }
        legend.hidden = !result;
      }
      svg.setAttribute('aria-label', caption.textContent ?? '');
      cancelAnimationFrame(animation);
      const from = shown.map((point) => ({ ...point }));
      const reduce = motion.reduced;
      const start = performance.now();
      const step = (now: number) => {
        const t = reduce ? 1 : Math.min(1, (now - start) / 350);
        const ease = 1 - (1 - t) * (1 - t);
        shown = from.map((point, i) => ({ x: point.x + (target[i].x - point.x) * ease, y: point.y + (target[i].y - point.y) * ease }));
        draw(shown, forces);
        if (t < 1 && svg.isConnected) animation = requestAnimationFrame(step);
      };
      if (reduce) step(start);
      else animation = requestAnimationFrame(step);
      draw(shown, forces);
    };
    sim.append(push.row, toggle, caption, legend, note);
    refresh();
    return sim;
  }

  /** Bridge forces lesson: pick a part and the model shows simplified force arrows on it (blue = pulled, orange = squeezed). */
  private bridgeForcesSimulation(landmark: RealLandmark, state: LessonState): HTMLElement {
    const scene = this.scene;
    const sim = el('div', 'rw-sim rw-forces');
    sim.appendChild(el('div', 'rw-sim__label', 'Simplified force arrows on the learning model - not to scale'));
    const parts = landmark.parts.filter((part) => BRIDGE_FORCE_WORDS[part.id]);
    const caption = el('p', 'rw-sim__insight');
    caption.setAttribute('aria-live', 'polite');
    const legend = el('div', 'rw-truss__legend');
    legend.append(
      el('span', 'rw-truss__key rw-truss__key--tension', 'pulled (tension)'),
      el('span', 'rw-truss__key rw-truss__key--compression', 'squeezed (compression)'),
      el('span', 'rw-truss__key rw-truss__key--weight', 'weight'),
    );
    const chips = parts.map((part) => {
      const chip = el('button', 'rw-chip rw-chip--button', part.name);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        state.forcesPart = part.id;
        scene.setHighlight([part.id]);
        scene.setForces(part.id);
        refresh();
      });
      return chip;
    });
    const refresh = () => {
      chips.forEach((chip, i) => chip.setAttribute('aria-pressed', String(parts[i].id === state.forcesPart)));
      const words = state.forcesPart ? BRIDGE_FORCE_WORDS[state.forcesPart] : undefined;
      caption.textContent = words ? words.text : 'Pick a part to see its arrows.';
      legend.hidden = !words;
    };
    const row = el('div', 'rw-sim__presets');
    row.append(...chips);
    sim.append(row, caption, legend);
    refresh();
    return sim;
  }

  /**
   * Bridge load lesson: slide a load along the main span. The pretend cable
   * (two straight pieces meeting at the load, solved by cableUnderLoad)
   * shows how hard the cable pulls and how the towers share the load; the
   * pretend flatter cable pulls harder. The 3D model shows the same load
   * moving with its load path.
   */
  private suspensionLoadSimulation(state: LessonState): HTMLElement {
    const scene = this.scene;
    const sim = el('div', 'rw-sim rw-cable');
    sim.appendChild(el('div', 'rw-sim__label', 'A pretend cable holding one load - a simplified model, not the real bridge\u2019s numbers'));
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 240 150');
    svg.setAttribute('class', 'rw-truss__svg rw-cable__svg');
    svg.setAttribute('role', 'img');
    const make = <K extends keyof SVGElementTagNameMap>(tag: K, className: string): SVGElementTagNameMap[K] => {
      const node = document.createElementNS(SVG_NS, tag);
      node.setAttribute('class', className);
      svg.appendChild(node);
      return node;
    };
    const set = (node: SVGElement, attributes: Record<string, number | string>) => {
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, typeof value === 'number' ? value.toFixed(1) : value);
    };
    // Towers at x 30 and 210 (a span of 180), tops at y 34, the deck at y 112, the water below.
    const left = 30;
    const span = 180;
    const top = 34;
    const deck = 112;
    set(make('rect', 'rw-cable__water'), { x: 0, y: 128, width: 240, height: 22 });
    for (const x of [left, left + span]) set(make('rect', 'rw-cable__tower'), { x: x - 4, y: top - 6, width: 8, height: 128 - top + 6 });
    set(make('line', 'rw-cable__deck'), { x1: 6, x2: 234, y1: deck, y2: deck });
    const leftHalf = make('line', 'rw-truss__bar rw-truss__bar--tension rw-cable__half');
    const rightHalf = make('line', 'rw-truss__bar rw-truss__bar--tension rw-cable__half');
    const hanger = make('line', 'rw-cable__hanger');
    const load = make('rect', 'rw-cable__load');
    const towerArrows = [0, 1].map(() => ({ line: make('line', 'rw-cable__push'), head: make('polygon', 'rw-cable__push-head') }));
    sim.appendChild(svg);

    const slider = this.slider('Where is the load? (San Francisco tower to Marin tower)', Math.round(state.loadAt * 100), 5, 95, 1, (v) => {
      state.loadAt = v / 100;
      if (state.flatCable) state.triedFlat = true;
      else state.triedNormal = true;
      show();
    });
    const toggle = el('button', 'rw-chip rw-chip--button');
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      state.flatCable = !state.flatCable;
      if (state.flatCable) state.triedFlat = true;
      else state.triedNormal = true;
      show();
    });
    const pull = this.meter('How hard the cable pulls (times the load)', 5);
    const shares = el('p', 'rw-cable__shares');
    const caption = el('p', 'rw-sim__insight');
    caption.setAttribute('aria-live', 'polite');

    const draw = (result: CableLoadResult, sag: number) => {
      const x = left + span * result.position;
      const y = top + span * 4 * sag * result.position * (1 - result.position);
      set(leftHalf, { x1: left, y1: top, x2: x, y2: y });
      set(rightHalf, { x1: left + span, y1: top, x2: x, y2: y });
      leftHalf.style.strokeWidth = (2 + 1.2 * result.leftPull).toFixed(1);
      rightHalf.style.strokeWidth = (2 + 1.2 * result.rightPull).toFixed(1);
      set(hanger, { x1: x, y1: y, x2: x, y2: deck - 9 });
      set(load, { x: x - 9, y: deck - 10, width: 18, height: 10 });
      [result.leftTower, result.rightTower].forEach((share, i) => {
        const towerX = left + span * i;
        const length = 8 + 34 * share;
        const tipY = top - 8;
        set(towerArrows[i].line, { x1: towerX, x2: towerX, y1: tipY - length, y2: tipY - 5 });
        set(towerArrows[i].head, { points: `${towerX},${tipY} ${towerX - 5},${tipY - 7} ${towerX + 5},${tipY - 7}` });
      });
    };
    const show = () => {
      const sag = state.flatCable ? GOLDEN_GATE_SAG_RATIO.flat : GOLDEN_GATE_SAG_RATIO.normal;
      const result = cableUnderLoad(state.loadAt, sag);
      const normal = cableUnderLoad(state.loadAt, GOLDEN_GATE_SAG_RATIO.normal);
      scene.setLoadPoint(state.loadAt, state.flatCable ? 'flat' : 'normal');
      if (state.triedNormal && state.triedFlat) scene.compared(state.lesson.id);
      toggle.textContent = state.flatCable ? 'Back to the normal cable' : 'Try a flatter cable (pretend)';
      if (!result || !normal) return;
      draw(result, sag);
      const most = Math.max(result.leftPull, result.rightPull);
      pull.set(most, `${most.toFixed(1)} x the load`, most >= 3.5 ? 'high' : most >= 2.6 ? 'medium' : 'low');
      shares.textContent = `San Francisco tower carries ${Math.round(result.leftTower * 100)}% of the load, Marin tower ${Math.round(result.rightTower * 100)}%.`;
      const nearer = result.leftTower > 0.55 ? 'San Francisco' : result.rightTower > 0.55 ? 'Marin' : null;
      const sentences = [
        state.flatCable
          ? `The flatter cable pulls about ${most.toFixed(1)} times as hard as the load weighs - about ${(most / Math.max(normal.leftPull, normal.rightPull)).toFixed(1)} times as hard as the normal cable.`
          : `The cable pulls about ${most.toFixed(1)} times as hard as the load weighs.`,
        nearer ? `The load is nearer the ${nearer} tower, so that tower carries more of it.` : '',
        !state.triedFlat ? 'Now try the flatter cable.' : !state.triedNormal ? 'Now move the load with the normal cable.' : '',
      ];
      caption.textContent = sentences.filter(Boolean).join(' ');
      svg.setAttribute('aria-label', `${caption.textContent} ${shares.textContent}`);
    };
    sim.append(slider.row, toggle, pull.row, shares, caption);
    show();
    return sim;
  }

  private quizView(landmark: RealLandmark, state: LessonState, quizId: string): HTMLElement {
    const question = landmark.quiz.find((q) => q.id === quizId);
    const box = el('div', 'rw-quiz');
    if (!question) return box;
    box.appendChild(el('strong', 'rw-quiz__question', question.question));
    const options = el('div', 'rw-quiz__options');
    question.options.forEach((option, index) => {
      const button = el('button', 'rw-quiz__option', option);
      button.type = 'button';
      if (state.answered !== null) {
        button.disabled = true;
        if (index === question.correctIndex) button.classList.add('rw-quiz__option--right');
        else if (index === state.answered) button.classList.add('rw-quiz__option--wrong');
      }
      button.addEventListener('click', () => {
        state.answered = index;
        this.scene.answer(quizId, index);
        this.pendingFocus = '.rw-quiz__feedback';
        this.render();
      });
      options.appendChild(button);
    });
    box.appendChild(options);
    if (state.answered !== null) {
      const right = state.answered === question.correctIndex;
      const feedback = el('p', `rw-quiz__feedback rw-quiz__feedback--${right ? 'right' : 'try'}`, right ? `Yes! ${question.explanation}` : `Good try! ${question.explanation}`);
      feedback.tabIndex = -1;
      box.appendChild(feedback);
      if (!right) {
        // Mistakes are part of learning: the child can always answer again.
        const again = el('button', 'rw-btn rw-btn--quiet rw-quiz__again');
        again.type = 'button';
        again.append(icon('turn'), el('span', '', 'Try again'));
        again.addEventListener('click', () => {
          state.answered = null;
          this.pendingFocus = '.rw-quiz__option';
          this.render();
        });
        box.appendChild(again);
      }
    }
    return box;
  }

  // ------------------------------------------------------------ companion

  private renderCompanion(landmark: RealLandmark, snapshot: RealWorldSnapshot): void {
    const scene = this.scene;
    const foundation = landmark.stops.find((s) => s.kind === 'foundation');
    const highest = [...landmark.stops].sort((a, b) => b.heightM - a.heightM)[0];
    const foundationLesson = landmark.lessons.find((l) => l.steps.some((s) => s.simulation === 'foundation-pressure'));
    const lines = landmark.companion;
    let text: string;
    const choices: Array<{ label: string; run: () => void }> = [];
    const offer = (choice: CompanionChoice) => choices.push({ label: choice.label, run: () => this.runChoice(landmark, choice) });
    if (this.lessonState) {
      text = this.lessonLine(landmark, this.lessonState);
    } else if (snapshot.view === 'construction') {
      text = 'Would you like to see how the structure changed during construction? Press Play to watch it grow.';
    } else if (snapshot.selectedPart) {
      const part = landmark.parts.find((p) => p.id === snapshot.selectedPart);
      const line = lines?.parts?.[snapshot.selectedPart];
      if (line) {
        text = line.text;
        line.choices?.forEach(offer);
      } else text = part ? `That's the ${part.name.toLowerCase()}. Read about it in the card, or tap another part.` : 'Tap a part of the model to find out what it does.';
    } else if (snapshot.stopId && snapshot.stopId === foundation?.id && foundationLesson) {
      text = "You're looking at the foundation. Let's discover how the building's weight reaches the ground.";
      choices.push({ label: 'Start the foundation lesson', run: () => this.openLesson(foundationLesson) });
    } else if (snapshot.stopId && snapshot.stopId === highest?.id) {
      text = `You're at the top: ${highest.description}`;
      if (foundation) choices.push({ label: 'Back down to the foundation', run: () => scene.goToStop(foundation.id) });
    } else if (snapshot.stopId) {
      // Any other floor: say where we are, in the stop's own (sourced, caveated) words.
      const stop = landmark.stops.find((s) => s.id === snapshot.stopId);
      text = stop ? `${stop.name}: ${stop.description}` : 'Pick a place to travel there.';
      if (foundation) choices.push({ label: 'Down to the foundation', run: () => scene.goToStop(foundation.id) });
      if (highest) choices.push({ label: 'Up to the top', run: () => scene.goToStop(highest.id) });
    } else if (lines?.welcome) {
      text = snapshot.model === 'fallback' ? `${lines.welcome} The detailed model could not load, so this is a simpler one.` : lines.welcome;
      lines.welcomeChoices?.forEach(offer);
    } else {
      text =
        snapshot.model === 'fallback'
          ? `Welcome to the ${landmark.name}! The detailed model could not load, so this is a simpler one. Would you like to explore the foundations or travel to the top?`
          : `Welcome to the ${landmark.name}! Would you like to explore the foundations or travel to the top?`;
      if (foundation) choices.push({ label: 'Explore the foundation', run: () => scene.goToStop(foundation.id) });
      if (highest) choices.push({ label: 'Travel to the top', run: () => scene.goToStop(highest.id) });
      if (landmark.timeline.length > 0)
        choices.push({
          label: 'See how it was built',
          run: () => this.showConstruction(),
        });
    }
    const key = `${text}|${choices.map((c) => c.label).join('|')}`;
    if (key === this.companionKey) return;
    this.companionKey = key;
    this.companionText.textContent = text;
    this.companionChoices.replaceChildren(
      ...choices.map((choice) => {
        const chip = el('button', 'rw-chip rw-chip--button', choice.label);
        chip.type = 'button';
        chip.addEventListener('click', choice.run);
        return chip;
      }),
    );
  }

  /** EAVARA's line during a lesson: the landmark's own line, following what the child has really done in the panel. */
  private lessonLine(landmark: RealLandmark, state: LessonState): string {
    const base = landmark.companion?.lessons?.[state.lesson.id] ?? `Let's learn: ${state.lesson.title}`;
    if (state.finished) return `You finished "${state.lesson.title}". Try a mission or another lesson!`;
    const step = state.lesson.steps[state.step];
    if (step.simulation === 'bridge-forces' && state.forcesPart) {
      const part = landmark.parts.find((p) => p.id === state.forcesPart);
      const words = BRIDGE_FORCE_WORDS[state.forcesPart];
      if (part && words) {
        if (words.kind === 'tension') return `${part.name}: pulled (tension). Can you find a part that is squeezed?`;
        if (words.kind === 'compression') return `${part.name}: squeezed (compression). Can you find a part that is pulled?`;
        return `${part.name}: pulled and pressed at the same time. Try another part!`;
      }
    }
    if (step.simulation === 'suspension-load') {
      if (state.triedNormal && state.triedFlat) return 'You compared the two cables: the flatter one has to pull harder. Can you trace the load from the deck toward the foundations?';
      if (state.flatCable) return 'A flatter cable has to pull harder to hold the same load.';
    }
    if (step.kind === 'check' && step.quizId && state.answered !== null) {
      const question = landmark.quiz.find((q) => q.id === step.quizId);
      if (question) return state.answered === question.correctIndex ? 'Yes, that is right!' : 'Good try! Read why, then have another go.';
    }
    return base;
  }

  /** Run one of EAVARA's suggestion chips: open a lesson, switch view, or travel to a stop. */
  private runChoice(landmark: RealLandmark, choice: CompanionChoice): void {
    const scene = this.scene;
    const lesson = choice.lessonId ? landmark.lessons.find((l) => l.id === choice.lessonId) : undefined;
    if (lesson) {
      this.openLesson(lesson);
      return;
    }
    if (choice.view === 'construction') this.showConstruction();
    else if (choice.view) scene.setView(choice.view);
    if (choice.stopId) scene.goToStop(choice.stopId);
  }

  // ------------------------------------------------------------ helpers

  /**
   * The construction view with its timeline. An open lesson closes first:
   * its load-path arrows and glowing parts would float over a half-built
   * tower or an empty site.
   */
  private showConstruction(): void {
    const scene = this.scene;
    if (this.lessonState) {
      this.closeLesson();
      this.render();
    }
    scene.setView('construction');
    if (scene.snapshotState().timelineIndex === null) scene.showTimelineEntry(0);
  }

  private startPlaying(landmark: RealLandmark): void {
    const scene = this.scene;
    this.stopPlaying();
    let index = scene.snapshotState().timelineIndex ?? 0;
    if (index >= landmark.timeline.length - 1) index = -1;
    this.playTimer = setInterval(() => {
      index++;
      if (index >= landmark.timeline.length) {
        this.stopPlaying();
        return;
      }
      scene.showTimelineEntry(index);
      if (index >= landmark.timeline.length - 1) this.stopPlaying();
    }, PLAY_SECONDS * 1000);
    this.timelineKey = '';
    scene.showTimelineEntry(Math.max(0, index));
  }

  private stopPlaying(): void {
    if (!this.playTimer) return;
    clearInterval(this.playTimer);
    this.playTimer = null;
    this.timelineKey = '';
  }

  private celebrate(text: string): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast.hidden = true;
    }, 4200);
  }

  /** A labelled range input; `set` moves it without firing `onInput`. */
  private slider(label: string, value: number, min: number, max: number, step: number, onInput: (value: number) => void): { row: HTMLElement; set: (value: number) => void } {
    const row = el('label', 'rw-slider');
    const text = el('span', 'rw-slider__label', `${label}: ${value}`);
    const input = el('input', 'rw-slider__input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      text.textContent = `${label}: ${v}`;
      onInput(v);
    });
    row.append(text, input);
    return {
      row,
      set: (v: number) => {
        input.value = String(v);
        text.textContent = `${label}: ${v}`;
      },
    };
  }

  /** A bar meter (0..max) with a spoken value; `set` updates it in place. */
  private meter(label: string, max: number): { row: HTMLElement; set: (value: number, text: string, level?: 'low' | 'medium' | 'high') => void } {
    const row = el('div', 'rw-meter');
    row.appendChild(el('span', 'rw-meter__label', label));
    const bar = el('div', 'rw-meter__bar');
    const fill = el('div', 'rw-meter__fill');
    bar.setAttribute('role', 'meter');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(max));
    bar.setAttribute('aria-label', label);
    bar.appendChild(fill);
    const value = el('span', 'rw-meter__value');
    row.append(bar, value);
    return {
      row,
      set: (v: number, text: string, level?: 'low' | 'medium' | 'high') => {
        fill.className = `rw-meter__fill${level ? ` rw-meter__fill--${level}` : ''}`;
        fill.style.width = `${Math.max(2, Math.min(100, (v / max) * 100))}%`;
        bar.setAttribute('aria-valuenow', String(Math.min(max, Math.max(0, v))));
        bar.setAttribute('aria-valuetext', text);
        value.textContent = text;
      },
    };
  }

  private round(iconName: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = el('button', 'st-round st-round--small rw-round');
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.appendChild(icon(iconName));
    button.addEventListener('click', onClick);
    return button;
  }

  private sourcesOf(landmark: RealLandmark, ids: string[]): Source[] {
    const unique = [...new Set(ids)];
    return unique.map((id) => landmark.sources.find((s) => s.id === id)).filter((s): s is Source => s !== undefined);
  }

  private publishers(landmark: RealLandmark, ids: string[]): string {
    return [...new Set(this.sourcesOf(landmark, ids).map((s) => s.publisher))].join('; ');
  }

  /** A source as plain text (title, publisher and address) - no outgoing links in a children's app. */
  private sourceLine(source: Source): HTMLElement {
    const line = el('p', 'rw-source');
    line.append(el('strong', '', source.title), el('span', '', ` - ${source.publisher}`), el('span', 'rw-source__url', source.url));
    return line;
  }
}
