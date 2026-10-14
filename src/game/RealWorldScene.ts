import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GameStore } from '@/state/GameStore';
import type { GameState } from '@/state/GameState';
import type { GameActions } from '@/state/actions';
import type { World } from '@/world/World';
import type { CameraSnapshot } from '@/world/CameraController';
import type { InputManager } from '@/input/InputManager';
import type { PointerClick } from '@/input/PointerInput';
import type { EnvironmentLook } from '@/visual/environment/Environment';
import {
  CONSTRUCTION_PROGRESS,
  LANDMARKS,
  SCENE_SCALE,
  buildLandmarkModel,
  builtHeightForProgress,
  landmarkById,
  timelineProgress,
  type LandmarkModel,
  type LandmarkView,
  type Mission,
  type RealLandmark,
  type Stop,
} from '@/realworld';
import type { LandmarkProgress, RealWorldProgressStore } from '@/realworld/RealWorldProgress';
import { TAP_TOLERANCE_PX, mostFrequentPart, partFromHits, ringOffsets } from '@/realworld/picking';
import { prepareLandmarkModel, type ModelOrigin, type PreparedModel } from '@/realworld/loadModel';
import { motion } from '@/accessibility/motion';

/** Downloaded CC0 assets (see docs/realworld-asset-manifest.md); each has a fallback if it fails to load. */
const ASSETS = {
  hdri: 'assets/realworld/environments/kloofendal_43d_clear_puresky_1k.hdr',
  sand: 'assets/realworld/materials/sand_01/sand_01_diff_1k.jpg',
  concrete: 'assets/realworld/materials/concrete_floor_01/concrete_floor_01_diff_1k.jpg',
};

/** A bright, warm desert day for landmark scenes (scene units are 1:10, so fog reaches ~16 km). */
const DESERT_LOOK: EnvironmentLook = {
  exposure: 0.95,
  sun: { color: '#fff1d6', intensity: 3.2 },
  hemisphere: { sky: '#cfe2ff', ground: '#c9a978', intensity: 0.38 },
  environmentIntensity: 0.55,
  fog: { color: '#d9e3ee', near: 500, far: 1600 },
};

/** What the RealWorld screen shows. */
export interface RealWorldSnapshot {
  landmark: RealLandmark | null;
  view: LandmarkView;
  stopId: string | null;
  /** 0..1 construction progress shown in the 'construction' view. */
  construction: number;
  /** Index of the timeline entry being shown, or null. */
  timelineIndex: number | null;
  selectedPart: string | null;
  loadPath: boolean;
  wind: number | null;
  /** The part whose force arrows are shown (bridge lesson), or null. */
  forces: string | null;
  /** Where a lesson's load stands along the main span (0..1), or null; and the cable shape it hangs from. */
  loadPoint: number | null;
  cable: 'normal' | 'flat';
  /**
   * 'procedural' = built in code (simplified model), 'downloaded' = the
   * downloaded model file, 'fallback' = the built-in stand-in because the
   * file could not be loaded, 'loading' = the file is on its way,
   * 'unavailable' = nothing to show.
   */
  model: ModelOrigin | 'loading' | 'unavailable';
  progress: LandmarkProgress | null;
  /** Lighting: the downloaded sky, or the built-in one if it could not load. */
  environment: 'hdri' | 'fallback' | 'loading';
}

/**
 * How much of the screen the RealWorld panels cover on each side, as
 * fractions (0..1) of its width or height. The 3D view keeps the landmark's
 * subject in the uncovered part (see setScreenInsets).
 */
export interface ScreenInsets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Largest shift of the view centre, as a fraction of the screen (so a crowded phone screen never pushes the subject off it). */
const MAX_VIEW_SHIFT = 0.3;
/** How quickly the view centre glides to a new free area (per second). */
const VIEW_SHIFT_RATE = 6;
/** The farthest a long landmark's overview steps back (the camera limit in RealWorld is 420). */
const OVERVIEW_MAX_DISTANCE = 380;

