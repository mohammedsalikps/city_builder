/**
 * Generates the PLACEHOLDER 3D asset library as real binary glTF (.glb) files.
 *
 * These are procedural stand-ins, not final art. They exist so the runtime
 * asset pipeline (registry -> GLTFLoader -> cache -> clone / instance ->
 * material binding -> animation) is exercised end to end with genuine GLB
 * files. Replacing a file in public/assets/3d with a downloaded model of the
 * same id is all it takes to upgrade the look; nothing in the game changes.
 *
 * Conventions shared with src/data/assets.json:
 *   - metres, Y up, the model's front faces +Z, bottom-centre at the origin
 *   - material names are the binding contract with the runtime MaterialLibrary
 *     ("plaster", "roof_tile", "glass", ...); variants tint by material name
 *   - animated nodes are named (the windmill's "blades")
 *
 * Run: npm run assets:placeholders
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// GLTFExporter reads its binary blobs through FileReader, which Node lacks.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = 'data:application/octet-stream;base64,' + Buffer.from(buffer).toString('base64');
      this.onloadend?.();
    });
  }
};

const OUT = 'public/assets/3d';

// ------------------------------------------------------------------ helpers

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const materialCache = new Map();
/** Named PBR material; the name is what the runtime binds to its library. */
function mat(name, color, roughness = 0.8, metalness = 0, extra = {}) {
  const key = `${name}|${color}|${roughness}|${metalness}|${JSON.stringify(extra)}`;
  if (!materialCache.has(key)) {
    materialCache.set(key, new THREE.MeshStandardMaterial({ name, color, roughness, metalness, ...extra }));
  }
  return materialCache.get(key);
}

const MAT = {
  plaster: () => mat('plaster', '#efe6d6', 0.92),
  plasterWhite: () => mat('plaster', '#f4f2ee', 0.9),
  stone: () => mat('stone', '#a39c90', 0.95),
  roofTile: () => mat('roof_tile', '#b0523b', 0.85),
  roofSlate: () => mat('roof_tile', '#5d6168', 0.8),
  brick: () => mat('brick', '#a4513d', 0.9),
  trim: () => mat('trim', '#f4f1ea', 0.6),
  shutter: () => mat('shutter', '#5f7f5a', 0.6),
  wood: () => mat('wood', '#8a5a36', 0.75),
  woodDark: () => mat('wood', '#5a3a24', 0.75),
  woodCladding: () => mat('wood', '#a8774a', 0.7),
  glass: () => mat('glass', '#2e3d4a', 0.06, 0.4),
  metal: () => mat('metal', '#5d646b', 0.4, 0.8),
  metalDark: () => mat('metal', '#34383d', 0.45, 0.7),
  concrete: () => mat('concrete', '#c3beb3', 0.9),
  asphalt: () => mat('asphalt', '#3a3c40', 0.95),
  marking: () => mat('marking', '#f2efe6', 0.7),
  markingYellow: () => mat('marking', '#e3b13b', 0.7),
  curb: () => mat('stone', '#9a9790', 0.9),
  paint: () => mat('paint', '#c0392b', 0.32, 0.25),
  rubber: () => mat('rubber', '#1d1f22', 0.9),
  light: () => mat('light', '#fff4d6', 0.3, 0, { emissive: '#ffe9b0', emissiveIntensity: 1.2 }),
  taillight: () => mat('taillight', '#9c1c22', 0.3, 0, { emissive: '#a01820', emissiveIntensity: 0.6 }),
  bark: () => mat('bark', '#5a4030', 0.95),
  foliage: () => mat('foliage', '#4f8f3a', 0.85),
  foliageDark: () => mat('foliage', '#3e7a33', 0.85),
  foliagePine: () => mat('foliage', '#2f6232', 0.85),
  soil: () => mat('soil', '#6b4f35', 1),
  flowerPink: () => mat('flower_pink', '#e86aa6', 0.7),
  flowerYellow: () => mat('flower_yellow', '#f2c33a', 0.7),
  flowerWhite: () => mat('flower_white', '#f7f5f0', 0.7),
  sail: () => mat('sail', '#efe9dc', 0.9),
};

