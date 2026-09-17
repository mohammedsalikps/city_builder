import { GameStore } from '@/state/GameStore';
import { createInitialState } from '@/state/initialState';
import { GameActions } from '@/state/actions';
import { ObjectRegistry } from '@/construction/ObjectRegistry';
import { ConstructionController } from '@/construction/ConstructionController';
import type { BuildArea } from '@/construction/BuildArea';
import { boundsOfPlaced } from '@/construction/bounds';
import { roleOf } from '@/construction/ConstructionObjectDefinition';
import { HOME_MIN_FOOTPRINT } from '@/visual/assets/scalePolicy';
import type { EnvironmentLook } from '@/visual/environment/Environment';
import { ChallengeRegistry } from '@/challenges/ChallengeRegistry';
import { BlueprintRenderer } from '@/challenges/BlueprintRenderer';
import { ChallengePlacementTargets } from '@/challenges/PlacementTargets';
import { ChallengeSystem } from '@/challenges/ChallengeSystem';
import {
  objectDefinitions,
  challengeDefinitions,
  worldDefinitions,
  assetDefinitions,
  sceneryDefinition,
  templateDefinitions,
  studioDefinition,
  worldDefinition,
} from '@/data';
import { WorldSpace } from '@/world/WorldSpace';
import { LivingWorld } from '@/visual/world/LivingWorld';
import { isPlacementMode, type GameState } from '@/state/GameState';
import { TemplateRegistry } from '@/creative/Template';
import { MyWorldPersistenceService } from '@/creative/MyWorldPersistenceService';
import { TemplatePlacementController } from '@/creative/TemplatePlacementController';
import { StreetDrawController } from '@/creative/StreetDrawController';
import { HistoryService } from '@/creative/HistoryService';
import { ThumbnailRenderer } from '@/creative/ThumbnailRenderer';
import { GhostKit } from '@/creative/Ghosts';
import { StudioCatalog } from '@/creative/Studio';
import type { CameraView, ScreenPoint, StudioServices } from '@/ui/studio/StudioServices';
import { LocalMyWorldStorage } from '@/state/MyWorldStorage';
import { AssetRegistry } from '@/visual/assets/AssetRegistry';
import { AssetLibrary } from '@/visual/assets/AssetLibrary';
import { Scenery } from '@/visual/scenery/Scenery';
import { HomeShowcase } from '@/visual/scenery/HomeShowcase';
import { cloneMaterial } from '@/visual/materials/MaterialLibrary';
import type { CameraPreset } from '@/world/CameraController';
import * as THREE from 'three';
import { LocalProgressStorage } from '@/progression/ProgressStorage';
import { ProgressionService } from '@/progression/ProgressionService';
import { World } from '@/world/World';
import { InputManager } from '@/input/InputManager';
import { UIManager } from '@/ui/UIManager';
import { GameLoop } from './GameLoop';
import { InteriorReadability } from './InteriorReadability';

/** Where the world-map camera looks: the street and houses beyond the building sites. */
const MENU_FOCUS = { x: 0, y: 2, z: -22 };
const MENU_VIEW = { distance: 62, azimuth: 28, elevation: 17 };
const MENU_AUTOROTATE_SPEED = 0.35;

/**
 * The home screen's own cinematic composition: the "under construction" site
 * near the origin in the foreground, the neighbourhood and commercial
 * skyline in the middle distance, the lake, forest and mountains beyond.
 * Orbits far slower than the world map so it reads as alive without ever
 * competing with the menu for attention.
 */
const HOME_FOCUS = { x: 2, y: 2.5, z: -20 };
const HOME_VIEW = { distance: 78, azimuth: 12, elevation: 14 };
const HOME_AUTOROTATE_SPEED = 0.05;

/** Renderer exposure while the home screen is showing (the game uses its lighting look's). */
const HOME_EXPOSURE = 1.08;

/**
 * My World's own default framing: the home plot in front, the neighbours
 * around it and the town and skyline beyond, so a fresh session opens on
 * somewhere to build inside a world that is clearly bigger. Only used when
 * there is no active challenge - Challenge Mode keeps its own per-level
 * framing (see ChallengeSystem), which this must never override.
 */