/** A mission finished just now (for a celebration). */
export interface MissionEvent {
  mission: Mission;
}

/**
 * RealWorld Explorer's 3D side: when the game is in 'realworld' mode it
 * shows a landmark scene instead of the construction site - a desert ground,
 * the downloaded sky for lighting, and the landmark's model (loaded only
 * when the landmark is opened) - and answers the screen's requests: travel
 * to a floor-navigator stop, switch view (complete / construction /
 * cutaway / inspect), scrub the construction timeline, highlight parts, show
 * the load path and wind. Taps on the model pick structural parts and
 * advance missions. Learning progress is stored separately from Challenge
 * Mode (RealWorldProgressStore). On leaving, the scene, camera and lighting
 * are put back exactly as they were; My World and Challenge Mode never see
 * any of it.
 */
export class RealWorldScene {
  private readonly root = new THREE.Group();
  private model: LandmarkModel | null = null;
  private landmark: RealLandmark | null = null;
  private active = false;
  private snapshot: CameraSnapshot | null = null;
  private previousEnvironment: THREE.Texture | null = null;
  private envTexture: THREE.Texture | null = null;
  private envStatus: RealWorldSnapshot['environment'] = 'loading';
  private textures: { ground?: THREE.Texture; concrete?: THREE.Texture } = {};
  private view: LandmarkView = 'complete';
  private stopId: string | null = null;
  private construction = 1;
  private timelineIndex: number | null = null;
  private selectedPart: string | null = null;
  private highlight: string[] | null = null;
  private loadPath = false;
  private wind: number | null = null;
  private forces: string | null = null;
  private loadPoint: number | null = null;
  private cable: 'normal' | 'flat' = 'normal';
  private readonly sequenceStep = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private readonly missionListeners = new Set<(event: MissionEvent) => void>();
  private readonly partListeners = new Set<(partId: string | null) => void>();
  private readonly raycaster = new THREE.Raycaster();
  private unsubscribe: (() => void) | null = null;
  private unsubscribeClick: (() => void) | null = null;
  private unsubscribeMotion: (() => void) | null = null;
  private loadToken = 0;
  /** Bumped whenever the landmark changes, so a model that finishes loading too late is dropped. */
  private modelToken = 0;
  private modelLoading = false;
  private modelOrigin: ModelOrigin | null = null;
  private insets: ScreenInsets = { left: 0, top: 0, right: 0, bottom: 0 };
  private readonly viewShift = { x: 0, y: 0 };

  constructor(
    private readonly store: GameStore,
    private readonly actions: GameActions,
    private readonly world: World,
    private readonly input: InputManager,
    readonly progress: RealWorldProgressStore,
  ) {
    this.root.name = 'realworldRoot';
    this.root.visible = false;
  }

