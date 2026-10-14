import * as THREE from 'three';
import { motion } from '@/accessibility/motion';

/**
 * The construction celebration's presentation-only extras: a small pooled
 * burst of warm particles and a soft expanding ground ring. Neither ever
 * touches game state or `PlacedObject` - purely decoration, driven entirely
 * by `ConstructionRenderer.tick()`, and cheap enough to run continuously
 * (fixed-size pools, no per-effect allocation).
 *
 * Kept as its own small file so `ConstructionRenderer.ts` stays about
 * mirroring state into meshes; this is the one thing it delegates to.
 */

const PARTICLE_CAPACITY = 48;
const PARTICLE_LIFETIME = 0.5;
const PULSE_POOL_SIZE = 3;
const PULSE_LIFETIME = 0.55;

const PARTICLE_VERTEX_SHADER = `
  attribute float aAge;
  attribute float aMaxAge;
  attribute float aSize;
  attribute float aMix;
  varying float vLife;
  varying float vMix;
  void main() {
    vLife = 1.0 - clamp(aAge / aMaxAge, 0.0, 1.0);
    vMix = aMix;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aAge >= aMaxAge ? 0.0 : aSize * (0.4 + 0.6 * vLife) * (260.0 / max(-mv.z, 0.001));
    gl_Position = projectionMatrix * mv;
  }
`;

const PARTICLE_FRAGMENT_SHADER = `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying float vLife;
  varying float vMix;
  void main() {
    vec2 delta = gl_PointCoord - vec2(0.5);
    float dist = length(delta);
    if (dist > 0.5) discard;
    float edge = smoothstep(0.5, 0.1, dist);
    vec3 color = mix(uColorA, uColorB, vMix);
    gl_FragColor = vec4(color, edge * vLife * 0.5);
  }
`;

/** A soft, feathered circle - the ground ring's glow, painted once into a texture. */
function createPulseTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const gradient = ctx.createRadialGradient(cx, cy, size * 0.26, cx, cy, size * 0.5);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.72, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.5, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Pulse {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  age: number;
  maxAge: number;
  startScale: number;
  endScale: number;
  active: boolean;
}

export class ConstructionEffects {
  private readonly particlePoints: THREE.Points;
  private readonly particleGeometry: THREE.BufferGeometry;
  private readonly particleMaterial: THREE.ShaderMaterial;
  private readonly positions: Float32Array;
  private readonly ages: Float32Array;
  private readonly maxAges: Float32Array;
  private readonly sizes: Float32Array;
  private readonly mixes: Float32Array;
  private readonly velocities: THREE.Vector3[];
  private nextParticle = 0;

  private readonly pulseTexture: THREE.CanvasTexture;
  private readonly pulses: Pulse[] = [];
  private nextPulse = 0;

