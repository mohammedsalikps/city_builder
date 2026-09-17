import * as THREE from 'three';

const SIZE = 30;

/**
 * A soft, local building guide: 1 m lines (with every fourth line stronger)
 * that fade out in a circle around the point being built on. Shown only
 * while the child is placing something, so the world never looks like an
 * editor grid the rest of the time.
 */
export class LocalGrid {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly target = new THREE.Vector2();
  private opacity = 0;
  private wanted = false;

  constructor() {
    const geometry = new THREE.PlaneGeometry(SIZE, SIZE, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: {
        uOpacity: { value: 0 },
        uCentre: { value: new THREE.Vector2() },
        uRadius: { value: SIZE * 0.42 },
        uColor: { value: new THREE.Color('#ffffff') },
      },
      vertexShader: /* glsl */ `
        varying vec2 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        uniform vec2 uCentre;
        uniform float uRadius;
        uniform vec3 uColor;
        varying vec2 vWorld;
        float lineAt(vec2 p, float spacing, float width) {
          vec2 g = abs(fract(p / spacing - 0.5) - 0.5) * spacing;
          vec2 w = fwidth(p) * width;
          vec2 l = 1.0 - smoothstep(vec2(0.0), w, g);
          return max(l.x, l.y);
        }
        void main() {
          float fade = 1.0 - smoothstep(uRadius * 0.35, uRadius, distance(vWorld, uCentre));
          float minor = lineAt(vWorld, 1.0, 1.0) * 0.35;
          float major = lineAt(vWorld, 4.0, 1.6) * 0.75;
          float a = max(minor, major) * fade * uOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'local-grid';
    this.mesh.position.y = 0.02;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
  }

  setWanted(wanted: boolean): void {
    this.wanted = wanted;
  }

  /** Follow the point under the pointer (snapped so the lines stay still). */
  setCentre(x: number, z: number): void {
    this.target.set(x, z);
  }

  update(deltaSeconds: number): void {
    const goal = this.wanted ? 0.55 : 0;
    this.opacity += (goal - this.opacity) * Math.min(1, deltaSeconds * 10);
    const uniforms = this.mesh.material.uniforms;
    uniforms.uOpacity.value = this.opacity;
    const centre = uniforms.uCentre.value as THREE.Vector2;
    centre.lerp(this.target, Math.min(1, deltaSeconds * 14));
    this.mesh.position.x = Math.round(centre.x);
    this.mesh.position.z = Math.round(centre.y);
    this.mesh.visible = this.opacity > 0.01;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