/** Collects parts and merges everything sharing a material into one mesh. */
class Model {
  constructor(name) {
    this.name = name;
    this.parts = new Map();
  }

  add(geometry, material, t = {}) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (t.scale) g.scale(t.scale[0], t.scale[1], t.scale[2]);
    if (t.rx) g.rotateX(t.rx);
    if (t.rz) g.rotateZ(t.rz);
    if (t.ry) g.rotateY(t.ry);
    g.translate(t.x ?? 0, t.y ?? 0, t.z ?? 0);
    for (const attr of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(attr)) g.deleteAttribute(attr);
    }
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const list = this.parts.get(material) ?? [];
    list.push(g);
    this.parts.set(material, list);
    return this;
  }

  /** Merge into a Group: one mesh per material. */
  build(name = this.name) {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, geometries] of this.parts) {
      const merged = mergeGeometries(geometries, false);
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `${name}_${material.name}`;
      group.add(mesh);
    }
    return group;
  }
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 16) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r, h, seg = 12) => new THREE.ConeGeometry(r, h, seg);
const ico = (r, detail = 1) => new THREE.IcosahedronGeometry(r, detail);

/** Displace vertices deterministically by position, so shared corners stay closed. */
function lumpy(geometry, amount, seed) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const hx = Math.round(v.x * 1000), hy = Math.round(v.y * 1000), hz = Math.round(v.z * 1000);
    const r = rng((hx * 73856093) ^ (hy * 19349663) ^ (hz * 83492791) ^ seed);
    const k = 1 + (r() - 0.5) * 2 * amount;
    pos.setXYZ(i, v.x * k, v.y * (1 + (r() - 0.5) * amount), v.z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Extrude a 2D outline (x, y) by `depth` along Z, centred on Z. */
function extrude(points, depth, bevel = 0) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 8,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** A framed window on a wall face at local z = face, facing +Z. */
function windowUnit(m, { x, y, z, w = 1.1, h = 1.2, ry = 0, shutters = false }) {
  const place = (geometry, material, dx, dy, dz) => {
    const px = Math.cos(ry) * dx + Math.sin(ry) * dz;
    const pz = -Math.sin(ry) * dx + Math.cos(ry) * dz;
    m.add(geometry, material, { ry, x: x + px, y: y + dy, z: z + pz });
  };
  const t = 0.08;
  place(box(w, t, 0.1), MAT.trim(), 0, h / 2 - t / 2, 0.03);
  place(box(w, t, 0.1), MAT.trim(), 0, -h / 2 + t / 2, 0.03);
  place(box(t, h, 0.1), MAT.trim(), -w / 2 + t / 2, 0, 0.03);
  place(box(t, h, 0.1), MAT.trim(), w / 2 - t / 2, 0, 0.03);
  place(box(0.05, h - 2 * t, 0.06), MAT.trim(), 0, 0, 0.03);
  place(box(w - 2 * t, 0.05, 0.06), MAT.trim(), 0, 0.08, 0.03);
  place(box(w - 2 * t, h - 2 * t, 0.02), MAT.glass(), 0, 0, 0.0);
  place(box(w + 0.16, 0.06, 0.2), MAT.stone(), 0, -h / 2 - 0.03, 0.08);
  if (shutters) {
    place(box(w * 0.45, h, 0.04), MAT.shutter(), -w / 2 - w * 0.25 - 0.02, 0, 0.03);
    place(box(w * 0.45, h, 0.04), MAT.shutter(), w / 2 + w * 0.25 + 0.02, 0, 0.03);
  }
}

// ------------------------------------------------------------------ assets

function houseCottage() {
  const m = new Model('house_cottage_01');
  const W = 6.4, D = 5.2, H = 3.1, PL = 0.45;
  m.add(box(W + 0.12, PL, D + 0.12), MAT.stone(), { y: PL / 2 });
  m.add(box(W, H - PL, D), MAT.plaster(), { y: PL + (H - PL) / 2 });
  // Gable ends (ridge along X) and roof slabs with overhang.
  const rise = 2.3, half = D / 2;
  m.add(extrude([[-half, 0], [half, 0], [0, rise]], W - 0.02), MAT.plaster(), { ry: Math.PI / 2, y: H });
  const slope = Math.hypot(half, rise), angle = Math.atan2(rise, half), t = 0.16, over = 0.5, overX = 0.35;
  for (const side of [1, -1]) {
    const length = slope + over;
    const dz = side * (half / 2 + (over / 2) * Math.cos(angle)) + side * (t / 2) * Math.sin(angle);
    const dy = H + rise / 2 - (over / 2) * Math.sin(angle) + (t / 2) * Math.cos(angle);
    m.add(box(W + 2 * overX, t, length), MAT.roofTile(), { rx: side * angle, y: dy, z: dz });
  }
  m.add(box(W + 2 * overX + 0.04, 0.12, 0.26), MAT.roofTile(), { y: H + rise + 0.08 });
  m.add(box(0.7, 1.9, 0.7), MAT.brick(), { x: 1.9, y: H + rise - 0.2, z: -0.9 });
  m.add(box(0.82, 0.1, 0.82), MAT.stone(), { x: 1.9, y: H + rise + 0.8, z: -0.9 });
  // Front: door with frame, canopy and step; two shuttered windows.
  m.add(box(1.22, 2.32, 0.1), MAT.trim(), { x: -1.2, y: PL + 1.1, z: D / 2 + 0.03 });
  m.add(box(1.0, 2.15, 0.08), MAT.woodDark(), { x: -1.2, y: PL + 1.07, z: D / 2 + 0.06 });
  m.add(ico(0.045, 0), MAT.metal(), { x: -0.85, y: PL + 1.0, z: D / 2 + 0.12 });
  m.add(box(1.7, 0.18, 0.7), MAT.stone(), { x: -1.2, y: 0.09, z: D / 2 + 0.35 });
  m.add(box(1.7, 0.1, 1.0), MAT.roofTile(), { x: -1.2, y: PL + 2.55, z: D / 2 + 0.45, rx: 0.18 });
  windowUnit(m, { x: 1.1, y: PL + 1.35, z: D / 2 + 0.02, shutters: true });
  windowUnit(m, { x: 2.6, y: PL + 1.35, z: D / 2 + 0.02, w: 0.8, shutters: true });
  windowUnit(m, { x: -2.6, y: PL + 1.35, z: D / 2 + 0.02, w: 0.8, shutters: true });
  // Back and sides.
  windowUnit(m, { x: -1.4, y: PL + 1.35, z: -D / 2 - 0.02, ry: Math.PI });
  windowUnit(m, { x: 1.4, y: PL + 1.35, z: -D / 2 - 0.02, ry: Math.PI });
  windowUnit(m, { x: W / 2 + 0.02, y: PL + 1.35, z: 0, ry: Math.PI / 2 });
  windowUnit(m, { x: -W / 2 - 0.02, y: PL + 1.35, z: 0, ry: -Math.PI / 2 });
  windowUnit(m, { x: W / 2 + 0.02, y: H + 0.9, z: 0, w: 0.7, h: 0.8, ry: Math.PI / 2 });
  windowUnit(m, { x: -W / 2 - 0.02, y: H + 0.9, z: 0, w: 0.7, h: 0.8, ry: -Math.PI / 2 });
  return m.build();
}

function houseModern() {
  const m = new Model('house_modern_01');
  // Ground floor: white render, big glazing; upper floor: timber cladding.
  m.add(box(8.2, 0.25, 6.2), MAT.concrete(), { y: 0.125 });
  m.add(box(8, 3, 6), MAT.plasterWhite(), { y: 0.25 + 1.5 });
  m.add(box(8.6, 0.22, 6.6), MAT.concrete(), { y: 3.25 + 0.11 });
  m.add(box(6, 2.8, 5.4), MAT.woodCladding(), { x: -0.8, y: 3.47 + 1.4, z: -0.2 });
  m.add(box(6.5, 0.24, 5.9), MAT.concrete(), { x: -0.8, y: 6.27 + 0.12, z: -0.2 });
  m.add(box(6.5, 0.4, 0.14), MAT.concrete(), { x: -0.8, y: 6.51 + 0.2, z: 2.63 });
  // Ground floor glazing with slim metal frames.
  m.add(box(3.8, 2.3, 0.05), MAT.glass(), { x: 1.6, y: 0.25 + 1.35, z: 3.01 });
  for (const x of [-0.3, 1.6, 3.5]) m.add(box(0.07, 2.3, 0.08), MAT.metalDark(), { x, y: 0.25 + 1.35, z: 3.03 });
  m.add(box(3.9, 0.07, 0.08), MAT.metalDark(), { x: 1.6, y: 0.25 + 2.5, z: 3.03 });
  m.add(box(1.05, 2.3, 0.08), MAT.woodDark(), { x: -2.4, y: 0.25 + 1.15, z: 3.03 });
  m.add(box(2.2, 0.12, 1.3), MAT.concrete(), { x: -2.4, y: 2.95, z: 3.6 });
  m.add(box(1.4, 0.15, 0.9), MAT.concrete(), { x: -2.4, y: 0.075, z: 3.55 });
  // Upper floor windows and balcony on the ground-floor roof.
  m.add(box(3.4, 1.4, 0.05), MAT.glass(), { x: -1.2, y: 3.47 + 1.5, z: 2.52 });
  m.add(box(3.5, 0.08, 0.1), MAT.metalDark(), { x: -1.2, y: 3.47 + 2.22, z: 2.54 });
  m.add(box(3.5, 0.08, 0.1), MAT.metalDark(), { x: -1.2, y: 3.47 + 0.78, z: 2.54 });
  m.add(box(0.05, 1.0, 1.6), MAT.glass(), { x: 2.25, y: 3.47 + 0.5, z: 2.35 });
  m.add(box(2.1, 1.0, 0.05), MAT.glass(), { x: 3.25, y: 3.47 + 0.5, z: 3.25 });
  m.add(box(2.1, 0.05, 0.08), MAT.metalDark(), { x: 3.25, y: 3.47 + 1.0, z: 3.27 });
  m.add(box(1.2, 1.2, 0.05), MAT.glass(), { x: -3.8, y: 3.47 + 1.5, z: -1.0, ry: Math.PI / 2 });
  m.add(box(0.05, 1.8, 1.4), MAT.glass(), { x: 4.01, y: 0.25 + 1.3, z: -1.2 });
  m.add(box(3.0, 1.4, 0.05), MAT.glass(), { x: -0.8, y: 3.47 + 1.5, z: -2.92 });
  m.add(box(2.4, 1.6, 0.05), MAT.glass(), { x: 1.5, y: 0.25 + 1.5, z: -3.01 });
  return m.build();
}

function treeOak(detail = 1, name = 'tree_oak_01') {
  const m = new Model(name);
  const r = rng(11);
  m.add(cyl(0.2, 0.34, 2.8, 10), MAT.bark(), { y: 1.4 });
  if (detail > 0) {
    for (const [a, tilt] of [[0.3, 0.7], [2.4, 0.6], [4.3, 0.75]]) {
      m.add(cyl(0.07, 0.12, 1.5, 7), MAT.bark(), { rz: tilt, ry: a, x: Math.cos(a) * 0.45, y: 2.9, z: -Math.sin(a) * 0.45 });
    }
  }
  const blobs = detail > 0
    ? [[0, 4.6, 0, 1.75], [1.1, 4.1, 0.4, 1.3], [-1.0, 4.2, -0.3, 1.35], [0.3, 4.2, -1.1, 1.25], [-0.4, 4.0, 1.1, 1.25], [0.5, 5.4, 0.2, 1.15], [-0.6, 5.2, -0.5, 1.05]]
    : [[0, 4.5, 0, 2.1], [0.4, 5.3, 0.1, 1.4]];
  blobs.forEach(([x, y, z, rad], i) => {
    m.add(lumpy(ico(rad, detail), 0.16, 31 + i), i % 2 ? MAT.foliageDark() : MAT.foliage(), { x, y, z, ry: r() * 6 });
  });
  return m.build(name);
}

function treePine() {
  const m = new Model('tree_pine_01');
  m.add(cyl(0.12, 0.24, 2.4, 8), MAT.bark(), { y: 1.2 });
  const layers = [[1.9, 2.6, 1.6], [1.55, 2.3, 3.0], [1.2, 2.0, 4.3], [0.85, 1.7, 5.5], [0.5, 1.4, 6.6]];
  layers.forEach(([rad, h, y], i) => m.add(lumpy(cone(rad, h, 9), 0.1, 7 + i), MAT.foliagePine(), { y: y + h / 2 - 0.2, ry: i * 0.7 }));
  return m.build();
}

function bushRound() {
  const m = new Model('bush_round_01');
  [[0, 0.5, 0, 0.6], [0.45, 0.42, 0.1, 0.45], [-0.42, 0.4, -0.05, 0.47], [0.1, 0.4, 0.4, 0.42], [-0.1, 0.45, -0.4, 0.42]].forEach(([x, y, z, rad], i) => {
    m.add(lumpy(ico(rad, 1), 0.18, 50 + i), i % 2 ? MAT.foliageDark() : MAT.foliage(), { x, y, z });
  });
  return m.build();
}

function flowerPatch() {
  const m = new Model('flower_patch_01');
  const r = rng(5);
  m.add(cyl(0.75, 0.8, 0.08, 18), MAT.soil(), { y: 0.04 });
  const heads = [MAT.flowerPink(), MAT.flowerYellow(), MAT.flowerWhite()];
  for (let i = 0; i < 16; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.6, h = 0.25 + r() * 0.2;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    m.add(cyl(0.012, 0.012, h, 5), MAT.foliageDark(), { x, y: 0.08 + h / 2, z });
    m.add(ico(0.06, 0), heads[i % 3], { x, y: 0.08 + h, z });
    m.add(box(0.12, 0.01, 0.04), MAT.foliage(), { x: x + 0.04, y: 0.1 + h * 0.4, z, ry: a });
  }
  return m.build();
}

function carSedan() {
  const m = new Model('car_sedan_01');
  const L = 4.4;
  // Side profile, front at -X (mapped to +Z after the final turn).
  const arches = (cx) => {
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const a = (k / 10) * Math.PI;
      pts.push([cx + Math.cos(a) * 0.42, 0.32 + Math.sin(a) * 0.42]);
    }
    return pts;
  };
  // Outline: front bottom, up over the bonnet and roof line, down the tail, back along the sills with wheel arches.
  const outline = [
    [-L / 2, 0.36], [-L / 2 + 0.02, 0.68], [-L / 2 + 0.25, 0.82], [-0.95, 0.9], [-0.55, 0.95], [1.4, 0.97], [2.05, 0.9], [L / 2, 0.72], [L / 2, 0.36],
    [1.77, 0.36], ...arches(1.35).slice(1, -1), [0.93, 0.36], [-0.93, 0.36], ...arches(-1.35).slice(1, -1), [-1.77, 0.36],
  ];
  m.add(extrude(outline, 1.62, 0.07), MAT.paint(), { ry: Math.PI / 2 });
  const cabin = [[-0.7, 0.96], [-0.15, 1.38], [1.0, 1.38], [1.62, 0.96]];
  m.add(extrude(cabin, 1.44, 0.05), MAT.glass(), { ry: Math.PI / 2 });
  m.add(box(1.36, 0.06, 1.05), MAT.paint(), { y: 1.44, z: -0.42 });
  // Wheels: tyre + rim, left and right.
  for (const x of [-0.8, 0.8]) {
    for (const z of [-1.35, 1.35]) {
      m.add(cyl(0.36, 0.36, 0.24, 18), MAT.rubber(), { rz: Math.PI / 2, x, y: 0.36, z });
      m.add(cyl(0.21, 0.21, 0.26, 12), MAT.metal(), { rz: Math.PI / 2, x: x * 1.01, y: 0.36, z });
    }
  }
  m.add(box(1.72, 0.18, 0.12), MAT.metalDark(), { y: 0.42, z: L / 2 + 0.04 });
  m.add(box(1.72, 0.18, 0.12), MAT.metalDark(), { y: 0.42, z: -L / 2 - 0.04 });
  for (const x of [-0.62, 0.62]) {
    m.add(box(0.34, 0.1, 0.05), MAT.light(), { x, y: 0.7, z: L / 2 + 0.06 });
    m.add(box(0.34, 0.1, 0.05), MAT.taillight(), { x, y: 0.72, z: -L / 2 - 0.06 });
  }
  return m.build();
}

