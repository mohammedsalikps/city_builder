import { GameStore } from '@/state/GameStore';
import { createInitialState } from '@/state/initialState';
import { GameActions } from '@/state/actions';
import { ObjectRegistry } from '@/construction/ObjectRegistry';
import { ConstructionController } from '@/construction/ConstructionController';
import type { BuildArea } from '@/construction/BuildArea';
import { ChallengeRegistry } from '@/challenges/ChallengeRegistry';
import { BlueprintRenderer } from '@/challenges/BlueprintRenderer';
import { ChallengePlacementTargets } from '@/challenges/PlacementTargets';
import { ChallengeSystem } from '@/challenges/ChallengeSystem';
import { objectDefinitions, challengeDefinitions, worldDefinitions, assetDefinitions, sceneryDefinition } from '@/data';
import { AssetRegistry } from '@/visual/assets/AssetRegistry';
import { AssetLibrary } from '@/visual/assets/AssetLibrary';
import { Scenery } from '@/visual/scenery/Scenery';
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

/** Where the menu camera looks: the street and houses beyond the building sites. */
const MENU_FOCUS = { x: 0, y: 2, z: -22 };
const MENU_VIEW = { distance: 62, azimuth: 28, elevation: 17 };

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
  readonly challengeSystem: ChallengeSystem;
  readonly progression: ProgressionService;
  readonly world: World;
  readonly input: InputManager;
  readonly construction: ConstructionController;
  readonly ui: UIManager;
  readonly loop: GameLoop;
  readonly interior: InteriorReadability;
  readonly assetRegistry: AssetRegistry;
  readonly assets: AssetLibrary;
  readonly scenery: Scenery;

  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeKeys: (() => void) | null = null;

  constructor(elements: GameElements) {
    this.registry = new ObjectRegistry();
    this.registry.registerAll(objectDefinitions);
    this.challenges = new ChallengeRegistry(this.registry);
    this.challenges.registerWorlds(worldDefinitions);
    this.challenges.registerAll(challengeDefinitions);
    this.assetRegistry = new AssetRegistry(assetDefinitions);
    this.assetRegistry.checkReferences(objectDefinitions);

    this.world = new World({ canvas: elements.canvas, environment: sceneryDefinition.environment });
    this.assets = new AssetLibrary(this.assetRegistry, this.world.materials);
    this.scenery = new Scenery(sceneryDefinition, this.assets, (x, z) => this.world.environment.terrain.heightAt(x, z));
    this.world.sceneryRoot.add(this.scenery.root);

    const storage = new LocalProgressStorage();
    this.store = new GameStore(createInitialState(storage.load() ?? undefined));
    const placementTargets = new ChallengePlacementTargets(this.store, this.challenges);
    const placementRules = {
      getBuildArea: () => this.currentBuildArea(),
      getPlacementTargets: (definitionId: string) => placementTargets.get(definitionId),
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
    this.ui = new UIManager(elements.uiRoot, this.store, {
      actions: this.actions,
      registry: this.registry,
      challenges: this.challenges,
    });

    this.loop = new GameLoop((delta) => this.frame(delta));
  }

  start(): void {
    this.ui.start();
    this.construction.start();
    this.challengeSystem.start();
    this.progression.start();
    this.unsubscribeStore = this.store.subscribe((state, previous) => {
      if (state.mode !== previous.mode) this.onModeChanged(state.mode);
      // The helper grid belongs to free building (My World); levels show their site pad.
      this.world.setGridVisible(state.mode === 'playing' && state.challenge === null);
    });
    this.onModeChanged(this.store.getState().mode);
    this.world.setGridVisible(false);
    this.unsubscribeKeys = this.input.keyboard.on('keydown', (key) => {
      if (this.store.getState().mode !== 'playing') return;
      const preset = CAMERA_KEYS[key.code];
      if (preset) this.world.cameraController.setPreset(preset);
    });
    void this.scenery.build().catch((error) => console.warn('[scenery] could not be built', error));
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
    return { center: { x: 0, y: 0, z: 0 }, halfSize: this.world.groundSize / 2 };
  }

  dispose(): void {
    this.loop.stop();
    this.unsubscribeStore?.();
    this.unsubscribeKeys?.();
    this.assets.dispose();
    this.ui.dispose();
    this.progression.dispose();
    this.challengeSystem.dispose();
    this.construction.dispose();
    this.input.dispose();
    this.world.dispose();
  }

  private frame(delta: number): void {
    this.world.update(delta);
    this.assets.update(delta);
    // Readability first: the preview resolved next uses this frame's
    // occluders, the same ones the frame is rendered with.
    this.interior.update();
    this.construction.update();
    this.world.render();
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

  private onModeChanged(mode: string): void {
    // The camera is only controllable while actually playing.
    this.world.cameraController.setEnabled(mode === 'playing');
    // Menus show the neighbourhood from a slowly orbiting vantage point.
    const showcase = mode === 'menu' || mode === 'world-map';
    this.world.cameraController.setAutoRotate(showcase);
    if (showcase) this.world.cameraController.transitionTo(MENU_FOCUS, MENU_VIEW, 1.6);
  }
}
