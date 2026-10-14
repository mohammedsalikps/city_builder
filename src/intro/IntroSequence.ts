import * as THREE from 'three';
import type { AssetLibrary } from '@/visual/assets/AssetLibrary';
import { loadLogoTexture, type LogoTexture } from './logoTexture';
import { IntroParticles } from './IntroParticles';
import { clamp01, easeInOutCubic, easeOutCubic, easeOutQuad, phaseT } from './easing';

/**
 * "Building -> structure -> Eavara": a dedicated, lightweight three.js scene
 * (its own Scene + Camera, rendered via the game's existing renderer/canvas -
 * see Game.frame()) that plays once between boot and the Home screen.
 *
 * A small architectural model (floor, three walls, a doorway, a simple roof
 * frame - the same building-kit pieces Challenge Mode itself builds with)
 * assembles, glows briefly, then dissolves into particles that converge into
 * the official Eavara wordmark. Deliberately restrained: this replaced an
 * earlier version built from construction-site props (cones, barriers,
 * crates), which read as clutter rather than a brand moment - see the
 * "intro-brand-restraint" note. Timeline is driven entirely by elapsed
 * seconds (see PHASES) - no tween library, no per-frame allocation once
 * `load()` has resolved.
 */

const PHASES = {
  quiet: { start: 0, duration: 0.7 },
  foundation: { start: 0.7, duration: 1.1 }, // ends 1.8
  energy: { start: 1.8, duration: 0.9 }, // ends 2.7
  transform: { start: 2.7, duration: 0.9 }, // ends 3.6
  wordmark: { start: 3.6, duration: 0.7 }, // ends 4.3
  tagline: { start: 4.3, duration: 0.4 }, // ends 4.7
  transition: { start: 4.7, duration: 0.5 }, // ends 5.2
};
const TOTAL_DURATION = PHASES.transition.start + PHASES.transition.duration;

/** Overall size of the little architectural model, relative to the building-kit's own (gameplay-scale) pieces. */
const MODEL_SCALE = 0.3;
/** Multiplies the building-kit's own (fairly cold/grey) baked texture colour toward a warm architectural neutral. */
const WARM_TINT = 0xe4c99a;

interface PieceConfig {
  /** A real building-kit asset, or 'roof-beam' for the one procedural piece. */
  assetId: string | 'roof-beam';
  position: THREE.Vector3;
  rotationY: number;
  /** Seconds into the foundation phase this piece begins rising into place. */
  delay: number;
  duration: number;
}

/**
 * Positions here are in the building-kit's own natural units (a wall/floor
 * is 2 units wide, so HALF = 1 unit to each side) - NOT pre-multiplied by
 * MODEL_SCALE. `load()` applies MODEL_SCALE to both each piece's own scale
 * and its position together, so the model's proportions stay correct
 * however MODEL_SCALE itself is tuned.
 */
const HALF = 1;
const WALL_HEIGHT = 2.4;
/** How far above the wall tops the roof's ridge peaks. */
const ROOF_RISE = 0.65;
const ROOF_ANGLE = Math.atan2(ROOF_RISE, HALF);
const ROOF_LENGTH = Math.hypot(HALF, ROOF_RISE);

const STRUCTURE: PieceConfig[] = [
  { assetId: 'kenney_bk_floor', position: new THREE.Vector3(0, 0, 0), rotationY: 0, delay: 0, duration: 0.45 },
  { assetId: 'kenney_bk_wall', position: new THREE.Vector3(0, 0, -HALF), rotationY: 0, delay: 0.25, duration: 0.55 },
  { assetId: 'kenney_bk_wall', position: new THREE.Vector3(-HALF, 0, 0), rotationY: Math.PI / 2, delay: 0.4, duration: 0.55 },
  { assetId: 'kenney_bk_wall', position: new THREE.Vector3(HALF, 0, 0), rotationY: -Math.PI / 2, delay: 0.4, duration: 0.55 },
  { assetId: 'kenney_bk_door', position: new THREE.Vector3(0, 0, -HALF * 0.82), rotationY: 0, delay: 0.65, duration: 0.4 },
  {
    assetId: 'roof-beam',
    position: new THREE.Vector3(-HALF * 0.5, WALL_HEIGHT + ROOF_RISE * 0.5, 0),
    rotationY: 0,
    delay: 0.85,
    duration: 0.4,
  },
  {
    assetId: 'roof-beam',
    position: new THREE.Vector3(HALF * 0.5, WALL_HEIGHT + ROOF_RISE * 0.5, 0),
    rotationY: 0,
    delay: 0.85,
    duration: 0.4,
  },
];