function streetlight() {
  const m = new Model('streetlight_01');
  m.add(cyl(0.15, 0.18, 0.45, 12), MAT.metalDark(), { y: 0.225 });
  m.add(cyl(0.055, 0.08, 4.7, 10), MAT.metalDark(), { y: 0.45 + 2.35 });
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 5.0, 0), new THREE.Vector3(0.1, 5.35, 0), new THREE.Vector3(0.95, 5.3, 0));
  m.add(new THREE.TubeGeometry(curve, 12, 0.04, 8), MAT.metalDark());
  m.add(box(0.5, 0.12, 0.26), MAT.metalDark(), { x: 1.05, y: 5.24 });
  m.add(box(0.42, 0.04, 0.2), MAT.light(), { x: 1.05, y: 5.16 });
  return m.build();
}

function fencePicket() {
  const m = new Model('fence_picket_01');
  const picket = [[-0.035, 0], [0.035, 0], [0.035, 0.82], [0, 0.9], [-0.035, 0.82]];
  for (const x of [-0.96, 0.96]) m.add(box(0.08, 1.0, 0.08), MAT.trim(), { x, y: 0.5 });
  for (const y of [0.25, 0.7]) m.add(box(1.92, 0.07, 0.035), MAT.trim(), { y, z: -0.03 });
  for (let i = 0; i < 11; i++) m.add(extrude(picket, 0.025), MAT.trim(), { x: -0.8 + i * 0.16, y: 0.03, z: 0.005 });
  return m.build();
}