  start(): void {
    this.progress.load();
    this.unsubscribe = this.store.subscribe((state, previous) => this.onState(state, previous));
    this.unsubscribeClick = this.input.pointer.on('click', (click) => this.onClick(click));
    this.unsubscribeMotion = motion.onChange((reduced) => this.model?.setReducedMotion?.(reduced));
    this.progress.onChange(() => this.emit());
    // Loaded on demand (RealWorldHost): the game may already be in RealWorld mode, with a landmark open.
    const state = this.store.getState();
    this.onState(state, state);
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribeClick?.();
    this.unsubscribeMotion?.();
    this.leave();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onMission(listener: (event: MissionEvent) => void): () => void {
    this.missionListeners.add(listener);
    return () => this.missionListeners.delete(listener);
  }

  onPartTapped(listener: (partId: string | null) => void): () => void {
    this.partListeners.add(listener);
    return () => this.partListeners.delete(listener);
  }

  update(deltaSeconds: number): void {
    if (!this.active) return;
    this.model?.update(deltaSeconds);
    this.easeViewShift(deltaSeconds);
  }

  /**
   * The screen reports which parts of the screen its panels cover. The 3D
   * view then centres on the uncovered area (the camera's image is shifted,
   * the camera itself does not move), so the stop, part or construction
   * being shown is never hidden behind the floors list, the learn panel or
   * the timeline. Taps stay exact: picking uses the same shifted projection.
   */
  setScreenInsets(insets: ScreenInsets): void {
    const clean = (value: number) => (Number.isFinite(value) ? Math.min(0.9, Math.max(0, value)) : 0);
    this.insets = { left: clean(insets.left), top: clean(insets.top), right: clean(insets.right), bottom: clean(insets.bottom) };
  }

  private easeViewShift(deltaSeconds: number): void {
    const { left, top, right, bottom } = this.insets;
    const clamp = (value: number) => Math.min(MAX_VIEW_SHIFT, Math.max(-MAX_VIEW_SHIFT, value));
    // Shift that puts the image centre in the middle of the free area (positive = content moves left / up).
    const targetX = left + right < 0.95 ? clamp(0.5 - (left + 1 - right) / 2) : 0;
    const targetY = top + bottom < 0.95 ? clamp(0.5 - (top + 1 - bottom) / 2) : 0;
    const dt = Math.min(Math.max(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0), 0.1);
    const k = motion.reduced ? 1 : 1 - Math.exp(-VIEW_SHIFT_RATE * dt);
    const nextX = Math.abs(targetX - this.viewShift.x) < 1e-4 ? targetX : this.viewShift.x + (targetX - this.viewShift.x) * k;
    const nextY = Math.abs(targetY - this.viewShift.y) < 1e-4 ? targetY : this.viewShift.y + (targetY - this.viewShift.y) * k;
    if (nextX === this.viewShift.x && nextY === this.viewShift.y) return;
    this.viewShift.x = nextX;
    this.viewShift.y = nextY;
    this.applyViewShift();
  }

  private applyViewShift(): void {
    const camera = this.world.camera;
    if (Math.abs(this.viewShift.x) < 1e-4 && Math.abs(this.viewShift.y) < 1e-4) {
      if (camera.view?.enabled) camera.clearViewOffset();
      return;
    }
    // Only the ratios matter, so a fixed 1000 x 1000 "full image" works for any canvas size. three.js
    // also sets the camera's aspect to fullWidth / fullHeight here, so the canvas's own aspect is put
    // back (otherwise a wide screen would show the scene stretched sideways, and keep it after leaving).
    const aspect = camera.aspect;
    camera.setViewOffset(1000, 1000, this.viewShift.x * 1000, this.viewShift.y * 1000, 1000, 1000);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ screen requests

  landmarks(): RealLandmark[] {
    return LANDMARKS;
  }

  snapshotState(): RealWorldSnapshot {
    return {
      landmark: this.landmark,
      view: this.view,
      stopId: this.stopId,
      construction: this.construction,
      timelineIndex: this.timelineIndex,
      selectedPart: this.selectedPart,
      loadPath: this.loadPath,
      wind: this.wind,
      forces: this.forces,
      loadPoint: this.loadPoint,
      cable: this.cable,
      model: !this.landmark ? 'unavailable' : this.modelLoading ? 'loading' : this.model ? (this.modelOrigin ?? 'procedural') : 'unavailable',
      progress: this.landmark ? this.progress.get(this.landmark.id) : null,
      environment: this.envStatus,
    };
  }

  open(landmarkId: string | null): void {
    this.actions.openLandmark(landmarkId);
  }

  exit(): void {
    this.actions.exitRealWorld();
  }

  /** Travel to a floor-navigator stop (the camera eases there). */
  goToStop(stopId: string): void {
    const stop = this.landmark?.stops.find((s) => s.id === stopId);
    if (!stop || !this.model) return;
    this.stopId = stop.id;
    // Below ground the cutaway shows the foundation; elsewhere the chosen view stays.
    if (stop.kind === 'foundation' && this.view !== 'cutaway') this.setView('cutaway');
    this.frameStop(stop, 1.3);
    this.emit();
  }

  /** Back to the overview of the whole landmark. */
  resetView(): void {
    if (!this.model) return;
    this.stopId = null;
    this.setHighlight(null);
    this.selectedPart = null;
    this.frameOverview(1.2);
    this.emit();
  }

  setView(view: LandmarkView): void {
    if (!this.model) return;
    const entering = view === 'construction' && this.view !== 'construction';
    this.view = view;
    this.model.setView(view);
    if (view === 'construction') this.model.setConstructionProgress(this.construction);
    if (entering) this.frameConstruction(1.2);
    if (view !== 'inspect' && this.highlight) this.model.setHighlight(this.highlight);
    this.emit();
  }

  /** Show the model as built at a point of the timeline (index into landmark.timeline). */
  showTimelineEntry(index: number): void {
    const landmark = this.landmark;
    if (!landmark || !this.model) return;
    const entry = landmark.timeline[index];
    if (!entry) return;
    this.timelineIndex = index;
    this.construction = timelineProgress(landmark, entry);
    if (this.view !== 'construction') this.setView('construction');
    this.model.setConstructionProgress(this.construction);
    this.frameConstruction(1.2);
    if (index === landmark.timeline.length - 1 && this.progress.markTimelineWatched(landmark.id)) {
      this.completeMissions((m) => m.kind === 'timeline');
    }
    this.emit();
  }

  setHighlight(partIds: string[] | null): void {
    this.highlight = partIds && partIds.length > 0 ? [...partIds] : null;
    this.model?.setHighlight(this.highlight);
    this.emit();
  }

  /** Select a part as if it was tapped (from a hotspot list), or null to clear. */
  selectPart(partId: string | null): void {
    this.selectedPart = partId;
    this.setHighlight(partId ? [partId] : null);
    this.partListeners.forEach((listener) => listener(partId));
  }

  /**
   * Choose a part from the screen's parts list (keyboard, screen reader, or
   * simply easier than tapping a thin cable): the same as tapping it in 3D,
   * including the missions it completes.
   */
  choosePart(partId: string | null): void {
    this.selectPart(partId);
    if (partId) this.advanceMissions(partId);
  }

  setLoadPath(on: boolean): void {
    this.loadPath = on;
    this.model?.setLoadPath(on);
    this.emit();
  }

  setWind(strength01: number | null): void {
    this.wind = strength01;
    this.model?.setWind(strength01);
    this.emit();
  }

  /** Force arrows on one part (models that have them: the bridge), or null to hide them. */
  setForces(partId: string | null): void {
    this.forces = partId;
    this.model?.setForces?.(partId);
    this.emit();
  }

  /** A lesson's load at a point of the main span (0..1) with its load path, or null to remove it. */
  setLoadPoint(fraction01: number | null, cable: 'normal' | 'flat' = 'normal'): void {
    this.loadPoint = fraction01;
    this.cable = fraction01 === null ? 'normal' : cable;
    this.model?.setLoadPoint?.(fraction01, this.cable);
    this.emit();
  }

  /** The child reached the end of a lesson. */
  completeLesson(lessonId: string): void {
    const landmark = this.landmark;
    if (!landmark) return;
    this.progress.completeLesson(landmark.id, lessonId);
    this.completeMissions((m) => m.kind === 'lesson' && m.lessonId === lessonId);
  }

  /** Answer a quiz question; true when correct (only correct answers are recorded). */
  answer(quizId: string, optionIndex: number): boolean {
    const landmark = this.landmark;
    const question = landmark?.quiz.find((q) => q.id === quizId);
    if (!landmark || !question) return false;
    const correct = optionIndex === question.correctIndex;
    if (correct) {
      this.progress.answeredCorrectly(landmark.id, quizId);
      this.completeMissions((m) => m.kind === 'quiz' && m.quizId === quizId);
    }
    return correct;
  }

  /**
   * The child compared two designs in a simulation (a low-rise and a tall
   * building, a frame with and without a diagonal). Only the 'compare'
   * missions of that lesson count it.
   */
  compared(lessonId?: string): void {
    this.completeMissions((m) => m.kind === 'compare' && (lessonId === undefined || m.lessonId === undefined || m.lessonId === lessonId));
  }

  // ------------------------------------------------------------ internals

  private onState(state: GameState, previous: GameState): void {
    const wanted = state.mode === 'realworld';
    if (wanted && !this.active) this.arrive();
    else if (!wanted && this.active) this.leave();
    if (!this.active) return;
    if (state.realWorld.landmarkId !== previous.realWorld.landmarkId || (this.landmark?.id ?? null) !== state.realWorld.landmarkId) {
      this.showLandmark(state.realWorld.landmarkId);
    }
  }

  /** Enter the mode: hide the construction site, set up the landmark scene and lighting. */
  private arrive(): void {
    this.active = true;
    const world = this.world;
    this.snapshot = world.cameraController.snapshot();
    world.placementRoot.visible = false;
    world.overlayRoot.visible = false;
    world.sceneryRoot.visible = false;
    world.environment.setShowcaseVisible(false);
    world.environment.setLook(DESERT_LOOK);
    world.renderer.toneMappingExposure = DESERT_LOOK.exposure;
    world.scene.add(this.root);
    this.root.visible = true;
    this.previousEnvironment = world.scene.environment;
    world.cameraController.setLimits({ minDistance: 2, maxDistance: 420, halfSize: 160 });
    // Low stops look up at the tower, so the camera may go below its target.
    world.cameraController.setPolarLimits(0.05, Math.PI * 0.62);
    world.cameraController.setAutoRotate(false);
    world.cameraController.setEnabled(true);
    this.loadEnvironment();
    this.loadTextures();
    this.frameLibrary();
    this.emit();
  }

  /** Leave the mode: everything back exactly as it was. */
  private leave(): void {
    if (!this.active) return;
    this.active = false;
    this.loadToken++;
    this.modelToken++;
    this.modelLoading = false;
    this.modelOrigin = null;
    this.disposeModel();
    this.landmark = null;
    const world = this.world;
    this.root.visible = false;
    this.root.removeFromParent();
    world.placementRoot.visible = true;
    world.overlayRoot.visible = true;
    world.sceneryRoot.visible = true;
    world.environment.setShowcaseVisible(true);
    world.environment.setLook(world.environment.siteLook);
    world.scene.environment = this.previousEnvironment;
    this.previousEnvironment = null;
    this.envTexture?.dispose();
    this.envTexture = null;
    this.envStatus = 'loading';
    Object.values(this.textures).forEach((texture) => texture?.dispose());
    this.textures = {};
    world.cameraController.setPolarLimits(null, null);
    // The image shift belongs to RealWorld only: My World and Challenge Mode get the camera back unshifted.
    this.insets = { left: 0, top: 0, right: 0, bottom: 0 };
    this.viewShift.x = 0;
    this.viewShift.y = 0;
    this.applyViewShift();
    if (this.snapshot) world.cameraController.restore(this.snapshot, { animate: false });
    this.snapshot = null;
    this.emit();
  }

  private showLandmark(landmarkId: string | null): void {
    this.disposeModel();
    this.resetLandmarkState();
    const token = ++this.modelToken;
    this.modelLoading = false;
    this.modelOrigin = null;
    const landmark = landmarkId ? landmarkById(landmarkId) ?? null : null;
    this.landmark = landmark && landmark.status === 'available' ? landmark : null;
    if (!this.landmark) {
      this.frameLibrary();
      this.emit();
      return;
    }
    if (this.landmark.model?.kind === 'glb') {
      // A downloaded model is fetched only now, when the child opens the landmark.
      this.modelLoading = true;
      this.frameOverview(1.6);
      this.emit();
      void prepareLandmarkModel(this.landmark, { quality: 'high', textures: this.textures }, (url) => this.loadModelFile(url), document.baseURI)
        .then((prepared) => this.modelReady(prepared, token))
        .catch((error) => this.modelReady({ model: null, origin: null, error }, token));
      return;
    }
    try {
      this.model = buildLandmarkModel(this.landmark, { quality: 'high', textures: this.textures });
    } catch (error) {
      console.warn('[realworld] model could not be built', error);
      this.model = null;
    }
    this.modelOrigin = this.model ? 'procedural' : null;
    this.model?.setReducedMotion?.(motion.reduced);
    if (this.model) {
      this.root.add(this.model.root);
      this.model.setView('complete');
      this.frameOverview(1.6);
    }
    this.emit();
  }

  /** A loaded (or fallback) model arrives; dropped if the child has moved on meanwhile. */
  private modelReady(prepared: PreparedModel, token: number): void {
    if (token !== this.modelToken || !this.active || !this.landmark) {
      prepared.model?.dispose();
      return;
    }
    this.modelLoading = false;
    if (prepared.error) console.warn('[realworld] the downloaded model was not used; showing the built-in model instead', prepared.error);
    this.model = prepared.model;
    this.model?.setReducedMotion?.(motion.reduced);
    this.modelOrigin = prepared.model ? prepared.origin : null;
    if (this.model) {
      this.root.add(this.model.root);
      this.model.setView(this.view);
      this.frameOverview(1.2);
    }
    this.emit();
  }

  /** The downloaded model file (fetched only when its landmark is opened; the loader itself is already part of the app). */
  private async loadModelFile(url: string): Promise<THREE.Object3D> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return gltf.scene;
  }

  private resetLandmarkState(): void {
    this.view = 'complete';
    this.stopId = null;
    this.construction = 1;
    this.timelineIndex = null;
    this.selectedPart = null;
    this.highlight = null;
    this.loadPath = false;
    this.wind = null;
    this.forces = null;
    this.loadPoint = null;
    this.cable = 'normal';
    this.sequenceStep.clear();
  }

  private disposeModel(): void {
    if (!this.model) return;
    this.model.root.removeFromParent();
    this.model.dispose();
    this.model = null;
  }

  /** The downloaded clear sky lights the landmark's glass and steel; the built-in sky stays if it fails. */
  private loadEnvironment(): void {
    const token = this.loadToken;
    this.envStatus = 'loading';
    new HDRLoader().load(
      new URL(ASSETS.hdri, document.baseURI).href,
      (texture) => {
        if (token !== this.loadToken || !this.active) {
          texture.dispose();
          return;
        }
        texture.mapping = THREE.EquirectangularReflectionMapping;
        const pmrem = new THREE.PMREMGenerator(this.world.renderer);
        const env = pmrem.fromEquirectangular(texture).texture;
        pmrem.dispose();
        texture.dispose();
        this.envTexture = env;
        this.world.scene.environment = env;
        this.envStatus = 'hdri';
        this.emit();
      },
      undefined,
      (error) => {
        console.warn('[realworld] sky could not be loaded; using the built-in sky', error);
        if (token === this.loadToken) this.envStatus = 'fallback';
        this.emit();
      },
    );
  }

  /** Sand and concrete photos for the ground and the foundation; plain colours if they fail. */
  private loadTextures(): void {
    const token = this.loadToken;
    const loader = new THREE.TextureLoader();
    const load = (key: 'ground' | 'concrete', path: string, repeat: number) => {
      loader.load(
        new URL(path, document.baseURI).href,
        (texture) => {
          if (token !== this.loadToken || !this.active) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(repeat, repeat);
          texture.anisotropy = Math.min(8, this.world.renderer.capabilities.getMaxAnisotropy());
          this.textures[key] = texture;
          // A model already on show takes the photos (or is rebuilt once with them - cheap, and only when they arrive).
          if (this.model?.applyTextures) this.model.applyTextures(this.textures);
          else if (this.landmark && this.model) this.showLandmarkKeepingView();
        },
        undefined,
        () => console.warn(`[realworld] ${key} texture could not be loaded; using a plain colour`),
      );
    };
    load('ground', ASSETS.sand, 60);
    load('concrete', ASSETS.concrete, 2);
  }

  private showLandmarkKeepingView(): void {
    const keep = { view: this.view, stopId: this.stopId, construction: this.construction, timelineIndex: this.timelineIndex, highlight: this.highlight, loadPath: this.loadPath, wind: this.wind, selected: this.selectedPart, forces: this.forces, loadPoint: this.loadPoint, cable: this.cable };
    const landmark = this.landmark;
    if (!landmark) return;
    this.disposeModel();
    try {
      this.model = buildLandmarkModel(landmark, { quality: 'high', textures: this.textures });
    } catch {
      this.model = null;
    }
    if (!this.model) return;
    this.model.setReducedMotion?.(motion.reduced);
    this.root.add(this.model.root);
    this.view = keep.view;
    this.model.setView(keep.view);
    this.construction = keep.construction;
    this.model.setConstructionProgress(keep.construction);
    this.stopId = keep.stopId;
    this.timelineIndex = keep.timelineIndex;
    this.highlight = keep.highlight;
    this.model.setHighlight(keep.highlight);
    this.loadPath = keep.loadPath;
    this.model.setLoadPath(keep.loadPath);
    this.wind = keep.wind;
    this.model.setWind(keep.wind);
    this.forces = keep.forces;
    this.model.setForces?.(keep.forces);
    this.loadPoint = keep.loadPoint;
    this.cable = keep.cable;
    this.model.setLoadPoint?.(keep.loadPoint, keep.cable);
    this.selectedPart = keep.selected;
    this.emit();
  }

  private frameLibrary(): void {
    // The library floats over a calm, wide view of the empty desert under the sky.
    this.world.cameraController.transitionTo({ x: 0, y: 6, z: 0 }, { distance: 120, azimuth: 30, elevation: 12 }, 1.2);
  }

  private frameOverview(duration: number): void {
    // A long, low landmark (the bridge) brings its own framing; towers are framed by their height.
    const overview = this.model?.overview;
    if (overview) {
      this.world.cameraController.transitionTo({ x: 0, y: overview.targetY, z: 0 }, { distance: this.overviewDistance(overview), azimuth: overview.azimuth, elevation: overview.elevation }, duration);
      return;
    }
    const top = this.model?.topY ?? (this.landmark?.heightM ? this.landmark.heightM * SCENE_SCALE : 0);
    if (!(top > 0)) return;
    this.world.cameraController.transitionTo({ x: 0, y: top * 0.42, z: 0 }, { distance: top * 1.55 + 20, azimuth: 35, elevation: 14 }, duration);
  }

  /**
   * How far back a long landmark's overview stands so its length fits the
   * part of the screen the panels leave free. Before the panels have
   * reported (the landmark is just opening), a wide screen assumes its two
   * side columns take about half the width.
   */
  private overviewDistance(overview: NonNullable<LandmarkModel['overview']>): number {
    if (!overview.halfLength) return overview.distance;
    const camera = this.world.camera;
    const covered = this.insets.left + this.insets.right;
    const free = covered > 0 ? 1 - covered : camera.aspect > 1.2 ? 0.5 : 1;
    const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect * Math.max(0.3, free));
    const azimuth = THREE.MathUtils.degToRad(overview.azimuth);
    // The nearer end sits closer to the camera, so it reaches further out to the side.
    const across = overview.halfLength * Math.abs(Math.cos(azimuth));
    const nearer = overview.halfLength * Math.abs(Math.sin(azimuth)) * Math.cos(THREE.MathUtils.degToRad(overview.elevation));
    const fit = nearer + across / Math.tan(halfFov * 0.85);
    return Math.min(OVERVIEW_MAX_DISTANCE, Math.max(overview.distance, fit));
  }

