import * as THREE from 'three';
import type { ObjectRegistry } from './ObjectRegistry';
import type { ConstructionResources } from './ConstructionResources';
import type { PlacedObject } from './PlacedObject';
import { roleOf, type ConstructionObjectDefinition } from './ConstructionObjectDefinition';
import { buildWallGeometry, openingRects, openingSignature } from './walls';
import type { AssetLibrary } from '@/visual/assets/AssetLibrary';
import { cloneMaterial } from '@/visual/materials/MaterialLibrary';

/** Key on `Object3D.userData` that links a mesh back to its PlacedObject. */
export const INSTANCE_ID_KEY = 'instanceId';

const EDGE_COLOR = 0x1e1a16;
const SELECTED_EDGE_COLOR = 0xffd54a;
const INVALID_EDGE_COLOR = 0xff5252;
const SELECTED_EMISSIVE = 0x5a4300;
const EDGE_THRESHOLD_DEGREES = 25;
/** Outline strength on textured objects: a hint of drawing, not a wireframe. */
const EDGE_OPACITY = 0.28;
/** Opacity of an object faded because it hides an interior target. */
const FADED_OPACITY = 0.22;
const FADED_EDGE_OPACITY = 0.45;

interface RenderedInstance {
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  /** The data object this mesh was last synced from. */
  source: PlacedObject;
  /** Per-instance selection material (created lazily, disposed on removal). */
  selectedMaterial: THREE.MeshStandardMaterial | null;
  /**
   * Walls with openings get their own geometry (a wall with holes is unique
   * to that wall). Null means the shared definition geometry is in use.
   */
  customGeometry: THREE.BufferGeometry | null;
  customEdges: THREE.EdgesGeometry | null;
  /** Which openings the custom geometry was built for; '' = none. */
  openingSignature: string;
  /**
   * 3D asset drawn for this object (definition.visual). When present the
   * gameplay mesh stays as an invisible raycast/selection proxy.
   */
  visual: THREE.Object3D | null;
}

/** Per-instance colour override, or null for the definition's own colours. */
function overrideColor(placed: PlacedObject): string | null {
  return placed.materialOverrides.color ?? null;
}

/**
 * Mirrors `state.placedObjects` into three.js objects under a root group.
 *
 *   PlacedObject[] --sync()--> Mesh per instance
 *
 * The renderer never changes game state. It only reads placed-object data
 * and creates, updates, or removes meshes so the scene matches that data.
 * What a definition looks like comes from ConstructionResources (shape
 * builders). The one relationship the renderer understands is host walls:
 * a wall is rebuilt with holes when the set of openings set into it changes,
 * and only then.
 */
