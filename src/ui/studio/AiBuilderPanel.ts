import { el, type ScreenContext } from '../Screen';
import type { GameState } from '@/state/GameState';
import { BUILD_GOALS, type AssistantTurn, type BuildGoal } from '@/creative/ai/BuildAssistant';
import { designTip, type DesignTip } from '@/creative/ai/DesignTips';
import { MAX_SECONDS, microphonePermission, sharedVoiceSwitch, VoiceError, VoiceInput, voiceSupport, type VoiceProblem, type VoiceStage } from '@/creative/ai/VoiceInput';
import { voiceSetting } from '@/creative/ai/VoiceSetting';
import { KIND_NAMES, type ConstructionPlan } from '@/creative/plan/ConstructionPlan';
import { icon } from './icons';
import { setShown } from './dom';
import './ai.css';

const MAX_MESSAGES = 10;
const MAX_INPUT = 300;

type QuickEdit = { label: string; text: string };

/**
 * What EAVARA is doing right now, drawn on the avatar and the launcher (see
 * ai.css): listening to the microphone, thinking about a request, showing a
 * preview that waits for "Place here", or just after something went wrong.
 */
type AgentMood = 'idle' | 'listening' | 'thinking' | 'previewing' | 'error';

const MOOD_LABELS: Partial<Record<AgentMood, string>> = {
  listening: 'Listening...',
  thinking: 'Thinking...',
  error: 'That did not work - try again',
};
/** How long the error look stays after a problem (it also ends with the next request). */
const ERROR_MOOD_MS = 4000;

/**
 * Quick changes for whatever is being worked on. Each one asks for a
 * preview - nothing changes until "Place here".
 */
function quickEditsFor(plan: ConstructionPlan): QuickEdit[] {
  switch (plan.kind) {
    case 'house':
      return [
        { label: 'Wider', text: 'make it wider' },
        { label: 'Add a bedroom', text: 'add another bedroom' },
        { label: 'Balcony', text: 'add a balcony' },
        { label: 'Bigger garden', text: 'make it bigger and keep the garden' },
      ];
    case 'garden':
      return [
        { label: 'Bigger', text: 'make the garden bigger' },
        { label: 'More flowers', text: 'add two more flower beds' },
        { label: 'Add a bench', text: 'add a bench' },
        { label: 'Add a tree', text: 'add a tree' },
      ];
    case 'park':
      return [
        { label: 'Bigger', text: 'make the park bigger' },
        plan.playground ? { label: 'More trees', text: 'add more trees' } : { label: 'Playground', text: 'add a playground' },
        { label: 'More benches', text: 'add two more benches' },
        { label: 'More flowers', text: 'add two more flower beds' },
      ];
    case 'neighborhood':
      return [
        { label: 'Add a house', text: 'add another house' },
        { label: 'Bigger houses', text: 'make the houses bigger' },
        { label: 'Add a bathroom', text: 'give every house a bathroom' },
        plan.park ? { label: 'No park', text: 'take away the park' } : { label: 'Add a park', text: 'add a park' },
      ];
    case 'treehouse':
      return [
        plan.access === 'ladder' ? { label: 'Use stairs', text: 'use stairs instead of the ladder' } : { label: 'Use a ladder', text: 'use a ladder instead of the stairs' },
        plan.hut ? { label: 'Open deck', text: 'take the hut away' } : { label: 'Add a hut', text: 'add a hut' },
      ];
    case 'objects':
      return [
        { label: 'Add a bench', text: 'add a bench' },
        { label: 'Add a tree', text: 'add a tree' },
      ];
  }
}

/** Quick changes for one house of a neighbourhood (it keeps its plot, so it grows deeper, not wider). */
const HOUSE_EDITS: QuickEdit[] = [
  { label: 'Deeper', text: 'make it deeper' },
  { label: 'Add a bedroom', text: 'add another bedroom' },
  { label: 'Balcony', text: 'add a balcony' },
  { label: 'Flat roof', text: 'give it a flat roof' },
];

/** Kinds with roofs worth seeing under. */
const ROOFED = new Set<ConstructionPlan['kind']>(['house', 'neighborhood', 'treehouse']);

