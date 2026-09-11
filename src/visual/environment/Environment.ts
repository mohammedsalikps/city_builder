import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seededRandom } from '../noise';
import type { MaterialLibrary } from '../materials/MaterialLibrary';
import { Terrain, type TerrainConfig } from './Terrain';

export interface EnvironmentConfig {
  sun: { azimuth: number; elevation: number };
  terrain: TerrainConfig;
  water: Array<{ x: number; z: number; radius: number; level: number }>;
  clouds: { count: number; seed: number; minRadius: number; maxRadius: number; minHeight: number; maxHeight: number };
  fog: { color: string; near: number; far: number };
}

/** Half-size of the sun's shadow frustum around the camera target, metres. */
const SHADOW_EXTENT = 42;
const SHADOW_MAP_SIZE = 2048;
/** Brightness of the sky dome relative to the scene exposure. */
const SKY_EXPOSURE = 0.42;

/**
 * The world around the construction site: physically based sky, sunlight
 * with soft shadows that follow the camera, sky-derived environment lighting
 * for PBR reflections, atmospheric haze, terrain, water and clouds.
 * Presentation only; nothing here is raycast or part of game state.
 */
export class Environment {
  readonly root = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;
  readonly terrain: Terrain;
  readonly sky: Sky;
  private readonly sunDirection = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();
  private readonly texel = (SHADOW_EXTENT * 2) / SHADOW_MAP_SIZE;

  constructor(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    private readonly materials: MaterialLibrary,
    config: EnvironmentConfig,
  ) {
    this.root.name = 'environment';
    scene.add(this.root);

    const phi = THREE.MathUtils.degToRad(90 - config.sun.elevation);
    const theta = THREE.MathUtils.degToRad(config.sun.azimuth);
    this.sunDirection.setFromSphericalCoords(1, phi, theta);

    this.sky = this.createSky();
    this.root.add(this.sky);
    this.bakeEnvironment(scene, renderer);

    scene.fog = new THREE.Fog(new THREE.Color(config.fog.color), config.fog.near, config.fog.far);
    scene.background = null;

    this.hemisphere = new THREE.HemisphereLight(0xcfe3ff, 0x5f6b45, 0.22);
    this.root.add(this.hemisphere);

    this.sun = new THREE.DirectionalLight(0xfff0dc, 3.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    const cam = this.sun.shadow.camera;
    cam.left = -SHADOW_EXTENT;
    cam.right = SHADOW_EXTENT;
    cam.top = SHADOW_EXTENT;
    cam.bottom = -SHADOW_EXTENT;
    cam.near = 1;
    cam.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.root.add(this.sun);
    this.root.add(this.sun.target);

    this.terrain = new Terrain(config.terrain, materials);
    this.root.add(this.terrain.mesh);

    for (const lake of config.water) this.root.add(this.createWater(lake));
    this.root.add(this.createClouds(config.clouds));

    this.update(0, new THREE.Vector3());
  }

  /** Keep the sun's shadow box on the camera target and animate water. */
  update(deltaSeconds: number, target: THREE.Vector3): void {
    this.focus.set(
      Math.round(target.x / this.texel) * this.texel,
      0,
      Math.round(target.z / this.texel) * this.texel,
    );
    this.sun.position.copy(this.sunDirection).multiplyScalar(160).add(this.focus);
    this.sun.target.position.copy(this.focus);
    this.materials.update(deltaSeconds);
  }

  private createSky(): Sky {
    const sky = new Sky();
    sky.name = 'sky';
    sky.scale.setScalar(2500);
    const u = sky.material.uniforms;
    u.turbidity.value = 2.6;
    u.rayleigh.value = 1.05;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.84;
    u.sunPosition.value.copy(this.sunDirection);
    // A light layer of the shader's own procedural clouds.
    if (u.cloudCoverage) {
      u.cloudCoverage.value = 0.32;
      u.cloudDensity.value = 0.42;
      u.cloudElevation.value = 0.55;
    }
    // The sky model is calibrated for about half the scene's exposure; scale
    // only the sky so the scene can stay bright while the sky stays blue.
    sky.material.uniforms.skyExposure = { value: SKY_EXPOSURE };
    sky.material.fragmentShader = sky.material.fragmentShader
      .replace('uniform float time;', 'uniform float time;' + String.fromCharCode(10) + 'uniform float skyExposure;')
      .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * skyExposure, 1.0 );');
    sky.material.needsUpdate = true;
    return sky;
  }

  /** Pre-filter the sky once into an environment map for PBR reflections/ambient. */
  private bakeEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = this.createSky();
    envSky.scale.setScalar(50);
    envScene.add(envSky);
    const target = pmrem.fromScene(envScene, 0, 0.1, 200);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.3;
    envSky.geometry.dispose();
    envSky.material.dispose();
    pmrem.dispose();
  }

  private createWater(lake: { x: number; z: number; radius: number; level: number }): THREE.Mesh {
    const geometry = new THREE.CircleGeometry(lake.radius, 64);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, this.materials.water());
    mesh.name = 'water';
    mesh.position.set(lake.x, lake.level, lake.z);
    mesh.receiveShadow = true;
    return mesh;
  }

  /** A few soft 3D cloud clusters, merged into one mesh (one draw call). */
  private createClouds(config: EnvironmentConfig['clouds']): THREE.Mesh {
    const rand = seededRandom(config.seed);
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < config.count; i++) {
      const angle = rand() * Math.PI * 2;
      const radius = config.minRadius + rand() * (config.maxRadius - config.minRadius);
      const cx = Math.cos(angle) * radius;
      const cz = Math.sin(angle) * radius;
      const cy = config.minHeight + rand() * (config.maxHeight - config.minHeight);
      const puffs = 5 + Math.floor(rand() * 4);
      const width = 18 + rand() * 26;
      for (let p = 0; p < puffs; p++) {
        const r = 6 + rand() * 9;
        const g = new THREE.IcosahedronGeometry(r, 2);
        g.scale(1.4, 0.62, 1);
        g.translate(cx + (rand() - 0.5) * width, cy + rand() * 4, cz + (rand() - 0.5) * width * 0.5);
        parts.push(g);
      }
    }
    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      emissive: new THREE.Color('#aebfd0'),
      emissiveIntensity: 0.35,
    });
    const mesh = new THREE.Mesh(merged ?? new THREE.BufferGeometry(), material);
    mesh.name = 'clouds';
    return mesh;
  }
}
