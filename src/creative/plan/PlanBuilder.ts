import type { GameStore } from '@/state/GameStore';
import type { GameActions, TemplateInstantiateResult } from '@/state/actions';
import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import type { PlacedObject, Vec3 } from '@/construction/PlacedObject';
import type { PlacementRulesContext } from '@/construction/PlacementResolver';
import type { TemplateObjectSpec, TemplateRegistry } from '@/creative/Template';
import type { WorldSpace } from '@/world/WorldSpace';
import { rotateAroundY } from '@/utils/math';
import { computeBounds } from '@/construction/bounds';
import {
  houseEditInput,
  itemName,
  KIND_NAMES,
  OBJECT_ITEMS,
  parseConstructionPlan,
  planInput,
  roomName,
  ROOM_TYPES,
  SIZE_LIMITS,
  type ConstructionPlan,
  type HousePlan,
  type NeighborhoodHouseEdit,
  type NeighborhoodPlan,
  type PlanKind,
  type PlanSite,
  type RoomType,
  type SiteAnchor,
  type SiteSide,
} from './ConstructionPlan';
import { isContentKey, type LayoutFacts, type LocalRect, type PlanLayout } from './LayoutKit';
import { neighborhoodHouse } from './NeighborhoodLayout';
import { describePlan, describeTemplate, KIND_CREATION, kindIcon, layoutPlan } from './PlanLayouts';
import { chooseSite, chooseSiteNear, CONNECTED_MARGIN, fitsExactly, siteConflict, worldRect, type SiteChoice, type SiteConflict, type SiteContext } from './PlanSite';
import type { PlanRecord, PlanStore, PlannedPiece } from './PlanRecords';

export { describePlan } from './PlanLayouts';

/** How far a changed creation may shift to find room for its new size, metres. */
const REVISION_REACH = 16;
/** How far a creation moved by a few metres may shift to find a free spot, metres. */
const SHIFT_REACH = 10;
const MAX_SHIFT = 80;

export interface PlanPreviewSummary {
  /** The runtime template being previewed (see TemplateRegistry.upsert). */
  templateId: string;
  name: string;
  /** What is planned (null for a ready-made template). */
  kind: PlanKind | null;
  /** Main size actually laid out, metres (house walls, garden ground, treehouse deck...). */
  width: number;
  depth: number;
  /** Rooms actually laid out, by type (houses). */
  rooms: Partial<Record<RoomType, number>>;
  pieces: number;
  origin: { x: number; z: number };
  rotationY: number;
  /** For a changed creation: what is different, in child-friendly words ("4 m wider", "2 more benches"). */
  changes: string[];
  /** For a changed creation: how many of the child's own edits are kept. */
  keptEdits: number;
  /** What was understood, as short chips ("30 × 20 m", "3 bedrooms", "by the lake"), from the validated plan and its layout. */
  understood: string[];
  /** The validated plan shown (null for a ready-made template such as a park). */
  plan: ConstructionPlan | null;
  /** For a change to one house of a neighbourhood: which house (0-based). */
  house?: number;
  /** Measured facts about the layout (null for a ready-made template). */
  facts: LayoutFacts | null;
}

export interface PlanPreviewResult {
  ok: boolean;
  /** Why nothing is shown (child-friendly). */
  errors: string[];
  /** What was adjusted on the way (child-friendly). */
  notes: string[];
  /** Ignored input, for the console. */
  warnings: string[];
  summary: PlanPreviewSummary | null;
  /**
   * When the place asked for is taken: the places nearby where it WOULD fit,
   * offered to the child (errors[0] explains and asks). Nothing is shown or
   * built there until the child picks one.
   */
  offer?: PlacementOffer;
}

/** Alternative places for a creation whose requested place is taken. */
export interface PlacementOffer {
  /** Why the requested place is taken. */
  conflict: SiteConflict | null;
  /** Places where it fits, best first, each with the words of a tappable answer. */
  alternatives: Array<{ site: PlanSite; label: string }>;
}

/** A follow-up move: to a named place, or by metres as the child sees the screen. */
export interface PlanMove {
  near: SiteAnchor | null;
  right: number;
  forward: number;
}

interface PendingPlan {
  plan: ConstructionPlan;
  facts: LayoutFacts;
  /** The planned creation this preview is a new version of; null for a new one. */
  revisionOf: string | null;
  keys: string[];
  removedKeys: string[];
  /** Pieces of the earlier version carried into this one, and where they were generated. */
  carried: Array<{ id: string; piece: PlannedPiece | null }>;
  from: { origin: Vec3; rotationY: number } | null;
  /** For a change to one house of a neighbourhood: which house (0-based). */
  house: number | null;
}

/**
 * From a construction plan to a preview in the real world, and from a
 * follow-up request to a changed version of a planned creation - a house, a
 * garden, a park, a neighbourhood, a treehouse or a few loose things:
 *
 *   untrusted plan -> parseConstructionPlan (validate, clamp)
 *                  -> layoutPlan (catalogue pieces, creation-local)
 *                  -> chooseSite (a free spot, same rules as placement)
 *                  -> a runtime template, previewed as a pinned ghost
 *
 * Confirming the ghost (World Studio's "Place here", or Enter) builds it
 * through `GameActions.instantiateTemplate` like any template, so the result
 * is ordinary placed objects: editable, undoable and saved with My World.
 * Cancelling it changes nothing.
 *
 * A changed version replaces the earlier one in the same step, keeping the
 * child's own work: contents they moved, turned or resized (furniture,
 * plants, benches, play equipment...) are carried along unchanged, and
 * contents they removed stay removed. Structure (walls, floors, fences,
 * paths, decks) follows the new plan. Objects that are not part of the
 * creation are never touched.
 */
export class PlanBuilder {
  private serial = 0;
  private previewTemplateId: string | null = null;
  private readonly pending = new Map<string, PendingPlan>();
  private readonly records: Record<string, PlanRecord>;
  /** Versions built this session: kept even while undone, so redo still finds their plan. */
  private readonly sessionGroups = new Set<string>();
  /** The selection last seen by `noteSelection`. */
  private seenSelection: string | null = null;
  /**
   * The planned creation the child last worked on (selected, previewed a
   * change of, or built), and which version each change replaced - so a
   * cancelled or undone change keeps follow-ups on the same creation even
   * when something else was built more recently.
   */
  private lastWorkedOn: string | null = null;
  private readonly replaced = new Map<string, string>();

