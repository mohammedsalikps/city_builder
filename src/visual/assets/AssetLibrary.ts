import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetDefinition, AssetRegistry } from './AssetRegistry';
import { cloneMaterial, type MaterialLibrary } from '../materials/MaterialLibrary';

/** A loaded, normalised model every instance is cloned from. */
interface Template {
  definition: AssetDefinition;
  /** Wrapper whose child is the corrected (scaled / turned / offset) glTF scene. */
  root: THREE.Group;
  clips: THREE.AnimationClip[];
  lod: Array<{ root: THREE.Group; distance: number }>;
  /** Measured size after correction. */
  size: THREE.Vector3;
  fallback: boolean;
}

/** How a model is fitted into a gameplay box. */
export type AssetFit = 'contain' | 'height' | 'stretch';

const ORIGINAL_MATERIAL_NAME = 'assetMaterialName';

/**
 * Loads glTF / GLB models once, caches them, and hands out cheap copies.
 *
 *   registry id --load (once)--> Template --clone--> instance (shares geometry & materials)
 *                                        \--createInstanced--> InstancedMesh per sub-mesh
 *
 * Also: material binding to the shared MaterialLibrary, colour variants,
 * LOD, animation mixers, disposal, and a visible fallback box (plus a
 * warning) when a file is missing or fails to parse, so a bad asset never
 * breaks the game. Meshopt-compressed files are supported out of the box.
 */
export class AssetLibrary {
  private readonly loader = new GLTFLoader();
  private readonly templates = new Map<string, Template>();
  private readonly pending = new Map<string, Promise<Template>>();
  private readonly variantMaterials = new Map<string, THREE.Material>();
  private readonly mixers = new Map<THREE.Object3D, THREE.AnimationMixer>();
  private readonly fallbackMaterial = new THREE.MeshStandardMaterial({ color: 0xb9b2a6, roughness: 0.9 });
  private readonly baseUrl: string;
  private failures = 0;

