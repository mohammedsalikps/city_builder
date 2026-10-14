import * as THREE from 'three';
import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import type { ConstructionResources } from '@/construction/ConstructionResources';
import type { AssetLibrary } from '@/visual/assets/AssetLibrary';
import type { TemplateObjectSpec, TemplateRegistry } from './Template';

const WIDTH = 320;
const HEIGHT = 240;

/**
 * Little 3D pictures for World Studio's choices - the real models, lit
 * like the world, rendered once each into an image and cached. Templates
 * get a miniature "diorama" plate; single pieces float on a clean
 * background. Uses its own small offscreen renderer so the main view is
 * never interrupted; shares geometry, materials and loaded models with it.
 */
export class ThumbnailRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly cache = new Map<string, Promise<string>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly registry: ObjectRegistry,
    private readonly templates: TemplateRegistry,
    private readonly resources: ConstructionResources,
    private readonly assets: AssetLibrary,
  ) {}

  /** A picture of a whole template (a house style, a park, a neighbourhood). */
  forTemplate(templateId: string): Promise<string> {
    const template = this.templates.get(templateId);
    if (!template) return Promise.resolve('');
    return this.cached(`t:${templateId}`, () => this.render(template.objects, true));
  }

  /** A picture of one catalogue piece. */
  forDefinition(definitionId: string): Promise<string> {
    return this.cached(`d:${definitionId}`, () =>
      this.render([{ definitionId, position: { x: 0, y: 0, z: 0 }, rotationY: -0.5 }], false),
    );
  }

  dispose(): void {
    this.renderer?.dispose();
    this.renderer = null;
    this.cache.clear();
  }

  private cached(key: string, make: () => Promise<string>): Promise<string> {
    let entry = this.cache.get(key);
    if (!entry) {
      // One at a time: thumbnails share the offscreen canvas.
      entry = this.queue.then(make, make);
      this.queue = entry.catch(() => undefined);
      this.cache.set(key, entry);
    }
    return entry;
  }

  private ensureRenderer(): THREE.WebGLRenderer {
    if (!this.renderer) {
      const canvas = document.createElement('canvas');
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(WIDTH, HEIGHT, false);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setClearColor(0x000000, 0);
    }
    return this.renderer;
  }

  private async render(specs: TemplateObjectSpec[], diorama: boolean): Promise<string> {
    const assetIds = specs
      .map((spec) => this.registry.get(spec.definitionId)?.visual?.asset)
      .filter((id): id is string => typeof id === 'string');
    await this.assets.preload(assetIds);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfdfbf4, 0x8fa37a, 1.9));
    const sun = new THREE.DirectionalLight(0xfff2de, 2.4);
    sun.position.set(6, 12, 8);
    scene.add(sun);

    const content = new THREE.Group();
    const clones: THREE.Object3D[] = [];
    for (const spec of specs) {
      const definition = this.registry.get(spec.definitionId);
      if (!definition) continue;
      let object: THREE.Object3D;
      if (definition.visual) {
        object = this.assets.instantiateFitted(definition.visual.asset, definition.dimensions, definition.visual.fit ?? 'contain');
        clones.push(object);
      } else {
        object = new THREE.Mesh(this.resources.getGeometry(definition), this.resources.getMaterial(null, definition));
      }
      object.position.set(spec.position.x, spec.position.y, spec.position.z);
      object.rotation.y = spec.rotationY ?? 0;
      if (spec.scale) object.scale.set(spec.scale.x, spec.scale.y, spec.scale.z);
      content.add(object);
    }
    scene.add(content);

    const box = new THREE.Box3().setFromObject(content);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const disposables: Array<{ dispose(): void }> = [];
    if (diorama) {
      const radius = Math.max(size.x, size.z) * 0.62 + 0.6;
      const plateGeometry = new THREE.CylinderGeometry(radius, radius * 1.02, 0.35, 48);
      const plateMaterial = new THREE.MeshStandardMaterial({ color: 0x9fcf7f, roughness: 0.95 });
      const plate = new THREE.Mesh(plateGeometry, plateMaterial);
      plate.position.set(center.x, box.min.y - 0.18, center.z);
      scene.add(plate);
      disposables.push(plateGeometry, plateMaterial);
    }

    const camera = new THREE.PerspectiveCamera(28, WIDTH / HEIGHT, 0.1, 2000);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const distance = (Math.max(sphere.radius, 0.3) / Math.sin(THREE.MathUtils.degToRad(28 / 2))) * (diorama ? 0.8 : 0.95);
    const direction = new THREE.Vector3(0.9, diorama ? 0.95 : 0.6, 1.25).normalize();
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.lookAt(center.x, center.y - (diorama ? sphere.radius * 0.08 : 0), center.z);

    const renderer = this.ensureRenderer();
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');

    clones.forEach((clone) => this.assets.release(clone));
    disposables.forEach((d) => d.dispose());
    return url;
  }
}