  /**
   * The construction view follows the work: the foundation pit while the
   * site is prepared and the foundation laid, then the structure as built so
   * far (so a 100 m tower is not a speck in a frame made for 828 m).
   */
  private frameConstruction(duration: number): void {
    const landmark = this.landmark;
    if (!this.model || !landmark) return;
    // A bridge is built along its length (piers, towers, cables, deck): the whole of it stays in view.
    if (this.model.overview) {
      this.frameOverview(duration);
      return;
    }
    if (this.construction < CONSTRUCTION_PROGRESS.foundationDone) {
      const foundation = landmark.stops.find((s) => s.kind === 'foundation');
      if (foundation) {
        this.frameStop(foundation, duration);
        return;
      }
    }
    const totalM = landmark.heightM ?? this.model.topY / SCENE_SCALE;
    // At least 60 m in view, so the first floors are not lost in the frame.
    const shownM = Math.max(60, builtHeightForProgress(this.construction, totalM));
    const top = shownM * SCENE_SCALE;
    this.world.cameraController.transitionTo({ x: 0, y: top * 0.42, z: 0 }, { distance: top * 1.55 + 20, azimuth: 35, elevation: 14 }, duration);
  }

  private frameStop(stop: Stop, duration: number): void {
    if (!this.model) return;
    const y = this.model.heightToY(stop.heightM);
    const x = (stop.focusM?.x ?? 0) * SCENE_SCALE;
    const z = (stop.focusM?.z ?? 0) * SCENE_SCALE;
    this.world.cameraController.transitionTo({ x, y, z }, { distance: stop.camera.distance, azimuth: stop.camera.azimuth, elevation: stop.camera.elevation }, duration);
  }