  constructor(
    private readonly registry: AssetRegistry,
    private readonly materials: MaterialLibrary,
    baseUrl = new URL('assets/3d/', document.baseURI).href,
  ) {
    this.baseUrl = baseUrl;
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  /** Load (or return the cached load of) an asset. Never rejects: failures resolve to a fallback. */
  load(id: string): Promise<Template> {
    const ready = this.templates.get(id);
    if (ready) return Promise.resolve(ready);
    let promise = this.pending.get(id);
    if (!promise) {
      promise = this.loadTemplate(id).then((template) => {
        this.templates.set(id, template);
        this.pending.delete(id);
        return template;
      });
      this.pending.set(id, promise);
    }
    return promise;
  }

  preload(ids: Iterable<string>): Promise<void> {
    return Promise.all([...new Set(ids)].map((id) => this.load(id))).then(() => undefined);
  }

  isReady(id: string): boolean {
    return this.templates.has(id);
  }

  /** Run `callback` once the asset is loaded (immediately if it already is). */
  whenReady(id: string, callback: () => void): void {
    if (this.templates.has(id)) callback();
    else void this.load(id).then(callback);
  }

  /** Measured size of a loaded asset (after correction). */
  sizeOf(id: string): THREE.Vector3 | null {
    return this.templates.get(id)?.size.clone() ?? null;
  }

  /**
   * A new copy of a loaded asset. Geometry and materials are shared with the
   * template; LOD levels and animation are set up per copy.
   */
  instantiate(id: string, options: { variant?: string } = {}): THREE.Object3D {
    const template = this.templates.get(id) ?? this.fallbackTemplate(id);
    let object: THREE.Object3D;
    if (template.lod.length > 0) {
      const lod = new THREE.LOD();
      lod.addLevel(this.copy(template.root), 0);
      for (const level of template.lod) lod.addLevel(this.copy(level.root), level.distance);
      object = lod;
    } else {
      object = this.copy(template.root);
    }
    if (options.variant) this.applyVariant(object, template.definition, options.variant);
    object.userData.assetId = id;

    const autoplay = template.definition.animations?.autoplay;
    if (autoplay && template.clips.length > 0) {
      const clip = autoplay === '*' ? template.clips[0] : THREE.AnimationClip.findByName(template.clips, autoplay);
      if (clip) {
        const mixer = new THREE.AnimationMixer(object);
        const action = mixer.clipAction(clip);
        action.setLoop(template.definition.animations?.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
        action.play();
        this.mixers.set(object, mixer);
      }
    }
    return object;
  }

  /**
   * A copy scaled into a gameplay box (bottom-centred). 'contain' keeps it
   * inside all three dimensions uniformly; 'height' matches the height and
   * lets thin details (a streetlight arm) overhang; 'stretch' scales each
   * axis to the box exactly (walls, floors, road tiles: the gameplay box IS
   * the object).
   */
  instantiateFitted(id: string, box: { width: number; height: number; depth: number }, fit: AssetFit = 'contain'): THREE.Object3D {
    const object = this.instantiate(id);
    const size = this.templates.get(id)?.size ?? new THREE.Vector3(1, 1, 1);
    const sx = box.width / Math.max(size.x, 1e-6);
    const sy = box.height / Math.max(size.y, 1e-6);
    const sz = box.depth / Math.max(size.z, 1e-6);
    if (fit === 'stretch') object.scale.set(sx, sy, sz);
    else object.scale.setScalar(fit === 'height' ? sy : Math.min(sx, sy, sz));
    return object;
  }

  /**
   * Many static copies of one asset as InstancedMesh (one per sub-mesh):
   * a forest of 500 trees is two draw calls. No LOD or animation.
   */
  createInstanced(id: string, transforms: THREE.Matrix4[], options: { variant?: string } = {}): THREE.Group {
    const template = this.templates.get(id) ?? this.fallbackTemplate(id);
    const group = new THREE.Group();
    group.name = `instanced:${id}`;
    if (transforms.length === 0) return group;
    template.root.updateMatrixWorld(true);
    const matrix = new THREE.Matrix4();
    template.root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = options.variant
        ? this.variantMaterial(template.definition, options.variant, mesh.material as THREE.Material, mesh)
        : mesh.material;
      const instanced = new THREE.InstancedMesh(mesh.geometry, material, transforms.length);
      transforms.forEach((transform, i) => instanced.setMatrixAt(i, matrix.multiplyMatrices(transform, mesh.matrixWorld)));
      instanced.instanceMatrix.needsUpdate = true;
      instanced.castShadow = mesh.castShadow;
      instanced.receiveShadow = mesh.receiveShadow;
      instanced.computeBoundingSphere();
      group.add(instanced);
    });
    return group;
  }

  /** Advance animation mixers. */
  update(deltaSeconds: number): void {
    this.mixers.forEach((mixer) => mixer.update(deltaSeconds));
  }

  /** Stop animation for a copy that is being removed. Shared resources stay cached. */
  release(object: THREE.Object3D): void {
    const mixer = this.mixers.get(object);
    if (mixer) {
      mixer.stopAllAction();
      mixer.uncacheRoot(object);
      this.mixers.delete(object);
    }
  }

  get stats(): { registered: number; loaded: number; loading: number; failed: number; animated: number } {
    return {
      registered: this.registry.size,
      loaded: this.templates.size,
      loading: this.pending.size,
      failed: this.failures,
      animated: this.mixers.size,
    };
  }