  /** Called when a preview is shown: its world centre, rough radius and heading - lets Game.ts frame it. */
  onPreview: ((center: { x: number; y: number; z: number }, radius: number, rotationY: number) => void) | null = null;
  /** Called once a previewed plan has been built (or rebuilt), with what its layout really contains. */
  onBuilt: ((groupId: string, plan: ConstructionPlan, facts: LayoutFacts) => void) | null = null;

  constructor(
    private readonly store: GameStore,
    private readonly actions: GameActions,
    private readonly registry: ObjectRegistry,
    private readonly templates: TemplateRegistry,
    private readonly placementRules: PlacementRulesContext,
    private readonly worldSpace: WorldSpace,
    private readonly view: () => { x: number; z: number; azimuth: number },
    private readonly planStore: PlanStore | null = null,
  ) {
    this.records = planStore?.load() ?? {};
  }

  /**
   * The planned creation a follow-up request is about: the one the selected
   * piece belongs to, else the most recently built version still standing.
   */
  currentPlan(): { groupId: string; plan: ConstructionPlan } | null {
    const groupId = this.pick(() => true);
    return groupId ? { groupId, plan: this.records[groupId].plan } : null;
  }

  /**
   * The plan record behind a planned creation, read-only (Interior Explorer
   * recomputes the house's rooms from it). Null for anything not planned here.
   */
  recordOf(groupId: string): Readonly<Pick<PlanRecord, 'plan' | 'origin' | 'rotationY' | 'pieces' | 'focusHouse'>> | null {
    const record = this.records[groupId];
    return record ? { plan: record.plan, origin: { ...record.origin }, rotationY: record.rotationY, pieces: record.pieces, focusHouse: record.focusHouse } : null;
  }

  /** What a planned creation really is (its kind and name), or null for anything not planned here. */
  planOf(groupId: string): { kind: PlanKind; name: string } | null {
    const record = this.records[groupId];
    return record ? { kind: record.plan.kind, name: record.plan.name } : null;
  }

  /** The child's house (for "behind the house"): the selected one, else the newest one standing. */
  currentHouse(): { groupId: string; plan: ConstructionPlan } | null {
    const groupId = this.pick((plan) => plan.kind === 'house');
    return groupId ? { groupId, plan: this.records[groupId].plan } : null;
  }

  /** The planned preview on screen right now (not built yet), if any. */
  activePreview(): { plan: ConstructionPlan; revisionOf: string | null; origin: Vec3; rotationY: number; house: number | null } | null {
    const placement = this.store.getState().templatePlacement;
    if (!placement?.origin || placement.templateId !== this.previewTemplateId) return null;
    const pending = this.pending.get(placement.templateId);
    if (!pending) return null;
    return { plan: pending.plan, revisionOf: pending.revisionOf, origin: { ...placement.origin }, rotationY: placement.rotationY, house: pending.house };
  }

  /** Which house of a planned neighbourhood a placed piece belongs to (its layout key starts "h2/"), or null. */
  houseOf(instanceId: string): { groupId: string; index: number } | null {
    const groupId = this.store.getState().placedObjects.find((p) => p.id === instanceId)?.group?.id;
    const record = groupId ? this.records[groupId] : undefined;
    if (!groupId || !record || record.plan.kind !== 'neighborhood') return null;
    const index = houseIndex(record.pieces[instanceId]?.key);
    return index !== null && index < record.plan.houses ? { groupId, index } : null;
  }

  /**
   * Told whenever the selection changes: tapping a piece of a neighbourhood
   * picks its house to work on, and tapping its street or park picks the
   * whole neighbourhood. Clearing the selection keeps the house picked.
   */
  noteSelection(instanceId: string | null): void {
    if (instanceId === this.seenSelection) return;
    this.seenSelection = instanceId;
    const groupId = instanceId ? this.store.getState().placedObjects.find((p) => p.id === instanceId)?.group?.id : undefined;
    if (!instanceId || !groupId || !this.records[groupId]) return;
    this.lastWorkedOn = groupId;
    if (this.records[groupId].plan.kind === 'neighborhood') this.setHouseFocus(groupId, this.houseOf(instanceId)?.index ?? null);
  }

  /**
   * The house of a neighbourhood the child is working on, when the creation
   * follow-ups apply to is a neighbourhood and one of its houses is picked;
   * null means the whole neighbourhood (or no neighbourhood at all).
   */
  houseFocus(): { groupId: string; index: number; plan: HousePlan; houses: number } | null {
    this.noteSelection(this.store.getState().selectedInstanceId);
    const current = this.currentPlan();
    if (!current || current.plan.kind !== 'neighborhood') return null;
    const index = this.records[current.groupId].focusHouse;
    return index === undefined ? null : { groupId: current.groupId, index, plan: neighborhoodHouse(current.plan, index), houses: current.plan.houses };
  }

  /** Pick one house of a neighbourhood to work on (null: the whole neighbourhood). Kept with the plan, so it survives undo, redo and reloads. */
  setHouseFocus(groupId: string, index: number | null): void {
    const record = this.records[groupId];
    if (!record || record.plan.kind !== 'neighborhood') return;
    const next = index !== null && Number.isInteger(index) && index >= 0 && index < record.plan.houses ? index : undefined;
    if (record.focusHouse === next) return;
    if (next === undefined) delete record.focusHouse;
    else record.focusHouse = next;
    this.saveRecords();
  }

  /**
   * Forget every plan held in memory - records, previews waiting to be
   * built, and which creation was being worked on - as part of deleting
   * everything on this device. Nothing is saved here: an empty memory has
   * nothing to write back (the stored copy is removed separately).
   */
  forgetAll(): void {
    for (const id of Object.keys(this.records)) delete this.records[id];
    // The templates made from plans (named after them) go too.
    for (const template of this.templates.list()) if (template.id.startsWith('plan-')) this.templates.remove(template.id);
    this.pending.clear();
    this.sessionGroups.clear();
    this.replaced.clear();
    this.previewTemplateId = null;
    this.seenSelection = null;
    this.lastWorkedOn = null;
  }

