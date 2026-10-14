import * as THREE from 'three';
import { motion } from '@/accessibility/motion';
import type { GameStore } from '@/state/GameStore';
import type { GameState, InteriorView } from '@/state/GameState';
import type { GameActions } from '@/state/actions';
import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import type { CreationGroupRef, PlacedObject } from '@/construction/PlacedObject';
import { roleOf } from '@/construction/ConstructionObjectDefinition';
import { boundsOfPlaced } from '@/construction/bounds';
import type { PlanBuilder } from '@/creative/plan/PlanBuilder';
import type { GhostKit } from '@/creative/Ghosts';
import {
  buildWalkModel,
  describeHouseInterior,
  entryPose,
  exitPoint,
  findFreeSpot,
  findRoom,
  moveWithCollision,
  roomAt,
  roomViewpoint,
  tourOrder,
  type InteriorHouse,
  type InteriorRoom,
  type WalkModel,
} from '@/creative/interior';
import type { RoomType } from '@/creative/plan/ConstructionPlan';
import type { World } from '@/world/World';
import type { CameraSnapshot } from '@/world/CameraController';
import { WalkController, type WalkPose } from '@/world/WalkController';
import type { InputManager } from '@/input/InputManager';
import type { InteriorReadability } from './InteriorReadability';

/** Pause at each room during a guided tour, seconds. */
const TOUR_PAUSE = 2.4;
/** Light added indoors so rooms under a roof are easy to see (no extra shadow-casting lights): warm, like lamps. */
const INDOOR_FILL = 0.85;
const INDOOR_FILL_COLOUR = 0xffe4c4;
/**
 * Indoors the blue sky's own light (reflections and the sky-coloured hemisphere light) is turned down,
 * so rooms look warm and their colours read clearly instead of washed out in cool daylight. Restored on leaving.
 */
const INDOOR_SKY_LIGHT = { environment: 0.16, hemisphere: 0.12 };
/** Seconds for a walk between two places inside, from short to long trips. */
const WALK_SECONDS = { min: 0.7, max: 2.2, perMetre: 0.16 };

/** Something the child (or EAVARA for them) wants to change inside, waiting for an explicit yes. */
export interface InteriorProposal {
  kind: 'add' | 'move' | 'recolor';
  /** Short child-facing description: "Add a sofa by the window". */
  title: string;
  /** The room it applies to (name), when known. */
  roomName: string | null;
}

/** What the interior screen shows. */
export interface InteriorSnapshot {
  house: InteriorHouse;
  model: WalkModel;
  view: InteriorView;
  roomId: string | null;
  touring: boolean;
  walker: { x: number; z: number; yaw: number } | null;
  proposal: InteriorProposal | null;
}

/** The answer to an interior request: done or not, in the child's words (never claimed before it happened). */
export interface InteriorResult {
  ok: boolean;
  message: string;
}

interface PendingEdit extends InteriorProposal {
  apply(): InteriorResult;
  ghosts: THREE.Object3D[];
}

/**
 * Interior Explorer: going inside a planned house, walking from room to
 * room (first person, with walls that stop you), a dollhouse view with the
 * roof and outer walls cut away, a room navigator built from the house's
 * real plan, a guided tour, and furniture edits that are shown first and
 * only made when the child says yes.
 *
 * It is a view of the same house - the same placed objects, plan record and
 * room layout - never a copy. Rooms come from the house's stored plan
 * (recomputed, like the plan builder does); walls, doors and furniture come
 * from what actually stands, so the child's own changes count. Every change
 * goes through the ordinary GameActions, so undo/redo and saving work as
 * they do outside, and only the entered house is touched.
 */