const SANDBOX_FOCUS = { x: 0, y: 0, z: -6 };
const SANDBOX_VIEW = { distance: 118, azimuth: 25, elevation: 30 };
/**
 * World view: the normal city-building height. It keeps the current heading
 * but leans towards the valley's middle, so the neighbourhood you are in is
 * seen together with its roads, the lake and the next district over.
 */
const WORLD_VIEW = { distance: 235, elevation: 31 };
const WORLD_LEAN = { x: -10, z: -35, amount: 0.4 };
/**
 * City view: one composed postcard of the whole valley - suburbs and works
 * in front, the town and downtown behind, the lake to one side and the
 * mountains closing the picture.
 */
const CITY_FOCUS = { x: 10, y: 0, z: -85 };
const CITY_VIEW = { distance: 540, azimuth: 25, elevation: 27 };
/** My World's daylight (see EnvironmentLook). */
const VALLEY_LOOK: EnvironmentLook = {
  exposure: 0.9,
  sun: { color: '#ffeed6', intensity: 3.6 },
  hemisphere: { sky: '#c9ddff', ground: '#5e6e3e', intensity: 0.34 },
  environmentIntensity: 0.38,
  fog: { color: '#b8cee4', near: 300, far: 1300 },
};
/** Selecting something further than this from the view flies the camera to it. */
const FLY_TO_SELECTION = 70;
/**
 * My World keeps big views smooth on modest GPUs by rendering at a lower
 * resolution while frames are slow (never below MIN), and climbing back
 * when there is headroom. Challenge Mode and menus always render at full size.
 */
const RENDER_SCALE = { min: 0.6, step: 0.1, slowMs: 24, fastMs: 13, settleSeconds: 1.5 };

/** Number keys choose presentation views (see CameraController presets). */
const CAMERA_KEYS: Record<string, CameraPreset | undefined> = {
  Digit1: 'close',
  Digit2: 'build',
  Digit3: 'area',
  Digit4: 'town',
};

export interface GameElements {
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
}

/**
 * Composition root. Creates every system in dependency order and wires
 * them together. Systems never construct each other; they receive what
 * they need from here.
 *
 *   data  -> registry
 *   store -> actions -> ui
 *   world + input -> construction controller
 *   loop  -> world.update, construction.update, world.render
 */
export class Game {
  readonly store: GameStore;
  readonly actions: GameActions;
  readonly registry: ObjectRegistry;
  readonly challenges: ChallengeRegistry;
  readonly templates: TemplateRegistry;
  readonly challengeSystem: ChallengeSystem;
  readonly progression: ProgressionService;
  readonly myWorldPersistence: MyWorldPersistenceService;
  readonly templatePlacement: TemplatePlacementController;
  readonly streetDraw: StreetDrawController;
  readonly history: HistoryService;
  readonly thumbnails: ThumbnailRenderer;
  readonly studio: StudioCatalog;
  private readonly ghosts: GhostKit;
  private readonly projector = new THREE.Vector3();
  readonly world: World;
  readonly input: InputManager;
  readonly construction: ConstructionController;
  readonly ui: UIManager;
  readonly loop: GameLoop;
  readonly interior: InteriorReadability;
  readonly assetRegistry: AssetRegistry;
  readonly assets: AssetLibrary;
  readonly scenery: Scenery;
  readonly homeShowcase: HomeShowcase;
  readonly worldSpace: WorldSpace;
  readonly livingWorld: LivingWorld;
  private inMyWorld = false;
  private readonly pointerRay = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly groundPoint = new THREE.Vector3();
  private frameTimeAverage = 16;
  private renderScaleTimer = 0;

  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeKeys: (() => void) | null = null;

