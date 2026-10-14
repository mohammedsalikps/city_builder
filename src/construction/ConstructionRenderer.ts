import * as THREE from 'three';
import type { ObjectRegistry } from './ObjectRegistry';
import type { ConstructionResources } from './ConstructionResources';
import type { PlacedObject } from './PlacedObject';
import { roleOf, type ConstructionObjectDefinition } from './ConstructionObjectDefinition';
import { buildWallGeometry, openingRects, openingSignature } from './walls';
import type { AssetLibrary } from '@/visual/assets/AssetLibrary';
import { cloneMaterial } from '@/visual/materials/MaterialLibrary';
import { ConstructionEffects } from './ConstructionEffects';
import { revealTierOf } from './ConstructionRevealOrder';
import { motion } from '@/accessibility/motion';

/** Key on `Object3D.userData` that links a mesh back to its PlacedObject. */
export const INSTANCE_ID_KEY = 'instanceId';

const EDGE_COLOR = 0x1e1a16;
/** Shared with the Eavara gizmo (see ObjectTransformController) so the outline, halo and 3D handles agree on one selection/invalid language. */
export const SELECTED_EDGE_COLOR = 0xffd54a;
export const INVALID_EDGE_COLOR = 0xff5252;
const SELECTED_EMISSIVE = 0x5a4300;
const EDGE_THRESHOLD_DEGREES = 25;
/** Outline strength on textured objects: a hint of drawing, not a wireframe. */
const EDGE_OPACITY = 0.28;
/** How long a freshly placed object takes to settle into place (seconds). */
const SETTLE_SECONDS = 0.32;
/** Opacity of an object faded because it hides an interior target. */
const FADED_OPACITY = 0.22;
const FADED_EDGE_OPACITY = 0.45;
/** Soft ground glow under a selected 3D model (instead of a wireframe box). */
export const HALO_COLOR = 0xffc23d;
export const HALO_INVALID_COLOR = 0xff5a4a;
const HALO_MARGIN = 0.8;

/** Gap between one reveal wave (foundation, walls, roof...) and the next, during a multi-piece build. */
const REVEAL_WAVE_SECONDS = 0.13;
/** Pause after the last wave settles before the final celebration plays. */
const REVEAL_FINALE_DELAY = 0.22;