export class InteriorExplorer {
  readonly walk: WalkController;
  private house: InteriorHouse | null = null;
  private model: WalkModel | null = null;
  private modelSource: readonly PlacedObject[] | null = null;
  private entered: { groupId: string; houseIndex: number | null } | null = null;
  private snapshot: CameraSnapshot | null = null;
  private view: InteriorView | null = null;
  private pending: PendingEdit | null = null;
  private tourToken = 0;
  private readonly fill: THREE.AmbientLight;
  /** The sky's light outside, put back on leaving (null while outside). */
  private outdoorSkyLight: { environment: number; hemisphere: number } | null = null;
  private ceiling: THREE.Mesh | null = null;
  private readonly ceilingMaterial: THREE.MeshStandardMaterial;
  private readonly listeners = new Set<() => void>();
  private lastNotice: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly store: GameStore,
    private readonly actions: GameActions,
    private readonly registry: ObjectRegistry,
    private readonly planBuilder: PlanBuilder,
    private readonly world: World,
    private readonly input: InputManager,
    private readonly ghosts: GhostKit,
    private readonly readability: InteriorReadability,
  ) {
    this.walk = new WalkController(world.camera, world.renderer.domElement, input.keyboard);
    this.walk.setEnabled(false);
    // A permanent light whose strength is 0 outside: switching a light on and off would recompile every material.
    this.fill = new THREE.AmbientLight(INDOOR_FILL_COLOUR, 0);
    this.fill.name = 'interior-fill';
    world.scene.add(this.fill);
    this.ceilingMaterial = new THREE.MeshStandardMaterial({ color: '#f3eee6', roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  }

  start(): void {
    this.unsubscribe = this.store.subscribe((state, previous) => this.onState(state, previous));
    // Any key or drag of the child's own ends a guided tour.
    this.disposers.push(this.input.keyboard.on('keydown', () => this.stopTour()));
    const canvas = this.world.renderer.domElement;
    const stop = () => this.stopTour();
    canvas.addEventListener('pointerdown', stop);
    this.disposers.push(() => canvas.removeEventListener('pointerdown', stop));
  }

  dispose(): void {
    this.unsubscribe?.();
    this.disposers.forEach((d) => d());
    this.leave(false);
    this.walk.dispose();
    this.world.scene.remove(this.fill);
    this.ceilingMaterial.dispose();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Why the last enter attempt failed, for the screen to say (cleared when read). */
  takeNotice(): string | null {
    const notice = this.lastNotice;
    this.lastNotice = null;
    return notice;
  }

  /** Per frame: which room the walker is in. */
  update(): void {
    const interior = this.store.getState().interior;
    if (!interior || !this.house || this.view !== 'walk') return;
    const pose = this.walk.getPose();
    const room = roomAt(this.house, pose.x, pose.z);
    if (room && room.id !== interior.roomId) this.actions.setInteriorRoom(room.id);
  }

  // ------------------------------------------------------------ queries

  get isInside(): boolean {
    return this.house !== null;
  }

  snapshotState(): InteriorSnapshot | null {
    const interior = this.store.getState().interior;
    if (!interior || !this.house || !this.model) return null;
    const pose = this.view === 'walk' ? this.walk.getPose() : null;
    return {
      house: this.house,
      model: this.model,
      view: interior.view,
      roomId: interior.roomId,
      touring: interior.touring,
      walker: pose ? { x: pose.x, z: pose.z, yaw: pose.yaw } : null,
      proposal: this.pending ? { kind: this.pending.kind, title: this.pending.title, roomName: this.pending.roomName } : null,
    };
  }

  /** The room the child is in, or was last sent to. */
  currentRoom(): InteriorRoom | null {
    const id = this.store.getState().interior?.roomId;
    return this.house && id ? this.house.rooms.find((r) => r.id === id) ?? null : null;
  }

  /** A room by type and ordinal ("the second bedroom"), or null when the house has no such room. */
  room(query: { id?: string; type?: RoomType; ordinal?: number }): InteriorRoom | null {
    return this.house ? findRoom(this.house, query) : null;
  }

  /** Placed objects standing in a room (furniture and things the child added). */
  objectsIn(room: InteriorRoom): PlacedObject[] {
    const { placedObjects } = this.store.getState();
    return placedObjects.filter((p) => {
      const definition = this.registry.get(p.definitionId);
      if (!definition || roleOf(definition) !== null) return false;
      return p.position.x >= room.rect.minX && p.position.x <= room.rect.maxX && p.position.z >= room.rect.minZ && p.position.z <= room.rect.maxZ;
    });
  }

  // ------------------------------------------------------------ entering

  /**
   * The house a tap or request means: the selected piece's planned house
   * (or its house inside a neighbourhood), else the child's current house.
   */
  targetHouse(): { groupId: string; houseIndex: number | null } | null {
    const state = this.store.getState();
    const selected = state.placedObjects.find((p) => p.id === state.selectedInstanceId);
    const groupId = selected?.group?.id;
    if (groupId) {
      const planned = this.planBuilder.planOf(groupId);
      if (planned?.kind === 'house') return { groupId, houseIndex: null };
      if (planned?.kind === 'neighborhood') {
        const index = this.planBuilder.houseOf(selected.id)?.index ?? this.houseIndexAt(groupId, selected.position.x, selected.position.z);
        if (index !== null) return { groupId, houseIndex: index };
      }
    }
    const focus = this.planBuilder.houseFocus();
    if (focus) return { groupId: focus.groupId, houseIndex: focus.index };
    const current = this.planBuilder.currentHouse();
    return current ? { groupId: current.groupId, houseIndex: null } : null;
  }

  /** Go inside (the house a tap or request means, unless one is given). */
  enter(target: { groupId: string; houseIndex: number | null } | null = this.targetHouse(), view: InteriorView = 'walk'): InteriorResult {
    if (!target) return { ok: false, message: "Build a house first - then we can go inside!" };
    if (!this.describe(target)) return { ok: false, message: "This house has no rooms I can show you. Houses planned with EAVARA have rooms to explore." };
    if (!this.actions.enterInterior(target.groupId, target.houseIndex, view)) return { ok: false, message: "We can't go inside right now. Finish what you're doing first." };
    return { ok: true, message: 'Welcome inside!' };
  }

  exit(): void {
    this.actions.exitInterior();
  }

  setView(view: InteriorView): void {
    this.actions.setInteriorView(view);
  }

  // ------------------------------------------------------------ moving around

  /** Travel to a room: walk there (first person) or frame it from above (dollhouse). True once arrived. */
  async goToRoom(roomId: string): Promise<boolean> {
    const room = this.house?.rooms.find((r) => r.id === roomId);
    if (!room || !this.model) return false;
    if (this.view === 'walk') {
      const target = roomViewpoint(this.model, room);
      const from = this.walk.getPose();
      const duration = THREE.MathUtils.clamp(Math.hypot(target.x - from.x, target.z - from.z) * WALK_SECONDS.perMetre + WALK_SECONDS.min, WALK_SECONDS.min, WALK_SECONDS.max);
      await this.walk.setPose(target, { duration: motion.duration(duration) });
    } else {
      const size = Math.max(room.rect.maxX - room.rect.minX, room.rect.maxZ - room.rect.minZ);
      this.world.cameraController.transitionTo(
        { x: room.center.x, y: this.house!.floorY, z: room.center.z },
        { distance: THREE.MathUtils.clamp(size * 2.2 + 4, 7, 26), azimuth: this.world.cameraController.azimuth, elevation: 62 },
        0.9,
      );
    }
    if (this.house?.rooms.some((r) => r.id === roomId)) this.actions.setInteriorRoom(roomId);
    return true;
  }

  /** A guided walk through every room, pausing in each. Ends at the last room, or when the child takes over. */
  async startTour(): Promise<void> {
    if (!this.model || !this.house) return;
    const token = ++this.tourToken;
    if (this.view !== 'walk') this.actions.setInteriorView('walk');
    this.actions.setInteriorTouring(true);
    for (const roomId of tourOrder(this.model)) {
      if (token !== this.tourToken || !this.house) break;
      await this.goToRoom(roomId);
      if (token !== this.tourToken) break;
      await new Promise((resolve) => setTimeout(resolve, TOUR_PAUSE * 1000));
    }
    if (token === this.tourToken) this.actions.setInteriorTouring(false);
  }

  stopTour(): void {
    if (!this.store.getState().interior?.touring) return;
    this.tourToken++;
    this.actions.setInteriorTouring(false);
  }

  /** On-screen joystick input (x right, y forward). */
  setMove(x: number, y: number): void {
    if (x !== 0 || y !== 0) this.stopTour();
    this.walk.setMoveInput(x, y);
  }

  // ------------------------------------------------------------ editing (shown first, done on yes)

  /**
   * Show where a piece of furniture would go in a room (the current room
   * unless one is named), as a ghost, and wait for the child's yes.
   */
  proposeAdd(definitionId: string, options: { roomId?: string; near?: 'window' | 'wall' | 'centre'; count?: number } = {}): InteriorResult {
    const definition = this.registry.get(definitionId);
    if (!definition || !this.model || !this.house) return { ok: false, message: "I can't add that here." };
    const room = (options.roomId ? this.house.rooms.find((r) => r.id === options.roomId) : null) ?? this.currentRoom() ?? this.roomNearCamera();
    if (!room) return { ok: false, message: 'Pick a room first, then I can add it there.' };
    const count = Math.min(4, Math.max(1, Math.round(options.count ?? 1)));
    const name = definition.name.toLowerCase();
    // One free spot per piece; each spot found counts as taken for the next.
    let model = this.model;
    const spots: Array<{ x: number; z: number; rotationY: number }> = [];
    for (let i = 0; i < count; i++) {
      const spot = findFreeSpot(model, room, { width: definition.dimensions.width, depth: definition.dimensions.depth }, { near: options.near ?? 'wall' });
      if (!spot) break;
      spots.push(spot);
      const turned = Math.abs(Math.sin(spot.rotationY)) > 0.5;
      const halfW = (turned ? definition.dimensions.depth : definition.dimensions.width) / 2;
      const halfD = (turned ? definition.dimensions.width : definition.dimensions.depth) / 2;
      const box = { id: `planned-${i}`, minX: spot.x - halfW, maxX: spot.x + halfW, minZ: spot.z - halfD, maxZ: spot.z + halfD };
      model = { ...model, furniture: [...model.furniture, box], obstacles: [...model.obstacles, box] };
    }
    if (spots.length === 0) return { ok: false, message: `There isn't enough free space in the ${room.name.toLowerCase()} for ${articleFor(definition.name)}.` };
    const group = this.houseGroup();
    const ghosts = spots.map((s) => this.showGhost(definitionId, s.x, s.z, s.rotationY)).filter((g): g is THREE.Object3D => g !== null);
    const near = options.near === 'window' ? ' by the window' : '';
    const what = spots.length === 1 ? articleFor(definition.name) : `${spots.length} ${pluralOf(name)}`;
    const shortBy = count - spots.length;
    const roomName = room.name.toLowerCase();
    this.setPending({
      kind: 'add',
      title: `Add ${what} to the ${roomName}${near}`,
      roomName: room.name,
      ghosts,
      apply: () => {
        const placedIds: string[] = [];
        for (const spot of spots) {
          const floor = this.floorUnder(spot.x, spot.z);
          const placed = this.actions.placeAt(definitionId, { x: spot.x, y: this.house!.floorY, z: spot.z }, spot.rotationY, { supportId: floor?.id ?? null, group: group ?? undefined });
          if (placed) placedIds.push(placed.id);
        }
        if (placedIds.length === 0) return { ok: false, message: `The ${name} doesn't fit there any more. Try another room.` };
        this.actions.selectPlacedObject(placedIds[placedIds.length - 1]);
        const added = placedIds.length === 1 ? `The ${name} is` : `${placedIds.length} ${pluralOf(name)} are`;
        return { ok: true, message: `Done! ${added} in the ${roomName}. Tap one to move or turn it.` };
      },
    });
    const shortNote = shortBy > 0 ? ` There's only room for ${spots.length} in the ${roomName}.` : '';
    const subject = spots.length === 1 ? `the ${name} would` : `the ${pluralOf(name)} would`;
    return { ok: true, message: `Here's where ${subject} go.${shortNote} Shall I add ${spots.length === 1 ? 'it' : 'them'}?` };
  }

  /** Placed furniture of the entered house (optionally one room) whose catalogue type is one of `types`. */
  furnitureOfType(types: readonly string[], room: InteriorRoom | null): PlacedObject[] {
    if (!this.house) return [];
    const area = room?.rect ?? this.house.footprint;
    return this.store.getState().placedObjects.filter((p) => {
      const definition = this.registry.get(p.definitionId);
      if (!definition || roleOf(definition) !== null || !types.includes(definition.type)) return false;
      return p.position.x >= area.minX && p.position.x <= area.maxX && p.position.z >= area.minZ && p.position.z <= area.maxZ;
    });
  }

  /** Show a new spot for a piece of furniture ("move the bed near the window") and wait for yes. */
  proposeMove(objectId: string, near: 'window' | 'wall' | 'centre' = 'wall'): InteriorResult {
    const state = this.store.getState();
    const placed = state.placedObjects.find((p) => p.id === objectId);
    const definition = placed ? this.registry.get(placed.definitionId) : undefined;
    if (!placed || !definition || !this.model || !this.house) return { ok: false, message: "I can't find that any more." };
    const room = roomAt(this.house, placed.position.x, placed.position.z) ?? this.currentRoom();
    if (!room) return { ok: false, message: 'That is not inside a room I know.' };
    // The piece itself does not block its own new spot.
    const model: WalkModel = { ...this.model, furniture: this.model.furniture.filter((f) => f.id !== objectId), obstacles: [...this.model.walls, ...this.model.furniture.filter((f) => f.id !== objectId)] };
    const spot = findFreeSpot(model, room, { width: definition.dimensions.width * placed.scale.x, depth: definition.dimensions.depth * placed.scale.z }, { near });
    if (!spot) return { ok: false, message: `There isn't a free spot ${near === 'window' ? 'by the window' : 'like that'} in the ${room.name.toLowerCase()}.` };
    const ghost = this.showGhost(placed.definitionId, spot.x, spot.z, spot.rotationY);
    this.setPending({
      kind: 'move',
      ghosts: ghost ? [ghost] : [],
      title: `Move the ${definition.name.toLowerCase()}${near === 'window' ? ' near the window' : ''}`,
      roomName: room.name,
      apply: () => {
        this.actions.selectPlacedObject(objectId);
        const turned = this.actions.rotateSelectedPlacedObject(spot.rotationY);
        const status = this.actions.moveSelectedPlacedObject(spot.x, spot.z);
        if (!status?.valid) {
          if (turned?.valid) this.actions.rotateSelectedPlacedObject(placed.rotationY);
          return { ok: false, message: `The ${definition.name.toLowerCase()} can't go there - something is in the way.` };
        }
        return { ok: true, message: `Moved! The ${definition.name.toLowerCase()} is in its new spot.` };
      },
    });
    return { ok: true, message: `Here's the new spot for the ${definition.name.toLowerCase()}. Shall I move it?` };
  }

  /** Paint some furniture a colour ("make the kitchen cabinets white"), after the child says yes. */
  proposeRecolor(ids: string[], color: { name: string; hex: string }, what: string, roomName: string | null): InteriorResult {
    if (ids.length === 0) return { ok: false, message: `I couldn't find any ${what} here.` };
    this.setPending({
      kind: 'recolor',
      title: `Paint the ${what} ${color.name}`,
      roomName,
      ghosts: [],
      apply: () => {
        const changed = this.actions.recolorPlacedObjects(ids, color.hex);
        return changed > 0
          ? { ok: true, message: `Painted! The ${what} ${changed === 1 ? 'is' : 'are'} ${color.name} now.` }
          : { ok: false, message: `The ${what} ${ids.length === 1 ? 'is' : 'are'} already ${color.name}.` };
      },
    });
    return { ok: true, message: `Shall I paint the ${what} ${color.name}?` };
  }

  /** The child said yes: make the change (undoable) and say what happened. */
  confirmProposal(): InteriorResult {
    const pending = this.pending;
    if (!pending) return { ok: false, message: 'There is nothing waiting to be done.' };
    this.setPending(null);
    return pending.apply();
  }

  cancelProposal(): void {
    this.setPending(null);
  }

  get hasProposal(): boolean {
    return this.pending !== null;
  }

  // ------------------------------------------------------------ state changes

  private onState(state: GameState, previous: GameState): void {
    const interior = state.interior;
    // A plan preview (the AI builder changing a house) is shown from outside.
    if (interior && state.templatePlacement && !previous.templatePlacement) {
      this.actions.exitInterior();
      return;
    }
    if (!interior) {
      if (this.house) this.leave(true);
      return;
    }
    const sameHouse = this.entered && this.entered.groupId === interior.groupId && this.entered.houseIndex === interior.houseIndex;
    if (!sameHouse) {
      if (this.house) this.leave(false);
      if (!this.arrive(interior.groupId, interior.houseIndex)) {
        this.lastNotice = "This house has no rooms I can show you.";
        this.actions.exitInterior();
        return;
      }
    }
    // The house was rebuilt or undone away while inside: step back outside honestly.
    if (!state.placedObjects.some((p) => p.group?.id === interior.groupId)) {
      this.lastNotice = 'That house changed, so we stepped back outside.';
      this.actions.exitInterior();
      return;
    }
    if (state.placedObjects !== this.modelSource) this.rebuildModel(state.placedObjects);
    if (interior.view !== this.view) this.applyView(interior.view);
    this.emit();
  }

  private describe(target: { groupId: string; houseIndex: number | null }): InteriorHouse | null {
    const record = this.planBuilder.recordOf(target.groupId);
    if (!record) return null;
    try {
      return describeHouseInterior(target.groupId, record, this.registry, target.houseIndex);
    } catch (error) {
      console.warn('[interior] could not describe the house', error);
      return null;
    }
  }

  private arrive(groupId: string, houseIndex: number | null): boolean {
    const house = this.describe({ groupId, houseIndex });
    if (!house) return false;
    this.house = house;
    this.entered = { groupId, houseIndex };
    this.snapshot = this.world.cameraController.snapshot();
    this.rebuildModel(this.store.getState().placedObjects);
    this.fill.intensity = INDOOR_FILL;
    this.outdoorSkyLight ??= { environment: this.world.scene.environmentIntensity, hemisphere: this.world.environment.hemisphere.intensity };
    this.world.scene.environmentIntensity = INDOOR_SKY_LIGHT.environment;
    this.world.environment.hemisphere.intensity = INDOOR_SKY_LIGHT.hemisphere;
    this.view = null; // applyView decides
    return true;
  }

  /** Back outside: camera, lights and cutaway exactly as before going in. */
  private leave(animate: boolean): void {
    this.tourToken++;
    this.setPending(null);
    this.walk.setEnabled(false);
    this.walk.setCollision(null);
    this.walk.setMoveInput(0, 0);
    this.world.setCameraDriver(null);
    this.world.cameraController.setSuspended(false);
    this.readability.setInteriorCutaway(null);
    this.removeCeiling();
    this.fill.intensity = 0;
    if (this.outdoorSkyLight) {
      this.world.scene.environmentIntensity = this.outdoorSkyLight.environment;
      this.world.environment.hemisphere.intensity = this.outdoorSkyLight.hemisphere;
      this.outdoorSkyLight = null;
    }
    if (this.snapshot) this.world.cameraController.restore(this.snapshot, { animate, duration: 1.1 });
    this.snapshot = null;
    this.house = null;
    this.model = null;
    this.modelSource = null;
    this.entered = null;
    this.view = null;
    this.emit();
  }

  private applyView(view: InteriorView): void {
    const house = this.house;
    const model = this.model;
    if (!house || !model) return;
    const first = this.view === null;
    this.view = view;
    if (view === 'walk') {
      this.readability.setInteriorCutaway(null);
      this.addCeiling(house);
      this.world.cameraController.setSuspended(true);
      this.walk.setCollision((from, to) => (this.model ? moveWithCollision(this.model, from, to) : to));
      // Start from where the camera is now, then walk in: first to the front door, then inside.
      this.walk.setPose(this.cameraPose(), { duration: 0 });
      this.walk.setEnabled(true);
      this.world.setCameraDriver(this.walk);
      const inside = this.currentRoom() ? roomViewpoint(model, this.currentRoom()!) : entryPose(model);
      if (first) {
        const door = exitPoint(model);
        const approach: WalkPose = { x: door.x, y: inside.y, z: door.z, yaw: inside.yaw, pitch: -0.05 };
        const arrived = this.walk.setPose(approach, { duration: motion.duration(1.1) });
        const token = this.walk.poseToken;
        // Step inside only if the walk to the door really arrived (not cut short by a room the child picked meanwhile).
        void arrived.then(() => {
          if (this.walk.poseToken === token && this.view === 'walk' && this.house === house) return this.walk.setPose(inside, { duration: motion.duration(0.9) });
          return undefined;
        });
      } else {
        void this.walk.setPose(inside, { duration: 0.8 });
      }
    } else {
      this.walk.setEnabled(false);
      this.world.setCameraDriver(null);
      this.world.cameraController.setSuspended(false);
      this.removeCeiling();
      this.readability.setInteriorCutaway(this.cutawayIds(house));
      const size = Math.max(house.footprint.maxX - house.footprint.minX, house.footprint.maxZ - house.footprint.minZ);
      const centre = { x: (house.footprint.minX + house.footprint.maxX) / 2, y: house.floorY, z: (house.footprint.minZ + house.footprint.maxZ) / 2 };
      this.world.cameraController.transitionTo(centre, { distance: THREE.MathUtils.clamp(size * 1.5 + 6, 14, 60), azimuth: this.world.cameraController.azimuth, elevation: 58 }, 1);
    }
  }

  private rebuildModel(placedObjects: readonly PlacedObject[]): void {
    if (!this.house) return;
    this.model = buildWalkModel(this.house, placedObjects, this.registry);
    this.modelSource = placedObjects;
  }

  /** The house's roof and outer walls (what the dollhouse view cuts away). */
  private cutawayIds(house: InteriorHouse): string[] {
    const record = this.planBuilder.recordOf(house.groupId);
    const ids: string[] = [];
    for (const placed of this.store.getState().placedObjects) {
      if (placed.group?.id !== house.groupId) continue;
      const definition = this.registry.get(placed.definitionId);
      if (!definition) continue;
      const key = record?.pieces[placed.id]?.key ?? '';
      if (house.keyPrefix && key && !key.startsWith(house.keyPrefix)) continue;
      const inside = placed.position.x >= house.footprint.minX - 0.4 && placed.position.x <= house.footprint.maxX + 0.4 && placed.position.z >= house.footprint.minZ - 0.4 && placed.position.z <= house.footprint.maxZ + 0.4;
      if (!inside) continue;
      const role = roleOf(definition);
      const outerWall = role === 'wall' && /\/?wall:w[fbew]/.test(key);
      const roof = role === 'roof' || /(^|\/)roof:/.test(key);
      if (outerWall || roof) ids.push(placed.id);
    }
    return ids;
  }

  // ------------------------------------------------------------ helpers

  private setPending(next: PendingEdit | null): void {
    this.pending?.ghosts.forEach((ghost) => this.ghosts.discard(ghost));
    this.pending = next;
    this.emit();
  }

  private showGhost(definitionId: string, x: number, z: number, rotationY: number): THREE.Object3D | null {
    const definition = this.registry.get(definitionId);
    if (!definition || !this.house) return null;
    const ghost = this.ghosts.create(definition);
    ghost.position.set(x, this.house.floorY, z);
    ghost.rotation.set(0, rotationY, 0);
    this.ghosts.setValid(ghost, true);
    this.world.overlayRoot.add(ghost);
    return ghost;
  }

  /** The floor tile of the entered house under a point (furniture rests on it). */
  private floorUnder(x: number, z: number): PlacedObject | null {
    if (!this.house) return null;
    const floorY = this.house.floorY;
    return (
      this.store.getState().placedObjects.find((p) => {
        if (p.group?.id !== this.house!.groupId) return false;
        const definition = this.registry.get(p.definitionId);
        if (!definition || roleOf(definition) !== 'floor') return false;
        const b = boundsOfPlaced(definition, p);
        return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && Math.abs(b.maxY - floorY) < 0.05;
      }) ?? null
    );
  }

  private houseGroup(): CreationGroupRef | null {
    if (!this.house) return null;
    const member = this.store.getState().placedObjects.find((p) => p.group?.id === this.house!.groupId);
    return member?.group ? { ...member.group } : null;
  }

  /** In the dollhouse there is no walker: the room under the camera's focus. */
  private roomNearCamera(): InteriorRoom | null {
    if (!this.house) return null;
    const target = this.world.cameraController.target;
    return roomAt(this.house, target.x, target.z) ?? this.house.rooms[0] ?? null;
  }

  /** Which house of a neighbourhood stands at a point (for pieces the child added, which have no plan key). */
  private houseIndexAt(groupId: string, x: number, z: number): number | null {
    const record = this.planBuilder.recordOf(groupId);
    if (!record || record.plan.kind !== 'neighborhood') return null;
    for (let i = 0; i < record.plan.houses; i++) {
      const house = describeHouseInterior(groupId, record, this.registry, i);
      if (house && x >= house.footprint.minX && x <= house.footprint.maxX && z >= house.footprint.minZ && z <= house.footprint.maxZ) return i;
    }
    return null;
  }

  /** The camera's current position and heading as a walk pose. */
  private cameraPose(): WalkPose {
    const camera = this.world.camera;
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    return { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: euler.y, pitch: THREE.MathUtils.clamp(euler.x, -0.95, 0.95) };
  }

  private addCeiling(house: InteriorHouse): void {
    if (this.ceiling) return;
    const width = house.footprint.maxX - house.footprint.minX;
    const depth = house.footprint.maxZ - house.footprint.minZ;
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), this.ceilingMaterial);
    ceiling.name = 'interior-ceiling';
    // Just under the roof, facing down into the rooms.
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set((house.footprint.minX + house.footprint.maxX) / 2, house.ceilingY - 0.02, (house.footprint.minZ + house.footprint.maxZ) / 2);
    ceiling.receiveShadow = false;
    ceiling.castShadow = false;
    this.world.overlayRoot.add(ceiling);
    this.ceiling = ceiling;
  }

  private removeCeiling(): void {
    if (!this.ceiling) return;
    this.ceiling.removeFromParent();
    this.ceiling.geometry.dispose();
    this.ceiling = null;
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

/** "chairs", "sofas", "kitchen counters" (catalogue names are simple nouns). */
function pluralOf(name: string): string {
  if (/(s|sh|ch|x)$/.test(name)) return `${name}es`;
  return `${name}s`;
}

/** "a sofa", "an armchair". */
function articleFor(name: string): string {
  const lower = name.toLowerCase();
  return /^[aeiou]/.test(lower) ? `an ${lower}` : `a ${lower}`;
}