  constructor(elements: GameElements) {
    this.registry = new ObjectRegistry();
    this.registry.registerAll(objectDefinitions);
    this.challenges = new ChallengeRegistry(this.registry);
    this.challenges.registerWorlds(worldDefinitions);
    this.challenges.registerAll(challengeDefinitions);
    this.templates = new TemplateRegistry();
    this.templates.registerAll(templateDefinitions);
    this.checkTemplateReferences();
    this.assetRegistry = new AssetRegistry(assetDefinitions);
    this.assetRegistry.checkReferences(objectDefinitions);

    this.world = new World({ canvas: elements.canvas, environment: sceneryDefinition.environment });
    this.assets = new AssetLibrary(this.assetRegistry, this.world.materials);
    this.scenery = new Scenery(sceneryDefinition, this.assets, (x, z) => this.world.environment.terrain.heightAt(x, z));
    this.world.sceneryRoot.add(this.scenery.root);
    this.homeShowcase = new HomeShowcase(this.assets, (x, z) => this.world.environment.terrain.heightAt(x, z));
    this.world.homeRoot.add(this.homeShowcase.root);
    this.worldSpace = new WorldSpace(worldDefinition);
    this.livingWorld = new LivingWorld(this.worldSpace, this.assets, this.assetRegistry, this.world.materials);
    this.world.scene.add(this.livingWorld.root);

    const storage = new LocalProgressStorage();
    const myWorldStorage = new LocalMyWorldStorage();
    const savedWorld = myWorldStorage.load();
    this.store = new GameStore(
      createInitialState(storage.load() ?? undefined, savedWorld?.player ?? null, savedWorld?.identity),
    );
    const placementTargets = new ChallengePlacementTargets(this.store, this.challenges);
    const placementRules = {
      getBuildArea: () => this.currentBuildArea(),
      getPlacementTargets: (definitionId: string) => placementTargets.get(definitionId),
      // The valley's water and starting scenery - My World only.
      isBlocked: (bounds: Parameters<WorldSpace['isBlocked']>[0]) =>
        isMyWorld(this.store.getState()) && this.worldSpace.isBlocked(bounds),
    };
    this.actions = new GameActions(this.store, this.registry, this.challenges, placementRules);

    this.input = new InputManager(elements.canvas);
    this.construction = new ConstructionController(
      this.store,
      this.actions,
      this.registry,
      this.world,
      this.input,
      placementRules,
      this.assets,
    );
    this.challengeSystem = new ChallengeSystem(
      this.store,
      this.actions,
      this.challenges,
      this.registry,
      new BlueprintRenderer(this.world.overlayRoot, this.construction.resources, this.registry, this.createSiteMaterial(), this.assets),
      this.world,
    );
    this.interior = new InteriorReadability(
      this.store,
      this.registry,
      this.challenges,
      this.world.camera,
      this.construction.renderer,
    );
    this.construction.setPlacementSeeThrough(() => this.interior.placementOccluderIds);
    this.progression = new ProgressionService(this.store, this.actions, storage);
    this.myWorldPersistence = new MyWorldPersistenceService(this.store, this.actions, myWorldStorage, this.registry);
    this.studio = new StudioCatalog(studioDefinition, this.registry, this.templates);
    this.ghosts = new GhostKit(this.construction.resources, this.assets);
    this.templatePlacement = new TemplatePlacementController(
      this.store,
      this.actions,
      this.registry,
      this.templates,
      this.ghosts,
      this.world,
      this.input,
      placementRules,
    );
    this.templatePlacement.onPlaced = (center, radius) => this.frameCreation(center, radius);
    this.streetDraw = new StreetDrawController(
      this.store,
      this.actions,
      this.registry,
      this.ghosts,
      this.world,
      elements.canvas,
      placementRules,
    );
    this.streetDraw.onBuilt = (center, radius) => this.frameCreation(center, radius);
    this.history = new HistoryService(this.store, this.actions);
    this.thumbnails = new ThumbnailRenderer(this.registry, this.templates, this.construction.resources, this.assets);
    this.ui = new UIManager(elements.uiRoot, this.store, {
      actions: this.actions,
      registry: this.registry,
      challenges: this.challenges,
      templates: this.templates,
      studio: this.createStudioServices(),
    });

    this.loop = new GameLoop((delta) => this.frame(delta));
  }

