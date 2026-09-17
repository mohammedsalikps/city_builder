import * as THREE from 'three';
import type { AssetLibrary } from '../assets/AssetLibrary';
import type { AssetRegistry } from '../assets/AssetRegistry';

/**
 * How far away (from the camera, in 3D) a piece of scenery stays drawn.
 * Buildings and roads carry the skyline and are always drawn; trees thin
 * out at the far edge of the haze; vehicles, lamps and poles at a street's
 * length; small props (benches, flowers, crates) only matter up close.
 */
export type SceneryDetail = 'far' | 'mid' | 'small' | 'near';

export interface SceneryPiece {
  asset: string;
  x: number;
  y: number;
  z: number;
  /** Radians. */
  rotationY: number;
  scale: number;
  detail: SceneryDetail;
  /** Alternative colour atlas (see AssetDefinition.palettes). */
  palette?: string;
  /**
   * Soft scenery (trees, plants, small props, parked cars) that gives way
   * when the child builds on top of it; its ground footprint.
   */
  clearable?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const DETAIL_DISTANCE: Record<SceneryDetail, number> = { far: Infinity, mid: 820, small: 210, near: 150 };
/** Re-evaluate distance visibility once the camera has moved this far. */
const REFRESH_DISTANCE = 12;

interface Batch {
  mesh: THREE.BatchedMesh;
  geometryIds: Map<string, number>;
}

interface Tracked {
  batch: THREE.BatchedMesh;
  instance: number;
  x: number;
  z: number;
  range: number;
  inRange: boolean;
  cleared: boolean;
  visible: boolean;
}

/**
 * Turns thousands of static scenery pieces into a handful of draw calls.
 *
 *   piece --asset parts--> BatchedMesh per shared material
 *
 * Kenney kits sample one colour atlas per pack, so every model of a pack can
 * share one batch: the whole world is drawn with a few dozen BatchedMeshes,
 * each culling its own instances against the camera (and the shadow camera).
 * Small props are hidden beyond a distance. Purely visual: never raycast.
 */
export class SceneryBatcher {
  readonly root = new THREE.Group();
  private readonly batches = new Map<string, Batch>();
  private readonly tracked: Tracked[] = [];
  /** Tracked instances of each clearable piece, by piece index. */
  private readonly byPiece = new Map<number, Tracked[]>();
  private readonly lastRefresh = new THREE.Vector3(Infinity, 0, 0);
  private instanceCount = 0;

  constructor(
    private readonly assets: AssetLibrary,
    private readonly registry: AssetRegistry,
  ) {
    this.root.name = 'scenery-batches';
  }

  get stats(): { batches: number; instances: number; tracked: number } {
    return { batches: this.batches.size, instances: this.instanceCount, tracked: this.tracked.length };
  }