  /** A tap on the landmark picks a structural part (and may complete a mission). */
  private onClick(click: PointerClick): void {
    if (!this.active || !this.model || this.store.getState().mode !== 'realworld') return;
    let partId = this.partAt(click.ndcX, click.ndcY);
    if (partId === null) {
      // Thin parts (piles, the spire) are easy to miss: try a few points around the tap.
      const canvas = this.world.renderer.domElement;
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      for (const radius of TAP_TOLERANCE_PX) {
        partId = mostFrequentPart(ringOffsets(radius).map(({ dx, dy }) => this.partAt(click.ndcX + (2 * dx) / width, click.ndcY - (2 * dy) / height)));
        if (partId !== null) break;
      }
    }
    this.selectPart(partId);
    if (partId) this.advanceMissions(partId);
  }

  /** The part under a point of the screen (see realworld/picking for what a tap reaches). */
  private partAt(ndcX: number, ndcY: number): string | null {
    const model = this.model;
    if (!model) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.world.camera);
    const hits = this.raycaster.intersectObject(model.root, true).filter((h) => this.isShown(h.object));
    return partFromHits(model, hits);
  }

  /** Hidden ancestors (a part switched off for the current view or stage) never catch taps. */
  private isShown(object: THREE.Object3D): boolean {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
    return true;
  }

  private advanceMissions(partId: string): void {
    const landmark = this.landmark;
    if (!landmark) return;
    const progress = this.progress.get(landmark.id);
    for (const mission of landmark.missions) {
      if (progress.missions.includes(mission.id)) continue;
      if (mission.kind === 'find-part' && mission.partIds?.includes(partId)) this.finishMission(mission);
      if (mission.kind === 'tap-sequence' && mission.sequence) {
        const step = this.sequenceStep.get(mission.id) ?? 0;
        if (mission.sequence[step]?.includes(partId)) {
          const next = step + 1;
          if (next >= mission.sequence.length) {
            this.sequenceStep.delete(mission.id);
            this.finishMission(mission);
          } else {
            this.sequenceStep.set(mission.id, next);
            this.emit();
          }
        }
      }
    }
  }

  /** How far a tap-sequence mission has got (steps done). */
  sequenceProgress(missionId: string): number {
    return this.sequenceStep.get(missionId) ?? 0;
  }

  private completeMissions(match: (mission: Mission) => boolean): void {
    const landmark = this.landmark;
    if (!landmark) return;
    for (const mission of landmark.missions) if (match(mission)) this.finishMission(mission);
  }

  private finishMission(mission: Mission): void {
    const landmark = this.landmark;
    if (!landmark) return;
    if (this.progress.completeMission(landmark.id, mission.id)) {
      this.missionListeners.forEach((listener) => listener({ mission }));
    }
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

/** For tests and the screen: real metres to scene units. */
export function metresToScene(metres: number): number {
  return metres * SCENE_SCALE;
}