  dispose(): void {
    this.mixers.forEach((mixer) => mixer.stopAllAction());
    this.mixers.clear();
    this.templates.forEach((template) => {
      template.root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        if (template.definition.materials === 'embedded') {
          (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => m.dispose());
        }
      });
    });
    this.templates.clear();
    this.variantMaterials.forEach((m) => m.dispose());
    this.variantMaterials.clear();
    this.fallbackMaterial.dispose();
  }

  // ------------------------------------------------------------ loading

  private async loadTemplate(id: string): Promise<Template> {
    const definition = this.registry.get(id);
    if (!definition) return this.fallbackTemplate(id);
    try {
      const gltf = await this.loader.loadAsync(this.baseUrl + definition.path);
      const root = this.normalise(definition, gltf.scene);
      const lod = await Promise.all(
        (definition.lod ?? []).map(async (level) => ({
          distance: level.distance,
          root: this.normalise(definition, (await this.loader.loadAsync(this.baseUrl + level.path)).scene),
        })),
      );
      const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
      return { definition, root, clips: gltf.animations, lod, size, fallback: false };
    } catch (error) {
      this.failures++;
      console.warn(`[assets] "${id}" could not be loaded from ${definition.path}; using a placeholder box.`, error);
      return this.fallbackTemplate(id);
    }
  }

  /** Apply the registry's correction and bind materials / shadow flags. */
  private normalise(definition: AssetDefinition, scene: THREE.Object3D): THREE.Group {
    scene.rotation.y = THREE.MathUtils.degToRad(definition.rotationY ?? 0);
    scene.scale.setScalar(definition.scale ?? 1);
    const offset = definition.offset ?? { x: 0, y: 0, z: 0 };
    scene.position.set(offset.x, offset.y, offset.z);
    const root = new THREE.Group();
    root.name = `asset:${definition.id}`;
    root.add(scene);

    const bind = definition.materials !== 'embedded';
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = definition.castShadow ?? true;
      mesh.receiveShadow = definition.receiveShadow ?? true;
      const original = mesh.material as THREE.MeshStandardMaterial;
      mesh.userData[ORIGINAL_MATERIAL_NAME] = original.name;
      if (!Array.isArray(mesh.material)) this.adjustEmbedded(definition, original);
      if (!bind || Array.isArray(mesh.material)) return;
      const libraryId = this.materials.resolveAssetMaterial(original.name);
      if (libraryId) {
        mesh.material = this.materials.forAsset(libraryId, original.color ?? new THREE.Color(0xffffff));
        original.dispose();
      }
    });
    if (definition.recenter) {
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const centre = box.getCenter(new THREE.Vector3());
      scene.position.x -= centre.x;
      scene.position.z -= centre.z;
      scene.position.y -= box.min.y;
    }
    root.updateMatrixWorld(true);
    return root;
  }

  /** Palette-safe filtering and PBR response for a file's own materials. */
  private adjustEmbedded(definition: AssetDefinition, material: THREE.MeshStandardMaterial): void {
    if (definition.textureFilter === 'palette' && material.map && !material.map.userData.paletteFiltered) {
      material.map.generateMipmaps = false;
      material.map.minFilter = THREE.LinearFilter;
      material.map.magFilter = THREE.LinearFilter;
      material.map.userData.paletteFiltered = true;
      material.map.needsUpdate = true;
    }
    if (definition.surface && material.name !== 'glass') {
      if (definition.surface.roughness !== undefined) material.roughness = definition.surface.roughness;
      if (definition.surface.metalness !== undefined) material.metalness = definition.surface.metalness;
    }
  }

  private fallbackTemplate(id: string): Template {
    const definition: AssetDefinition = this.registry.get(id) ?? {
      id,
      path: 'missing.glb',
      category: 'props',
      footprint: { width: 1, depth: 1 },
      bounds: { width: 1, height: 1, depth: 1 },
    };
    if (!this.registry.has(id)) console.warn(`[assets] Unknown asset "${id}"; using a placeholder box.`);
    const { width, height, depth } = definition.bounds;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), this.fallbackMaterial);
    mesh.position.y = height / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const root = new THREE.Group();
    root.name = `asset:${id}:fallback`;
    root.add(mesh);
    root.updateMatrixWorld(true);
    return { definition, root, clips: [], lod: [], size: new THREE.Vector3(width, height, depth), fallback: true };
  }

  // ------------------------------------------------------------ copies

  private copy(root: THREE.Group): THREE.Object3D {
    return cloneSkinned(root);
  }

  private applyVariant(object: THREE.Object3D, definition: AssetDefinition, variantId: string): void {
    object.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      mesh.material = this.variantMaterial(definition, variantId, mesh.material, mesh);
    });
  }

  private variantMaterial(definition: AssetDefinition, variantId: string, material: THREE.Material, mesh: THREE.Mesh): THREE.Material {
    const variant = definition.variants?.find((v) => v.id === variantId);
    const name = mesh.userData[ORIGINAL_MATERIAL_NAME] as string | undefined;
    const tint = variant && name ? variant.tints[name] : undefined;
    if (!tint) return material;
    const key = `${definition.id}:${variantId}:${material.uuid}`;
    let tinted = this.variantMaterials.get(key);
    if (!tinted) {
      tinted = cloneMaterial(material);
      (tinted as THREE.MeshStandardMaterial).color?.set(tint);
      this.variantMaterials.set(key, tinted);
    }
    return tinted;
  }
}