  start(): void {
    this.ui.start();
    this.construction.start();
    this.challengeSystem.start();
    this.progression.start();
    this.myWorldPersistence.start();
    this.history.start();
    this.templatePlacement.start();
    this.streetDraw.start();
    this.unsubscribeStore = this.store.subscribe((state, previous) => {
      const myWorld = isMyWorld(state);
      const wasMyWorld = this.inMyWorld;
      if (myWorld !== this.inMyWorld) this.setMyWorldScene(myWorld);
      if (state.mode !== previous.mode) this.onModeChanged(state.mode, previous.mode, state.challenge === null);
      // A soft local guide while placing in My World; levels show their site pad.
      this.world.setGridVisible(
        myWorld && (isPlacementMode(state) || state.templatePlacement !== null || state.streetDrawing),
      );
      if (myWorld && (state.placedObjects !== previous.placedObjects || !wasMyWorld)) this.clearSceneryUnderCreations(state);
      if (myWorld && state.selectedInstanceId && state.selectedInstanceId !== previous.selectedInstanceId) {
        this.flyToSelection(state.selectedInstanceId);
      }
    });
    this.onModeChanged(this.store.getState().mode);
    this.world.setGridVisible(false);
    this.unsubscribeKeys = this.input.keyboard.on('keydown', (key) => {
      if (this.store.getState().mode !== 'playing') return;
      const preset = CAMERA_KEYS[key.code];
      if (preset) this.world.cameraController.setPreset(preset);
    });
    void this.scenery.build().catch((error) => console.warn('[scenery] could not be built', error));
    void this.homeShowcase.build().catch((error) => console.warn('[home] showcase could not be built', error));
    this.loop.start();
    this.actions.finishBoot();

    console.info(
      `[game] started - ${this.registry.size} construction object definitions, ${this.challenges.worlds().length} worlds, ${this.challenges.size} challenges loaded`,
    );
  }

  /**
   * Where building is allowed right now: the active challenge's area, or the
   * whole ground when free building. Read live by the placement rules.
   */
  private currentBuildArea(): BuildArea {
    const { challenge } = this.store.getState();
    const definition = challenge ? this.challenges.get(challenge.challengeId) : undefined;
    if (definition) {
      return { center: definition.buildOrigin, halfSize: definition.buildAreaHalfSize };
    }
    return { center: { x: 0, y: 0, z: 0 }, halfSize: this.worldSpace.buildHalfSize };
  }

  dispose(): void {
    this.loop.stop();
    this.unsubscribeStore?.();
    this.unsubscribeKeys?.();
    this.assets.dispose();
    this.ui.dispose();
    this.progression.dispose();
    this.myWorldPersistence.dispose();
    this.history.dispose();
    this.templatePlacement.dispose();
    this.streetDraw.dispose();
    this.thumbnails.dispose();
    this.ghosts.dispose();
    this.livingWorld.dispose();
    this.challengeSystem.dispose();
    this.construction.dispose();
    this.input.dispose();
    this.world.dispose();
  }

  private frame(delta: number): void {
    this.world.update(delta);
    if (this.inMyWorld) {
      this.livingWorld.update(this.world.camera);
      this.world.environment.setHazeForView(this.world.cameraController.distance);
      this.followPointerWithGrid();
      this.adaptRenderScale(delta);
    }
    this.assets.update(delta);
    // Readability first: the preview resolved next uses this frame's
    // occluders, the same ones the frame is rendered with.
    this.interior.update();
    this.construction.update(delta);
    this.templatePlacement.update();
    this.world.render();
    this.ui.frame();
  }

  /**
   * Gentle camera settle after a creation is placed (frame, never jump):
   * a house gets a close, friendly view; a neighbourhood a wider one. The
   * current heading is kept so the world doesn't swing around.
   */
  private frameCreation(center: { x: number; y: number; z: number }, radius: number): void {
    const distance = THREE.MathUtils.clamp(radius * 2.6, 22, 78);
    // Big creations (a neighbourhood) are best seen from higher up, like a map.
    const elevation = radius > 12 ? 52 : 38;
    this.world.cameraController.transitionTo(
      { x: center.x, y: 0.5, z: center.z },
      { distance, azimuth: this.currentAzimuth(), elevation },
      1.1,
    );
  }

  private currentAzimuth(): number {
    return this.world.cameraController.azimuth;
  }

