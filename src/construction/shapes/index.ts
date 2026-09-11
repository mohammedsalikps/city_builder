import type * as THREE from 'three';
import {
  partColor,
  shapeOf,
  type ConstructionObjectDefinition,
  type ShapeId,
} from '../ConstructionObjectDefinition';
import { PartList, box, cone, cylinder, gablePrism, sphere } from './PartList';

type ShapeBuilder = (definition: ConstructionObjectDefinition) => THREE.BufferGeometry;

const DARK_WOOD = '#4a3323';
const METAL = '#6b7280';
const GLASS = '#a7d8f0';
const RUBBER = '#1f2326';

/**
 * One builder per ShapeId. Every builder reads only the definition's
 * dimensions and colours, so the same recipe serves any number of catalogue
 * entries (a 2 m wall and a 4 m wall are both 'box').
 *
 * Coordinate convention: X = width, Y = height (up), Z = depth; the shape's
 * bottom-centre is at the origin and everything stays inside the dimensions.
 */
const BUILDERS: Record<ShapeId, ShapeBuilder> = {
  box(d) {
    const { width: w, height: h, depth: dp } = d.dimensions;
    return new PartList().add(box(w, h, dp), d.color, { y: h / 2 }).build();
  },

  cylinder(d) {
    const { width: w, height: h, depth: dp } = d.dimensions;
    const r = Math.min(w, dp) / 2;
    return new PartList().add(cylinder(r, h, 24), d.color, { y: h / 2 }).build();
  },

  'roof-gable'(d) {
    // Two tiled slabs on rendered gable ends with a ridge cap, all inside
    // the gameplay box (the slabs' top faces are the old prism's slopes).
    const { width: w, height: h, depth: dp } = d.dimensions;
    const gable = partColor(d, 'gable', '#e5dccb');
    const ridge = partColor(d, 'ridge', '#7a2f22');
    const t = Math.min(0.14, h * 0.15);
    const half = w / 2;
    const slope = Math.hypot(half, h);
    const angle = Math.atan2(h, half);
    const parts = new PartList().add(gablePrism(w * 0.97, h * 0.97, dp * 0.96), gable);
    for (const side of [1, -1]) {
      const nx = (side * h) / slope;
      const ny = half / slope;
      parts.add(box(slope, t, dp), d.color, { rotZ: -side * angle, x: (side * half) / 2 - (nx * t) / 2, y: h / 2 - (ny * t) / 2 });
    }
    parts.add(box(0.14, 0.08, dp), ridge, { y: h - 0.05 });
    return parts.build();
  },

  stairs(d) {
    const { width: w, height: h, depth: dp } = d.dimensions;
    const steps = Math.max(2, Math.round(h / 0.18));
    const parts = new PartList();
    const stepDepth = dp / steps;
    for (let i = 0; i < steps; i++) {
      const stepHeight = (h * (i + 1)) / steps;
      parts.add(box(w, stepHeight, stepDepth), d.color, {
        y: stepHeight / 2,
        z: -dp / 2 + stepDepth * (i + 0.5),
      });
    }
    return parts.build();
  },

  door(d) {
    const { width: w, height: h, depth: dp } = d.dimensions;
    const frame = partColor(d, 'frame', DARK_WOOD);
    const t = 0.05;
    return new PartList()
      .add(box(t, h, dp), frame, { x: -w / 2 + t / 2, y: h / 2 })
      .add(box(t, h, dp), frame, { x: w / 2 - t / 2, y: h / 2 })
      .add(box(w, t, dp), frame, { y: h - t / 2 })
      .add(box(w - 2 * t, h - t, dp * 0.6), d.color, { y: (h - t) / 2 })
      .add(sphere(0.03), partColor(d, 'handle', METAL), { x: w / 2 - 0.15, y: h * 0.48, z: dp / 2 - 0.03 })
      .build();
  },

  window(d) {
    const { width: w, height: h, depth: dp } = d.dimensions;
    const frame = partColor(d, 'frame', '#f3f4f6');
    const glass = partColor(d, 'glass', GLASS);
    const t = 0.06;
    return new PartList()
      .add(box(t, h, dp), frame, { x: -w / 2 + t / 2, y: h / 2 })
      .add(box(t, h, dp), frame, { x: w / 2 - t / 2, y: h / 2 })
      .add(box(w, t, dp), frame, { y: t / 2 })
      .add(box(w, t, dp), frame, { y: h - t / 2 })
      .add(box(w - 2 * t, h - 2 * t, dp * 0.3), glass, { y: h / 2 })
      .add(box(0.04, h - 2 * t, dp * 0.5), frame, { y: h / 2 })
      .add(box(w - 2 * t, 0.04, dp * 0.5), frame, { y: h / 2 })
      .build();
  },

  tree(d) {
    const { width: w, height: h, depth: dp } = d.dimensions;
    const trunk = partColor(d, 'trunk', '#6b4a2b');
    const radius = Math.min(w, dp) / 2;
    return new PartList()
      .add(cylinder(radius * 0.16, h * 0.35, 12), trunk, { y: h * 0.175 })
      .add(cone(radius, h * 0.4), d.color, { y: h * 0.3 + h * 0.2 })
      .add(cone(radius * 0.72, h * 0.45), d.color, { y: h * 0.55 + h * 0.225 })
      .build();
  },

  bush(d) {
    const { width: w, height: h, depth: dp } = d.dimensions;
    const r = Math.min(h, Math.min(w, dp) * 0.6) / 2;
    return new PartList()
      .add(sphere(r), d.color, { y: r })
      .add(sphere(r * 0.85), d.color, { x: -w / 2 + r * 0.85, y: r * 0.85 })
      .add(sphere(r * 0.85), d.color, { x: w / 2 - r * 0.85, y: r * 0.85, z: dp * 0.1 })
      .build();
  },

  flower(d) {
    const { width: w, height: h } = d.dimensions;
    const stem = partColor(d, 'stem', '#3f8f3a');
    const head = w * 0.35;
    return new PartList()
      .add(cylinder(0.012, h - head, 8), stem, { y: (h - head) / 2 })
      .add(sphere(head), d.color, { y: h - head })
      .build();
  },

  fence(d) {
    const { width: w, height: h, depth: dp } = d.dimensions;
    const post = 0.08;
    const parts = new PartList();
    for (const x of [-w / 2 + post / 2, 0, w / 2 - post / 2]) {
      parts.add(box(post, h, post), d.color, { x, y: h / 2 });
    }
    parts.add(box(w, 0.08, dp * 0.4), d.color, { y: h * 0.4 });
    parts.add(box(w, 0.08, dp * 0.4), d.color, { y: h * 0.8 });
    return parts.build();
  },

  streetlight(d) {
    const { width: w, height: h } = d.dimensions;
    const pole = partColor(d, 'pole', METAL);
    const poleHeight = h * 0.95;
    const lampHeight = 0.12;
    return new PartList()
      .add(cylinder(0.05, poleHeight, 12), pole, { x: -w / 2 + 0.05, y: poleHeight / 2 })
      .add(box(w - 0.1, 0.06, 0.06), pole, { y: poleHeight - 0.03 })
      .add(box(0.3, lampHeight, 0.2), d.color, { x: w / 2 - 0.15, y: poleHeight - 0.06 - lampHeight / 2 })
      .build();
  },

  road(d) {
    const { width: w, height: h, depth: dp } = d.dimensions;
    const marking = partColor(d, 'marking', '#f5f0dc');
    const parts = new PartList().add(box(w, h, dp), d.color, { y: h / 2 });
    const dashes = 3;
    const dashLength = dp / (dashes * 2);
    for (let i = 0; i < dashes; i++) {
      parts.add(box(0.12, 0.006, dashLength), marking, {
        y: h - 0.003,
        z: -dp / 2 + dashLength * (2 * i + 1),
      });
    }
    return parts.build();
  },

  sidewalk(d) {
    const { width: w, height: h, depth: dp } = d.dimensions;
    const kerb = partColor(d, 'kerb', '#8a8f96');
    return new PartList()
      .add(box(w, h * 0.8, dp), d.color, { y: h * 0.4 })
      .add(box(w, h, 0.15), kerb, { y: h / 2, z: -dp / 2 + 0.075 })
      .build();
  },

  car(d) {
    const { width: w, height: h, depth: dp } = d.dimensions;
    const glass = partColor(d, 'glass', GLASS);
    const wheel = partColor(d, 'wheel', RUBBER);
    const r = Math.min(0.32, h * 0.22);
    const bodyBottom = r * 0.9;
    const bodyHeight = h * 0.38;
    const cabinHeight = h - bodyBottom - bodyHeight;
    const parts = new PartList()
      .add(box(w, bodyHeight, dp * 0.92), d.color, { y: bodyBottom + bodyHeight / 2 })
      .add(box(w * 0.82, cabinHeight, dp * 0.42), glass, {
        y: bodyBottom + bodyHeight + cabinHeight / 2,
        z: -dp * 0.04,
      });
    for (const x of [-w / 2 + 0.12, w / 2 - 0.12]) {
      for (const z of [-dp * 0.3, dp * 0.3]) {
        parts.add(cylinder(r, 0.2, 16), wheel, { rotZ: Math.PI / 2, x, y: r, z });
      }
    }
    return parts.build();
  },

  chair(d) {
    const { width: w, height: h, depth: dp } = d.dimensions;
    const seatHeight = Math.min(0.45, h * 0.5);
    const leg = 0.04;
    const parts = new PartList().add(box(w, 0.05, dp), d.color, { y: seatHeight - 0.025 });
    for (const x of [-w / 2 + leg / 2, w / 2 - leg / 2]) {
      for (const z of [-dp / 2 + leg / 2, dp / 2 - leg / 2]) {
        parts.add(box(leg, seatHeight - 0.05, leg), d.color, { x, y: (seatHeight - 0.05) / 2, z });
      }
    }
    parts.add(box(w, h - seatHeight, 0.05), d.color, { y: seatHeight + (h - seatHeight) / 2, z: -dp / 2 + 0.025 });
    return parts.build();
  },

  table(d) {
    const { width: w, height: h, depth: dp } = d.dimensions;
    const leg = 0.06;
    const parts = new PartList().add(box(w, 0.05, dp), d.color, { y: h - 0.025 });
    for (const x of [-w / 2 + leg / 2, w / 2 - leg / 2]) {
      for (const z of [-dp / 2 + leg / 2, dp / 2 - leg / 2]) {
        parts.add(box(leg, h - 0.05, leg), d.color, { x, y: (h - 0.05) / 2, z });
      }
    }
    return parts.build();
  },

  bed(d) {
    const { width: w, height: h, depth: dp } = d.dimensions;
    const mattress = partColor(d, 'mattress', '#f3f0e8');
    const pillow = partColor(d, 'pillow', '#ffffff');
    const baseHeight = Math.min(0.25, h * 0.5);
    return new PartList()
      .add(box(w, baseHeight, dp), d.color, { y: baseHeight / 2 })
      .add(box(w - 0.1, 0.18, dp - 0.1), mattress, { y: baseHeight + 0.09 })
      .add(box(w * 0.5, 0.1, 0.35), pillow, { y: baseHeight + 0.18 + 0.05, z: -dp / 2 + 0.3 })
      .add(box(w, h, 0.05), d.color, { y: h / 2, z: -dp / 2 + 0.025 })
      .build();
  },

  sofa(d) {
    const { width: w, height: h, depth: dp } = d.dimensions;
    const seatHeight = Math.min(0.4, h * 0.5);
    return new PartList()
      .add(box(w, seatHeight, dp), d.color, { y: seatHeight / 2 })
      .add(box(w, h - seatHeight, 0.2), d.color, { y: seatHeight + (h - seatHeight) / 2, z: -dp / 2 + 0.1 })
      .add(box(0.15, 0.25, dp), d.color, { x: -w / 2 + 0.075, y: seatHeight + 0.125 })
      .add(box(0.15, 0.25, dp), d.color, { x: w / 2 - 0.075, y: seatHeight + 0.125 })
      .build();
  },
};

/** Build the (unshared, freshly allocated) geometry for a definition. */
export function buildShapeGeometry(definition: ConstructionObjectDefinition): THREE.BufferGeometry {
  const builder = BUILDERS[shapeOf(definition)];
  const geometry = builder(definition);
  geometry.name = `shape:${definition.id}`;
  return geometry;
}