  /** A piece that shows where a house of a neighbourhood is (its front door, else a wall, else any piece), for selecting it. */
  housePiece(groupId: string, index: number): string | null {
    const record = this.records[groupId];
    if (!record) return null;
    const standing = new Set(this.store.getState().placedObjects.filter((p) => p.group?.id === groupId).map((p) => p.id));
    const ids = Object.entries(record.pieces).filter(([id, piece]) => standing.has(id) && houseIndex(piece.key) === index);
    const rank = (key: string) => (key.includes('/opening:wf') ? 0 : key.includes('/wall:wf') ? 1 : key.includes('/wall:') ? 2 : 3);
    ids.sort(([, a], [, b]) => rank(a.key) - rank(b.key));
    return ids[0]?.[0] ?? null;
  }

  /** Validate a plan, lay it out, find it a site and show it as a pinned ghost. */
  preview(input: unknown): PlanPreviewResult {
    const prepared = this.prepare(input);
    if ('result' in prepared) return prepared.result;
    const { plan, layout, notes, warnings } = prepared;
    const context = this.siteContext([], plan.site);
    if ('beside' in plan.site && !context.anchor) notes.push(`There's no house yet, so I put the ${KIND_NAMES[plan.kind]} where you are looking.`);
    const site = chooseSite(plan.site, layout.extent, layout.objects, context);
    if (!site) return this.offerAlternatives(plan, layout, layout.objects, [], notes, warnings);
    return this.show(plan, layout, layout.objects, layout.keys, site, notes, warnings, null);
  }

  /**
   * A follow-up while the child is still looking at a preview: change the
   * plan being previewed (it stays about where it is unless moved).
   */
  reviseActivePreview(input: unknown, move: PlanMove | null = null): PlanPreviewResult | null {
    const active = this.activePreview();
    if (!active) return null;
    if (active.revisionOf && active.house !== null) {
      if (move) return failure(['A house on a street stays on its own plot. Place this change first - then I can move the whole neighbourhood.']);
      return this.previewHouseRevision(active.revisionOf, active.house, input);
    }
    if (active.revisionOf) return this.previewRevision(active.revisionOf, input, move);
    const prepared = this.prepare(input);
    if ('result' in prepared) return prepared.result;
    const { plan, layout, notes, warnings } = prepared;
    const base = { plan: active.plan, origin: active.origin, rotationY: active.rotationY };
    const site = this.revisionSite(base, plan, move, layout.extent, layout.objects, []);
    if (!site) return !move && !sameSite(active.plan.site, plan.site) ? this.offerAlternatives(plan, layout, layout.objects, [], notes, warnings, active.plan.site) : noRoom(plan, layout, notes, warnings);
    const result = this.show(plan, layout, layout.objects, layout.keys, site, notes, warnings, null);
    if (result.summary) result.summary.changes = describeChanges(active.plan, plan, site, base);
    return result;
  }

  /**
   * Show a changed version of a planned creation (`groupId`) as a pinned
   * ghost: a revised plan, a move, or both. Confirming it replaces the old version.
   */
  previewRevision(groupId: string, input: unknown, move: PlanMove | null = null): PlanPreviewResult {
    const record = this.records[groupId];
    const state = this.store.getState();
    const members = state.placedObjects.filter((p) => p.group?.id === groupId);
    if (!record || members.length === 0) return failure(["I can't find that any more. Ask me to build something new!"]);
    const prepared = this.prepare(withHouseEdits(record.plan, input));
    if ('result' in prepared) return prepared.result;
    const { plan, layout, notes, warnings } = prepared;
    if (plan.kind !== record.plan.kind) {
      return failure([`That is a ${KIND_NAMES[record.plan.kind]}, so I can't turn it into a ${KIND_NAMES[plan.kind]}. Ask me to build a new one instead!`]);
    }

    // Sort the old version's pieces: the child's own edits stay, the rest is rebuilt.
    const memberIds = new Set(members.map((m) => m.id));
    const removedKeys = new Set(record.removedKeys);
    for (const [id, piece] of Object.entries(record.pieces)) {
      if (!memberIds.has(id) && isContentKey(piece.key)) removedKeys.add(piece.key);
    }
    const carried: PendingPlan['carried'] = [];
    const replace: string[] = [];
    for (const object of members) {
      const piece = record.pieces[object.id] ?? null;
      if (!piece || (isContentKey(piece.key) && edited(object, piece))) carried.push({ id: object.id, piece });
      else replace.push(object.id);
    }
    const keptKeys = new Set(carried.map((c) => c.piece?.key).filter((k): k is string => !!k));
    const { objects, keys } = withoutKeys(layout, (key) => isContentKey(key) && (removedKeys.has(key) || keptKeys.has(key)));

    const ignore = [...replace, ...carried.map((c) => c.id)];
    const site = this.revisionSite(record, plan, move, layout.extent, objects, ignore);
    if (!site) {
      // A new place was asked for and it is taken: offer the places nearby that are free.
      if (!move && !sameSite(record.plan.site, plan.site)) return this.offerAlternatives(plan, layout, objects, ignore, notes, warnings, record.plan.site);
      const where = move?.near ? placeWords({ near: move.near }) : 'there';
      return { ok: false, errors: [`There isn't room for that ${where}. Try a smaller change, or move it first.`], notes, warnings, summary: null };
    }
    const from = { origin: { ...record.origin }, rotationY: record.rotationY };
    const result = this.show(plan, layout, objects, keys, site, notes, warnings, {
      revisionOf: groupId,
      replace,
      carried,
      removedKeys: [...removedKeys],
      from,
    });
    if (result.summary) {
      result.summary.changes = describeChanges(record.plan, plan, site, record);
      result.summary.keptEdits = carried.filter((c) => c.piece).length;
    }
    return result;
  }