  /**
   * Switch the scene between My World's large valley and the construction
   * site (menus, world map, challenges). Presentation and camera only.
   */
  private setMyWorldScene(on: boolean): void {
    this.inMyWorld = on;
    this.livingWorld.setVisible(on);
    this.scenery.root.visible = !on;
    this.world.environment.setShowcaseVisible(!on);
    this.world.environment.setCloudLift(on ? 420 : 0);
    const environment = this.world.environment;
    environment.setLook(on ? VALLEY_LOOK : environment.siteLook);
    if (this.store.getState().mode !== 'menu') this.world.renderer.toneMappingExposure = environment.exposure;
    this.world.cameraController.setLimits(
      on ? { minDistance: 3, maxDistance: 820, halfSize: this.worldSpace.cameraHalfSize } : null,
    );
    if (on) {
      void this.livingWorld
        .build()
        .then(() => console.info('[world] valley ready', this.livingWorld.stats))
        .catch((error) => console.warn('[world] valley could not be built', error));
    } else {
      this.world.environment.setHazeForView(null);
      this.world.setRenderScale(1);
    }
  }

  private adaptRenderScale(delta: number): void {
    if (delta <= 0 || delta > 0.5) return; // tab switches and stalls say nothing about the GPU
    this.frameTimeAverage += (delta * 1000 - this.frameTimeAverage) * 0.05;
    this.renderScaleTimer += delta;
    if (this.renderScaleTimer < RENDER_SCALE.settleSeconds) return;
    const scale = this.world.currentRenderScale;
    if (this.frameTimeAverage > RENDER_SCALE.slowMs && scale > RENDER_SCALE.min + 1e-3) {
      this.world.setRenderScale(Math.max(RENDER_SCALE.min, scale - RENDER_SCALE.step));
      this.renderScaleTimer = 0;
    } else if (this.frameTimeAverage < RENDER_SCALE.fastMs && scale < 1 - 1e-3) {
      this.world.setRenderScale(Math.min(1, scale + RENDER_SCALE.step));
      this.renderScaleTimer = 0;
    }
  }

  /** Trees and small props give way wherever the child has built. */
  private clearSceneryUnderCreations(state: GameState): void {
    const footprints = [];
    for (const placed of state.placedObjects) {
      const definition = this.registry.get(placed.definitionId);
      if (!definition) continue;
      const b = boundsOfPlaced(definition, placed);
      footprints.push({ minX: b.minX - 0.3, maxX: b.maxX + 0.3, minZ: b.minZ - 0.3, maxZ: b.maxZ + 0.3 });
    }
    this.livingWorld.clearUnder(footprints);
  }

  /** The local building guide follows the point under the pointer. */
  private followPointerWithGrid(): void {
    const pointer = this.input.pointer.position;
    if (!pointer) return;
    this.pointerRay.setFromCamera(new THREE.Vector2(pointer.ndcX, pointer.ndcY), this.world.camera);
    if (this.pointerRay.ray.intersectPlane(this.groundPlane, this.groundPoint)) {
      this.world.grid.setCentre(this.groundPoint.x, this.groundPoint.z);
    }
  }

  /** Selecting something far away (from the map, say) travels there. */
  private flyToSelection(instanceId: string): void {
    const placed = this.store.getState().placedObjects.find((p) => p.id === instanceId);
    if (!placed) return;
    const controller = this.world.cameraController;
    const dx = placed.position.x - controller.target.x;
    const dz = placed.position.z - controller.target.z;
    const far = Math.hypot(dx, dz) > FLY_TO_SELECTION;
    if (!far && this.projectInstance(instanceId)?.onScreen) return;
    controller.flyTo(
      { x: placed.position.x, y: 1, z: placed.position.z },
      { distance: THREE.MathUtils.clamp(controller.distance, 26, 60), azimuth: controller.azimuth, elevation: 36 },
    );
  }

  private flyToPoint(x: number, z: number): void {
    const controller = this.world.cameraController;
    controller.flyTo(
      { x, y: 0, z },
      { distance: THREE.MathUtils.clamp(controller.distance, 45, 190), azimuth: controller.azimuth, elevation: 40 },
    );
  }

  private flyToDistrict(id: string): void {
    const district = this.worldSpace.district(id);
    if (!district) return;
    const { rect } = district;
    const size = Math.max(rect.maxX - rect.minX, rect.maxZ - rect.minZ);
    const home = district.kind === 'home';
    this.world.cameraController.flyTo(
      { x: (rect.minX + rect.maxX) / 2, y: 0, z: (rect.minZ + rect.maxZ) / 2 + (home ? 2 : 0) },
      {
        distance: home ? SANDBOX_VIEW.distance : THREE.MathUtils.clamp(size * 1.15, 70, 300),
        azimuth: this.currentAzimuth(),
        elevation: home ? SANDBOX_VIEW.elevation : 44,
      },
    );
  }