function roadStraight() {
  const m = new Model('road_straight_01');
  m.add(box(8, 0.04, 8), MAT.asphalt(), { y: 0.02 });
  for (const x of [-3.55, 3.55]) m.add(box(0.12, 0.006, 8), MAT.marking(), { x, y: 0.043 });
  for (let i = 0; i < 2; i++) m.add(box(0.14, 0.006, 2.4), MAT.markingYellow(), { y: 0.043, z: -2 + i * 4 });
  return m.build();
}

function sidewalkStraight() {
  const m = new Model('sidewalk_straight_01');
  m.add(box(2.5, 0.14, 8), MAT.concrete(), { y: 0.07 });
  m.add(box(0.2, 0.18, 8), MAT.curb(), { x: -1.25 + 0.1, y: 0.09 });
  for (let i = 1; i < 8; i++) m.add(box(2.3, 0.004, 0.02), MAT.curb(), { x: 0.1, y: 0.142, z: -4 + i });
  return m.build();
}

function bench() {
  const m = new Model('bench_01');
  for (let i = 0; i < 4; i++) m.add(box(1.6, 0.04, 0.09), MAT.wood(), { y: 0.46, z: -0.18 + i * 0.12 });
  for (let i = 0; i < 2; i++) m.add(box(1.6, 0.09, 0.04), MAT.wood(), { y: 0.62 + i * 0.14, z: -0.27, rx: -0.2 });
  for (const x of [-0.7, 0.7]) {
    m.add(box(0.06, 0.46, 0.5), MAT.metalDark(), { x, y: 0.23 });
    m.add(box(0.06, 0.4, 0.06), MAT.metalDark(), { x, y: 0.66, z: -0.28, rx: -0.2 });
  }
  return m.build();
}