/** What to tell the child for each way voice can fail, and whether "Try again" makes sense. */
const VOICE_PROBLEMS: Record<Exclude<VoiceProblem, 'cancelled'>, { text: string; retry: boolean }> = {
  app: { text: "Talking isn't available in the app yet. Please type your idea instead.", retry: false },
  insecure: { text: 'Talking only works on a secure (https) page. You can type instead.', retry: false },
  unsupported: { text: "This browser can't record sound. Please type instead - or try Chrome, Edge, Safari or Firefox.", retry: false },
  denied: { text: 'The microphone is blocked. Allow it from the lock icon next to the web address, then try again - or just type.', retry: true },
  'no-device': { text: "I can't find a microphone. Plug one in, or type instead.", retry: true },
  busy: { text: 'Another app is using the microphone. Close it and try again - or type.', retry: true },
  'too-short': { text: 'That was very quick! Tap the microphone, say your idea, then tap stop.', retry: true },
  'no-speech': { text: "I didn't hear any words. Try again a little closer to the microphone - or type.", retry: true },
  offline: { text: 'You seem to be offline. Check the internet, then try again.', retry: true },
  timeout: { text: 'Listening took too long. Let\'s try again.', retry: true },
  'rate-limited': { text: 'Lots of builders are talking to me right now. Wait a moment, then try again.', retry: true },
  'not-configured': { text: "Talking is switched off right now, so I can't listen. Please type your idea instead.", retry: false },
  'needs-grown-up': { text: 'Talking is off on this device. A grown-up can switch it on from the Home screen. Please type your idea for now.', retry: false },
  unchecked: { text: "I couldn't check whether talking is switched on, so I didn't listen. Try again in a moment - or type.", retry: true },
  provider: { text: 'Something went wrong while I was listening. Try again, or type.', retry: true },
};

/** The microphone button and the line under the box while voice is switched off on the server. */
const VOICE_OFF_LABEL = 'Talking is switched off - please type';
const VOICE_OFF_HINT = 'Talking to EAVARA is switched off here, so the microphone stays off. Type your idea instead.';
/** ...and while no grown-up has switched talking on for this device (VoiceSetting, on the Home screen). */
const GROWN_UP_OFF_LABEL = 'Talking is off on this device - please type';
const GROWN_UP_OFF_HINT = 'Talking is off on this device until a grown-up switches it on from the Home screen. Type your idea instead.';
const MIC_BLOCKED_HINT = 'The microphone is blocked for this site. Allow it from the lock icon next to the web address - or type.';

/**
 * What happens to the child's voice, next to the microphone ("How talking
 * works"). It must stay true: EAVARA keeps no recording itself, but the
 * speech-to-text provider's retention is its own (and not verified), so
 * nothing here may say that a recording is never kept anywhere.
 */
const VOICE_NOTICE = [
  'EAVARA records only after you tap the microphone.',
  'Tap Stop when you are done, or Cancel to throw the recording away without sending it. It stops by itself after 20 seconds.',
  'When you stop, the recording is sent to the speech-to-text service EAVARA uses, which turns it into words.',
  'The words appear in this box. Check them, then tap Send - EAVARA uses them just like typed words.',
  'For grown-ups: EAVARA does not keep recordings on this device or on its own server. The speech-to-text service handles them under its own privacy and retention rules. Talking stays off until a grown-up switches it on from the Home screen.',
];

interface SayOptions {
  source?: AssistantTurn['source'];
  extra?: string[];
  understood?: string[];
  choices?: string[];
  tip?: DesignTip;
  retry?: () => void;
}

/**
 * "Ask EAVARA": World Studio's building buddy. The child picks a starting
 * idea, types, or taps the microphone and talks; EAVARA says what it
 * understood, asks at most one simple question when something important is
 * missing, and shows the plan as a ghost in the world. The normal "Place
 * here" bar builds it - nothing is built without that tap. Afterwards one
 * short design idea, and follow-ups by voice, text or quick buttons.
 *
 * UI only: everything it does goes through the BuildAssistant service.
 */