export class ConstructionRenderer {
  private readonly instances = new Map<string, RenderedInstance>();
  private readonly edgeMaterial = new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: EDGE_OPACITY });
  /** Invisible but raycastable: the gameplay shape under an asset visual. */
  private readonly proxyMaterial = new THREE.MeshBasicMaterial({ visible: false });
  private readonly selectedEdgeMaterial = new THREE.LineBasicMaterial({ color: SELECTED_EDGE_COLOR });
  /** Shown instead of the selection colour while a gizmo drag is currently invalid. */
  private readonly invalidEdgeMaterial = new THREE.LineBasicMaterial({ color: INVALID_EDGE_COLOR });
  /** Selected instance currently being dragged to an invalid spot, if any. */
  private invalidId: string | null = null;
  /**
   * Presentation-only fade (see InteriorReadability): ids drawn see-through
   * because they stand between the camera and an interior target. One faded
   * clone per base material, created once and reused.
   */
  private fadedIds: ReadonlySet<string> = new Set();
  private selectedId: string | null = null;
  private readonly fadedMaterials = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  private readonly fadedEdgeMaterial = new THREE.LineBasicMaterial({
    color: EDGE_COLOR,
    transparent: true,
    opacity: FADED_EDGE_OPACITY,
    depthWrite: false,
  });

  constructor(
    private readonly root: THREE.Group,
    private readonly registry: ObjectRegistry,
    private readonly resources: ConstructionResources,
    private readonly assets: AssetLibrary | null = null,
  ) {}

  /** Meshes that can be raycast for selection. Excludes edge overlays. */
  get selectableMeshes(): THREE.Mesh[] {
    return [...this.instances.values()].map((i) => i.mesh);
  }

  get count(): number {
    return this.instances.size;
  }

  /** For diagnostics: how many walls currently carry their own hole geometry. */
  get customGeometryCount(): number {
    return [...this.instances.values()].filter((i) => i.customGeometry !== null).length;
  }

  /**
   * Bring the scene in line with the given data. Objects are compared by
   * reference: state is immutable, so a changed instance is a new object.
   */
  sync(placedObjects: PlacedObject[], selectedInstanceId: string | null): void {
    const wantedIds = new Set<string>();

    for (const placed of placedObjects) {
      wantedIds.add(placed.id);
      const existing = this.instances.get(placed.id);
      if (!existing) {
        this.create(placed);
      } else if (existing.source !== placed) {
        this.update(existing, placed);
      }
    }

    for (const id of [...this.instances.keys()]) {
      if (!wantedIds.has(id)) this.remove(id);
    }

    this.syncWallOpenings(placedObjects);
    if (this.selectedId !== selectedInstanceId) this.invalidId = null;
    this.selectedId = selectedInstanceId;
    this.instances.forEach((instance) => this.applyMaterials(instance));
  }

  /** The live three.js object for a placed instance, e.g. to attach a transform gizmo to. */
  getObject3D(instanceId: string): THREE.Object3D | null {
    return this.instances.get(instanceId)?.mesh ?? null;
  }

  /** Snap an instance's mesh back to its last authoritative transform (a rejected drag). */
  resync(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (instance) this.applyTransform(instance, instance.source);
  }

  /**
   * Tint the selected instance's outline red while a gizmo drag would not be
   * a valid transform, or back to the normal selection colour once it is (or
   * once the drag ends). Presentation only; never touches placed-object data.
   */
  setSelectionValid(instanceId: string, valid: boolean): void {
    const next = valid ? null : instanceId;
    if (this.invalidId === next) return;
    this.invalidId = next;
    const instance = this.instances.get(instanceId);
    if (instance) this.applyMaterials(instance);
  }

  /**
   * Draw these instances faded. Rendering only: meshes stay in the scene,
   * keep their geometry and remain raycast targets.
   */
  setFaded(ids: ReadonlySet<string>): void {
    if (ids.size === this.fadedIds.size && [...ids].every((id) => this.fadedIds.has(id))) return;
    this.fadedIds = new Set(ids);
    this.instances.forEach((instance) => this.applyMaterials(instance));
  }

  /** For diagnostics: how many instances are currently drawn faded. */
  get fadedCount(): number {
    let count = 0;
    this.instances.forEach((_, id) => {
      if (this.fadedIds.has(id)) count++;
    });
    return count;
  }

  /** Remove every mesh. Shared geometries/materials are left to `resources`. */
  clear(): void {
    for (const id of [...this.instances.keys()]) this.remove(id);
  }

  dispose(): void {
    this.clear();
    this.edgeMaterial.dispose();
    this.selectedEdgeMaterial.dispose();
    this.invalidEdgeMaterial.dispose();
    this.fadedEdgeMaterial.dispose();
    this.fadedMaterials.forEach((m) => m.dispose());
    this.fadedMaterials.clear();
    this.proxyMaterial.dispose();
  }

  // ------------------------------------------------------------------ walls

  /**
   * Give every wall the geometry matching its current openings. Openings are
   * grouped by host once per sync; a wall is rebuilt only when its opening
   * signature (relative rectangles) differs from the last build.
   */
  private syncWallOpenings(placedObjects: PlacedObject[]): void {
    const byHost = new Map<string, Array<{ placed: PlacedObject; definition: ConstructionObjectDefinition }>>();
    for (const placed of placedObjects) {
      if (!placed.hostId) continue;
      const definition = this.registry.get(placed.definitionId);
      if (!definition) continue;
      const list = byHost.get(placed.hostId) ?? [];
      list.push({ placed, definition });
      byHost.set(placed.hostId, list);
    }

    for (const [id, instance] of this.instances) {
      const definition = this.registry.get(instance.source.definitionId);
      if (!definition || roleOf(definition) !== 'wall') continue;

      const openings = byHost.get(id) ?? [];
      const rects = openingRects(definition, instance.source, openings);
      const signature = openings.length === 0 ? '' : openingSignature(rects);
      // A wall drawn with a model shows the procedural wall (with real holes)
      // while doors or windows are set into it, and its model otherwise.
      if (instance.visual) instance.visual.visible = signature === '';
      if (signature === instance.openingSignature) continue;

      this.disposeCustomGeometry(instance);
      if (signature !== '') {
        instance.customGeometry = buildWallGeometry(definition, rects);
        instance.customEdges = new THREE.EdgesGeometry(instance.customGeometry, EDGE_THRESHOLD_DEGREES);
        instance.mesh.geometry = instance.customGeometry;
        instance.edges.geometry = instance.customEdges;
      } else {
        instance.mesh.geometry = this.resources.getGeometry(definition);
        instance.edges.geometry = this.resources.getEdges(definition);
      }
      instance.openingSignature = signature;
    }
  }

  private disposeCustomGeometry(instance: RenderedInstance): void {
    instance.customGeometry?.dispose();
    instance.customEdges?.dispose();
    instance.customGeometry = null;
    instance.customEdges = null;
  }

  // -------------------------------------------------------------- instances

  private create(placed: PlacedObject): void {
    const definition = this.registry.get(placed.definitionId);
    if (!definition) {
      console.warn(`[renderer] Skipping placed object with unknown definition: ${placed.definitionId}`);
      return;
    }

    const mesh = new THREE.Mesh(
      this.resources.getGeometry(definition),
      this.resources.getMaterial(overrideColor(placed), definition),
    );
    mesh.name = `placed:${placed.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData[INSTANCE_ID_KEY] = placed.id;

    const edges = new THREE.LineSegments(this.resources.getEdges(definition), this.edgeMaterial);
    edges.name = 'edges';
    mesh.add(edges);

    const instance: RenderedInstance = {
      mesh,
      edges,
      source: placed,
      selectedMaterial: null,
      customGeometry: null,
      customEdges: null,
      openingSignature: '',
      visual: null,
    };
    this.applyTransform(instance, placed);
    this.instances.set(placed.id, instance);
    this.root.add(mesh);
    this.attachVisual(instance, definition);
  }

  /**
   * Swap in the definition's 3D asset once it is loaded. Until then (or if
   * there is none) the procedural shape is shown, so nothing ever pops in empty.
   */
  private attachVisual(instance: RenderedInstance, definition: ConstructionObjectDefinition): void {
    const visual = definition.visual;
    if (!visual || !this.assets) return;
    const assets = this.assets;
    assets.whenReady(visual.asset, () => {
      if (this.instances.get(instance.source.id) !== instance || instance.visual) return;
      if (instance.source.definitionId !== definition.id) return;
      const object = assets.instantiateFitted(visual.asset, definition.dimensions, visual.fit ?? 'contain');
      object.name = 'visual';
      object.visible = instance.openingSignature === '';
      instance.mesh.add(object);
      instance.visual = object;
      this.applyMaterials(instance);
    });
  }

  private detachVisual(instance: RenderedInstance): void {
    if (!instance.visual) return;
    this.assets?.release(instance.visual);
    instance.mesh.remove(instance.visual);
    instance.visual = null;
  }

  /** For diagnostics: how many objects are drawn with a 3D asset. */
  get assetVisualCount(): number {
    let count = 0;
    this.instances.forEach((i) => {
      if (i.visual) count++;
    });
    return count;
  }

  private update(instance: RenderedInstance, placed: PlacedObject): void {
    const definition = this.registry.get(placed.definitionId);
    if (!definition) return;

    const definitionChanged = instance.source.definitionId !== placed.definitionId;
    if (definitionChanged) {
      this.detachVisual(instance);
      this.disposeCustomGeometry(instance);
      instance.openingSignature = '';
      instance.mesh.geometry = this.resources.getGeometry(definition);
      instance.edges.geometry = this.resources.getEdges(definition);
    }
    if (overrideColor(placed) !== overrideColor(instance.source)) {
      instance.mesh.material = this.resources.getMaterial(overrideColor(placed), definition);
      instance.selectedMaterial?.dispose();
      instance.selectedMaterial = null;
    }
    this.applyTransform(instance, placed);
    instance.source = placed;
    if (definitionChanged) this.attachVisual(instance, definition);
  }

  private remove(id: string): void {
    const instance = this.instances.get(id);
    if (!instance) return;
    this.detachVisual(instance);
    instance.mesh.remove(instance.edges);
    this.root.remove(instance.mesh);
    instance.selectedMaterial?.dispose();
    this.disposeCustomGeometry(instance);
    this.instances.delete(id);
  }

  private applyTransform(instance: RenderedInstance, placed: PlacedObject): void {
    instance.mesh.position.set(placed.position.x, placed.position.y, placed.position.z);
    instance.mesh.rotation.set(0, placed.rotationY, 0);
    instance.mesh.scale.set(placed.scale.x, placed.scale.y, placed.scale.z);
    // Raycasting can happen before the next render; keep the world matrix current now.
    instance.mesh.updateMatrixWorld(true);
  }

  /** Selection wins over fading; otherwise faded or the normal material. */
  private applyMaterials(instance: RenderedInstance): void {
    const definition = this.registry.get(instance.source.definitionId);
    const baseMaterial = this.resources.getMaterial(overrideColor(instance.source), definition);
    const id = instance.source.id;

    if (instance.visual && instance.visual.visible) {
      // Asset-drawn objects: the gameplay proxy stays invisible; selection
      // shows the gameplay outline in the selection colour; interior
      // readability fades the model's own materials.
      instance.mesh.material = this.proxyMaterial;
      instance.edges.visible = id === this.selectedId;
      instance.edges.material = id === this.invalidId ? this.invalidEdgeMaterial : this.selectedEdgeMaterial;
      const faded = this.fadedIds.has(id) && id !== this.selectedId;
      instance.visual.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        const base = (mesh.userData.baseMaterial as THREE.MeshStandardMaterial | undefined) ?? (mesh.material as THREE.MeshStandardMaterial);
        mesh.userData.baseMaterial = base;
        mesh.material = faded ? this.fadedMaterialFor(base) : base;
      });
      return;
    }
    instance.edges.visible = true;

    if (id === this.selectedId) {
      if (!instance.selectedMaterial) {
        instance.selectedMaterial = cloneMaterial(baseMaterial);
        instance.selectedMaterial.emissive = new THREE.Color(SELECTED_EMISSIVE);
      }
      instance.mesh.material = instance.selectedMaterial;
      instance.edges.material = id === this.invalidId ? this.invalidEdgeMaterial : this.selectedEdgeMaterial;
    } else if (this.fadedIds.has(id)) {
      instance.mesh.material = this.fadedMaterialFor(baseMaterial);
      instance.edges.material = this.fadedEdgeMaterial;
    } else {
      instance.mesh.material = baseMaterial;
      instance.edges.material = this.edgeMaterial;
    }
  }

  private fadedMaterialFor(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    let faded = this.fadedMaterials.get(base);
    if (!faded) {
      faded = cloneMaterial(base);
      faded.transparent = true;
      faded.opacity = FADED_OPACITY;
      faded.depthWrite = false;
      this.fadedMaterials.set(base, faded);
    }
    return faded;
  }
}
