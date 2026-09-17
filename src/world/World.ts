import * as THREE from 'three';
import { CameraController } from './CameraController';
import { MaterialLibrary } from '@/visual/materials/MaterialLibrary';
import { Environment, type EnvironmentConfig } from '@/visual/environment/Environment';
import { LocalGrid } from '@/visual/world/LocalGrid';

export interface WorldOptions {
  canvas: HTMLCanvasElement;
  /**
   * Side length of the invisible placement plane in metres. It only has to
   * cover every place anyone can build; the rules decide where that is.
   */
  groundSize?: number;
  /** Sky, sun, terrain, water and clouds around the site (data-driven). */
  environment: EnvironmentConfig;
}

/**
 * Owns the three.js scene: renderer, camera, environment and the root groups.
 *
 *   placementRoot  construction objects (raycast for placement and selection)
 *   overlayRoot    preview, blueprint ghosts, build-area pad (never raycast)
 *   sceneryRoot    the surrounding neighbourhood (never raycast)
 *   environment    sky, sun, haze, terrain, water, clouds (never raycast)
 *
 * The World knows nothing about game rules. The flat `ground` plane stays
 * the placement surface (invisible; the terrain draws the grass), so every
 * challenge coordinate means exactly what it did before.
 */
export class World {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly cameraController: CameraController;
  readonly materials: MaterialLibrary;
  readonly environment: Environment;

  /** All placed construction objects live under this group. */
  readonly placementRoot: THREE.Group;
  /** Temporary visuals (placement preview, ghosts). Never raycast for selection. */
  readonly overlayRoot: THREE.Group;
  /** Decorative neighbourhood around the site. Never raycast. */
  readonly sceneryRoot: THREE.Group;
  /** Decorative "under construction" vignette shown only behind the home menu. Never raycast. */
  readonly homeRoot: THREE.Group;
  /** Invisible placement plane at y = 0. */
  readonly ground: THREE.Mesh;
  /** Soft building guide around the pointer (My World placement only). */
  readonly grid: LocalGrid;

  readonly groundSize: number;

  private readonly canvas: HTMLCanvasElement;
  private readonly resizeObserver: ResizeObserver;
  private renderScale = 1;

  constructor(options: WorldOptions) {
    this.canvas = options.canvas;
    this.groundSize = options.groundSize ?? 600;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3000);
    this.camera.position.set(4, 3, 4);

    this.cameraController = new CameraController(this.camera, this.canvas);

    this.placementRoot = new THREE.Group();
    this.placementRoot.name = 'placementRoot';
    this.scene.add(this.placementRoot);

    this.overlayRoot = new THREE.Group();
    this.overlayRoot.name = 'overlayRoot';
    this.scene.add(this.overlayRoot);

    this.sceneryRoot = new THREE.Group();
    this.sceneryRoot.name = 'sceneryRoot';
    this.scene.add(this.sceneryRoot);

    this.homeRoot = new THREE.Group();
    this.homeRoot.name = 'homeRoot';
    this.homeRoot.visible = false;
    this.scene.add(this.homeRoot);

    this.materials = new MaterialLibrary(this.renderer);
    this.environment = new Environment(this.scene, this.renderer, this.materials, options.environment);

    this.ground = this.createGround();
    this.scene.add(this.ground);

    this.grid = new LocalGrid();
    this.scene.add(this.grid.mesh);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement ?? document.body);
    this.resize();
  }

  /** Advance per-frame systems: camera easing, sun/shadow follow, animated surfaces. */
  update(deltaSeconds: number): void {
    this.cameraController.update(deltaSeconds);
    const target = this.cameraController.target;
    this.environment.update(deltaSeconds, target, this.camera.position.distanceTo(target));
    this.grid.update(deltaSeconds);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Show the local building guide (it fades in and out). */
  /**
   * Render at a fraction of the display resolution (1 = full). Used to keep
   * large views smooth on modest GPUs; the UI is unaffected.
   */
  setRenderScale(scale: number): void {
    if (Math.abs(scale - this.renderScale) < 1e-3) return;
    this.renderScale = scale;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * scale);
    this.resize();
  }

  get currentRenderScale(): number {
    return this.renderScale;
  }

  setGridVisible(visible: boolean): void {
    this.grid.setWanted(visible);
  }

  addPlacedObject(object: THREE.Object3D): void {
    this.placementRoot.add(object);
  }

  removePlacedObject(object: THREE.Object3D): void {
    this.placementRoot.remove(object);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.cameraController.dispose();
    this.grid.dispose();
    this.materials.dispose();
    this.renderer.dispose();
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    const width = parent ? parent.clientWidth : window.innerWidth;
    const height = parent ? parent.clientHeight : window.innerHeight;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private createGround(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(this.groundSize, this.groundSize);
    // Invisible but raycastable: placement keeps using this exact plane.
    const material = new THREE.MeshBasicMaterial({ visible: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'ground';
    mesh.rotation.x = -Math.PI / 2;
    mesh.updateMatrixWorld(true);
    return mesh;
  }
}