  /**
   * Show a changed version of ONE house of a planned neighbourhood (`input`
   * is a house plan: size, rooms, roof, balcony - anything left out stays as
   * it is). Only that house is rebuilt, on its own plot: it can grow deeper
   * or get narrower, never wider than its neighbours allow. Every other
   * house, the street and the park are carried into the new version exactly
   * as they stand - the same pieces in the same places. Confirming it
   * replaces the old version in one step, so one undo brings it back.
   */
  previewHouseRevision(groupId: string, index: number, input: unknown): PlanPreviewResult {
    const state = this.store.getState();
    if (state.mode !== 'playing' || state.challenge !== null) return failure(['Planned building is only available in My World.']);
    const record = this.records[groupId];
    const members = state.placedObjects.filter((p) => p.group?.id === groupId);
    if (!record || record.plan.kind !== 'neighborhood' || members.length === 0) return failure(["I can't find that neighbourhood any more. Ask me to build something new!"]);
    const hood = record.plan;
    if (!Number.isInteger(index) || index < 0 || index >= hood.houses) return failure([`This street has ${hood.houses} houses, so there's no house ${index + 1}.`]);
    const label = `House ${index + 1}`;
    const before = neighborhoodHouse(hood, index);

    // The change, read like any house plan on top of the house as it is.
    const parsed = parseConstructionPlan({ ...planInput(before), ...(isRecord(input) ? input : {}), version: hood.version, kind: 'house' });
    const { notes, warnings } = parsed;
    if (!parsed.plan || parsed.plan.kind !== 'house') return { ok: false, errors: parsed.errors, notes, warnings, summary: null };
    const asked = parsed.plan;
    if (!asked.garden || !asked.driveway) warnings.push('Houses in a neighbourhood always keep their garden and driveway.');
    const limits = SIZE_LIMITS.neighborhoodHouse;
    let depth = asked.size.depth;
    if (depth < limits.min || depth > limits.max) {
      depth = Math.min(limits.max, Math.max(limits.min, depth));
      notes.push(`Houses on a street can be ${limits.min} to ${limits.max} m deep, so ${label} is ${depth} m deep.`);
    }
    let width = asked.size.width;
    if (width < limits.min) {
      width = limits.min;
      notes.push(`Houses on a street are at least ${limits.min} m wide, so ${label} is ${width} m wide.`);
    }
    if (width > hood.houseSize.width) {
      const otherChange = depth !== before.size.depth || !sameRooms(asked.rooms, before.rooms) || asked.roof !== before.roof || asked.balcony !== before.balcony;
      if (!otherChange) return failure([`${label} can't get any wider - its neighbours are right next to it. I can make it deeper, give it more rooms or change its roof.`], notes, warnings);
      width = hood.houseSize.width;
      notes.push(`${label} can't get wider without bumping into its neighbours, so it stays ${width} m wide.`);
    }
    // Only what differs from the street's own houses is remembered for this house.
    const edit: NeighborhoodHouseEdit = { house: index };
    if (width !== hood.houseSize.width || depth !== hood.houseSize.depth) edit.size = { width, depth };
    if (!sameRooms(asked.rooms, hood.rooms)) edit.rooms = [...asked.rooms];
    if (asked.roof !== hood.roof) edit.roof = asked.roof;
    if (asked.balcony) edit.balcony = true;
    const customHouses = [...hood.customHouses.filter((c) => c.house !== index), ...(Object.keys(edit).length > 1 ? [edit] : [])].sort((a, b) => a.house - b.house);
    const plan: NeighborhoodPlan = { ...hood, customHouses };
    const after = neighborhoodHouse(plan, index);
    if (sameHouse(before, after)) return failure([`${label} already looks like that. Try "make it deeper", "add a bedroom" or "give it a flat roof".`], notes, warnings);

    let layout: PlanLayout;
    let houseLayout: PlanLayout;
    try {
      layout = layoutPlan(plan, this.registry);
      houseLayout = layoutPlan(after, this.registry);
    } catch (error) {
      return failure([`${label} could not be laid out: ${(error as Error).message}`], notes, warnings);
    }
    for (const note of houseLayout.notes) if (!notes.includes(note)) notes.push(note);

    // This house's old pieces are rebuilt (keeping the child's own edits); everything else stays exactly as it stands.
    const prefix = `h${index}/`;
    const memberIds = new Set(members.map((m) => m.id));
    const removedKeys = new Set(record.removedKeys);
    for (const [id, piece] of Object.entries(record.pieces)) {
      if (!memberIds.has(id) && isContentKey(piece.key)) removedKeys.add(piece.key);
    }
    const carried: PendingPlan['carried'] = [];
    const replace: string[] = [];
    const ownEdits: string[] = [];
    for (const object of members) {
      const piece = record.pieces[object.id] ?? null;
      if (!piece || !piece.key.startsWith(prefix)) carried.push({ id: object.id, piece });
      else if (isContentKey(piece.key) && edited(object, piece)) {
        carried.push({ id: object.id, piece });
        ownEdits.push(object.id);
      } else replace.push(object.id);
    }
    const keptKeys = new Set(carried.map((c) => c.piece?.key).filter((k): k is string => !!k));
    const { objects, keys } = withoutKeys(layout, (key) => !key.startsWith(prefix) || (isContentKey(key) && (removedKeys.has(key) || keptKeys.has(key))));

    // It is rebuilt exactly where the neighbourhood stands, so it has to fit between its neighbours as it is.
    const at: SiteChoice = { origin: { ...record.origin }, rotationY: record.rotationY };
    const extent = templateExtent(objects, this.registry);
    if (!fitsExactly(at, extent, objects, this.siteContext([...replace, ...ownEdits]))) {
      const where = depth > before.size.depth ? ' behind it' : '';
      return failure([`There isn't room for ${label} to be that big - something is in the way${where}. Try a smaller change.`], notes, warnings);
    }
    const result = this.show(
      plan,
      layout,
      objects,
      keys,
      at,
      notes,
      warnings,
      { revisionOf: groupId, replace, carried, removedKeys: [...removedKeys], from: at, house: index },
      { label: `${label} · ${after.size.width} × ${after.size.depth} m`, extent, understood: [label, ...describePlan(after, houseLayout)] },
    );
    if (result.summary) {
      result.summary.house = index;
      result.summary.changes = describeChanges(before, after, at, at);
      result.summary.keptEdits = ownEdits.length;
      result.summary.width = after.size.width;
      result.summary.depth = after.size.depth;
      result.summary.rooms = {};
      for (const room of houseLayout.rooms) result.summary.rooms[room.type] = (result.summary.rooms[room.type] ?? 0) + 1;
    }
    return result;
  }

