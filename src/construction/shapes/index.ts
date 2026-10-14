import type * as THREE from 'three';
import {
  partColor,
  shapeOf,
  type ConstructionObjectDefinition,
  type ShapeId,
} from '../ConstructionObjectDefinition';
import { PartList, box, cone, cylinder, gablePrism, sphere } from './PartList';
import { WALL_VISUAL_THICKNESS } from '../constants';

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
    // The gameplay box can be thinner than the wall it sits in (collision
    // only cares about width/height); the visual frame fills the wall's
    // full thickness so the door reads flush on both faces, not recessed.
    const visualDp = Math.max(dp, WALL_VISUAL_THICKNESS);
    const frame = partColor(d, 'frame', DARK_WOOD);
    const t = 0.05;
    return new PartList()
      .add(box(t, h, visualDp), frame, { x: -w / 2 + t / 2, y: h / 2 })
      .add(box(t, h, visualDp), frame, { x: w / 2 - t / 2, y: h / 2 })
      .add(box(w, t, visualDp), frame, { y: h - t / 2 })
      .add(box(w - 2 * t, h - t, visualDp * 0.75), d.color, { y: (h - t) / 2 })
      .add(sphere(0.03), partColor(d, 'handle', METAL), { x: w / 2 - 0.15, y: h * 0.48, z: visualDp / 2 - 0.03 })
      .build();
  },

  window(d) {
    const { width: w, height: h, depth: dp } = d.dimensions;
    const visualDp = Math.max(dp, WALL_VISUAL_THICKNESS);
    const frame = partColor(d, 'frame', '#f3f4f6');
    const glass = partColor(d, 'glass', GLASS);
    const sill = partColor(d, 'sill', '#e7e5df');
    const t = 0.06;
    return new PartList()
      .add(box(t, h, visualDp), frame, { x: -w / 2 + t / 2, y: h / 2 })
      .add(box(t, h, visualDp), frame, { x: w / 2 - t / 2, y: h / 2 })
      .add(box(w, t, visualDp), frame, { y: t / 2 })
      .add(box(w, t, visualDp), frame, { y: h - t / 2 })
      .add(box(w - 2 * t, h - 2 * t, visualDp * 0.55), glass, { y: h / 2 })
      .add(box(0.04, h - 2 * t, visualDp * 0.7), frame, { y: h / 2 })
      .add(box(w - 2 * t, 0.04, visualDp * 0.7), frame, { y: h / 2 })
      // A small sill proud of the wall face reads as a real window ledge.
      .add(box(w + 0.1, 0.03, visualDp * 0.4 + 0.06), sill, { y: 0.015 })
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

  wardrobe(d) {
    // Front (doors) towards +Z, like every piece of furniture with a front.
    const { width: w, height: h, depth: dp } = d.dimensions;
    const door = partColor(d, 'door', '#d9c4a3');
    const handle = partColor(d, 'handle', METAL);
    const parts = new PartList().add(box(w, h, dp - 0.02), d.color, { y: h / 2, z: -0.01 });
    for (const side of [-1, 1]) {
      parts.add(box(w / 2 - 0.04, h - 0.12, 0.02), door, { x: (side * w) / 4, y: h / 2, z: dp / 2 - 0.01 });
      parts.add(box(0.02, 0.18, 0.012), handle, { x: side * 0.05, y: h * 0.52, z: dp / 2 - 0.008 });
    }
    return parts.build();
  },

  counter(d) {
    // Kitchen cabinets with a worktop, a sink and two hob rings; doors towards +Z.
    const { width: w, height: h, depth: dp } = d.dimensions;
    const top = partColor(d, 'top', '#e3ddd1');
    const door = partColor(d, 'door', '#f4f1ea');
    const steel = partColor(d, 'sink', '#9aa3ab');
    const hob = partColor(d, 'hob', '#26292c');
    const doors = Math.max(2, Math.round(w / 0.5));
    const parts = new PartList()
      .add(box(w, h - 0.04, dp - 0.04), d.color, { y: (h - 0.04) / 2, z: -0.02 })
      .add(box(w, 0.035, dp), top, { y: h - 0.04 + 0.0175 });
    for (let i = 0; i < doors; i++) {
      parts.add(box(w / doors - 0.03, h - 0.16, 0.015), door, { x: -w / 2 + (w / doors) * (i + 0.5), y: (h - 0.04) / 2, z: dp / 2 - 0.04 + 0.0075 });
    }
    parts.add(box(Math.min(0.45, w * 0.25), 0.01, dp * 0.55), steel, { x: -w / 4, y: h - 0.005 });
    for (const x of [w / 4 - 0.11, w / 4 + 0.11]) parts.add(cylinder(0.08, 0.01, 18), hob, { x, y: h - 0.005 });
    return parts.build();
  },

  bathtub(d) {
    // A hollow tub, long side along X, with water inside and a tap at one end.
    const { width: w, height: h, depth: dp } = d.dimensions;
    const water = partColor(d, 'water', '#9fd3e6');
    const tap = partColor(d, 'tap', METAL);
    const t = 0.08;
    return new PartList()
      .add(box(w, h * 0.35, dp), d.color, { y: h * 0.175 })
      .add(box(w, h * 0.65, t), d.color, { y: h * 0.35 + h * 0.325, z: dp / 2 - t / 2 })
      .add(box(w, h * 0.65, t), d.color, { y: h * 0.35 + h * 0.325, z: -dp / 2 + t / 2 })
      .add(box(t, h * 0.65, dp - 2 * t), d.color, { x: w / 2 - t / 2, y: h * 0.35 + h * 0.325 })
      .add(box(t, h * 0.65, dp - 2 * t), d.color, { x: -w / 2 + t / 2, y: h * 0.35 + h * 0.325 })
      .add(box(w - 2 * t, 0.02, dp - 2 * t), water, { y: h * 0.6 })
      .add(box(0.05, 0.05, 0.05), tap, { x: -w / 2 + t / 2, y: h - 0.025 })
      .build();
  },

  toilet(d) {
    // Cistern at the back (-Z), bowl and seat towards +Z.
    const { width: w, height: h, depth: dp } = d.dimensions;
    const seat = partColor(d, 'seat', '#e9e6df');
    const bowlRadius = Math.min(w / 2, dp / 3) * 0.95;
    return new PartList()
      .add(box(w * 0.6, h * 0.55, 0.16), d.color, { y: h * 0.275, z: -dp / 2 + 0.09 })
      .add(box(w, h * 0.45, 0.18), d.color, { y: h * 0.775, z: -dp / 2 + 0.09 })
      .add(cylinder(bowlRadius, 0.4, 20), d.color, { y: 0.2, z: dp / 2 - bowlRadius - 0.02 })
      .add(box(w * 0.95, 0.03, bowlRadius * 2), seat, { y: 0.415, z: dp / 2 - bowlRadius - 0.02 })
      .build();
  },

  basin(d) {
    // A washbasin on a pedestal; the bowl is the box top, water shows inside.
    const { width: w, height: h, depth: dp } = d.dimensions;
    const water = partColor(d, 'water', '#9fd3e6');
    return new PartList()
      .add(cylinder(0.08, h * 0.8, 16), d.color, { y: h * 0.4, z: -0.05 })
      .add(box(w, 0.14, dp - 0.05), d.color, { y: h - 0.08 })
      .add(box(w * 0.7, 0.012, dp * 0.5), water, { y: h - 0.006 })
      .build();
  },

  flowerbed(d) {
    // A timber-edged bed of soil planted with rows of flowers in three colours.
    const { width: w, height: h, depth: dp } = d.dimensions;
    const soil = partColor(d, 'soil', '#5b3d27');
    const stem = partColor(d, 'stem', '#3f8f3a');
    const blooms = [partColor(d, 'flowerA', '#f06292'), partColor(d, 'flowerB', '#ffd54f'), partColor(d, 'flowerC', '#ba68c8')];
    const t = 0.08;
    const edge = Math.min(0.22, h * 0.6);
    const parts = new PartList()
      .add(box(w, edge, t), d.color, { y: edge / 2, z: dp / 2 - t / 2 })
      .add(box(w, edge, t), d.color, { y: edge / 2, z: -dp / 2 + t / 2 })
      .add(box(t, edge, dp - 2 * t), d.color, { x: w / 2 - t / 2, y: edge / 2 })
      .add(box(t, edge, dp - 2 * t), d.color, { x: -w / 2 + t / 2, y: edge / 2 })
      .add(box(w - 2 * t, edge * 0.8, dp - 2 * t), soil, { y: edge * 0.4 });
    const across = Math.max(2, Math.round((w - 2 * t) / 0.32));
    const rows = Math.max(1, Math.round((dp - 2 * t) / 0.32));
    const head = 0.055;
    const stemHeight = h - head - edge * 0.8;
    for (let i = 0; i < across; i++) {
      for (let j = 0; j < rows; j++) {
        const x = -w / 2 + t + ((w - 2 * t) * (i + 0.5)) / across;
        const z = -dp / 2 + t + ((dp - 2 * t) * (j + 0.5)) / rows;
        parts.add(cylinder(0.01, stemHeight, 6), stem, { x, y: edge * 0.8 + stemHeight / 2, z });
        parts.add(sphere(head), blooms[(i + j) % blooms.length], { x, y: h - head, z });
      }
    }
    return parts.build();
  },

  deck(d) {
    // Timber planks with small gaps, running front to back.
    const { width: w, height: h, depth: dp } = d.dimensions;
    const planks = Math.max(3, Math.round(w / 0.2));
    const parts = new PartList();
    for (let i = 0; i < planks; i++) {
      parts.add(box(w / planks - 0.015, h, dp), i % 2 === 0 ? d.color : partColor(d, 'plank', d.color), { x: -w / 2 + (w / planks) * (i + 0.5), y: h / 2 });
    }
    return parts.build();
  },

  ladder(d) {
    // A leaning ladder: feet at +Z, top against whatever it climbs at -Z.
    // The rungs stop 0.9 m below the top; the rails rise on as handholds.
    const { width: w, height: h, depth: dp } = d.dimensions;
    const run = dp - 0.1;
    const lean = Math.atan2(run, h);
    const rail = Math.hypot(h, run) - 0.02;
    const parts = new PartList();
    for (const side of [-1, 1]) parts.add(box(0.06, rail, 0.06), d.color, { rotX: -lean, x: side * (w / 2 - 0.03), y: h / 2 });
    for (let y = 0.3; y <= h - 0.95; y += 0.3) {
      parts.add(box(w - 0.06, 0.04, 0.05), d.color, { y, z: run / 2 - (y / h) * run });
    }
    return parts.build();
  },

  slide(d) {
    // Ladder and platform at the back (-Z), the chute running down to the front.
    const { width: w, height: h, depth: dp } = d.dimensions;
    const frame = partColor(d, 'frame', '#3d7cc9');
    const platform = h * 0.6;
    const back = -dp / 2;
    const parts = new PartList();
    for (const side of [-1, 1]) {
      parts.add(box(0.06, h, 0.06), frame, { x: side * (w / 2 - 0.04), y: h / 2, z: back + 0.05 });
      parts.add(box(0.04, h - platform, 0.5), frame, { x: side * (w / 2 - 0.02), y: platform + (h - platform) / 2, z: back + 0.3 });
    }
    for (let y = 0.3; y < platform; y += 0.3) parts.add(box(w - 0.08, 0.04, 0.04), frame, { y, z: back + 0.05 });
    parts.add(box(w, 0.06, 0.5), frame, { y: platform, z: back + 0.3 });
    const z0 = back + 0.55;
    const z1 = dp / 2 - 0.06;
    const drop = platform - 0.12;
    const chute = Math.hypot(z1 - z0, drop);
    const angle = Math.atan2(drop, z1 - z0);
    parts.add(box(w * 0.8, 0.04, chute), d.color, { rotX: angle, y: (platform + 0.12) / 2, z: (z0 + z1) / 2 });
    for (const side of [-1, 1]) {
      parts.add(box(0.03, 0.14, chute), d.color, { rotX: angle, x: side * (w * 0.4 + 0.015), y: (platform + 0.12) / 2 + 0.07, z: (z0 + z1) / 2 });
    }
    parts.add(box(0.05, 0.12, 0.05), frame, { y: 0.06, z: z1 - 0.05 });
    return parts.build();
  },

  swing(d) {
    // An A-frame at each end, a top bar along X and two seats on ropes.
    const { width: w, height: h, depth: dp } = d.dimensions;
    const frame = partColor(d, 'frame', '#c0392b');
    const rope = partColor(d, 'rope', '#d8cfb8');
    const spread = dp / 2 - 0.05;
    const top = h - 0.08;
    // Shortened so the leaning legs' corners stay above the ground and inside the box.
    const leg = Math.hypot(top, spread) - 0.08;
    const angle = Math.atan2(spread, top);
    const parts = new PartList();
    for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) {
      parts.add(box(0.07, leg, 0.07), frame, { rotX: -angle, x, y: top / 2, z: spread / 2 });
      parts.add(box(0.07, leg, 0.07), frame, { rotX: angle, x, y: top / 2, z: -spread / 2 });
    }
    parts.add(box(w, 0.08, 0.08), frame, { y: h - 0.04 });
    const seatY = 0.45;
    for (const x of [-w / 5, w / 5]) {
      for (const offset of [-0.2, 0.2]) parts.add(box(0.02, top - seatY, 0.02), rope, { x: x + offset, y: (top + seatY) / 2 });
      parts.add(box(0.48, 0.04, 0.2), d.color, { x, y: seatY });
    }
    return parts.build();
  },

  sandpit(d) {
    const { width: w, height: h, depth: dp } = d.dimensions;
    const sand = partColor(d, 'sand', '#e8d39a');
    const bucket = partColor(d, 'bucket', '#e74c3c');
    const t = 0.15;
    return new PartList()
      .add(box(w, h, t), d.color, { y: h / 2, z: dp / 2 - t / 2 })
      .add(box(w, h, t), d.color, { y: h / 2, z: -dp / 2 + t / 2 })
      .add(box(t, h, dp - 2 * t), d.color, { x: w / 2 - t / 2, y: h / 2 })
      .add(box(t, h, dp - 2 * t), d.color, { x: -w / 2 + t / 2, y: h / 2 })
      .add(box(w - 2 * t, h * 0.6, dp - 2 * t), sand, { y: h * 0.3 })
      .add(cylinder(0.08, h * 0.4, 14), bucket, { x: w * 0.2, y: h * 0.6 + h * 0.2, z: -dp * 0.15 })
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