export class AiBuilderPanel {
  readonly root: HTMLElement;
  private readonly launcher: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly log: HTMLElement;
  private readonly status: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly newHouseButton: HTMLButtonElement;
  private readonly goals: HTMLElement;
  private readonly quick: HTMLElement;
  private readonly quickEdits: HTMLElement;
  /** The quick edits on show, so they are only rebuilt when they change. */
  private quickKey = '';
  /** For a neighbourhood: "Whole street", "House 1", "House 2"... - which part follow-ups change. */
  private readonly housePicker: HTMLElement;
  private houseKey = '';
  private readonly peekButton: HTMLButtonElement;
  private readonly voiceStrip: HTMLElement;
  private readonly voiceLabel: HTMLElement;
  private readonly voiceLevel: HTMLElement;
  private readonly voiceStop: HTMLButtonElement;
  private readonly micHint: HTMLElement;
  /** "How talking works", next to the microphone. */
  private readonly voiceNotice: HTMLDetailsElement;
  private readonly input: HTMLTextAreaElement;
  private readonly micButton: HTMLButtonElement;
  private readonly sendButton: HTMLButtonElement;
  /** Whether the server has voice switched on - asked before the microphone is ever opened. */
  private readonly voiceSwitch = sharedVoiceSwitch;
  private readonly voice = new VoiceInput(this.voiceSwitch);
  /** A tap on the microphone is being checked or started: another tap waits (no overlapping recordings). */
  private voiceStarting = false;
  /** The microphone permission as last read without prompting. */
  private micPermission: 'granted' | 'denied' | 'prompt' | 'unknown' = 'unknown';
  private readonly disposers: Array<() => void> = [];
  private open = false;
  private busy = false;
  /** The preview this panel asked for, until it is built or put away. */
  private awaiting: { templateId: string; plan: ConstructionPlan | null; name: string; changes: string[]; house: number | null } | null = null;
  private placedAtPreview: GameState['placedObjects'] | null = null;
  private builtWhileAwaiting = false;
  private builds = 0;
  private latest: GameState | null = null;
  private readonly avatar: HTMLElement;
  /** The header line for what is being worked on (shown whenever EAVARA is not listening, thinking or upset). */
  private contextLabel = 'Your building buddy';
  private previewing = false;
  private errorUntil = 0;
  private errorTimer: ReturnType<typeof setTimeout> | null = null;

  /** Told when the panel opens or closes (World Studio hides its welcome card meanwhile). */
  onOpenChange: ((open: boolean) => void) | null = null;

  get isOpen(): boolean {
    return this.open;
  }

