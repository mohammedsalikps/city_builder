import * as THREE from 'three';

/**
 * The "emblem formation" moment: a fixed pool of particles, each assigned a
 * scattered start point (near the construction props) and a target point
 * sampled from the logo's own silhouette (see logoTexture.ts), converging
 * together over one short window. Same pattern as
 * construction/ConstructionEffects.ts (a single THREE.Points + custom shader,
 * no per-particle allocation), adapted for one directed convergence instead
 * of a continuous burst pool.
 */

const VERTEX_SHADER = `
  attribute vec3 aStart;
  attribute vec3 aTarget;
  attribute float aDelay;
  attribute float aSize;
  uniform float uTime;
  uniform float uDuration;
  varying float vT;
  void main() {
    float local = clamp((uTime - aDelay) / uDuration, 0.0, 1.0);
    // Ease-out: fast start, gentle arrival - reads as converging, not snapping.
    float eased = 1.0 - pow(1.0 - local, 3.0);
    vec3 pos = mix(aStart, aTarget, eased);
    // A little arc and settle-in wobble so the convergence feels alive, not linear.
    pos.y += sin(eased * 3.14159265) * 0.14 * (1.0 - eased);
    vT = local;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    float fade = smoothstep(0.0, 0.12, local) * (1.0 - smoothstep(0.82, 1.0, local));
    gl_PointSize = aSize * (0.5 + fade * 0.5) * (10.0 / max(-mv.z, 0.001));
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT_SHADER = `
  uniform vec3 uColorStart;
  uniform vec3 uColorEnd;
  uniform float uOpacity;
  varying float vT;
  void main() {
    vec2 delta = gl_PointCoord - vec2(0.5);
    float dist = length(delta);
    if (dist > 0.5) discard;
    float edge = smoothstep(0.5, 0.05, dist);
    float fade = smoothstep(0.0, 0.12, vT) * (1.0 - smoothstep(0.82, 1.0, vT));
    vec3 color = mix(uColorStart, uColorEnd, smoothstep(0.0, 1.0, vT));
    gl_FragColor = vec4(color, edge * fade * uOpacity);
  }
`;

export interface ParticleSpawn {
  start: THREE.Vector3;
  target: { x: number; y: number };
  /** Seconds after uTime=0 this particle begins moving. */
  delay: number;
}

export class IntroParticles {
  private readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  readonly duration: number;

  constructor(spawns: ParticleSpawn[], options: { duration?: number; colorStart?: number; colorEnd?: number } = {}) {
    this.duration = options.duration ?? 0.55;
    const count = spawns.length;
    const starts = new Float32Array(count * 3);
    const targets = new Float32Array(count * 3);
    const delays = new Float32Array(count);
    const sizes = new Float32Array(count);

    spawns.forEach((spawn, i) => {
      starts[i * 3] = spawn.start.x;
      starts[i * 3 + 1] = spawn.start.y;
      starts[i * 3 + 2] = spawn.start.z;
      targets[i * 3] = spawn.target.x;
      targets[i * 3 + 1] = spawn.target.y;
      targets[i * 3 + 2] = 0;
      delays[i] = spawn.delay;
      sizes[i] = 2.5 + Math.random() * 3;
    });

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(targets.slice(), 3));
    this.geometry.setAttribute('aStart', new THREE.BufferAttribute(starts, 3));
    this.geometry.setAttribute('aTarget', new THREE.BufferAttribute(targets, 3));
    this.geometry.setAttribute('aDelay', new THREE.BufferAttribute(delays, 1));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDuration: { value: this.duration },
        uColorStart: { value: new THREE.Color(options.colorStart ?? 0xffb238) },
        uColorEnd: { value: new THREE.Color(options.colorEnd ?? 0x2f6b45) },
        uOpacity: { value: 1 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'intro-emblem-particles';
    this.points.frustumCulled = false;
    this.points.raycast = () => {};
  }

  get object3D(): THREE.Object3D {
    return this.points;
  }

  /** `time` is seconds since this convergence began (0 = all particles at their start point). */
  setTime(time: number): void {
    this.material.uniforms.uTime.value = time;
  }

  set opacity(value: number) {
    this.material.uniforms.uOpacity.value = value;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
