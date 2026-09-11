import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface PartTransform {
  x?: number;
  y?: number;
  z?: number;
  /** Rotations in radians, applied before translation. */
  rotX?: number;
  rotY?: number;
  rotZ?: number;
}

/**
 * Collects coloured geometry parts and merges them into ONE BufferGeometry
 * with a per-vertex colour attribute.
 *
 * One geometry per definition keeps the rest of the engine simple: one mesh
 * per placed object, one raycast target, one shared geometry in the cache.
 * Colours travel in the geometry, so a single vertex-colour material renders
 * every catalogue item, while preview/blueprint materials (which ignore vertex
 * colours) still get a uniform tint.
 */
export class PartList {
  private readonly parts: THREE.BufferGeometry[] = [];
  private readonly color = new THREE.Color();

  add(geometry: THREE.BufferGeometry, color: string, transform: PartTransform = {}): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();

    if (transform.rotX) g.rotateX(transform.rotX);
    if (transform.rotY) g.rotateY(transform.rotY);
    if (transform.rotZ) g.rotateZ(transform.rotZ);
    g.translate(transform.x ?? 0, transform.y ?? 0, transform.z ?? 0);

    this.paint(g, color);
    this.parts.push(g);
    return this;
  }

  /** Merge all parts. The part geometries are disposed; the result is owned by the caller. */
  build(): THREE.BufferGeometry {
    if (this.parts.length === 0) {
      throw new Error('PartList.build() called with no parts');
    }
    const merged = mergeGeometries(this.parts, false);
    if (!merged) {
      throw new Error('Failed to merge shape parts (attribute mismatch)');
    }
    this.parts.forEach((p) => p.dispose());
    this.parts.length = 0;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }

  private paint(geometry: THREE.BufferGeometry, color: string): void {
    this.color.set(color);
    const count = geometry.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = this.color.r;
      colors[i * 3 + 1] = this.color.g;
      colors[i * 3 + 2] = this.color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // Extruded shapes carry no uv2/other extras; make attribute sets uniform.
    for (const name of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(name)) geometry.deleteAttribute(name);
    }
    if (!geometry.getAttribute('uv')) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  }
}

// Small geometry helpers shared by the shape builders. All are centred at the
// origin; builders position them with PartTransform.

export function box(w: number, h: number, d: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

export function cylinder(radius: number, height: number, segments = 20): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(radius, radius, height, segments);
}

export function cone(radius: number, height: number, segments = 16): THREE.ConeGeometry {
  return new THREE.ConeGeometry(radius, height, segments);
}

export function sphere(radius: number): THREE.SphereGeometry {
  return new THREE.SphereGeometry(radius, 14, 10);
}

/**
 * Triangular prism: an isoceles triangle of base `width` and height `height`
 * extruded along Z by `depth`, centred on X/Z with its base at y = 0.
 */
export function gablePrism(width: number, height: number, depth: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, height);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}