  /** TemplatePlacementController's report that a template was built; records it if it was a plan. */
  onTemplateBuilt(templateId: string, at: { origin: Vec3; rotationY: number }, result: TemplateInstantiateResult): void {
    const pending = this.pending.get(templateId);
    if (!pending) return;
    this.pending.delete(templateId);
    if (!result.groupId) return;
    const placed = new Map(this.store.getState().placedObjects.map((p) => [p.id, p]));
    const pieces: Record<string, PlannedPiece> = {};
    result.byIndex.forEach((id, index) => {
      const object = id ? placed.get(id) : undefined;
      if (!object) return;
      const { x, y, z } = object.scale;
      pieces[object.id] = { key: pending.keys[index], x: object.position.x, z: object.position.z, rotationY: object.rotationY, ...(x !== 1 || y !== 1 || z !== 1 ? { scale: { x, y, z } } : {}) };
    });
    // Carried edits keep their generated spot (moved along), so they still count as the child's edits next time.
    for (const { id, piece } of pending.carried) {
      if (!piece || !pending.from) continue;
      const local = rotateAroundY(piece.x - pending.from.origin.x, piece.z - pending.from.origin.z, -pending.from.rotationY);
      const offset = rotateAroundY(local.x, local.z, at.rotationY);
      pieces[id] = { ...piece, x: at.origin.x + offset.x, z: at.origin.z + offset.z, rotationY: piece.rotationY + at.rotationY - pending.from.rotationY };
    }
    // The house the child was working on stays picked in the new version (when it is still there).
    const before = pending.revisionOf ? this.records[pending.revisionOf]?.focusHouse : undefined;
    const focusHouse = pending.plan.kind !== 'neighborhood' ? undefined : pending.house ?? (before !== undefined && before < pending.plan.houses ? before : undefined);
    this.records[result.groupId] = {
      plan: pending.plan,
      origin: { ...at.origin },
      rotationY: at.rotationY,
      pieces,
      removedKeys: pending.removedKeys,
      builtAt: Date.now(),
      ...(focusHouse !== undefined ? { focusHouse } : {}),
    };
    this.sessionGroups.add(result.groupId);
    // The version it replaced may come back with undo (even one built in an earlier session), so its plan is kept too.
    if (pending.revisionOf) this.sessionGroups.add(pending.revisionOf);
    this.lastWorkedOn = result.groupId;
    if (pending.revisionOf) this.replaced.set(result.groupId, pending.revisionOf);
    this.saveRecords();
    this.onBuilt?.(result.groupId, pending.plan, pending.facts);
  }

  // ---------------------------------------------------------------- helpers

  /**
   * The place asked for is taken: say why, and offer the nearby places
   * where the same creation does fit (checked, not shown). Nothing appears
   * on the map - the child has to pick one first. When nothing nearby fits
   * either, say so honestly.
   */
  private offerAlternatives(
    plan: ConstructionPlan,
    layout: PlanLayout,
    objects: TemplateObjectSpec[],
    ignore: string[],
    notes: string[],
    warnings: string[],
    /** Where a creation being changed stands now - never offered, as going there would change nothing. */
    standing: PlanSite | null = null,
  ): PlanPreviewResult {
    const what = plan.kind === 'objects' ? 'them' : `the ${KIND_NAMES[plan.kind]}`;
    const conflict = siteConflict(plan.site, layout.extent, this.siteContext(ignore, plan.site));
    const because = conflictWords(conflict, plan.site);
    const alternatives = alternativeSites(plan.site)
      .filter((site) => !(standing && sameSite(site, standing)))
      .filter((site) => chooseSite(site, layout.extent, objects, this.siteContext(ignore, site)) !== null)
      .slice(0, 2)
      .map((site) => ({ site, label: choiceLabel(site) }));
    if (alternatives.length === 0 && standing) {
      return failure([`${because}, so there's no room for ${what} there, or anywhere else close by. I've left ${plan.kind === 'objects' ? 'them' : 'it'} where ${plan.kind === 'objects' ? 'they are' : 'it is'}.`], notes, warnings);
    }
    if (alternatives.length === 0) {
      const size = plan.kind === 'objects' ? '' : ` ${layout.footprint.width} × ${layout.footprint.depth} m`;
      return failure([`${because}, and there's no room for${size ? ` a${size} ${KIND_NAMES[plan.kind]}` : ' them'} anywhere close by either. Try something smaller, or ask for it somewhere else.`], notes, warnings);
    }
    const places = alternatives.map((a) => placeWords(a.site)).join(' or ');
    return {
      ok: false,
      errors: [`${because}, so there's no room for ${what} there. Shall I put ${plan.kind === 'objects' ? 'them' : 'it'} ${places} instead?`],
      notes,
      warnings,
      summary: null,
      offer: { conflict, alternatives },
    };
  }

  /**
   * The selected planned creation passing `accept`, else the one last worked
   * on (or the version of it standing after an undo), else the newest one standing.
   */
  private pick(accept: (plan: ConstructionPlan) => boolean): string | null {
    const { placedObjects, selectedInstanceId } = this.store.getState();
    const groups = new Set(placedObjects.map((p) => p.group?.id).filter((id): id is string => !!id));
    const standing = new Set([...groups].filter((id) => !!this.records[id] && accept(this.records[id].plan)));
    const selected = placedObjects.find((p) => p.id === selectedInstanceId)?.group?.id;
    if (selected && standing.has(selected)) return selected;
    let worked = this.lastWorkedOn;
    for (let hops = 0; worked && !groups.has(worked) && hops < 100; hops++) worked = this.replaced.get(worked) ?? null;
    if (worked && standing.has(worked)) return worked;
    return [...standing].sort((a, b) => this.records[b].builtAt - this.records[a].builtAt)[0] ?? null;
  }

  private prepare(input: unknown): { plan: ConstructionPlan; layout: PlanLayout; notes: string[]; warnings: string[] } | { result: PlanPreviewResult } {
    const state = this.store.getState();
    if (state.mode !== 'playing' || state.challenge !== null) return { result: failure(['Planned building is only available in My World.']) };
    const parsed = parseConstructionPlan(input);
    const { notes, warnings } = parsed;
    if (!parsed.plan) return { result: { ok: false, errors: parsed.errors, notes, warnings, summary: null } };
    try {
      const layout = layoutPlan(parsed.plan, this.registry);
      notes.push(...layout.notes);
      if (layout.objects.length === 0) return { result: { ok: false, errors: [`There was nothing I could fit in that ${KIND_NAMES[parsed.plan.kind]}.`], notes, warnings, summary: null } };
      return { plan: parsed.plan, layout, notes, warnings };
    } catch (error) {
      return { result: { ok: false, errors: [`This ${KIND_NAMES[parsed.plan.kind]} could not be laid out: ${(error as Error).message}`], notes, warnings, summary: null } };
    }
  }