interface PieceInstance extends PieceConfig {
  object: THREE.Object3D;
  materials: THREE.MeshStandardMaterial[];
  restY: number;
}

export interface IntroReadyContext {
  /** Kept in sync with the main camera's aspect by World's own resize handling. */
  getAspect: () => number;
}

const GOLD = 0xf4c06b;
const STRUCTURE_NEUTRAL = 0xe7ddc9;

export class IntroSequence {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly stage = new THREE.Group();
  private readonly pieces: PieceInstance[] = [];
  private readonly ambientLight: THREE.AmbientLight;
  private readonly fillLight: THREE.HemisphereLight;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly fillBack: THREE.DirectionalLight;
  private readonly ground: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>;
  private readonly glow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly glowTexture: THREE.CanvasTexture;
  private readonly skyTexture: THREE.CanvasTexture;
  private logo: LogoTexture | null = null;
  private logoMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private particles: IntroParticles | null = null;

  private elapsed = 0;
  private ready = false;
  private completeCalled = false;
  private finished = false;
  private onComplete: (() => void) | null = null;
  private chimePlayed = false;
  private confirmPlayed = false;
  private settledClick = false;

  constructor(private readonly assets: AssetLibrary, private readonly ctx: IntroReadyContext) {
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
    this.camera.position.set(0, 1.1, 4.4);
    this.camera.lookAt(0, 0.42, 0);

    this.skyTexture = createSkyTexture();
    this.scene.background = this.skyTexture;
    this.scene.fog = new THREE.Fog(0xf3ead9, 5, 10);

    this.ambientLight = new THREE.AmbientLight(0xfff4e2, 0.05);
    this.scene.add(this.ambientLight);
    this.fillLight = new THREE.HemisphereLight(0xfff6e6, 0xcdb083, 0);
    this.scene.add(this.fillLight);
    this.sunLight = new THREE.DirectionalLight(0xffe9c4, 0);
    this.sunLight.position.set(-1.4, 3, 2.6);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(512, 512);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 7;
    this.sunLight.shadow.camera.left = -1.6;
    this.sunLight.shadow.camera.right = 1.6;
    this.sunLight.shadow.camera.top = 1.6;
    this.sunLight.shadow.camera.bottom = -1.6;
    this.sunLight.shadow.bias = -0.003;
    this.scene.add(this.sunLight);
    // Soft fill from the opposite side, so the un-lit side of the little
    // model never goes dark/moody - this should read as bright and premium.
    this.fillBack = new THREE.DirectionalLight(0xfff2df, 0);
    this.fillBack.position.set(1.6, 1.6, -1.2);
    this.scene.add(this.fillBack);

    this.scene.add(this.stage);

    this.ground = this.createGround();
    this.stage.add(this.ground);

    this.glowTexture = createGlowTexture();
    const glowGeometry = new THREE.PlaneGeometry(0.65, 0.65);
    glowGeometry.rotateX(-Math.PI / 2);
    const glowMaterial = new THREE.MeshBasicMaterial({
      map: this.glowTexture,
      color: GOLD,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    this.glow = new THREE.Mesh(glowGeometry, glowMaterial);
    this.glow.position.y = 0.02;
    this.glow.raycast = () => {};
    this.stage.add(this.glow);
  }

  /** Loads the building-kit pieces + the logo texture. Cheap and fast; safe to render before this resolves. */
  async load(): Promise<void> {
    const realAssetIds = STRUCTURE.filter((p) => p.assetId !== 'roof-beam').map((p) => p.assetId);
    await this.assets.preload(realAssetIds);

    for (const config of STRUCTURE) {
      const object =
        config.assetId === 'roof-beam' ? createRoofBeam(config.position.x > 0) : this.assets.instantiate(config.assetId);
      object.scale.setScalar(MODEL_SCALE);
      object.position.copy(config.position).multiplyScalar(MODEL_SCALE);
      object.rotation.y = config.rotationY;
      // AssetLibrary shares materials across every instance of an asset (see
      // MaterialLibrary.forAsset); cloning here is required so this model's
      // fade/glow can never bleed into the same asset placed elsewhere in
      // the game (Challenge Mode walls, My World houses...).
      // The building-kit's own baked texture reads as cold construction-site
      // grey; multiplying its colour warms it toward the brand's neutral
      // palette without losing the texture's surface detail. The door's own
      // warm wood tone and the roof beams' already-neutral colour are left alone.
      const warm = config.assetId === 'kenney_bk_wall' || config.assetId === 'kenney_bk_floor';
      const materials: THREE.MeshStandardMaterial[] = [];
      object.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const clone = (mesh.material as THREE.MeshStandardMaterial).clone();
        clone.transparent = true;
        clone.emissive = new THREE.Color(0x000000);
        if (warm) clone.color.multiply(new THREE.Color(WARM_TINT));
        mesh.material = clone;
        materials.push(clone);
      });
      const restY = object.position.y;
      object.position.y = restY - 0.5;
      this.stage.add(object);
      this.pieces.push({ ...config, object, materials, restY });
    }

    this.logo = await loadLogoTexture('/assets/branding/eavara-logo.jpg');
    // Sized to stay clear of both edges even on the narrowest required
    // portrait viewport (390px wide) - see the horizontal-FOV margin check
    // done during visual tuning, not just a guess.
    const height = 0.44;
    const width = height * this.logo.aspect;
    const logoMaterial = new THREE.MeshBasicMaterial({
      map: this.logo.texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    this.logoMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), logoMaterial);
    this.logoMesh.position.set(0, 0.56, 0.05);
    this.logoMesh.raycast = () => {};
    this.stage.add(this.logoMesh);

    // A restrained handful of "architectural dust" - not a firework burst.
    const spawns = this.logo.samplePoints(42).map((point) => {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.25 + Math.random() * 0.35;
      return {
        start: new THREE.Vector3(Math.cos(angle) * radius, 0.4 + Math.random() * 0.5, Math.sin(angle) * radius + 0.1),
        target: { x: point.x * width, y: this.logoMesh!.position.y + point.y * height },
        delay: Math.random() * (PHASES.transform.duration * 0.5),
      };
    });
    this.particles = new IntroParticles(spawns, { duration: 0.45, colorStart: GOLD, colorEnd: 0x2f6b45 });
    this.particles.object3D.position.z = this.logoMesh.position.z - 0.05;
    this.stage.add(this.particles.object3D);

    this.ready = true;
  }

