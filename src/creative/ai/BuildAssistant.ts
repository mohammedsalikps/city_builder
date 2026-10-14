import { planInput, type ConstructionPlan, type HousePlan, type PlanSite } from '@/creative/plan/ConstructionPlan';
import { neighborhoodHouse } from '@/creative/plan/NeighborhoodLayout';
import type { LayoutFacts } from '@/creative/plan/LayoutKit';
import type { PlanBuilder, PlanPreviewResult } from '@/creative/plan/PlanBuilder';
import { AiServiceError, requestIntent, type Interpreter } from './AiClient';
import { readBuildIntent, restoreHiddenName, toModelPlan, toPlanInput, type BuildAction, type BuildIntent } from './BuildIntent';
import { asksForNew, interpretLocally } from './LocalInterpreter';
import { interpretInteriorCommand, type FurnitureWord, type InteriorCommand, type Near } from './InteriorCommands';
import type { RoomType } from '@/creative/plan/ConstructionPlan';
import type { PaintColour } from '@/creative/colours';

export interface AssistantTurn {
  /** What EAVARA says back. */
  reply: string;
  /**
   * Who understood the request: the AI model, the offline helper, a
   * ready-made idea (template), or the game itself on this device (Interior
   * Explorer commands - "go to the kitchen" - never leave the device).
   */
  source: 'ai' | 'offline' | 'template' | 'device';
  /** Model id when the AI answered. */
  model: string | null;
  /** Why the offline helper was used, when it was. */
  aiError: string | null;
  action: BuildAction;
  /** The preview that was shown (or why not), for build / add / modify / move. */
  preview: PlanPreviewResult | null;
  /** For a clarifying question: short answers the child can tap. */
  choices: string[];
}

/** A starting idea in the AI builder: a request for the AI, or one of World Studio's ready-made templates. */
export interface BuildGoal {
  id: string;
  label: string;
  icon: string;
  /** Sent to the AI builder as if the child had said it. */
  prompt?: string;
  /** Or: a ready-made template, previewed the same way. */
  templateId?: string;
  creationId?: string;
  name?: string;
}

/** Every starting idea is a real, planned creation - understood by the AI (or the offline helper), previewed, confirmed. */
export const BUILD_GOALS: readonly BuildGoal[] = [
  { id: 'home', label: 'Build my first home', icon: 'home', prompt: 'Build me a cosy first home with two bedrooms, a kitchen, a bathroom, a garden and a pitched roof' },
  { id: 'garden', label: 'Design a garden', icon: 'flower', prompt: 'Design a garden with flower beds, a path, a bench and a fence' },
  { id: 'park', label: 'Create a park', icon: 'tree', prompt: 'Create a park with paths, trees, benches and a playground' },
  { id: 'treehouse', label: 'Build a treehouse', icon: 'treehouse', prompt: 'Build a treehouse with a ladder, railings and a little hut with a roof' },
  { id: 'neighborhood', label: 'Plan a neighbourhood', icon: 'neighborhood', prompt: 'Plan a neighbourhood with four houses along a street and a small park' },
];

/** Words that move a creation somewhere else on purpose. */
const ASKS_TO_PLACE = /lake|water|shore|home|here|move|put|shift|behind|front|beside|next to/i;

/**
 * One conversation turn of EAVARA's AI builder:
 *
 *   child's words -> AI model (server) -> validated BuildIntent
 *                 \-> offline helper, when the AI cannot be reached
 *   BuildIntent   -> PlanBuilder preview (new creation, loose things added,
 *                    changed creation or moved creation)
 *
 * The assistant never builds: the child confirms the preview with the
 * normal "Place here" control. Follow-ups apply to the planned creation the
 * child has selected, else the one they last worked on (or, failing that,
 * the one built most recently) - and an ambiguous follow-up ("make the
 * house bigger") changes it rather than building a second one.
 */
/** Places EAVARA offered because the one asked for was taken, waiting for the child's answer. */
interface PendingOffer {
  /** The plan as asked for (its site is replaced by the chosen place). */
  input: Record<string, unknown>;
  /** The creation being changed, or null for a new one. */
  revisionOf: string | null;
  alternatives: Array<{ site: PlanSite; label: string }>;
  source: AssistantTurn['source'];
  model: string | null;
}