  /** World Studio's window onto the running game - see StudioServices. */
  private createStudioServices(): StudioServices {
    return {
      catalog: this.studio,
      thumbnails: this.thumbnails,
      history: this.history,
      confirmTemplate: () => this.templatePlacement.confirm(),
      templateFits: () => this.templatePlacement.fits,
      templateHasSpot: () => this.templatePlacement.hasSpot,
      projectInstance: (id) => this.projectInstance(id),
      cameraView: (view) => this.cameraView(view),
      findPlaced: (id) => this.store.getState().placedObjects.find((p) => p.id === id) ?? null,
      allPlaced: () => this.store.getState().placedObjects,
      mapData: () => {
        const composed = this.livingWorld.world;
        if (!composed) return null;
        const spec = this.worldSpace.spec;
        return {
          halfSize: spec.buildHalfSize,
          districts: spec.districts,
          lakes: spec.water,
          roadTiles: composed.roadTiles,
          tile: spec.tile,
          homePlot: spec.homePlot,
          openPlots: spec.openPlots,
        };
      },
      cameraFocus: () => {
        const controller = this.world.cameraController;
        return { x: controller.target.x, z: controller.target.z, azimuth: controller.azimuth, distance: controller.distance };
      },
      districtAt: (x, z) => this.worldSpace.districtAt(x, z),
      placeName: () => {
        const controller = this.world.cameraController;
        if (controller.distance > 380) return 'The whole valley';
        return this.worldSpace.districtAt(controller.target.x, controller.target.z)?.name ?? 'Open countryside';
      },
      flyTo: (x, z) => this.flyToPoint(x, z),
      flyToDistrict: (id) => this.flyToDistrict(id),
    };
  }

  private projectInstance(instanceId: string): ScreenPoint | null {
    const state = this.store.getState();
    const placed = state.placedObjects.find((p) => p.id === instanceId);
    const definition = placed ? this.registry.get(placed.definitionId) : undefined;
    if (!placed || !definition) return null;
    const camera = this.world.camera;
    const rect = this.world.renderer.domElement.getBoundingClientRect();
    const toScreen = (x: number, y: number, z: number) => {
      this.projector.set(x, y, z).project(camera);
      return {
        x: rect.left + ((this.projector.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - this.projector.y) / 2) * rect.height,
        visible: this.projector.z < 1 && Math.abs(this.projector.x) <= 1.05 && Math.abs(this.projector.y) <= 1.05,
      };
    };
    const height = definition.dimensions.height * placed.scale.y;
    const reach = (Math.max(definition.dimensions.width * placed.scale.x, definition.dimensions.depth * placed.scale.z) / 2) * 0.9;
    const { x, y, z } = placed.position;
    const top = toScreen(x, y + height, z);
    const middle = toScreen(x, y + height / 2, z);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const side = toScreen(x + right.x * reach, y + height / 2, z + right.z * reach);
    return {
      x: top.x,
      y: top.y,
      centerY: middle.y,
      radius: Math.abs(side.x - middle.x),
      onScreen: middle.visible,
    };
  }

  /**
   * The three friendly framings:
   *   Close - construction detail on what's selected (or right here)
   *   World - the normal building height, several districts in view
   *   City  - high above the whole valley
   */
  private cameraView(view: CameraView): void {
    const state = this.store.getState();
    const controller = this.world.cameraController;
    const azimuth = this.currentAzimuth();
    if (view === 'close') {
      const selected = state.placedObjects.find((p) => p.id === state.selectedInstanceId);
      const target = selected
        ? { x: selected.position.x, y: 1, z: selected.position.z }
        : { x: controller.target.x, y: 0.5, z: controller.target.z };
      // A low three-quarter view: architecture and details read best from here.
      const size = selected ? this.registry.get(selected.definitionId)?.dimensions : undefined;
      const distance = size ? THREE.MathUtils.clamp(Math.max(size.width, size.depth, size.height) * 2.2, 12, 34) : 26;
      controller.flyTo(target, { distance, azimuth, elevation: 24 });
    } else if (view === 'world') {
      const lean = WORLD_LEAN.amount;
      const x = THREE.MathUtils.lerp(controller.target.x, WORLD_LEAN.x, lean);
      const z = THREE.MathUtils.lerp(controller.target.z, WORLD_LEAN.z, lean);
      controller.flyTo({ x, y: 0, z }, { ...WORLD_VIEW, azimuth });
    } else {
      controller.flyTo(CITY_FOCUS, CITY_VIEW);
    }
  }