  /** Begins the timeline. `onComplete` fires once (at the start of the dissolve into Home), not when fully finished. */
  start(onComplete: () => void): void {
    this.onComplete = onComplete;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /** True once the dissolve into Home has begun - Game should render both scenes (see Game.frame()). */
  get blending(): boolean {
    return this.elapsed >= PHASES.transition.start;
  }

  get taglineOpacity(): number {
    const inT = phaseT(this.elapsed, PHASES.tagline.start, PHASES.tagline.duration);
    const outT = phaseT(this.elapsed, PHASES.transition.start, PHASES.transition.duration * 0.6);
    return easeOutCubic(inT) * (1 - outT);
  }

  update(deltaSeconds: number): void {
    if (!this.ready || this.finished) return;
    this.elapsed += deltaSeconds;
    this.camera.aspect = this.ctx.getAspect();
    this.camera.updateProjectionMatrix();

    this.updateCamera();
    this.updateLights();
    this.updatePieces();
    this.updateEnergy();
    this.updateGlow();
    this.updateParticles();
    this.updateLogo();
    this.updateTransition();
  }

  private updateCamera(): void {
    // Slow push in while the model builds and comes alive, a brief hold
    // while it transforms, then a small settling pull-back for the reveal.
    const pushInEnd = PHASES.energy.start + PHASES.energy.duration;
    const pushIn = easeInOutCubic(clamp01(this.elapsed / pushInEnd));
    const pullBack = easeOutCubic(phaseT(this.elapsed, PHASES.wordmark.start, PHASES.wordmark.duration));
    const z = THREE.MathUtils.lerp(4.4, 3.8, Math.min(pushIn, 1)) + pullBack * 0.25;
    this.camera.position.z = z;
  }

  private updateLights(): void {
    const fadeIn = easeOutCubic(phaseT(this.elapsed, 0, PHASES.quiet.duration + 0.3));
    this.ambientLight.intensity = 0.05 + fadeIn * 0.25;
    this.fillLight.intensity = fadeIn * 0.55;
    this.sunLight.intensity = fadeIn * 1.4;
    this.fillBack.intensity = fadeIn * 0.4;
  }

  private updatePieces(): void {
    const fadeOut = 1 - easeOutCubic(phaseT(this.elapsed, PHASES.transform.start, PHASES.transform.duration * 0.75));
    for (const piece of this.pieces) {
      const t = easeOutQuad(phaseT(this.elapsed, PHASES.foundation.start + piece.delay, piece.duration));
      piece.object.position.y = THREE.MathUtils.lerp(piece.restY - 0.5, piece.restY, t);
      for (const material of piece.materials) material.opacity = Math.min(t, fadeOut);
      if (!this.settledClick && t >= 1 && piece === this.pieces[this.pieces.length - 1]) {
        this.settledClick = true;
        window.dispatchEvent(new CustomEvent('eavara:placed'));
      }
    }
    // The ground fades away with the structure - by the wordmark reveal, the
    // logo should be the only thing left in frame.
    const groundFadeIn = easeOutCubic(phaseT(this.elapsed, 0, PHASES.quiet.duration + 0.2));
    this.ground.material.opacity = groundFadeIn * fadeOut;
  }

  /** The "structure becomes special" beat: a soft golden emissive pulse through every piece. */
  private updateEnergy(): void {
    const t = phaseT(this.elapsed, PHASES.energy.start, PHASES.energy.duration);
    const pulse = Math.sin(Math.PI * clamp01(t)) * easeOutCubic(clamp01(t * 3));
    for (const piece of this.pieces) {
      for (const material of piece.materials) {
        material.emissive.setHex(GOLD);
        material.emissiveIntensity = pulse * 0.35;
      }
    }
  }

  private updateGlow(): void {
    // A brief pulse through "energy" and "transform" only - faded out well
    // before the wordmark reveal, which must stay the frame's only highlight.
    const rampIn = easeOutCubic(phaseT(this.elapsed, PHASES.energy.start, PHASES.transform.start - PHASES.energy.start));
    const rampOut = 1 - easeOutCubic(phaseT(this.elapsed, PHASES.wordmark.start - 0.2, 0.35));
    this.glow.material.opacity = 0.2 * rampIn * rampOut;
    this.glow.scale.setScalar(1 + rampIn * 0.25);
  }

  private updateParticles(): void {
    if (!this.particles) return;
    if (!this.chimePlayed && this.elapsed >= PHASES.transform.start) {
      this.chimePlayed = true;
      window.dispatchEvent(new CustomEvent('eavara:intro-chime'));
    }
    const local = this.elapsed - PHASES.transform.start;
    this.particles.setTime(Math.max(0, local));
    const fadeOut = 1 - easeOutCubic(phaseT(this.elapsed, PHASES.wordmark.start, PHASES.wordmark.duration * 0.6));
    this.particles.opacity = clamp01(fadeOut);
  }

  private updateLogo(): void {
    if (!this.logoMesh) return;
    if (!this.confirmPlayed && this.elapsed >= PHASES.wordmark.start) {
      this.confirmPlayed = true;
      window.dispatchEvent(new CustomEvent('eavara:intro-confirm'));
    }
    const material = this.logoMesh.material;
    const inT = easeOutCubic(phaseT(this.elapsed, PHASES.wordmark.start, PHASES.wordmark.duration));
    material.opacity = inT;
    const scale = THREE.MathUtils.lerp(0.94, 1, inT);
    this.logoMesh.scale.setScalar(scale);
  }

  private updateTransition(): void {
    if (this.elapsed >= PHASES.transition.start && !this.completeCalled) {
      this.completeCalled = true;
      this.onComplete?.();
    }
    if (this.elapsed >= TOTAL_DURATION) this.finished = true;
  }

  /** First tap: jump straight to the fully-formed logo. Second: jump into the dissolve. Third: snap done. */
  skip(): void {
    if (!this.ready) return;
    if (this.elapsed < PHASES.wordmark.start + PHASES.wordmark.duration) {
      this.elapsed = PHASES.wordmark.start + PHASES.wordmark.duration;
      for (const piece of this.pieces) for (const material of piece.materials) material.opacity = 0;
      if (this.particles) this.particles.opacity = 0;
    } else if (!this.completeCalled) {
      this.elapsed = PHASES.transition.start;
    } else {
      this.elapsed = TOTAL_DURATION;
    }
  }

  /** Renders the intro alone (before the dissolve begins). */
  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  /** Renders the intro ON TOP of whatever is already in the framebuffer, fading out - the "soft dissolve" into Home. */
  renderBlend(renderer: THREE.WebGLRenderer): void {
    const priorAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = priorAutoClear;
  }

  private createGround(): THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial> {
    const geometry = new THREE.CircleGeometry(0.55, 40);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({
      color: STRUCTURE_NEUTRAL,
      roughness: 0.95,
      metalness: 0,
      transparent: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.position.y = -0.001;
    return mesh;
  }

  dispose(): void {
    for (const piece of this.pieces) {
      if (piece.assetId !== 'roof-beam') this.assets.release(piece.object);
      for (const material of piece.materials) material.dispose();
    }
    this.particles?.dispose();
    this.glowTexture.dispose();
    (this.glow.material as THREE.Material).dispose();
    this.glow.geometry.dispose();
    this.skyTexture.dispose();
    this.ground.geometry.dispose();
    (this.ground.material as THREE.Material).dispose();
    if (this.logoMesh) {
      this.logoMesh.geometry.dispose();
      (this.logoMesh.material as THREE.Material).dispose();
    }
    this.logo?.texture.dispose();
  }
}

/** One side of a simple pitched roof frame - a thin beam, no texture needed. Mirrored so both sides meet at a centre apex. */
function createRoofBeam(mirror: boolean): THREE.Object3D {
  const geometry = new THREE.BoxGeometry(ROOF_LENGTH, 0.1, 0.14);
  const material = new THREE.MeshStandardMaterial({ color: STRUCTURE_NEUTRAL, roughness: 0.8, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.z = (mirror ? -1 : 1) * ROOF_ANGLE;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

/** A soft warm sky gradient, painted once - cheaper than a shader and good enough for a few seconds on screen. */
function createSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#fbeed9');
  gradient.addColorStop(0.55, '#f6e4cd');
  gradient.addColorStop(1, '#eddcc0');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A soft feathered circle for the centre glow - same technique as ConstructionEffects' pulse texture. */
function createGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.5);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.5, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