  private siteContext(ignore: string[], site: PlanSite | null = null): SiteContext {
    const skip = new Set(ignore);
    const placedObjects = this.store.getState().placedObjects.filter((p) => !skip.has(p.id));
    const besideHouse = site !== null && 'beside' in site;
    return {
      registry: this.registry,
      rules: this.placementRules,
      placedObjects,
      lakes: this.worldSpace.spec.water,
      home: this.worldSpace.spec.homePlot,
      view: this.view(),
      anchor: besideHouse ? this.houseAnchor(skip) : null,
      ...(besideHouse ? { margin: CONNECTED_MARGIN } : {}),
    };
  }

  /** The ground the child's house covers (world, from its standing pieces) and the way it faces. */
  private houseAnchor(skip: Set<string>): { rect: LocalRect; rotationY: number } | null {
    const house = this.currentHouse();
    if (!house) return null;
    const members = this.store.getState().placedObjects.filter((p) => p.group?.id === house.groupId && !skip.has(p.id));
    if (members.length === 0) return null;
    const rect = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const p of members) {
      const definition = this.registry.get(p.definitionId);
      if (!definition) continue;
      const b = computeBounds(definition, p.position, p.rotationY, p.scale);
      rect.minX = Math.min(rect.minX, b.minX);
      rect.maxX = Math.max(rect.maxX, b.maxX);
      rect.minZ = Math.min(rect.minZ, b.minZ);
      rect.maxZ = Math.max(rect.maxZ, b.maxZ);
    }
    return Number.isFinite(rect.minX) ? { rect, rotationY: this.records[house.groupId].rotationY } : null;
  }

  /** Where a changed version goes: a named place, a shifted spot, its new site, or (about) where it already is. */
  private revisionSite(
    record: { plan: ConstructionPlan; origin: Vec3; rotationY: number },
    plan: ConstructionPlan,
    move: PlanMove | null,
    extent: LocalRect,
    objects: TemplateObjectSpec[],
    ignore: string[],
  ): SiteChoice | null {
    const context = this.siteContext(ignore, move?.near ? { near: move.near } : plan.site);
    if (move?.near) return chooseSite({ near: move.near }, extent, objects, context);
    if (move && (move.right !== 0 || move.forward !== 0)) {
      // Screen directions: right and "into the screen" for the current camera heading.
      const azimuth = (context.view.azimuth * Math.PI) / 180;
      const right = clampShift(move.right);
      const forward = clampShift(move.forward);
      const x = record.origin.x + Math.cos(azimuth) * right - Math.sin(azimuth) * forward;
      const z = record.origin.z - Math.sin(azimuth) * right - Math.cos(azimuth) * forward;
      return chooseSiteNear({ origin: { x, y: 0, z }, rotationY: record.rotationY }, SHIFT_REACH, extent, objects, context);
    }
    if (!sameSite(record.plan.site, plan.site)) return chooseSite(plan.site, extent, objects, context);
    return chooseSiteNear({ origin: record.origin, rotationY: record.rotationY }, REVISION_REACH, extent, objects, context);
  }

  private show(
    plan: ConstructionPlan,
    layout: PlanLayout,
    objects: TemplateObjectSpec[],
    keys: string[],
    site: SiteChoice,
    notes: string[],
    warnings: string[],
    revision: {
      revisionOf: string;
      replace: string[];
      carried: PendingPlan['carried'];
      removedKeys: string[];
      from: { origin: Vec3; rotationY: number };
      house?: number;
    } | null,
    /** For one house of a neighbourhood: what to call and frame instead of the whole neighbourhood. */
    view: { label: string; extent: LocalRect; understood: string[] } | null = null,
  ): PlanPreviewResult {
    const { width, depth } = layout.footprint;
    const templateId = `plan-${++this.serial}`;
    this.templates.upsert({ id: templateId, name: plan.name, description: describeTemplate(plan, layout), icon: kindIcon(plan.kind), objects });
    const previous = this.previewTemplateId;
    this.previewTemplateId = templateId;
    this.pending.set(templateId, {
      plan,
      facts: layout.facts,
      revisionOf: revision?.revisionOf ?? null,
      keys,
      removedKeys: revision?.removedKeys ?? [],
      carried: revision?.carried ?? [],
      from: revision?.from ?? null,
      house: revision?.house ?? null,
    });
    this.actions.startTemplatePlacement(templateId, {
      label: view?.label ?? (plan.kind === 'objects' ? plan.name : `${plan.name} · ${width} × ${depth} m`),
      creationId: KIND_CREATION[plan.kind],
      origin: site.origin,
      rotationY: site.rotationY,
      ...(revision ? { revise: { replace: revision.replace, carry: revision.carried.map((c) => c.id), from: revision.from } } : {}),
    });
    if (previous) {
      this.templates.remove(previous);
      this.pending.delete(previous);
    }
    if (revision) this.lastWorkedOn = revision.revisionOf;

    const box = worldRect(view?.extent ?? layout.extent, site);
    this.onPreview?.({ x: (box.minX + box.maxX) / 2, y: 0, z: (box.minZ + box.maxZ) / 2 }, Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ) / 2, site.rotationY);

    const rooms: Partial<Record<RoomType, number>> = {};
    for (const room of layout.rooms) rooms[room.type] = (rooms[room.type] ?? 0) + 1;
    return {
      ok: true,
      errors: [],
      notes,
      warnings,
      summary: {
        templateId,
        name: plan.name,
        kind: plan.kind,
        width,
        depth,
        rooms,
        pieces: objects.length,
        origin: { x: site.origin.x, z: site.origin.z },
        rotationY: site.rotationY,
        changes: [],
        keptEdits: 0,
        understood: view?.understood ?? describePlan(plan, layout),
        plan,
        facts: layout.facts,
      },
    };
  }

  /**
   * Show one of World Studio's ready-made templates (a park, a garden, a
   * neighbourhood) as a pinned preview at a free spot near the view - the
   * same confirm-to-build flow as a planned creation.
   */
  previewTemplate(templateId: string, options: { label: string; creationId: string }): PlanPreviewResult {
    const state = this.store.getState();
    if (state.mode !== 'playing' || state.challenge !== null) return failure(['Building is only available in My World.']);
    const template = this.templates.get(templateId);
    if (!template) return failure(['That idea is not available right now.']);
    const extent = templateExtent(template.objects, this.registry);
    const site = chooseSite({ near: 'view' }, extent, template.objects, this.siteContext([]));
    if (!site) return failure([`There's no free space for the ${options.label.toLowerCase()} around here. Try looking at an emptier spot.`]);
    this.actions.startTemplatePlacement(templateId, { label: options.label, creationId: options.creationId, origin: site.origin, rotationY: site.rotationY });
    const box = worldRect(extent, site);
    this.onPreview?.({ x: (box.minX + box.maxX) / 2, y: 0, z: (box.minZ + box.maxZ) / 2 }, Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ) / 2, site.rotationY);
    return {
      ok: true,
      errors: [],
      notes: [],
      warnings: [],
      summary: {
        templateId,
        name: options.label,
        kind: null,
        width: Math.round(extent.maxX - extent.minX),
        depth: Math.round(extent.maxZ - extent.minZ),
        rooms: {},
        pieces: template.objects.length,
        origin: { x: site.origin.x, z: site.origin.z },
        rotationY: site.rotationY,
        changes: [],
        keptEdits: 0,
        understood: [options.label, `${template.objects.length} pieces`],
        plan: null,
        facts: null,
      },
    };
  }

  private saveRecords(): void {
    if (!this.planStore) return;
    const standing = new Set(this.store.getState().placedObjects.map((p) => p.group?.id));
    for (const id of Object.keys(this.records)) {
      if (!standing.has(id) && !this.sessionGroups.has(id)) delete this.records[id];
    }
    this.planStore.save(this.records);
  }
}