  constructor(
    private readonly context: ScreenContext,
    private readonly toast: (text: string) => void,
  ) {
    this.root = el('div', 'st-ai-root');

    this.launcher = el('button', 'st-ai-launch');
    this.launcher.type = 'button';
    this.launcher.setAttribute('aria-label', 'Ask EAVARA to build something');
    this.launcher.append(icon('sparkle'), el('span', 'st-ai-launch__label', 'Ask EAVARA'));
    this.launcher.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setOpen(!this.open);
    });

    this.panel = el('section', 'st-ai');
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Ask EAVARA');

    const header = el('header', 'st-ai__header');
    const avatar = el('span', 'st-ai__avatar');
    avatar.setAttribute('aria-hidden', 'true');
    avatar.appendChild(icon('sparkle'));
    this.avatar = avatar;
    const titles = el('div', 'st-ai__titles');
    titles.appendChild(el('strong', 'st-ai__title', 'EAVARA'));
    this.subtitle = el('span', 'st-ai__subtitle', 'Your building buddy');
    this.subtitle.setAttribute('role', 'status');
    titles.appendChild(this.subtitle);
    this.newHouseButton = el('button', 'st-ai__chip st-ai__chip--quiet', 'Something new');
    this.newHouseButton.type = 'button';
    this.newHouseButton.title = 'Plan something brand-new instead of changing this one';
    this.newHouseButton.addEventListener('click', () => {
      this.context.studio.assistant.startNew();
      this.refresh();
      this.input.focus();
    });
    const close = el('button', 'st-round st-round--small');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.appendChild(icon('close'));
    close.addEventListener('click', () => this.setOpen(false));
    header.append(avatar, titles, this.newHouseButton, close);

    this.log = el('div', 'st-ai__log');
    this.log.setAttribute('aria-live', 'polite');
    this.say('eavara', 'Hi! What shall we build today? Pick an idea, or tell me in your own words.');

    this.goals = el('div', 'st-ai__goals');
    for (const goal of BUILD_GOALS) this.goals.appendChild(this.goalCard(goal));

    this.status = el('div', 'st-ai__status');
    this.status.hidden = true;

    this.voiceStrip = el('div', 'st-ai__voice');
    this.voiceStrip.hidden = true;
    const dot = el('span', 'st-ai__voice-dot');
    this.voiceLabel = el('span', 'st-ai__voice-label');
    const meter = el('span', 'st-ai__voice-meter');
    this.voiceLevel = el('span', 'st-ai__voice-level');
    meter.appendChild(this.voiceLevel);
    this.voiceStop = el('button', 'st-ai__chip st-ai__chip--strong', 'Stop');
    this.voiceStop.type = 'button';
    this.voiceStop.addEventListener('click', () => this.voice.stop());
    const voiceCancel = el('button', 'st-ai__chip', 'Cancel');
    voiceCancel.type = 'button';
    voiceCancel.addEventListener('click', () => this.voice.cancel());
    this.voiceStrip.append(dot, this.voiceLabel, meter, this.voiceStop, voiceCancel);

    const composer = el('div', 'st-ai__composer');
    this.input = el('textarea', 'st-ai__input');
    this.input.rows = 2;
    this.input.maxLength = MAX_INPUT;
    this.input.placeholder = 'Build me a house by the lake...';
    this.input.setAttribute('aria-label', 'What should EAVARA build?');
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void this.send(this.input.value);
      } else if (event.key === 'Escape') {
        this.setOpen(false);
      }
    });
    this.input.addEventListener('input', () => this.sendButton.classList.remove('st-ai__send--ready'));
    this.micButton = el('button', 'st-ai__mic');
    this.micButton.type = 'button';
    this.micButton.setAttribute('aria-label', 'Talk to EAVARA');
    this.micButton.appendChild(icon('mic'));
    this.micButton.addEventListener('click', () => void this.toggleVoice());
    this.sendButton = el('button', 'st-ai__send');
    this.sendButton.type = 'button';
    this.sendButton.setAttribute('aria-label', 'Send');
    this.sendButton.appendChild(icon('send'));
    this.sendButton.addEventListener('click', () => void this.send(this.input.value));
    composer.append(this.input, this.micButton, this.sendButton);

    this.micHint = el('div', 'st-ai__hint');
    this.micHint.hidden = true;

    this.voiceNotice = el('details', 'st-ai__voice-notice');
    const noticeSummary = el('summary', 'st-ai__voice-notice-summary');
    noticeSummary.append(icon('mic'), el('span', '', 'How talking works'));
    const noticeList = el('ul', 'st-ai__voice-notice-list');
    for (const line of VOICE_NOTICE) noticeList.appendChild(el('li', '', line));
    this.voiceNotice.append(noticeSummary, noticeList);

    this.quick = el('div', 'st-ai__quick');
    this.housePicker = el('div', 'st-ai__houses');
    this.housePicker.setAttribute('role', 'group');
    this.housePicker.setAttribute('aria-label', 'Which house to change');
    this.housePicker.hidden = true;
    this.quickEdits = el('div', 'st-ai__quick-edits');
    this.quick.append(this.housePicker, this.quickEdits);
    this.peekButton = el('button', 'st-ai__chip st-ai__chip--toggle');
    this.peekButton.type = 'button';
    this.peekButton.append(icon('eye'), el('span', '', 'Peek inside'));
    this.peekButton.title = 'See through roofs to the rooms inside';
    this.peekButton.addEventListener('click', () => {
      const on = !this.context.studio.isPeekingInside();
      this.context.studio.setPeekInside(on);
      this.peekButton.setAttribute('aria-pressed', String(on));
    });
    this.peekButton.setAttribute('aria-pressed', 'false');
    this.quick.appendChild(this.peekButton);

    this.panel.append(header, this.log, this.goals, this.status, this.voiceStrip, composer, this.micHint, this.voiceNotice, this.quick);
    this.root.append(this.panel, this.launcher);

    const support = voiceSupport();
    if (!support.ok) {
      this.micButton.disabled = true;
      this.micButton.title = VOICE_PROBLEMS[support.code].text;
      // The Android app has no voice at all (see voiceSupport): no microphone button to wonder about.
      this.micButton.hidden = support.code === 'app';
      this.voiceNotice.hidden = support.code === 'app';
    }
    this.voice.onStage = (stage) => this.showVoiceStage(stage);
    this.voice.onTick = (seconds, level) => {
      this.voiceLabel.textContent = `Listening ${formatSeconds(seconds)}`;
      this.voiceLevel.style.transform = `scaleX(${Math.max(0.04, level)})`;
      // The avatar's ring follows the voice a little, so the child sees that EAVARA hears them.
      this.avatar.style.setProperty('--voice-level', Math.min(1, Math.max(0, level)).toFixed(2));
    };
    this.applyMood();
    this.voice.onAutoStop = () => this.toast(`That's ${MAX_SECONDS} seconds - let me write it down`);

    this.disposers.push(
      this.context.studio.assistant.onBuilt((_, plan, facts) => {
        if (!this.awaiting) return;
        this.builtWhileAwaiting = true;
        const tip = designTip(plan, this.awaiting.changes, this.builds++, facts);
        this.say('eavara', `${plan.name} is built! Tap any piece to move it, or tell me what to change.`, { tip });
      }),
    );
  }

  /** Called with every state change while World Studio is showing. */
  update(state: GameState, flowActive: boolean): void {
    this.latest = state;
    const placement = state.templatePlacement;
    // Our preview ended: built (the assistant said so, or pieces appeared) or put away.
    if (this.awaiting && placement?.templateId !== this.awaiting.templateId) {
      const finished = this.awaiting;
      setTimeout(() => {
        if (this.awaiting !== finished) return;
        const built = this.builtWhileAwaiting || (this.placedAtPreview !== null && this.latest?.placedObjects !== this.placedAtPreview);
        if (built && !this.builtWhileAwaiting) {
          this.say('eavara', `Your ${finished.name.toLowerCase()} is built! Tap any piece to move it.`, {
            tip: { concept: 'Landscaping', text: 'Paths, trees and open lawns make a place nice to walk through. Try adding a house nearby!' },
          });
        } else if (!built) {
          this.say('eavara', 'Okay, I put that plan away. What shall we build?');
        }
        this.awaiting = null;
        this.placedAtPreview = null;
        this.builtWhileAwaiting = false;
        this.setOpen(true);
      }, 0);
    }
    // Stay out of the way of other building flows; while our own plan is on show the bar takes over.
    const ownPreview = !!placement && placement.templateId === this.awaiting?.templateId;
    this.launcher.classList.toggle('st-ai-launch--hidden', flowActive && !ownPreview);
    this.launcher.classList.toggle('st-ai-launch--waiting', ownPreview);
    if (ownPreview !== this.previewing) {
      this.previewing = ownPreview;
      this.applyMood();
    }
    this.root.classList.toggle('st-ai-root--lifted', ownPreview);
    if (flowActive && !ownPreview && this.open) this.setOpen(false);
    if (this.open) this.refresh();
  }

  dispose(): void {
    this.voice.cancel();
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorTimer = null;
    this.disposers.forEach((d) => d());
    this.disposers.length = 0;
  }

  // ------------------------------------------------------------- layout

  private setOpen(open: boolean): void {
    const changed = open !== this.open;
    this.open = open;
    setShown(this.panel, open);
    this.launcher.classList.toggle('st-ai-launch--open', open);
    if (changed) this.onOpenChange?.(open);
    if (open) {
      this.refresh();
      void this.checkVoice();
      if (!this.busy && this.voice.current === 'idle') setTimeout(() => this.input.focus(), 50);
    } else if (this.voice.current !== 'idle' || this.voiceStarting) {
      // Closing ends talking at once - also while the server is still being asked (nothing is opened afterwards).
      this.voice.cancel();
    }
  }

  /** Header line, goal cards and quick edits follow what the child is working on. */
  private refresh(): void {
    const onScreen = !!this.latest?.templatePlacement && this.latest.templatePlacement.templateId === this.awaiting?.templateId;
    const target = this.context.studio.assistant.target;
    // A neighbourhood: one of its houses can be picked, and then follow-ups change that house alone.
    const houses = onScreen ? null : this.context.studio.houseChoice();
    const house = onScreen ? this.awaiting?.house ?? null : houses?.picked ?? null;
    const label = onScreen
      ? house !== null ? `Changing House ${house + 1} on the map` : 'Changing the plan on the map'
      : target ? (house !== null ? `Working on House ${house + 1} of ${target.plan.name}` : `Working on ${target.plan.name}`) : 'Your building buddy';
    this.contextLabel = label;
    // Our own plan can appear on the map before the panel hears about it from a state change: catch up here too.
    this.previewing = onScreen;
    this.launcher.classList.toggle('st-ai-launch--waiting', onScreen);
    this.applyMood();
    this.renderHousePicker(houses);
    this.newHouseButton.hidden = !target || onScreen;
    // Starting ideas whenever nothing is being worked on (also after "Something new").
    this.goals.hidden = !!target || onScreen;
    // Quick edits for the plan on the map, else for the creation being worked on.
    const plan = (onScreen ? this.awaiting?.plan : null) ?? target?.plan ?? null;
    this.renderQuickEdits(plan, house);
    this.quick.hidden = !plan || this.busy;
    this.peekButton.hidden = !plan || !ROOFED.has(plan.kind);
    this.peekButton.setAttribute('aria-pressed', String(this.context.studio.isPeekingInside()));
  }

  /** "Whole street · House 1 · House 2 ..." for a neighbourhood; the picked one is highlighted (and selected in the world). */
  private renderHousePicker(choice: { groupId: string; houses: number; picked: number | null } | null): void {
    const key = choice ? `${choice.groupId}:${choice.houses}:${choice.picked}` : '';
    if (key === this.houseKey) return;
    this.houseKey = key;
    this.housePicker.hidden = !choice;
    if (!choice) {
      this.housePicker.replaceChildren();
      return;
    }
    const chip = (label: string, index: number | null) => {
      const button = el('button', 'st-ai__chip st-ai__chip--toggle', label);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(choice.picked === index));
      button.title = index === null ? 'Changes go to the whole neighbourhood' : `Changes go to house ${index + 1} only`;
      button.addEventListener('click', () => {
        this.context.studio.pickHouse(choice.groupId, index);
        this.refresh();
      });
      return button;
    };
    this.housePicker.replaceChildren(
      el('span', 'st-ai__houses-label', 'Change:'),
      chip('Whole street', null),
      ...Array.from({ length: choice.houses }, (_, i) => chip(`House ${i + 1}`, i)),
    );
  }

  private renderQuickEdits(plan: ConstructionPlan | null, house: number | null = null): void {
    const edits = house !== null ? HOUSE_EDITS : plan ? quickEditsFor(plan) : [];
    const key = `${house}|${edits.map((e) => e.text).join('|')}`;
    if (key === this.quickKey) return;
    this.quickKey = key;
    this.quickEdits.replaceChildren(
      ...edits.map((edit) => {
        const chip = el('button', 'st-ai__chip', edit.label);
        chip.type = 'button';
        chip.title = house !== null ? `Change house ${house + 1}: "${edit.text}"` : `Change the ${plan ? KIND_NAMES[plan.kind] : 'plan'}: "${edit.text}"`;
        chip.addEventListener('click', () => void this.send(edit.text));
        return chip;
      }),
    );
  }

  private goalCard(goal: BuildGoal): HTMLButtonElement {
    const card = el('button', 'st-ai__goal');
    card.type = 'button';
    const face = el('span', 'st-ai__goal-icon');
    face.appendChild(icon(goal.icon));
    card.append(face, el('span', 'st-ai__goal-label', goal.label));
    card.addEventListener('click', () => void this.startGoal(goal));
    return card;
  }

  // -------------------------------------------------------- conversation

  private async startGoal(goal: BuildGoal): Promise<void> {
    if (this.busy) return;
    this.say('child', goal.label);
    await this.run(() => this.context.studio.assistant.startGoal(goal));
  }

  private async send(raw: string): Promise<void> {
    const text = raw.trim().slice(0, MAX_INPUT);
    if (!text || this.busy) return;
    this.input.value = '';
    this.sendButton.classList.remove('st-ai__send--ready');
    this.say('child', text);
    await this.run(() => this.context.studio.assistant.ask(text));
  }

  private async run(request: () => Promise<AssistantTurn>): Promise<void> {
    this.setBusy(true);
    this.showStatus('EAVARA is thinking');
    let turn: AssistantTurn;
    try {
      turn = await request();
    } catch (error) {
      console.warn('[ai] request failed', error);
      this.setBusy(false);
      this.showError();
      this.say('eavara', 'Oops, something went wrong. Can you say that again?');
      return;
    }
    this.setBusy(false);
    if (turn.aiError) console.info(`[ai] offline helper used (${turn.aiError})`);
    if (turn.model) console.info(`[ai] answered by ${turn.model}`);
    const summary = turn.preview?.ok ? turn.preview.summary : null;
    const extra: string[] = [];
    if (summary?.changes.length) extra.push(`Changes: ${summary.changes.join(', ')}.`);
    if (summary?.keptEdits) extra.push(`I kept the ${summary.keptEdits} thing${summary.keptEdits === 1 ? '' : 's'} you moved yourself.`);
    if (turn.preview?.ok) extra.push(...turn.preview.notes);
    this.say('eavara', turn.reply, {
      source: turn.source,
      extra,
      understood: summary && !summary.changes.length ? summary.understood : undefined,
      choices: turn.choices,
    });
    if (summary) {
      // Let the child look: the placement bar ("Place here" / "Cancel") takes over.
      this.awaiting = { templateId: summary.templateId, plan: summary.plan, name: summary.name, changes: summary.changes, house: summary.house ?? null };
      this.placedAtPreview = this.latest?.placedObjects ?? null;
      this.builtWhileAwaiting = false;
      this.setOpen(false);
      this.toast('Look! Tap "Place here" to build it, or Cancel');
    }
    this.refresh();
  }

  // --------------------------------------------------------------- voice

  private async toggleVoice(): Promise<void> {
    const stage = this.voice.current;
    if (stage === 'recording') {
      this.voice.stop();
      return;
    }
    if (stage !== 'idle' || this.busy || this.voiceStarting) return;
    this.voiceStarting = true;
    try {
      // The recorder asks the server first (remembered for a minute), then checks this device's grown-up switch:
      // when either is off the microphone is never opened. Closed, or a typed request sent meanwhile: it stops there too.
      const { words } = await this.voice.start(() => this.open && !this.busy);
      words.then((text) => this.heard(text)).catch((error: unknown) => this.voiceProblem(error));
    } catch (error) {
      this.voiceProblem(error);
    } finally {
      this.voiceStarting = false;
      this.showVoiceAvailability();
    }
  }

  /** The transcript goes into the box to check and edit - it is only sent when the child taps Send. */
  private heard(text: string): void {
    this.input.value = text;
    this.input.focus();
    this.input.setSelectionRange(text.length, text.length);
    this.sendButton.classList.add('st-ai__send--ready');
    this.say('eavara', `I heard: "${text}" - fix any words if you like, then tap Send.`);
  }

  private voiceProblem(error: unknown): void {
    const code: VoiceProblem = error instanceof VoiceError ? error.code : 'provider';
    if (!(error instanceof VoiceError)) console.warn('[ai] voice failed', error);
    else console.info(`[ai] voice: ${code}`);
    if (code === 'cancelled') return;
    const problem = VOICE_PROBLEMS[code];
    if (code === 'not-configured' || code === 'needs-grown-up') {
      // Switched off is a setting, not a mistake: no "try again" look, and no repeat of what EAVARA just said.
      this.showVoiceAvailability();
      if (this.log.lastElementChild?.textContent !== problem.text) this.say('eavara', problem.text);
      return;
    }
    this.showError();
    this.say('eavara', problem.text, problem.retry ? { retry: () => void this.toggleVoice() } : {});
    if (code === 'denied') void this.checkMicrophone();
  }

  private showVoiceStage(stage: VoiceStage): void {
    const recording = stage === 'recording';
    this.micButton.classList.toggle('st-ai__mic--live', recording);
    this.micButton.replaceChildren(icon(recording ? 'stop' : 'mic'));
    this.micButton.setAttribute('aria-label', recording ? 'Stop and write down what I said' : 'Talk to EAVARA');
    this.micButton.setAttribute('aria-pressed', String(recording));
    this.micButton.disabled = stage === 'asking' || stage === 'processing';
    this.input.disabled = stage !== 'idle' || this.busy;
    this.voiceStrip.hidden = stage === 'idle';
    this.voiceStrip.dataset.stage = stage;
    this.voiceStop.hidden = !recording;
    this.voiceLevel.style.transform = 'scaleX(0.04)';
    if (stage === 'asking') this.voiceLabel.textContent = 'Allow the microphone in the browser pop-up...';
    else if (stage === 'recording') this.voiceLabel.textContent = `Listening ${formatSeconds(0)}`;
    else if (stage === 'processing') this.voiceLabel.textContent = 'Writing down what you said...';
    if (stage !== 'recording') this.avatar.style.removeProperty('--voice-level');
    this.showVoiceAvailability();
    this.applyMood();
  }

  /**
   * Say up front when talking cannot work here - voice switched off on the
   * server, or the microphone blocked - instead of finding out after a recording.
   */
  private async checkVoice(): Promise<void> {
    if (!voiceSupport().ok) return;
    await Promise.all([this.voiceSwitch.check(), this.checkMicrophone()]);
    this.showVoiceAvailability();
  }

  /** The microphone permission as far as the browser says without prompting. */
  private async checkMicrophone(): Promise<void> {
    if (!voiceSupport().ok) return;
    this.micPermission = await microphonePermission();
    this.renderMicHint();
  }

  /**
   * Why talking cannot start here, if it cannot: switched off on the server
   * (that comes first - no grown-up can change it on this device), or not
   * switched on for this device by a grown-up.
   */
  private voiceOff(): 'server' | 'grown-up' | null {
    if (this.voiceSwitch.current === 'off') return 'server';
    return voiceSetting.allowed ? null : 'grown-up';
  }

  /** While voice is switched off the microphone button says so (it stays tappable, to explain) - it never pretends to listen. */
  private showVoiceAvailability(): void {
    if (!voiceSupport().ok) return;
    const off = this.voiceOff();
    this.micButton.classList.toggle('st-ai__mic--off', off !== null);
    if (off) this.micButton.setAttribute('aria-disabled', 'true');
    else this.micButton.removeAttribute('aria-disabled');
    if (this.voice.current === 'idle') {
      const label = off === 'server' ? VOICE_OFF_LABEL : off === 'grown-up' ? GROWN_UP_OFF_LABEL : null;
      this.micButton.setAttribute('aria-label', label ?? 'Talk to EAVARA');
      this.micButton.title = label ?? '';
    }
    this.renderMicHint();
  }

  /** One line under the box: voice switched off (server, then this device), else the microphone blocked, else nothing. */
  private renderMicHint(): void {
    const off = voiceSupport().ok ? this.voiceOff() : null;
    const blocked = this.micPermission === 'denied';
    this.micHint.hidden = !off && !blocked;
    this.micHint.textContent = off === 'server' ? VOICE_OFF_HINT : off === 'grown-up' ? GROWN_UP_OFF_HINT : blocked ? MIC_BLOCKED_HINT : '';
    this.micHint.classList.toggle('st-ai__hint--off', off !== null);
  }

  // ------------------------------------------------------------ helpers

  /** The error look for a few seconds after a problem (the message in the chat says what to do). */
  private showError(): void {
    this.errorUntil = Date.now() + ERROR_MOOD_MS;
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => {
      this.errorTimer = null;
      this.applyMood();
    }, ERROR_MOOD_MS + 50);
    this.applyMood();
  }

  /** Which state EAVARA is in, from the existing ones: voice stage, a request on its way, a preview, a recent problem. */
  private mood(): AgentMood {
    const stage = this.voice.current;
    if (stage === 'recording' || stage === 'asking') return 'listening';
    if (this.busy || stage === 'processing') return 'thinking';
    if (Date.now() < this.errorUntil) return 'error';
    if (this.previewing) return 'previewing';
    return 'idle';
  }

  private applyMood(): void {
    const mood = this.mood();
    if (this.root.dataset.mood !== mood) this.root.dataset.mood = mood;
    const label = MOOD_LABELS[mood] ?? this.contextLabel;
    if (this.subtitle.textContent !== label) this.subtitle.textContent = label;
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    if (busy) this.errorUntil = 0;
    this.sendButton.disabled = busy;
    this.input.disabled = busy || this.voice.current !== 'idle';
    this.micButton.disabled = busy || !voiceSupport().ok;
    this.goals.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = busy));
    if (!busy) this.showStatus(null);
    this.applyMood();
  }

  private showStatus(text: string | null): void {
    this.status.hidden = text === null;
    this.status.textContent = text ?? '';
  }

  private say(who: 'child' | 'eavara', text: string, options: SayOptions = {}): void {
    const bubble = el('div', `st-ai__msg st-ai__msg--${who}`);
    bubble.appendChild(el('p', '', text));
    for (const line of options.extra ?? []) bubble.appendChild(el('p', 'st-ai__note', line));
    if (options.understood?.length) {
      const row = el('div', 'st-ai__understood');
      row.appendChild(el('span', 'st-ai__understood-label', 'I understood'));
      for (const chip of options.understood) row.appendChild(el('span', 'st-ai__fact', chip));
      bubble.appendChild(row);
    }
    if (options.choices?.length) {
      const row = el('div', 'st-ai__choices');
      for (const choice of options.choices) {
        const button = el('button', 'st-ai__chip st-ai__chip--choice', choice);
        button.type = 'button';
        button.addEventListener('click', () => void this.send(choice));
        row.appendChild(button);
      }
      bubble.appendChild(row);
    }
    if (options.tip) {
      const tip = el('div', 'st-ai__tip');
      tip.append(el('span', 'st-ai__tip-concept', options.tip.concept), el('p', '', options.tip.text));
      bubble.appendChild(tip);
    }
    if (options.retry) {
      const retry = el('button', 'st-ai__chip st-ai__chip--strong', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', options.retry);
      bubble.appendChild(retry);
    }
    // Always say who understood the request: the AI model, the offline helper, or a ready-made idea.
    if (options.source) {
      const label =
        options.source === 'ai' ? 'AI helper' : options.source === 'template' ? 'ready-made idea' : options.source === 'device' ? 'done on this device' : 'offline helper';
      bubble.appendChild(el('span', `st-ai__tag st-ai__tag--${options.source}`, label));
    }
    this.log.appendChild(bubble);
    while (this.log.children.length > MAX_MESSAGES) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
    if (this.open) this.refresh();
  }
}

function formatSeconds(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
