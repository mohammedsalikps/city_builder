import * as THREE from 'three';
import type { ConstructionObjectDefinition } from './ConstructionObjectDefinition';
import { buildShapeGeometry } from './shapes';
import type { MaterialLibrary } from '@/visual/materials/MaterialLibrary';

/** Cache key for the shared vertex-colour material. */
const VERTEX_COLOR_KEY = '__vertex__';

/** Edge lines are only drawn where faces meet at more than this angle. */
const EDGE_THRESHOLD_DEGREES = 25;

/**
 * Shared GPU resources for construction rendering, cached per definition.
 *
 * Every placed instance of the same definition shares one geometry, one edge
 * geometry and one material, so placing hundreds of objects does not create
 * hundreds of GPU buffers. Because resources are shared, individual meshes
 * must NOT dispose them; `dispose()` here releases everything at once.
 *
 * Geometries carry per-vertex colours produced by the shape builders, so a
 * single vertex-colour material renders the whole catalogue. Materials keyed
 * by a hex colour exist for per-instance colour overrides.
 */
export class ConstructionResources {
  private geometries = new Map<string, THREE.BufferGeometry>();
  private edges = new Map<string, THREE.EdgesGeometry>();
  private materials = new Map<string, THREE.MeshStandardMaterial>();

  /** With a library, objects get textured PBR materials by their catalogue `material`. */
  constructor(private readonly library: MaterialLibrary | null = null) {}

  /** Merged, vertex-coloured geometry for the definition's shape (unit scale). */
  getGeometry(definition: ConstructionObjectDefinition): THREE.BufferGeometry {
    let geometry = this.geometries.get(definition.id);
    if (!geometry) {
      geometry = buildShapeGeometry(definition);
      this.geometries.set(definition.id, geometry);
    }
    return geometry;
  }

  getEdges(definition: ConstructionObjectDefinition): THREE.EdgesGeometry {
    let edges = this.edges.get(definition.id);
    if (!edges) {
      edges = new THREE.EdgesGeometry(this.getGeometry(definition), EDGE_THRESHOLD_DEGREES);
      this.edges.set(definition.id, edges);
    }
    return edges;
  }

  /**
   * Material for a placed object. A hex string = a flat colour override;
   * otherwise the library's textured material for the definition's catalogue
   * material (vertex colours still give the hue), or the plain shared
   * vertex-colour material.
   */
  getMaterial(colorOverride: string | null, definition?: ConstructionObjectDefinition): THREE.MeshStandardMaterial {
    if (!colorOverride && definition && this.library) {
      const id = this.library.constructionMaterialId(definition.material);
      if (id) return this.library.forConstruction(id);
    }
    const key = colorOverride ?? VERTEX_COLOR_KEY;
    let material = this.materials.get(key);
    if (!material) {
      material = colorOverride
        ? new THREE.MeshStandardMaterial({ color: new THREE.Color(colorOverride), roughness: 0.85 })
        : new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85 });
      this.materials.set(key, material);
    }
    return material;
  }

  dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.edges.forEach((e) => e.dispose());
    this.materials.forEach((m) => m.dispose());
    this.geometries.clear();
    this.edges.clear();
    this.materials.clear();
  }

  /** For diagnostics: number of cached resources. */
  get stats(): { geometries: number; edges: number; materials: number } {
    return { geometries: this.geometries.size, edges: this.edges.size, materials: this.materials.size };
  }
}