  /** Fail fast at boot if a template references an object id that doesn't exist. */
  private checkTemplateReferences(): void {
    for (const template of this.templates.list()) {
      for (const spec of template.objects) {
        if (!this.registry.has(spec.definitionId)) {
          throw new Error(`Template "${template.id}" references unknown object "${spec.definitionId}"`);
        }
      }
      // Visual scale policy rule 4: a hand-built home is a real home, not a shed.
      const pieces = template.objects.map((spec) => ({ spec, definition: this.registry.get(spec.definitionId)! }));
      if (pieces.some((p) => roleOf(p.definition) === 'roof') && pieces.some((p) => roleOf(p.definition) === 'wall')) {
        const floor = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
        for (const { spec, definition } of pieces) {
          if (roleOf(definition) !== 'floor') continue;
          floor.minX = Math.min(floor.minX, spec.position.x - definition.dimensions.width / 2);
          floor.maxX = Math.max(floor.maxX, spec.position.x + definition.dimensions.width / 2);
          floor.minZ = Math.min(floor.minZ, spec.position.z - definition.dimensions.depth / 2);
          floor.maxZ = Math.max(floor.maxZ, spec.position.z + definition.dimensions.depth / 2);
        }
        const floorArea = Math.max(0, floor.maxX - floor.minX) * Math.max(0, floor.maxZ - floor.minZ);
        if (floorArea < HOME_MIN_FOOTPRINT) {
          throw new Error(`Template "${template.id}" is a ${floorArea.toFixed(1)} m² home; homes need ${HOME_MIN_FOOTPRINT} m²`);
        }
      }
    }
  }

  /** Soil-coloured ground under a level's build area: "this is your building site". */
  private createSiteMaterial(): THREE.Material {
    const material = cloneMaterial(this.world.materials.forAsset('soil', new THREE.Color('#9a7a55')));
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
    material.transparent = true;
    material.opacity = 0.72;
    material.depthWrite = false;
    return material;
  }

  private onModeChanged(mode: string, previousMode?: string, freeBuild?: boolean): void {
    // The camera is only controllable while actually playing.
    this.world.cameraController.setEnabled(mode === 'playing');
    // The home screen gets its own cinematic composition and presentation;
    // the world map keeps the original showcase view unchanged.
    this.world.homeRoot.visible = mode === 'menu';
    this.world.renderer.toneMappingExposure = mode === 'menu' ? HOME_EXPOSURE : this.world.environment.exposure;
    if (mode === 'menu') {
      this.world.cameraController.setAutoRotate(true, HOME_AUTOROTATE_SPEED);
      this.world.cameraController.transitionTo(HOME_FOCUS, HOME_VIEW, 1.8);
    } else if (mode === 'world-map') {
      this.world.cameraController.setAutoRotate(true, MENU_AUTOROTATE_SPEED);
      this.world.cameraController.transitionTo(MENU_FOCUS, MENU_VIEW, 1.6);
    } else {
      this.world.cameraController.setAutoRotate(false);
      // Freshly entering free-build (not resuming from pause, and not a
      // challenge - that has its own framing via ChallengeSystem) starts the
      // player looking at the buildable ground instead of stuck wherever the
      // menu's camera last was.
      if (mode === 'playing' && previousMode !== 'paused' && freeBuild) {
        this.world.cameraController.transitionTo(SANDBOX_FOCUS, SANDBOX_VIEW, 1.4);
      }
    }
  }
}

/** My World's free-building session (not a challenge, not a menu). */
function isMyWorld(state: GameState): boolean {
  return (state.mode === 'playing' || state.mode === 'paused') && state.challenge === null;
}