function windmill() {
  const tower = new Model('windmill_01');
  tower.add(cyl(1.25, 1.9, 8, 14), MAT.plasterWhite(), { y: 4 });
  tower.add(cone(1.7, 2.4, 14), MAT.woodDark(), { y: 8 + 1.2 });
  tower.add(box(0.9, 1.8, 0.1), MAT.woodDark(), { y: 0.9, z: 1.83, rx: -0.06 });
  windowUnit(tower, { x: 0, y: 4.6, z: 1.52, w: 0.6, h: 0.8 });
  const root = tower.build();
  const bladesModel = new Model('blades');
  bladesModel.add(cyl(0.25, 0.25, 0.4, 12), MAT.woodDark(), { rx: Math.PI / 2 });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    bladesModel.add(box(0.14, 5.2, 0.1), MAT.woodDark(), { rz: a, x: -Math.sin(a) * 2.6, y: Math.cos(a) * 2.6 });
    bladesModel.add(box(0.9, 4.2, 0.03), MAT.sail(), { rz: a, x: -Math.sin(a) * 3.0 + Math.cos(a) * 0.5, y: Math.cos(a) * 3.0 + Math.sin(a) * 0.5, z: 0.06 });
  }
  const blades = bladesModel.build('blades');
  blades.position.set(0, 8.3, 1.75);
  root.add(blades);
  const q = (angle) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle).toArray();
  const times = [0, 2, 4, 6, 8];
  const values = [0, 1, 2, 3, 4].flatMap((k) => q((-k * Math.PI) / 2));
  const clip = new THREE.AnimationClip('spin', 8, [new THREE.QuaternionKeyframeTrack('blades.quaternion', times, values)]);
  return { root, animations: [clip] };
}