/** True when the child moved, turned, resized or recoloured a generated piece (its generated size counts as unchanged). */
function edited(object: PlacedObject, piece: PlannedPiece): boolean {
  const turn = Math.abs(((object.rotationY - piece.rotationY) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  const size = piece.scale ?? { x: 1, y: 1, z: 1 };
  return (
    Math.hypot(object.position.x - piece.x, object.position.z - piece.z) > 0.01 ||
    turn > 1e-3 ||
    Math.abs(object.scale.x - size.x) > 1e-6 ||
    Math.abs(object.scale.y - size.y) > 1e-6 ||
    Math.abs(object.scale.z - size.z) > 1e-6 ||
    object.materialOverrides.color !== undefined
  );
}

/**
 * The layout without the pieces `drop` names. A piece set into a dropped one
 * goes too; a piece resting on a dropped one stays, just without the link.
 */
function withoutKeys(layout: PlanLayout, drop: (key: string) => boolean): { objects: TemplateObjectSpec[]; keys: string[] } {
  const droppedIds = new Set<string>();
  layout.objects.forEach((spec, i) => {
    if (drop(layout.keys[i]) && spec.localId) droppedIds.add(spec.localId);
  });
  const objects: TemplateObjectSpec[] = [];
  const keys: string[] = [];
  layout.objects.forEach((spec, i) => {
    if (drop(layout.keys[i]) || (spec.hostRef && droppedIds.has(spec.hostRef))) return;
    if (spec.supportRef && droppedIds.has(spec.supportRef)) {
      const { supportRef: _, surface: __, ...free } = spec;
      objects.push(free);
    } else {
      objects.push(spec);
    }
    keys.push(layout.keys[i]);
  });
  return { objects, keys };
}

/** Child-friendly list of what a revision changes. */
function describeChanges(before: ConstructionPlan, after: ConstructionPlan, site: SiteChoice, record: { origin: Vec3; rotationY: number }): string[] {
  const changes: string[] = [];
  const size = (delta: number, more: string, less: string) => {
    if (delta > 0) changes.push(`${delta} m ${more}`);
    if (delta < 0) changes.push(`${-delta} m ${less}`);
  };
  const toggle = (on: boolean, off: boolean, added: string, removed: string) => {
    if (on && !off) changes.push(added);
    if (!on && off) changes.push(removed);
  };
  const counted = (delta: number, one: string, many: string) => {
    if (delta > 0) changes.push(delta === 1 ? `one more ${one}` : `${delta} more ${many}`);
    if (delta < 0) changes.push(-delta === 1 ? `one ${one} fewer` : `${-delta} ${many} fewer`);
  };
  const roomsChanged = (a: RoomType[], b: RoomType[]) => {
    for (const type of ROOM_TYPES) counted(b.filter((r) => r === type).length - a.filter((r) => r === type).length, roomName(type), roomName(type, 2));
  };
  const roof = (a: string, b: string) => {
    if (a !== b) changes.push(b === 'none' ? 'no roof' : b === 'flat' ? 'a flat roof' : 'a pitched roof');
  };
  if (before.kind === 'house' && after.kind === 'house') {
    size(after.size.width - before.size.width, 'wider', 'narrower');
    size(after.size.depth - before.size.depth, 'deeper', 'shallower');
    roomsChanged(before.rooms, after.rooms);
    toggle(after.balcony, before.balcony, 'a balcony', 'no balcony');
    toggle(after.garden, before.garden, 'a garden', 'no garden');
    toggle(after.driveway, before.driveway, 'a driveway', 'no driveway');
    roof(before.roof, after.roof);
  } else if ((before.kind === 'garden' || before.kind === 'park') && (after.kind === 'garden' || after.kind === 'park')) {
    size(after.size.width - before.size.width, 'wider', 'narrower');
    size(after.size.depth - before.size.depth, 'deeper', 'shallower');
    counted(after.trees - before.trees, 'tree', 'trees');
    counted(after.flowerBeds - before.flowerBeds, 'flower bed', 'flower beds');
    counted(after.shrubs - before.shrubs, 'bush', 'bushes');
    counted(after.benches - before.benches, 'bench', 'benches');
    toggle(after.path, before.path, 'a path', 'no path');
    toggle(after.fence, before.fence, 'a fence', 'no fence');
    toggle(after.playground, before.playground, 'a playground', 'no playground');
    toggle(after.lamps, before.lamps, 'lamps', 'no lamps');
  } else if (before.kind === 'neighborhood' && after.kind === 'neighborhood') {
    counted(after.houses - before.houses, 'house', 'houses');
    size(after.houseSize.width - before.houseSize.width, 'wider houses', 'narrower houses');
    size(after.houseSize.depth - before.houseSize.depth, 'deeper houses', 'shallower houses');
    roomsChanged(before.rooms, after.rooms);
    toggle(after.street, before.street, 'a street', 'no street');
    toggle(after.park, before.park, 'a shared park', 'no park');
    roof(before.roof, after.roof);
  } else if (before.kind === 'treehouse' && after.kind === 'treehouse') {
    if (after.access !== before.access) changes.push(after.access === 'stairs' ? 'stairs instead of a ladder' : 'a ladder instead of stairs');
    toggle(after.hut, before.hut, 'a hut', 'no hut');
    if (after.hut && before.hut) roof(before.roof, after.roof);
  } else if (before.kind === 'objects' && after.kind === 'objects') {
    for (const item of OBJECT_ITEMS) {
      const delta = (after.items.find((i) => i.item === item)?.count ?? 0) - (before.items.find((i) => i.item === item)?.count ?? 0);
      counted(delta, itemName(item), itemName(item, 2));
    }
  }
  if (Math.hypot(site.origin.x - record.origin.x, site.origin.z - record.origin.z) > 3 || site.rotationY !== record.rotationY) changes.push('a new spot');
  return changes;
}

/** Ground covered by a template's ground pieces, template-local metres. */
function templateExtent(objects: TemplateObjectSpec[], registry: ObjectRegistry): LocalRect {
  const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const spec of objects) {
    const definition = registry.get(spec.definitionId);
    if (!definition || spec.hostRef || spec.supportRef) continue;
    const b = computeBounds(definition, spec.position, spec.rotationY ?? 0, spec.scale ?? { x: 1, y: 1, z: 1 });
    box.minX = Math.min(box.minX, b.minX);
    box.maxX = Math.max(box.maxX, b.maxX);
    box.minZ = Math.min(box.minZ, b.minZ);
    box.maxZ = Math.max(box.maxZ, b.maxZ);
  }
  return Number.isFinite(box.minX) ? box : { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
}

function failure(errors: string[], notes: string[] = [], warnings: string[] = []): PlanPreviewResult {
  return { ok: false, errors, notes, warnings, summary: null };
}

/** Other places worth trying when the one asked for is taken, best first. */
function alternativeSites(site: PlanSite): PlanSite[] {
  if ('beside' in site) {
    const order: Record<SiteSide, SiteSide[]> = { back: ['side', 'front'], front: ['side', 'back'], side: ['front', 'back'] };
    return order[site.beside].map((beside) => ({ beside }));
  }
  if ('near' in site) {
    if (site.near === 'lake') return [{ near: 'view' }, { near: 'home' }];
    if (site.near === 'home') return [{ near: 'view' }];
    return [{ near: 'home' }];
  }
  return [{ near: 'view' }];
}

/** The words of a tappable answer for a place ("Beside the house"). */
export function choiceLabel(site: PlanSite): string {
  if ('beside' in site) return site.beside === 'back' ? 'Behind the house' : site.beside === 'front' ? 'In front of the house' : 'Beside the house';
  if ('near' in site) return site.near === 'lake' ? 'By the lake' : site.near === 'home' ? 'Near my home' : "Where I'm looking";
  return 'There';
}

/** Why the place asked for is taken, as the start of a sentence for a child. */
function conflictWords(conflict: SiteConflict | null, site: PlanSite): string {
  const where = 'beside' in site ? (site.beside === 'back' ? 'behind your house' : site.beside === 'front' ? 'in front of your house' : 'beside your house') : placeWords(site);
  switch (conflict) {
    case 'water':
      return 'beside' in site ? `The lake is right ${where}` : `The lake is in the way ${where}`;
    case 'built':
      return `Something you built is already ${where}`;
    case 'scenery':
      return `The town's own trees and buildings are ${where}`;
    case 'edge':
      return `That's the edge of the world ${where}`;
    default:
      return `There's not enough space ${where}`;
  }
}

function noRoom(plan: ConstructionPlan, layout: PlanLayout, notes: string[], warnings: string[]): PlanPreviewResult {
  const { width, depth } = layout.footprint;
  const what = plan.kind === 'objects' ? 'those' : `a ${width} × ${depth} m ${KIND_NAMES[plan.kind]}`;
  const errors = [`There's no free space for ${what} ${placeWords(plan.site)}. Try something smaller or another place.`];
  return { ok: false, errors, notes, warnings, summary: null };
}

function placeWords(site: PlanSite): string {
  if ('at' in site) return 'there';
  if ('beside' in site) return site.beside === 'back' ? 'behind your house' : site.beside === 'front' ? 'in front of your house' : 'beside your house';
  return site.near === 'lake' ? 'near the lake' : site.near === 'home' ? 'near your home' : 'around here';
}

function sameSite(a: PlanSite, b: PlanSite): boolean {
  if ('near' in a && 'near' in b) return a.near === b.near;
  if ('beside' in a && 'beside' in b) return a.beside === b.beside;
  if ('at' in a && 'at' in b) return a.at.x === b.at.x && a.at.z === b.at.z;
  return false;
}

function clampShift(value: number): number {
  return Number.isFinite(value) ? Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, value)) : 0;
}