  constructor(private readonly root: THREE.Group) {
    this.positions = new Float32Array(PARTICLE_CAPACITY * 3);
    this.ages = new Float32Array(PARTICLE_CAPACITY).fill(PARTICLE_LIFETIME);
    this.maxAges = new Float32Array(PARTICLE_CAPACITY).fill(PARTICLE_LIFETIME);
    this.sizes = new Float32Array(PARTICLE_CAPACITY);
    this.mixes = new Float32Array(PARTICLE_CAPACITY);
    this.velocities = Array.from({ length: PARTICLE_CAPACITY }, () => new THREE.Vector3());

    this.particleGeometry = new THREE.BufferGeometry();
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.particleGeometry.setAttribute('aAge', new THREE.BufferAttribute(this.ages, 1));
    this.particleGeometry.setAttribute('aMaxAge', new THREE.BufferAttribute(this.maxAges, 1));
    this.particleGeometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.particleGeometry.setAttribute('aMix', new THREE.BufferAttribute(this.mixes, 1));
    this.particleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColorA: { value: new THREE.Color(0xfff1d8) },
        uColorB: { value: new THREE.Color(0xffb238) },
      },
      vertexShader: PARTICLE_VERTEX_SHADER,
      fragmentShader: PARTICLE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
    });
    this.particlePoints = new THREE.Points(this.particleGeometry, this.particleMaterial);
    this.particlePoints.name = 'construction-particles';
    this.particlePoints.frustumCulled = false;
    this.particlePoints.raycast = () => {};
    this.root.add(this.particlePoints);

    this.pulseTexture = createPulseTexture();
    for (let i = 0; i < PULSE_POOL_SIZE; i++) {
      const geometry = new THREE.PlaneGeometry(1, 1);
      geometry.rotateX(-Math.PI / 2);
      const material = new THREE.MeshBasicMaterial({
        map: this.pulseTexture,
        color: 0xffc23d,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'construction-pulse';
      mesh.visible = false;
      mesh.raycast = () => {};
      mesh.renderOrder = 3;
      this.root.add(mesh);
      this.pulses.push({ mesh, age: PULSE_LIFETIME, maxAge: PULSE_LIFETIME, startScale: 1, endScale: 1, active: false });
    }
  }

  /** A handful of warm particles rising and fading from `origin`. */
  burst(origin: THREE.Vector3, count: number, spread = 0.5): void {
    if (motion.reduced) return;
    for (let i = 0; i < count; i++) {
      const slot = this.nextParticle;
      this.nextParticle = (this.nextParticle + 1) % PARTICLE_CAPACITY;
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * spread;
      this.positions[slot * 3] = origin.x + Math.cos(angle) * radius;
      this.positions[slot * 3 + 1] = origin.y + 0.1 + Math.random() * 0.2;
      this.positions[slot * 3 + 2] = origin.z + Math.sin(angle) * radius;
      this.velocities[slot].set(Math.cos(angle) * 0.35, 0.9 + Math.random() * 0.6, Math.sin(angle) * 0.35);
      this.ages[slot] = 0;
      this.maxAges[slot] = PARTICLE_LIFETIME * (0.8 + Math.random() * 0.4);
      this.sizes[slot] = 6 + Math.random() * 5;
      this.mixes[slot] = Math.random();
    }
    this.particleGeometry.attributes.position.needsUpdate = true;
    this.particleGeometry.attributes.aMaxAge.needsUpdate = true;
    this.particleGeometry.attributes.aSize.needsUpdate = true;
    this.particleGeometry.attributes.aMix.needsUpdate = true;
  }

  /** A soft ring that expands and fades outward from `origin`. */
  pulse(origin: THREE.Vector3, radius: number): void {
    if (motion.reduced) return;
    const slot = this.pulses[this.nextPulse];
    this.nextPulse = (this.nextPulse + 1) % PULSE_POOL_SIZE;
    slot.mesh.position.set(origin.x, origin.y + 0.03, origin.z);
    slot.startScale = Math.max(0.4, radius * 0.45);
    slot.endScale = radius * 1.5;
    slot.age = 0;
    slot.maxAge = PULSE_LIFETIME;
    slot.active = true;
    slot.mesh.visible = true;
    slot.mesh.scale.setScalar(slot.startScale);
    slot.mesh.material.opacity = 0.38;
  }

  tick(deltaSeconds: number): void {
    let anyAlive = false;
    for (let i = 0; i < PARTICLE_CAPACITY; i++) {
      if (this.ages[i] >= this.maxAges[i]) continue;
      anyAlive = true;
      this.ages[i] += deltaSeconds;
      this.positions[i * 3] += this.velocities[i].x * deltaSeconds;
      this.positions[i * 3 + 1] += this.velocities[i].y * deltaSeconds;
      this.positions[i * 3 + 2] += this.velocities[i].z * deltaSeconds;
      this.velocities[i].y -= deltaSeconds * 0.6; // gentle settle of the rise, not real gravity
    }
    if (anyAlive) {
      this.particleGeometry.attributes.position.needsUpdate = true;
      this.particleGeometry.attributes.aAge.needsUpdate = true;
    }

    for (const p of this.pulses) {
      if (!p.active) continue;
      p.age += deltaSeconds;
      const t = Math.min(1, p.age / p.maxAge);
      if (t >= 1) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      const eased = 1 - (1 - t) * (1 - t);
      p.mesh.scale.setScalar(p.startScale + (p.endScale - p.startScale) * eased);
      p.mesh.material.opacity = 0.38 * (1 - t);
    }
  }

  dispose(): void {
    this.root.remove(this.particlePoints);
    this.particleGeometry.dispose();
    this.particleMaterial.dispose();
    for (const p of this.pulses) {
      this.root.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.pulseTexture.dispose();
  }
}