// ------------------------------------------------------------------ export

const exporter = new GLTFExporter();

async function write(path, object, animations = []) {
  const scene = new THREE.Scene();
  scene.add(object);
  const glb = await exporter.parseAsync(scene, { binary: true, animations, onlyVisible: true });
  const file = join(OUT, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(glb));
  const box3 = new THREE.Box3().setFromObject(object);
  const size = box3.getSize(new THREE.Vector3());
  console.log(`${path.padEnd(40)} ${(glb.byteLength / 1024).toFixed(1).padStart(7)} KB  size ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);
}

const mill = windmill();
await write('architecture/house_cottage_01.glb', houseCottage());
await write('architecture/house_modern_01.glb', houseModern());
await write('vegetation/tree_oak_01.glb', treeOak(1));
await write('vegetation/tree_oak_01_lod1.glb', treeOak(0, 'tree_oak_01_lod1'));
await write('vegetation/tree_pine_01.glb', treePine());
await write('vegetation/bush_round_01.glb', bushRound());
await write('vegetation/flower_patch_01.glb', flowerPatch());
await write('vehicles/car_sedan_01.glb', carSedan());
await write('props/streetlight_01.glb', streetlight());
await write('props/fence_picket_01.glb', fencePicket());
await write('props/bench_01.glb', bench());
await write('roads/road_straight_01.glb', roadStraight());
await write('roads/sidewalk_straight_01.glb', sidewalkStraight());
await write('environment/windmill_01.glb', mill.root, mill.animations);