/** The house a neighbourhood layout key belongs to ("h2/wall:wf0" -> 2), or null for its street and park. */
function houseIndex(key: string | undefined): number | null {
  const match = key ? /^h(\d+)\//.exec(key) : null;
  return match ? Number(match[1]) : null;
}

function sameRooms(a: readonly RoomType[], b: readonly RoomType[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

function sameHouse(a: HousePlan, b: HousePlan): boolean {
  return a.size.width === b.size.width && a.size.depth === b.size.depth && sameRooms(a.rooms, b.rooms) && a.roof === b.roof && a.balcony === b.balcony;
}

/**
 * A change to the whole neighbourhood keeps the houses the child changed on
 * their own - except in what the change itself sets for every house (a new
 * house size, rooms or roof for all of them) - unless the change lists the
 * changed houses itself.
 */
function withHouseEdits(before: ConstructionPlan, input: unknown): unknown {
  if (before.kind !== 'neighborhood' || before.customHouses.length === 0 || !isRecord(input) || input.kind !== 'neighborhood' || 'customHouses' in input) return input;
  const after = parseConstructionPlan(input).plan;
  if (!after || after.kind !== 'neighborhood') return input;
  const resized = after.houseSize.width !== before.houseSize.width || after.houseSize.depth !== before.houseSize.depth;
  const kept = before.customHouses
    .map((edit) => {
      const next: NeighborhoodHouseEdit = { ...edit };
      if (resized) delete next.size;
      if (!sameRooms(after.rooms, before.rooms)) delete next.rooms;
      if (after.roof !== before.roof) delete next.roof;
      return next;
    })
    .filter((edit) => edit.house < after.houses && Object.keys(edit).length > 1);
  return { ...input, customHouses: kept.map(houseEditInput) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