  /** Build every batch in one go (assets must already be loaded). */
  build(pieces: SceneryPiece[]): void {
    // Pass 1: size each batch.
    const plans = new Map<string, { material: THREE.Material; castShadow: boolean; instances: number; geometries: Map<string, THREE.BufferGeometry> }>();
    const partsByAsset = new Map<string, ReturnType<AssetLibrary['parts']>>();
    const keysByAsset = new Map<string, string[]>();
    const look = (piece: SceneryPiece) => `${piece.asset}|${piece.palette ?? ''}`;
    for (const piece of pieces) {
      let parts = partsByAsset.get(look(piece));
      if (!parts) {
        parts = this.assets.parts(piece.asset, piece.palette);
        partsByAsset.set(look(piece), parts);
        keysByAsset.set(look(piece), parts.map((part) => this.batchKey(piece.asset, part.geometry, part.material, piece.palette)));
      }
      const keys = keysByAsset.get(look(piece))!;
      parts.forEach((part, i) => {
        let plan = plans.get(keys[i]);
        if (!plan) plans.set(keys[i], (plan = { material: part.material, castShadow: part.castShadow, instances: 0, geometries: new Map() }));
        plan.instances++;
        plan.geometries.set(part.geometry.uuid, part.geometry);
      });
    }

    for (const [key, plan] of plans) {
      let vertices = 0;
      let indices = 0;
      for (const geometry of plan.geometries.values()) {
        vertices += geometry.getAttribute('position').count;
        indices += geometry.index?.count ?? 0;
      }
      const mesh = new THREE.BatchedMesh(plan.instances, vertices, indices, plan.material);
      mesh.name = `batch:${key}`;
      mesh.castShadow = plan.castShadow;
      mesh.receiveShadow = true;
      mesh.sortObjects = false;
      mesh.perObjectFrustumCulled = true;
      mesh.frustumCulled = false;
      mesh.raycast = () => {};
      const geometryIds = new Map<string, number>();
      for (const [uuid, geometry] of plan.geometries) geometryIds.set(uuid, mesh.addGeometry(geometry));
      this.batches.set(key, { mesh, geometryIds });
      this.root.add(mesh);
    }

    // Pass 2: instances.
    const pieceMatrix = new THREE.Matrix4();
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    pieces.forEach((piece, index) => {
      const parts = partsByAsset.get(look(piece))!;
      const keys = keysByAsset.get(look(piece))!;
      quaternion.setFromAxisAngle(up, piece.rotationY);
      pieceMatrix.compose(position.set(piece.x, piece.y, piece.z), quaternion, scale.setScalar(piece.scale));
      const range = DETAIL_DISTANCE[piece.detail];
      parts.forEach((part, i) => {
        const batch = this.batches.get(keys[i])!;
        const instance = batch.mesh.addInstance(batch.geometryIds.get(part.geometry.uuid)!);
        batch.mesh.setMatrixAt(instance, matrix.multiplyMatrices(pieceMatrix, part.matrix));
        this.instanceCount++;
        if (!Number.isFinite(range) && !piece.clearable) return;
        const tracked: Tracked = { batch: batch.mesh, instance, x: piece.x, z: piece.z, range, inRange: true, cleared: false, visible: true };
        this.tracked.push(tracked);
        if (piece.clearable) {
          let list = this.byPiece.get(index);
          if (!list) this.byPiece.set(index, (list = []));
          list.push(tracked);
        }
      });
    });
    this.lastRefresh.set(Infinity, 0, 0);
  }

  /** Hide small, distant pieces; cheap, and only when the camera has moved. */
  update(camera: THREE.Camera): void {
    const p = camera.position;
    if (this.lastRefresh.distanceTo(p) < REFRESH_DISTANCE) return;
    this.lastRefresh.copy(p);
    const height2 = p.y * p.y;
    for (const t of this.tracked) {
      const dx = t.x - p.x;
      const dz = t.z - p.z;
      t.inRange = dx * dx + dz * dz + height2 < t.range * t.range;
      this.apply(t);
    }
  }

  /** Hide (or bring back) a clearable piece. */
  setCleared(pieceIndex: number, cleared: boolean): void {
    for (const t of this.byPiece.get(pieceIndex) ?? []) {
      t.cleared = cleared;
      this.apply(t);
    }
  }

  private apply(t: Tracked): void {
    const visible = t.inRange && !t.cleared;
    if (visible === t.visible) return;
    t.visible = visible;
    t.batch.setVisibleAt(t.instance, visible);
  }

  dispose(): void {
    this.batches.forEach(({ mesh }) => mesh.dispose());
    this.batches.clear();
    this.tracked.length = 0;
    this.byPiece.clear();
    this.root.clear();
  }

  /**
   * Parts share a batch when they look identical (same pack atlas or same
   * flat colour) and have the same vertex layout.
   */
  private batchKey(assetId: string, geometry: THREE.BufferGeometry, material: THREE.Material, palette?: string): string {
    const m = material as THREE.MeshStandardMaterial;
    const path = this.registry.get(assetId)?.path ?? assetId;
    const folder = path.slice(0, path.lastIndexOf('/'));
    const attributes = Object.keys(geometry.attributes)
      .sort()
      .map((name) => `${name}${geometry.getAttribute(name).itemSize}`)
      .join(',');
    return [
      m.map ? `${folder}/${palette ?? 'colormap'}` : 'flat',
      m.name,
      m.color?.getHexString() ?? '',
      m.map ? 'tex' : '',
      m.transparent ? 't' : '',
      m.vertexColors ? 'vc' : '',
      m.side,
      m.roughness?.toFixed(2),
      m.metalness?.toFixed(2),
      attributes,
      geometry.index ? 'i' : 'n',
    ].join('|');
  }
}