/** A rounded, feathered ring painted once into a texture. */
function createHaloTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const ring = (inset: number, width: number, alpha: number): void => {
    ctx.lineWidth = width;
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    const r = 56;
    const a = inset;
    const b = size - inset;
    ctx.beginPath();
    ctx.roundRect(a, a, b - a, b - a, r);
    ctx.stroke();
  };
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.roundRect(30, 30, size - 60, size - 60, 50);
  ctx.fill();
  ctx.filter = 'blur(10px)';
  ring(30, 22, 0.55);
  ctx.filter = 'none';
  ring(30, 7, 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Settling {
  instance: RenderedInstance;
  elapsed: number;
}

/** A soft overshoot: the object lands, gives a tiny bounce, and rests. */
function easeOutBack(t: number): number {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

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
  private passThroughIds: ReadonlySet<string> = new Set();
  private selectedId: string | null = null;
  /** Objects currently playing their placement settle (presentation only). */
  private readonly settling = new Map<string, Settling>();
  private readonly fadedMaterials = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  /** Painted copies of 3D-model materials, one per (material, colour) - see tintedMaterialFor. */
  private readonly tintedMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private haloTexture: THREE.CanvasTexture | null = null;
  private halo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private haloClock = 0;
  private readonly fadedEdgeMaterial = new THREE.LineBasicMaterial({
    color: EDGE_COLOR,
    transparent: true,
    opacity: FADED_EDGE_OPACITY,
    depthWrite: false,
  });

  /** The construction celebration's particles/ground ring; see ConstructionEffects. */
  private readonly effects: ConstructionEffects;
  /**
   * Id of the Creation Group currently being placed live by one
   * `instantiateTemplate` call (see `eavara:creation-start`/`-end`), or null
   * outside of one. New instances that belong to it are held back from
   * `sync()`'s normal single-piece celebration and staged instead - see
   * `beginGroupReveal`. Never set for a restore or undo/redo, which arrive
   * with no such call in progress.
   */
  private liveCreationGroupId: string | null = null;
  /** Ids created so far for the in-progress live group, in creation order. */
  private pendingGroupIds: string[] = [];
  /** One-shot: consumed by the very next `sync()`, suppressing all celebration for it (a restore or undo/redo). */
  private silentSyncArmed = false;
  /** Waves of a staged multi-piece reveal in progress; empty when none is. */
  private revealQueue: Array<{ ids: string[]; startAt: number; fired: boolean }> = [];
  private revealClock = 0;
  private revealFinaleAt = 0;
  private revealFinaleFired = false;
  private revealCentroid = new THREE.Vector3();

  private readonly onCreationStart = (event: Event): void => {
    const detail = (event as CustomEvent<{ groupId: string }>).detail;
    this.liveCreationGroupId = detail.groupId;
    this.pendingGroupIds = [];
  };

  private readonly onCreationEnd = (event: Event): void => {
    const detail = (event as CustomEvent<{ groupId: string; ids: string[] }>).detail;
    this.liveCreationGroupId = null;
    this.beginGroupReveal(detail.ids);
  };

  private readonly onSilentSync = (): void => {
    this.silentSyncArmed = true;
  };

  constructor(
    private readonly root: THREE.Group,
    private readonly registry: ObjectRegistry,
    private readonly resources: ConstructionResources,
    private readonly assets: AssetLibrary | null = null,
  ) {
    this.effects = new ConstructionEffects(this.root);
    window.addEventListener('eavara:creation-start', this.onCreationStart);
    window.addEventListener('eavara:creation-end', this.onCreationEnd);
    window.addEventListener('eavara:silent-sync', this.onSilentSync);
  }

  /** Meshes that can be raycast for selection. Excludes edge overlays. */
  /** Objects taps go straight through (roofs while peeking inside). Presentation only. */
  setPassThrough(ids: ReadonlySet<string>): void {
    this.passThroughIds = new Set(ids);
  }

  get selectableMeshes(): THREE.Mesh[] {
    return [...this.instances.values()].filter((i) => !this.passThroughIds.has(i.source.id)).map((i) => i.mesh);
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
    // A restore (load) or undo/redo snapshot: everything below still needs
    // to create/update/remove meshes as normal, but none of it is a fresh
    // creation worth celebrating. One-shot so a later, real placement still
    // celebrates normally.
    const silent = this.silentSyncArmed;
    this.silentSyncArmed = false;

    const wantedIds = new Set<string>();
    const created: string[] = [];

    for (const placed of placedObjects) {
      wantedIds.add(placed.id);
      const existing = this.instances.get(placed.id);
      if (!existing) {
        this.create(placed, silent);
        created.push(placed.id);
      } else if (existing.source !== placed) {
        this.update(existing, placed);
      }
    }
    // Ids just held back into the in-progress group's buffer never get the
    // single-piece treatment - they're revealed together once the whole
    // creation finishes (`beginGroupReveal`). Everything else newly created
    // is a free-standing placement (or, if `silent`, a restore) that never
    // joined a group, and celebrates - or doesn't - on its own.
    if (!silent) {
      for (const id of created) {
        if (!this.pendingGroupIds.includes(id)) this.celebrate(id);
      }
    }

    for (const id of [...this.instances.keys()]) {
      if (!wantedIds.has(id)) this.remove(id);
    }

    this.syncWallOpenings(placedObjects);
    if (this.selectedId !== selectedInstanceId) this.invalidId = null;
    this.selectedId = selectedInstanceId;
    this.instances.forEach((instance) => this.applyMaterials(instance));
    this.placeHalo();
  }

  /**
   * Selected 3D models get a soft glowing footprint on the ground, which
   * reads as "this one" without drawing a technical bounding box.
   */
  private placeHalo(): void {
    const instance = this.selectedId ? this.instances.get(this.selectedId) : undefined;
    const wanted = instance?.visual?.visible ? instance : undefined;
    if (!wanted) {
      if (this.halo) {
        this.halo.removeFromParent();
        this.halo.visible = false;
      }
      return;
    }
    const halo = this.ensureHalo();
    const definition = this.registry.get(wanted.source.definitionId);
    if (!definition) return;
    const { width, depth } = definition.dimensions;
    const margin = HALO_MARGIN + Math.max(width, depth) * 0.12;
    halo.scale.set(width + margin * 2, 1, depth + margin * 2);
    halo.material.color.setHex(wanted.source.id === this.invalidId ? HALO_INVALID_COLOR : HALO_COLOR);
    if (halo.parent !== wanted.mesh) wanted.mesh.add(halo);
    halo.visible = true;
  }

  private ensureHalo(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
    if (!this.halo) {
      this.haloTexture = createHaloTexture();
      const geometry = new THREE.PlaneGeometry(1, 1);
      geometry.rotateX(-Math.PI / 2);
      const material = new THREE.MeshBasicMaterial({
        map: this.haloTexture,
        color: HALO_COLOR,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      this.halo = new THREE.Mesh(geometry, material);
      this.halo.name = 'selection-halo';
      this.halo.position.y = 0.03;
      this.halo.renderOrder = 2;
      this.halo.raycast = () => {};
    }
    return this.halo;
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
    this.placeHalo();
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

  /**
   * Advance placement settles, the staged multi-piece reveal, and the
   * particle/ring effects. Presentation only: the authoritative transform is
   * restored exactly when each settle ends, and nothing here ever writes to
   * `PlacedObject` state.
   */
  tick(deltaSeconds: number): void {
    if (this.halo?.visible) {
      this.haloClock += deltaSeconds;
      this.halo.material.opacity = motion.reduced ? 0.9 : 0.78 + 0.22 * Math.sin(this.haloClock * 3.2);
    }
    this.effects.tick(deltaSeconds);
    this.tickReveal(deltaSeconds);

    if (this.settling.size === 0) return;
    for (const [id, settle] of this.settling) {
      settle.elapsed += deltaSeconds;
      const { instance } = settle;
      const source = instance.source;
      const t = motion.reduced ? 1 : Math.min(1, settle.elapsed / SETTLE_SECONDS);
      if (t >= 1) {
        this.settling.delete(id);
        this.applyTransform(instance, source);
        continue;
      }
      const grow = 0.78 + 0.22 * easeOutBack(t);
      instance.mesh.scale.set(source.scale.x * grow, source.scale.y * grow, source.scale.z * grow);
      instance.mesh.position.y = source.position.y + (1 - t) * (1 - t) * 0.6;
    }
  }

  /** One freshly placed, free-standing object: settle, a small warm burst, a soft ground pulse. */
  private celebrate(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    this.settling.set(instanceId, { instance, elapsed: 0 });
    this.spawnPieceEffects(instance);
    window.dispatchEvent(
      new CustomEvent('eavara:placed', { detail: { instanceId, definitionId: instance.source.definitionId } }),
    );
  }

  private spawnPieceEffects(instance: RenderedInstance): void {
    const definition = this.registry.get(instance.source.definitionId);
    const footprint = definition ? Math.max(definition.dimensions.width, definition.dimensions.depth) : 1;
    this.effects.pulse(instance.mesh.position, Math.max(0.8, footprint * 0.6));
    this.effects.burst(instance.mesh.position, 6, 0.35);
  }

  /**
   * Group the ids one `instantiateTemplate` call just placed into reveal
   * waves (foundation, structure, openings, roof, details - see
   * `revealTierOf`) and start staging them in. Piece order within a wave is
   * whatever order they were created in - a safe, deterministic fallback
   * when several pieces share a tier.
   */
  private beginGroupReveal(ids: string[]): void {
    this.pendingGroupIds = [];
    // A new creation while the last one is still being staged in: show the
    // rest of that one at once, so none of its pieces is left hidden.
    this.finishReveal();
    const known = ids.filter((id) => this.instances.has(id));
    if (known.length === 0) return;

    const tiers = new Map<number, string[]>();
    const centroid = new THREE.Vector3();
    for (const id of known) {
      const instance = this.instances.get(id)!;
      const definition = this.registry.get(instance.source.definitionId);
      const tier = definition ? revealTierOf(definition) : 5;
      const list = tiers.get(tier) ?? [];
      list.push(id);
      tiers.set(tier, list);
      centroid.add(instance.mesh.position);
    }
    centroid.divideScalar(known.length);
    this.revealCentroid.copy(centroid);

    const orderedTiers = [...tiers.keys()].sort((a, b) => a - b);
    this.revealQueue = orderedTiers.map((tier, index) => ({
      ids: tiers.get(tier)!,
      startAt: index * REVEAL_WAVE_SECONDS,
      fired: false,
    }));
    this.revealClock = 0;
    this.revealFinaleFired = false;
    this.revealFinaleAt = (orderedTiers.length - 1) * REVEAL_WAVE_SECONDS + REVEAL_FINALE_DELAY;
  }

  /** Show every piece of an unfinished staged reveal immediately and end it. */
  private finishReveal(): void {
    for (const wave of this.revealQueue) {
      if (wave.fired) continue;
      wave.fired = true;
      for (const id of wave.ids) {
        const instance = this.instances.get(id);
        if (instance) instance.mesh.visible = true;
      }
    }
    this.revealQueue = [];
  }

  /** Advance the staged reveal: show each wave's pieces as its moment arrives, then the finale. */
  private tickReveal(deltaSeconds: number): void {
    if (this.revealQueue.length === 0) return;
    this.revealClock += deltaSeconds;

    for (const wave of this.revealQueue) {
      if (wave.fired || this.revealClock < wave.startAt) continue;
      wave.fired = true;
      const wavePosition = new THREE.Vector3();
      let found = 0;
      for (const id of wave.ids) {
        const instance = this.instances.get(id);
        if (!instance) continue;
        instance.mesh.visible = true;
        this.settling.set(id, { instance, elapsed: 0 });
        wavePosition.add(instance.mesh.position);
        found++;
      }
      if (found > 0) {
        wavePosition.divideScalar(found);
        this.effects.pulse(wavePosition, 1.2);
        this.effects.burst(wavePosition, 8, 0.6);
        window.dispatchEvent(new CustomEvent('eavara:placed', { detail: { instanceId: wave.ids[0], definitionId: null } }));
      }
    }

    if (!this.revealFinaleFired && this.revealClock >= this.revealFinaleAt) {
      this.revealFinaleFired = true;
      this.effects.pulse(this.revealCentroid, 2.2);
      this.effects.burst(this.revealCentroid, 16, 1.1);
      window.dispatchEvent(new CustomEvent('eavara:creation-complete'));
      this.revealQueue = [];
    }
  }

  /** Remove every mesh. Shared geometries/materials are left to `resources`. */
  clear(): void {
    for (const id of [...this.instances.keys()]) this.remove(id);
  }

  dispose(): void {
    window.removeEventListener('eavara:creation-start', this.onCreationStart);
    window.removeEventListener('eavara:creation-end', this.onCreationEnd);
    window.removeEventListener('eavara:silent-sync', this.onSilentSync);
    this.effects.dispose();
    this.clear();
    this.edgeMaterial.dispose();
    this.selectedEdgeMaterial.dispose();
    this.invalidEdgeMaterial.dispose();
    this.fadedEdgeMaterial.dispose();
    this.fadedMaterials.forEach((m) => m.dispose());
    this.fadedMaterials.clear();
    this.tintedMaterials.forEach((m) => m.dispose());
    this.tintedMaterials.clear();
    this.proxyMaterial.dispose();
    this.halo?.geometry.dispose();
    this.halo?.material.dispose();
    this.haloTexture?.dispose();
    this.halo = null;
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

  private create(placed: PlacedObject, silent = false): void {
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

    // Part of a live multi-piece creation in progress: held back, invisible,
    // until `beginGroupReveal` stages it in with the rest of its wave.
    if (!silent && this.liveCreationGroupId !== null && placed.group?.id === this.liveCreationGroupId) {
      mesh.visible = false;
      this.pendingGroupIds.push(placed.id);
    }
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
      if (instance.source.id === this.selectedId) this.placeHalo();
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
    this.settling.delete(id);
    if (this.halo?.parent === instance.mesh) {
      this.halo.removeFromParent();
      this.halo.visible = false;
    }
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
      // shows a ground halo (placeHalo); interior readability fades the
      // model's own materials.
      instance.mesh.material = this.proxyMaterial;
      instance.edges.visible = false;
      const faded = this.fadedIds.has(id) && id !== this.selectedId;
      // A colour the child chose paints the whole model (shared materials are never changed).
      const tint = overrideColor(instance.source);
      instance.visual.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        const base = (mesh.userData.baseMaterial as THREE.MeshStandardMaterial | undefined) ?? (mesh.material as THREE.MeshStandardMaterial);
        mesh.userData.baseMaterial = base;
        const painted = tint ? this.tintedMaterialFor(base, tint) : base;
        mesh.material = faded ? this.fadedMaterialFor(painted) : painted;
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

  /**
   * A 3D model's material painted one flat colour: the palette texture is
   * dropped so the chosen colour shows as chosen (a white cupboard really is
   * white), roughness and metalness are kept. Cached per material and colour.
   */
  private tintedMaterialFor(base: THREE.MeshStandardMaterial, color: string): THREE.MeshStandardMaterial {
    const key = `${base.uuid}|${color}`;
    let tinted = this.tintedMaterials.get(key);
    if (!tinted) {
      tinted = cloneMaterial(base);
      tinted.map = null;
      tinted.color = new THREE.Color(color);
      tinted.needsUpdate = true;
      this.tintedMaterials.set(key, tinted);
    }
    return tinted;
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