/** Answers that take the first place offered, or turn the offer down. */
const YES = /^(yes|yeah|yep|yup|ok|okay|sure|please|do it|go on|go ahead|that one)\b/;
const NO = /^(no|nope|nah|not now|cancel|dont|don't|stop)\b/;
/** Words that name one of the places on offer. */
const PLACE_WORDS: Array<[RegExp, (site: PlanSite) => boolean]> = [
  [/\b(beside|next to|side)\b/, (s) => 'beside' in s && s.beside === 'side'],
  [/\b(front)\b/, (s) => 'beside' in s && s.beside === 'front'],
  [/\b(behind|back)\b/, (s) => 'beside' in s && s.beside === 'back'],
  [/\b(looking|here)\b/, (s) => 'near' in s && s.near === 'view'],
  [/\bhome\b/, (s) => 'near' in s && s.near === 'home'],
  [/\blake\b/, (s) => 'near' in s && s.near === 'lake'],
];

/** What a game-side interior action reports: done or not, in the child's words. */
export interface InteriorOutcome {
  ok: boolean;
  message: string;
  /** Short answers to offer next (room names, "Yes, do it"...). */
  choices?: string[];
}

/**
 * The game's Interior Explorer, as the assistant sees it. Every method
 * reports what really happened - the assistant never claims more.
 */
export interface InteriorPort {
  isInside(): boolean;
  /** True while a change is shown and waiting for the child's yes or no. */
  hasProposal(): boolean;
  enter(): InteriorOutcome;
  exit(): InteriorOutcome;
  goToRoom(type: RoomType, ordinal: number | null): Promise<InteriorOutcome>;
  setView(view: 'walk' | 'dollhouse'): InteriorOutcome;
  tour(): InteriorOutcome;
  add(item: FurnitureWord, count: number, room: { type: RoomType; ordinal: number | null } | 'here' | null, near: Near | null): Promise<InteriorOutcome>;
  move(item: FurnitureWord | 'it', near: Near): InteriorOutcome;
  paint(item: FurnitureWord | 'it', colour: PaintColour, room: { type: RoomType; ordinal: number | null } | null): Promise<InteriorOutcome>;
  confirm(): InteriorOutcome;
  cancel(): InteriorOutcome;
}

/** Answers to a change waiting for the child's yes or no. */
const PROPOSAL_YES = /^(yes|yeah|yep|yup|ok|okay|sure|please|do it|yes do it|go on|go ahead|add it|move it|paint it|yes please)\b/;
const PROPOSAL_NO = /^(no|nope|nah|no thanks|not now|cancel|don't|dont|stop|leave it)\b/;

export class BuildAssistant {
  private newNext = false;
  private offer: PendingOffer | null = null;
  private interior: InteriorPort | null = null;
  private readonly builtListeners = new Set<(groupId: string, plan: ConstructionPlan, facts: LayoutFacts) => void>();

  constructor(
    private readonly planBuilder: PlanBuilder,
    private readonly interpret: Interpreter = requestIntent,
  ) {}

  /** Told (by Game, from PlanBuilder) when a previewed plan has been built. */
  notifyBuilt(groupId: string, plan: ConstructionPlan, facts: LayoutFacts): void {
    this.newNext = false;
    this.builtListeners.forEach((listener) => listener(groupId, plan, facts));
  }

  onBuilt(listener: (groupId: string, plan: ConstructionPlan, facts: LayoutFacts) => void): () => void {
    this.builtListeners.add(listener);
    return () => this.builtListeners.delete(listener);
  }

  /** The planned creation follow-ups will change, or null when the next request starts something new. */
  get target(): { groupId: string; plan: ConstructionPlan } | null {
    return this.newNext ? null : this.planBuilder.currentPlan();
  }

  /** Make the next request about something brand-new, even if a creation is standing. */
  startNew(): void {
    this.newNext = true;
  }

  /** Forget the conversation's state (an offer waiting for an answer), as when everything on this device is deleted. */
  reset(): void {
    this.newNext = false;
    this.offer = null;
  }

  /** Connect Interior Explorer (Game does this; tests use a fake). */
  setInteriorPort(port: InteriorPort | null): void {
    this.interior = port;
  }

  /**
   * Interior Explorer requests, answered on the device before anything is
   * sent to the AI: yes/no to a change on show, then going inside/outside,
   * rooms, views, the tour and furniture changes. Null when the words are
   * not an interior request (the AI builder handles them as before).
   */
  private async answerInterior(text: string): Promise<AssistantTurn | null> {
    const port = this.interior;
    if (!port) return null;
    const t = text.toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim();
    const turn = (outcome: InteriorOutcome): AssistantTurn => ({
      reply: outcome.message,
      source: 'device',
      model: null,
      aiError: null,
      action: 'chat',
      preview: null,
      choices: outcome.choices ?? [],
    });
    if (port.hasProposal()) {
      if (PROPOSAL_YES.test(t)) return turn(port.confirm());
      if (PROPOSAL_NO.test(t)) return turn(port.cancel());
    }
    const command: InteriorCommand | null = interpretInteriorCommand(text, { inside: port.isInside() });
    if (!command) return null;
    switch (command.kind) {
      case 'enter':
        return turn(port.isInside() ? { ok: true, message: "We're already inside! Which room would you like to see?" } : port.enter());
      case 'exit':
        return turn(port.isInside() ? port.exit() : { ok: true, message: "We're already outside." });
      case 'room':
        return turn(await port.goToRoom(command.type, command.ordinal));
      case 'view':
        return turn(port.setView(command.view));
      case 'tour':
        return turn(port.tour());
      case 'add':
        return turn(await port.add(command.item, command.count, command.room, command.near));
      case 'move':
        return turn(port.move(command.item, command.near));
      case 'paint':
        return turn(await port.paint(command.item, command.colour, command.room));
      case 'cannot-paint':
        return turn({ ok: false, message: `I can paint furniture and decorations, but not the ${command.what} yet. Tap a piece of furniture and choose Colour!` });
    }
  }

  /** Start from one of the BUILD_GOALS. */
  async startGoal(goal: BuildGoal): Promise<AssistantTurn> {
    if (goal.prompt) {
      // A goal always starts something new (and if it cannot be shown, nothing changes).
      const before = this.newNext;
      this.newNext = true;
      const turn = await this.ask(goal.prompt);
      if (!turn.preview?.ok) this.newNext = before;
      return turn;
    }
    const name = goal.name ?? goal.label;
    const preview = this.planBuilder.previewTemplate(goal.templateId ?? '', { label: name, creationId: goal.creationId ?? 'park' });
    return {
      reply: preview.ok ? `Here is a ${name.toLowerCase()} for you to look at. Place it, move it, or ask me for a house!` : preview.errors[0] ?? 'That idea is not ready yet.',
      source: 'template',
      model: null,
      aiError: null,
      action: 'build',
      preview,
      choices: [],
    };
  }

  /** Whether EAVARA is waiting for the child to pick one of the places it offered. */
  get offering(): boolean {
    return this.offer !== null;
  }

  /**
   * The child's answer to an offer of other places: a place picked (by its
   * button, its words, or "yes" for the first), or "no". Anything else is a
   * new request, and the offer is dropped. Nothing is built either way - a
   * picked place is only previewed, for the child to confirm.
   */
  private answerOffer(text: string): AssistantTurn | null {
    const offer = this.offer;
    if (!offer) return null;
    const t = text.toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim();
    const turn = (reply: string, preview: PlanPreviewResult | null): AssistantTurn => ({ reply, source: offer.source, model: offer.model, aiError: null, action: preview ? 'build' : 'chat', preview, choices: [] });
    if (NO.test(t)) {
      this.offer = null;
      return turn("Okay, I won't build it. What shall we do instead?", null);
    }
    const byLabel = offer.alternatives.find((a) => a.label.toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim() === t);
    const byWords = PLACE_WORDS.map(([words, matches]) => (words.test(t) ? offer.alternatives.find((a) => matches(a.site)) : undefined)).find(Boolean);
    const chosen = byLabel ?? byWords ?? (YES.test(t) ? offer.alternatives[0] : undefined);
    if (!chosen) return null;
    this.offer = null;
    const input = { ...offer.input, site: siteInput(chosen.site) };
    const preview = offer.revisionOf ? this.planBuilder.previewRevision(offer.revisionOf, input) : this.planBuilder.preview(input);
    if (preview.ok) this.newNext = false;
    return turn(preview.ok ? `Okay! Here it is ${chosen.label.toLowerCase()}. Tap "Place here" if you like it.` : preview.errors[0] ?? "That place is taken now too.", preview);
  }

  /** The neighbourhood house follow-ups apply to: the one whose change is on screen, else the one picked; null for anything else. */
  private houseInFocus(
    active: ReturnType<PlanBuilder['activePreview']>,
    target: { groupId: string; plan: ConstructionPlan } | null,
  ): { groupId: string; index: number; plan: HousePlan } | null {
    if (active) {
      if (active.revisionOf === null || active.house === null || active.plan.kind !== 'neighborhood') return null;
      return { groupId: active.revisionOf, index: active.house, plan: neighborhoodHouse(active.plan, active.house) };
    }
    if (target?.plan.kind !== 'neighborhood') return null;
    const focus = this.planBuilder.houseFocus();
    return focus && focus.groupId === target.groupId ? focus : null;
  }

  async ask(text: string): Promise<AssistantTurn> {
    const answered = this.answerOffer(text);
    if (answered) return answered;
    const interior = await this.answerInterior(text);
    if (interior) {
      this.offer = null;
      return interior;
    }
    this.offer = null;
    // While a plan is on screen, follow-ups change that plan; otherwise the target creation.
    const active = this.planBuilder.activePreview();
    const target = active ? null : this.target;
    // One house of a neighbourhood picked to work on (or its change on screen): follow-ups change that house alone.
    const house = this.houseInFocus(active, target);
    const currentPlan = house?.plan ?? active?.plan ?? target?.plan ?? null;
    const current = currentPlan ? toModelPlan(currentPlan) : null;
    const context = { hasHouse: this.planBuilder.currentHouse() !== null };
    let intent: BuildIntent | null = null;
    let model: string | null = null;
    let aiError: string | null = null;
    try {
      const response = await this.interpret(text, current, context);
      const read = readBuildIntent(response.intent);
      // The AI never saw the creation's name (see HIDDEN_NAME): put it back.
      intent = read && restoreHiddenName(read, current);
      model = response.model || null;
      if (!intent) aiError = 'unreadable-answer';
    } catch (error) {
      aiError = error instanceof AiServiceError ? error.code : 'failed';
    }
    const source: AssistantTurn['source'] = intent ? 'ai' : 'offline';
    if (!intent) {
      intent = interpretLocally(text, current, context);
      model = null;
    }
    const plan = intent.plan;
    // Inside a house, "move" never means moving the whole house away from under the child.
    if (intent.action === 'move' && this.interior?.isInside()) {
      return {
        reply: 'Inside the house I can move furniture: tap a piece and use Move, or say "move the bed near the window". To move the whole house, go outside first.',
        source,
        model,
        aiError,
        action: 'chat',
        preview: null,
        choices: [],
      };
    }
    // An ambiguous "build" of the same kind as the creation being worked on changes it - never a duplicate.
    if (intent.action === 'build' && plan && currentPlan && plan.kind === currentPlan.kind && !asksForNew(text, currentPlan.kind)) intent.action = 'modify';
    // A change should not wander off to another place unless the child asked for that.
    if (intent.action === 'modify' && plan && current && plan.kind === current.kind && plan.site !== current.site && !ASKS_TO_PLACE.test(text)) {
      plan.site = current.site;
    }

    let preview: PlanPreviewResult | null = null;
    let reply = intent.reply;
    // What was asked for, so an offer of other places can repeat it with only the place changed.
    let asked: { input: Record<string, unknown>; revisionOf: string | null } | null = null;
    const sameKind = (other: ConstructionPlan | null | undefined) => !!plan && !!other && plan.kind === other.kind;
    if (house && intent.action === 'modify' && plan?.kind === 'house') {
      preview = this.planBuilder.previewHouseRevision(house.groupId, house.index, toPlanInput(plan));
    } else if (active && (intent.action === 'move' || (intent.action === 'modify' && sameKind(active.plan)))) {
      const input = intent.action === 'modify' ? toPlanInput(plan!) : planInput(active.plan);
      preview = this.planBuilder.reviseActivePreview(input, intent.move);
      asked = { input, revisionOf: active.revisionOf };
    } else if (intent.action === 'modify' && target && sameKind(target.plan)) {
      asked = { input: toPlanInput(plan!), revisionOf: target.groupId };
      preview = this.planBuilder.previewRevision(target.groupId, asked.input);
    } else if (intent.action === 'build' || intent.action === 'add' || intent.action === 'modify') {
      asked = { input: toPlanInput(plan!), revisionOf: null };
      preview = this.planBuilder.preview(asked.input);
      if (preview.ok) this.newNext = false;
    } else if (intent.action === 'move') {
      if (target) preview = this.planBuilder.previewRevision(target.groupId, planInput(target.plan), intent.move);
      else reply = "Let's build something first - then I can move it!";
    }
    let choices = intent.action === 'clarify' ? intent.choices : [];
    if (preview && !preview.ok) {
      reply = preview.errors[0] ?? "I couldn't do that one.";
      // The place asked for is taken: offer the free places nearby, and wait for the child to pick one.
      if (preview.offer && asked) {
        this.offer = { ...asked, alternatives: preview.offer.alternatives, source, model };
        choices = [...preview.offer.alternatives.map((a) => a.label), 'No thanks'];
      }
    }
    if (!reply) reply = preview?.ok ? 'Here is my plan. Do you like it?' : 'Tell me what to build!';
    return { reply, source, model, aiError, action: intent.action, preview, choices };
  }
}

/** A place in the plan input format. */
function siteInput(site: PlanSite): Record<string, unknown> {
  if ('beside' in site) return { beside: site.beside };
  if ('near' in site) return { near: site.near };
  return { at: { ...site.at } };
}
