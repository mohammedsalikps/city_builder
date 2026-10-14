/**
 * The Golden Gate Bridge learning model, built in code (no downloadable model
 * with suitable licence and download terms was found). Scene units
 * (SCENE_SCALE: 1 unit = 10 m); x runs along the bridge (San Francisco at
 * -x, Marin at +x), y up from the water, z across the bridge.
 *
 * Sourced dimensions (official statistics): 1,280 m main span, 343 m side
 * spans, towers 227 m above the water, roadway about 67 m above the water,
 * 27 m wide, tower legs on 10 m x 16 m bases. Everything else (tower setbacks,
 * cable sag, pier and anchorage shapes, the headlands) is a visual
 * approximation, and the cables and suspenders are drawn thicker than real
 * so they can be seen. Force arrows and the moving load are simplified
 * teaching visuals, not engineering calculations.
 */
import * as THREE from 'three';
import { SCENE_SCALE, clamp01 } from '@/realworld/types';
import type { LandmarkModel, LandmarkView } from '@/realworld/models/BurjKhalifaModel';

export const GOLDEN_GATE_MODEL_PART_IDS = ['towers', 'main-cables', 'suspenders', 'deck', 'anchorages', 'piers'] as const;
export type GoldenGatePartId = (typeof GOLDEN_GATE_MODEL_PART_IDS)[number];

export interface GoldenGateBridgeOptions {
  quality?: 'low' | 'high';
  textures?: { ground?: THREE.Texture; concrete?: THREE.Texture };
}

const S = SCENE_SCALE;

const DIM = {
  /** Sourced: half the 1,280 m main span (the towers stand at +-640 m). */
  towerX: 640,
  /** Sourced: each side span is 343 m. */
  sideSpanM: 343,
  /** Sourced: towers 227 m above the water. */
  towerTopM: 227,
  /** Sourced: about 67 m clearance under the roadway at high tide. */
  deckBottomM: 67,
  /** Visual: depth of the deck and its stiffening truss. */
  deckDepthM: 7.6,
  /** Sourced: 27 m wide. The cables and tower legs stand at its edges. */
  halfWidthM: 13.5,
  /** Sourced: each tower leg stands on a 10 m x 16 m base. */
  legBaseXM: 10,
  legBaseZM: 16,
  /** Visual: where the cables rest on the towers and how low they dip in the middle. */
  cableTopM: 223,
  cableMidM: 80,
  /** Visual: thicker than the real 0.92 m cable so it shows from afar. */
  cableRadiusM: 1.6,
  suspenderRadiusM: 0.45,
  /** Visual: suspender spacing. */
  suspenderStepM: 15.24,
  /** Visual: pier tops (the San Francisco pier rose 44 ft above the water, per the official construction page). */
  pierTopM: 13.4,
  pierBottomM: -28,
  /** Visual: anchorage blocks and headlands. */
  anchorageCentreM: 1035,
  anchorageHalfXM: 25,
  anchorageHalfZM: 32,
  anchorageTopM: 82,
  cableEntryM: 74,
  landStartM: 930,
  landTopM: 16,
  deckEndM: 1110,
  waterRadiusM: 2200,
};

/**
 * The model's cable dip as a share of the main span, and the pretend flatter
 * cable of the load lesson (half the dip). Visual values of this learning
 * model, not the real bridge's design figures.
 */
export const GOLDEN_GATE_SAG_RATIO = {
  normal: (DIM.cableTopM - DIM.cableMidM) / (2 * DIM.towerX),
  flat: (DIM.cableTopM - DIM.cableMidM) / 2 / (2 * DIM.towerX),
} as const;

/** Construction bands (0..1) of the learning model; the timeline's entries point into them. Display values, not durations. */
const BUILD = {
  marinPier: [0.02, 0.08],
  anchorages: [0.02, 0.45],
  marinTower: [0.1, 0.22],
  sfPier: [0.24, 0.34],
  sfTower: [0.35, 0.45],
  catwalk: [0.46, 0.48],
  cables: [0.48, 0.65],
  deck: [0.66, 0.86],
} as const;

const DIM_OPACITY = 0.12;
const HIGHLIGHT_EMISSIVE = 0xffc23d;
const ORANGE = 0xb5452f;
const TENSION = new THREE.Color(0x2f7fe0);
const COMPRESSION = new THREE.Color(0xf0603e);
const LOAD = new THREE.Color(0xff8a1f);
const WEIGHT = new THREE.Color(0x6b4fe6);
const MAX_ARROWS = 260;
const ARROW_FLOW = 1.4;
const WIND_Z_START = -60;
const WIND_Z_END = 30;

interface Quality {
  mainSamples: number;
  sideSamples: number;
  windCount: number;
}

const QUALITY: Record<'low' | 'high', Quality> = {
  high: { mainSamples: 64, sideSamples: 18, windCount: 120 },
  low: { mainSamples: 36, sideSamples: 10, windCount: 50 },
};

/** Small deterministic random generator so the wind looks the same every time. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 0..1 through a band [from, to]. */
function band(p: number, [from, to]: readonly [number, number]): number {
  return clamp01((p - from) / (to - from));
}

/** Height (metres) of a main cable above the water at x (metres along the bridge), for a given dip in the middle. */
export function mainCableHeightM(xM: number, midM: number = DIM.cableMidM): number {
  if (Math.abs(xM) <= DIM.towerX) {
    const t = xM / DIM.towerX;
    return midM + (DIM.cableTopM - midM) * t * t;
  }
  // Side spans: from the tower top down to the anchorage, with a gentle sag.
  const t = clamp01((Math.abs(xM) - DIM.towerX) / (DIM.anchorageCentreM - DIM.anchorageHalfXM - DIM.towerX));
  return DIM.cableTopM + (DIM.cableEntryM - DIM.cableTopM) * t - 10 * 4 * t * (1 - t);
}

function helper<T extends THREE.Object3D>(object: T): T {
  object.userData.partId = null;
  return object;
}

/** Builds the Golden Gate Bridge learning model. */
export function buildGoldenGateBridge(opts: GoldenGateBridgeOptions = {}): LandmarkModel {
  const quality = QUALITY[opts.quality ?? 'high'];
  const root = new THREE.Group();
  root.name = 'golden-gate-bridge';
  const topY = DIM.towerTopM * S;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const direction = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);

  const ownedGeometries = new Set<THREE.BufferGeometry>();
  const geometry = <T extends THREE.BufferGeometry>(g: T): T => {
    ownedGeometries.add(g);
    return g;
  };
  const ownedMaterials = new Set<THREE.Material>();

  // --- Parts ---
  const parts = new Map<GoldenGatePartId, { group: THREE.Group; materials: THREE.MeshStandardMaterial[] }>();
  for (const id of GOLDEN_GATE_MODEL_PART_IDS) {
    const group = new THREE.Group();
    group.name = id;
    group.userData.partId = id;
    parts.set(id, { group, materials: [] });
    root.add(group);
  }
  const partGroup = (id: GoldenGatePartId) => parts.get(id)!.group;
  const partMaterial = (id: GoldenGatePartId, params: THREE.MeshStandardMaterialParameters) => {
    const material = new THREE.MeshStandardMaterial(params);
    parts.get(id)!.materials.push(material);
    ownedMaterials.add(material);
    return material;
  };
  const steel = (id: GoldenGatePartId) => partMaterial(id, { color: ORANGE, roughness: 0.55, metalness: 0.35 });
  const concrete = (id: GoldenGatePartId) => partMaterial(id, { color: 0xb3ada2, roughness: 0.95, metalness: 0, map: opts.textures?.concrete ?? null });
  const concreteMaterials: THREE.MeshStandardMaterial[] = [];

  const box = geometry(new THREE.BoxGeometry(1, 1, 1));
  const cylinder = geometry(new THREE.CylinderGeometry(1, 1, 1, 8, 1));
  /** A box mesh from min/max corners in metres. */
  const boxMesh = (material: THREE.Material, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) => {
    const mesh = new THREE.Mesh(box, material);
    mesh.position.set(((minX + maxX) / 2) * S, ((minY + maxY) / 2) * S, ((minZ + maxZ) / 2) * S);
    mesh.scale.set((maxX - minX) * S, (maxY - minY) * S, (maxZ - minZ) * S);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  /** Instance matrix for a cylinder from a to b (scene units) with a radius. */
  const segmentMatrix = (a: THREE.Vector3, b: THREE.Vector3, radius: number, target: THREE.Matrix4) => {
    direction.subVectors(b, a);
    const length = direction.length();
    quaternion.setFromUnitVectors(up, length > 1e-6 ? direction.normalize() : up);
    return target.compose(position.addVectors(a, b).multiplyScalar(0.5), quaternion, scale.set(radius, length, radius));
  };

  // --- Water and headlands ---
  const water = helper(
    new THREE.Mesh(
      geometry(new THREE.CircleGeometry(DIM.waterRadiusM * S, 72).rotateX(-Math.PI / 2)),
      new THREE.MeshStandardMaterial({ color: 0x2a5d7c, roughness: 0.3, metalness: 0.1 }),
    ),
  );
  water.name = 'water';
  water.receiveShadow = true;
  ownedMaterials.add(water.material as THREE.Material);
  const landMaterial = new THREE.MeshStandardMaterial({ color: 0x6f8452, roughness: 1, metalness: 0, map: opts.textures?.ground ?? null });
  ownedMaterials.add(landMaterial);
  const land = helper(new THREE.Group());
  land.name = 'land';
  const sfLand = helper(boxMesh(landMaterial, -1900, -4, -500, -DIM.landStartM, DIM.landTopM, 500));
  const marinLand = helper(boxMesh(landMaterial, DIM.landStartM, -4, -500, 1900, DIM.landTopM + 4, 500));
  const hill = helper(new THREE.Mesh(geometry(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), landMaterial));
  hill.position.set(1450 * S, (DIM.landTopM + 4) * S, -160 * S);
  hill.scale.set(420 * S, 150 * S, 300 * S);
  hill.receiveShadow = true;
  land.add(sfLand, marinLand, hill);
  root.add(water, land);

  // --- Piers (the towers' foundations) ---
  const piers = partGroup('piers');
  const pierMaterial = concrete('piers');
  concreteMaterials.push(pierMaterial);
  const pierFor = (x: number) => boxMesh(pierMaterial, x - 22, DIM.pierBottomM, -34, x + 22, DIM.pierTopM, 34);
  const marinPier = pierFor(DIM.towerX);
  const sfPier = pierFor(-DIM.towerX);
  // The San Francisco pier was built inside a fender wall in the open water (shown simply).
  const fender = new THREE.Group();
  for (const [minX, minZ, maxX, maxZ] of [[-58, -50, 58, -44], [-58, 44, 58, 50], [-58, -50, -52, 50], [52, -50, 58, 50]] as const) {
    fender.add(boxMesh(pierMaterial, -DIM.towerX + minX, DIM.pierBottomM, minZ, -DIM.towerX + maxX, 4, maxZ));
  }
  piers.add(marinPier, sfPier, fender);

  // --- Towers: two legs with setbacks, portal struts above the deck, bracing below ---
  const towerMaterial = steel('towers');
  const buildTower = (x: number) => {
    const tower = new THREE.Group();
    tower.position.set(x * S, DIM.pierTopM * S, 0);
    const height = DIM.towerTopM - DIM.pierTopM;
    const tiers = [
      { to: 0.42, sx: 1, sz: 1 },
      { to: 0.62, sx: 0.85, sz: 0.82 },
      { to: 0.8, sx: 0.72, sz: 0.66 },
      { to: 1, sx: 0.6, sz: 0.52 },
    ];
    for (const zSign of [-1, 1]) {
      let from = 0;
      for (const tier of tiers) {
        const hx = (DIM.legBaseXM / 2) * tier.sx;
        const hz = (DIM.legBaseZM / 2) * tier.sz;
        const leg = boxMesh(towerMaterial, -hx, from * height, zSign * DIM.halfWidthM - hz, hx, tier.to * height, zSign * DIM.halfWidthM + hz);
        tower.add(leg);
        from = tier.to;
      }
    }
    // Portal struts between the legs (visual).
    for (const h of [0.43, 0.63, 0.81, 0.97]) {
      tower.add(boxMesh(towerMaterial, -3, h * height - 3, -DIM.halfWidthM, 3, h * height + 3, DIM.halfWidthM));
    }
    // Cross bracing below the deck (visual).
    const braceTop = DIM.deckBottomM - DIM.pierTopM - 4;
    for (const [z0, z1] of [[-1, 1], [1, -1]] as const) {
      const a = new THREE.Vector3(0, 4 * S, z0 * DIM.halfWidthM * S);
      const b = new THREE.Vector3(0, braceTop * S, z1 * DIM.halfWidthM * S);
      const brace = new THREE.Mesh(cylinder, towerMaterial);
      segmentMatrix(a, b, 1.2 * S, brace.matrix);
      brace.matrixAutoUpdate = false;
      brace.castShadow = true;
      tower.add(brace);
    }
    partGroup('towers').add(tower);
    return tower;
  };
  const marinTower = buildTower(DIM.towerX);
  const sfTower = buildTower(-DIM.towerX);

  // --- Anchorages (and the concrete pylons of the approaches) ---
  const anchorageMaterial = concrete('anchorages');
  concreteMaterials.push(anchorageMaterial);
  const anchorageFor = (sign: number) => {
    const group = new THREE.Group();
    const c = sign * DIM.anchorageCentreM;
    group.add(boxMesh(anchorageMaterial, c - DIM.anchorageHalfXM, DIM.landTopM - 2, -DIM.anchorageHalfZM, c + DIM.anchorageHalfXM, DIM.anchorageTopM, DIM.anchorageHalfZM));
    // A pylon under the deck near the shore (visual).
    const px = sign * (DIM.landStartM + 30);
    group.add(boxMesh(anchorageMaterial, px - 6, DIM.landTopM - 2, -DIM.halfWidthM, px + 6, DIM.deckBottomM, DIM.halfWidthM));
    partGroup('anchorages').add(group);
    return group;
  };
  const sfAnchorage = anchorageFor(-1);
  const marinAnchorage = anchorageFor(1);

  // --- Main cables (instanced segments, rebuilt for the 'flat' comparison) ---
  const cableMaterial = steel('main-cables');
  const mainSegments = quality.mainSamples;
  const sideSegments = quality.sideSamples;
  const segmentsPerCable = mainSegments + 2 * sideSegments;
  const cables = new THREE.InstancedMesh(cylinder, cableMaterial, segmentsPerCable * 2);
  cables.castShadow = true;
  partGroup('main-cables').add(cables);
  /** Points along one cable from the San Francisco anchorage to the Marin one, metres. */
  const cablePath = (midM: number): THREE.Vector3[] => {
    const points: THREE.Vector3[] = [];
    const entry = DIM.anchorageCentreM - DIM.anchorageHalfXM + 12;
    for (let i = 0; i <= sideSegments; i++) {
      const x = -entry + ((entry - DIM.towerX) * i) / sideSegments;
      points.push(new THREE.Vector3(x, mainCableHeightM(x, midM), 0));
    }
    for (let i = 1; i <= mainSegments; i++) {
      const x = -DIM.towerX + (2 * DIM.towerX * i) / mainSegments;
      points.push(new THREE.Vector3(x, mainCableHeightM(x, midM), 0));
    }
    for (let i = 1; i <= sideSegments; i++) {
      const x = DIM.towerX + ((entry - DIM.towerX) * i) / sideSegments;
      points.push(new THREE.Vector3(x, mainCableHeightM(x, midM), 0));
    }
    return points;
  };

  // --- Suspenders and deck segments ---
  const suspenderMaterial = steel('suspenders');
  const suspenderXs: number[] = [];
  for (let x = -DIM.towerX - DIM.sideSpanM + DIM.suspenderStepM; x < DIM.towerX + DIM.sideSpanM - 1; x += DIM.suspenderStepM) {
    if (Math.abs(Math.abs(x) - DIM.towerX) > 8) suspenderXs.push(x);
  }
  const suspenders = new THREE.InstancedMesh(cylinder, suspenderMaterial, suspenderXs.length * 2);
  partGroup('suspenders').add(suspenders);

  const deckMaterial = steel('deck');
  const roadMaterial = partMaterial('deck', { color: 0x4a4d52, roughness: 0.9, metalness: 0.05 });
  const deckXs: number[] = [];
  for (let x = -DIM.deckEndM; x < DIM.deckEndM; x += DIM.suspenderStepM) deckXs.push(x + DIM.suspenderStepM / 2);
  const deckBody = new THREE.InstancedMesh(box, deckMaterial, deckXs.length);
  const roadway = new THREE.InstancedMesh(box, roadMaterial, deckXs.length);
  deckBody.castShadow = true;
  deckBody.receiveShadow = true;
  roadway.receiveShadow = true;
  partGroup('deck').add(deckBody, roadway);
  const deckTopM = DIM.deckBottomM + DIM.deckDepthM;

  // --- Arrows (forces and the load path) and wind ---
  const arrowGeometry = geometry(mergeArrow());
  const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
  ownedMaterials.add(arrowMaterial);
  const arrows = helper(new THREE.InstancedMesh(arrowGeometry, arrowMaterial, MAX_ARROWS));
  arrows.frustumCulled = false;
  arrows.renderOrder = 10;
  arrows.count = 0;
  arrows.setColorAt(0, TENSION);
  arrows.name = 'arrows';
  root.add(arrows);
  const loadMarkerMaterial = new THREE.MeshStandardMaterial({ color: 0xff8a1f, roughness: 0.6, metalness: 0.1, emissive: 0x7a3300, emissiveIntensity: 0.6 });
  ownedMaterials.add(loadMarkerMaterial);
  const loadMarker = helper(new THREE.Mesh(box, loadMarkerMaterial));
  loadMarker.name = 'load';
  loadMarker.scale.set(14 * S, 5 * S, 6 * S);
  loadMarker.visible = false;
  // The load is a marker, not part of the bridge: taps pass through it to the deck or cables.
  loadMarker.raycast = () => undefined;
  root.add(loadMarker);

  const windMaterial = new THREE.MeshBasicMaterial({ color: 0x2f8cff, transparent: true, opacity: 0.5, depthWrite: false });
  ownedMaterials.add(windMaterial);
  const windGeometry = geometry(new THREE.ConeGeometry(0.25, 2, 6).rotateX(Math.PI / 2));
  const wind = helper(new THREE.InstancedMesh(windGeometry, windMaterial, quality.windCount));
  wind.frustumCulled = false;
  wind.visible = false;
  root.add(wind);
  const random = seededRandom(1937);
  const windX = new Float32Array(quality.windCount);
  const windY = new Float32Array(quality.windCount);
  const windZ = new Float32Array(quality.windCount);
  for (let i = 0; i < quality.windCount; i++) {
    windX[i] = (random() - 0.5) * 180;
    windY[i] = 2 + random() * 20;
    windZ[i] = WIND_Z_START + random() * (WIND_Z_END - WIND_Z_START);
  }

  // --- State ---
  const partIds: string[] = [...GOLDEN_GATE_MODEL_PART_IDS];
  const knownParts = new Set<string>(partIds);
  let view: LandmarkView = 'complete';
  let progress = 1;
  let highlight = new Set<string>();
  let forcesPart: string | null = null;
  let loadAt: number | null = null;
  let loadPathOn = false;
  let cableMidM: number = DIM.cableMidM;
  let windStrength: number | null = null;
  let time = 0;
  /** Reduced motion: arrows sit evenly along their paths instead of flowing, and the wind streaks stop. */
  let still = false;
  let disposed = false;

  /** Writes the cables, suspenders and deck for the current construction progress and cable shape. */
  const writeStructure = () => {
    const p = view === 'construction' ? progress : 1;
    // Cables: thin catwalk lines first, then full thickness as the spinning finishes.
    const catwalk = band(p, BUILD.catwalk);
    const spun = band(p, BUILD.cables);
    const radius = catwalk <= 0 ? 0 : (0.25 + (DIM.cableRadiusM - 0.25) * spun) * S;
    const path = cablePath(cableMidM);
    let index = 0;
    for (const zSign of [-1, 1]) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = new THREE.Vector3(path[i].x * S, path[i].y * S, zSign * DIM.halfWidthM * S);
        const b = new THREE.Vector3(path[i + 1].x * S, path[i + 1].y * S, zSign * DIM.halfWidthM * S);
        cables.setMatrixAt(index++, radius > 0 ? segmentMatrix(a, b, radius, matrix) : zero);
      }
    }
    cables.instanceMatrix.needsUpdate = true;
    cables.computeBoundingSphere();
    // Deck and suspenders: from each tower outward (toward the middle and toward the shore).
    const deckShare = band(p, BUILD.deck);
    const builtNear = (x: number) => {
      if (p >= BUILD.deck[1]) return true;
      if (deckShare <= 0) return Math.abs(x) > DIM.landStartM && p >= BUILD.deck[0];
      if (Math.abs(x) > DIM.landStartM) return true;
      const fromTower = Math.abs(Math.abs(x) - DIM.towerX);
      const reach = Math.abs(x) < DIM.towerX ? DIM.towerX : DIM.landStartM - DIM.towerX;
      return fromTower <= deckShare * reach + 1;
    };
    deckXs.forEach((x, i) => {
      if (!builtNear(x)) {
        deckBody.setMatrixAt(i, zero);
        roadway.setMatrixAt(i, zero);
        return;
      }
      matrix.compose(position.set(x * S, (DIM.deckBottomM + DIM.deckDepthM / 2) * S, 0), quaternion.identity(), scale.set(DIM.suspenderStepM * S * 1.01, DIM.deckDepthM * S, DIM.halfWidthM * 2 * S));
      deckBody.setMatrixAt(i, matrix);
      matrix.compose(position.set(x * S, (deckTopM + 0.3) * S, 0), quaternion.identity(), scale.set(DIM.suspenderStepM * S * 1.01, 0.6 * S, (DIM.halfWidthM * 2 - 3) * S));
      roadway.setMatrixAt(i, matrix);
    });
    deckBody.instanceMatrix.needsUpdate = true;
    roadway.instanceMatrix.needsUpdate = true;
    deckBody.computeBoundingSphere();
    roadway.computeBoundingSphere();
    suspenderXs.forEach((x, i) => {
      for (const [k, zSign] of [[0, -1], [1, 1]] as const) {
        const visible = spun >= 1 && builtNear(x);
        if (!visible) {
          suspenders.setMatrixAt(i * 2 + k, zero);
          continue;
        }
        const a = new THREE.Vector3(x * S, deckTopM * S, zSign * DIM.halfWidthM * S);
        const b = new THREE.Vector3(x * S, mainCableHeightM(x, cableMidM) * S, zSign * DIM.halfWidthM * S);
        suspenders.setMatrixAt(i * 2 + k, segmentMatrix(a, b, DIM.suspenderRadiusM * S, matrix));
      }
    });
    suspenders.instanceMatrix.needsUpdate = true;
    suspenders.computeBoundingSphere();
  };

  /** Piers, towers and anchorages for the construction progress (all complete outside the construction view). */
  const writeFoundationsAndTowers = () => {
    const p = view === 'construction' ? progress : 1;
    const grow = (object: THREE.Object3D, share: number) => {
      object.visible = share > 0;
      object.scale.y = Math.max(1e-3, share) * (object.userData.fullScaleY ?? object.scale.y);
    };
    for (const object of [marinPier, sfPier, ...fender.children]) {
      object.userData.fullScaleY ??= object.scale.y;
      object.userData.fullY ??= object.position.y;
    }
    const pierShare = (object: THREE.Mesh, share: number) => {
      const full = object.userData.fullScaleY as number;
      const bottom = DIM.pierBottomM * S;
      object.visible = share > 0;
      object.scale.y = Math.max(1e-3, share) * full;
      object.position.y = bottom + (object.scale.y / 2);
    };
    pierShare(marinPier, band(p, BUILD.marinPier));
    pierShare(sfPier, band(p, BUILD.sfPier));
    for (const wall of fender.children as THREE.Mesh[]) pierShare(wall, band(p, [BUILD.sfPier[0], BUILD.sfPier[0] + 0.04]));
    for (const tower of [marinTower, sfTower]) tower.userData.fullScaleY ??= 1;
    grow(marinTower, band(p, BUILD.marinTower));
    grow(sfTower, band(p, BUILD.sfTower));
    for (const anchorage of [sfAnchorage, marinAnchorage]) {
      anchorage.userData.fullScaleY ??= 1;
      const share = band(p, BUILD.anchorages);
      anchorage.visible = share > 0;
      anchorage.scale.y = Math.max(1e-3, share);
      anchorage.position.y = (DIM.landTopM - 2) * S * (1 - anchorage.scale.y);
    }
  };

  const applyVisibility = () => {
    const seeThroughWater = view !== 'complete';
    const waterMaterial = water.material as THREE.MeshStandardMaterial;
    waterMaterial.transparent = seeThroughWater;
    waterMaterial.opacity = seeThroughWater ? 0.4 : 1;
    waterMaterial.depthWrite = !seeThroughWater;
    waterMaterial.needsUpdate = true;
    writeFoundationsAndTowers();
    writeStructure();
  };

  /** Opacity and glow per part: highlighted parts glow; inspecting dims the rest; the cutaway shows the anchorages see-through. */
  const applyLook = () => {
    const inspecting = view === 'inspect' && highlight.size > 0;
    for (const [id, { materials }] of parts) {
      const highlighted = highlight.has(id);
      let opacity = 1;
      if (inspecting) opacity = highlighted ? 1 : DIM_OPACITY;
      else if ((view === 'cutaway' || view === 'inspect') && id === 'anchorages') opacity = 0.35;
      const transparent = opacity < 1;
      for (const material of materials) {
        if (material.transparent !== transparent) {
          material.transparent = transparent;
          material.needsUpdate = true;
        }
        material.opacity = opacity;
        material.depthWrite = !transparent;
        material.emissive.setHex(highlighted ? HIGHLIGHT_EMISSIVE : 0x000000);
        material.emissiveIntensity = highlighted ? 0.55 : 1;
      }
    }
  };

  /** Arrow placements: [from, to] points in metres with a colour; arrows point from -> to. */
  type ArrowRun = { a: THREE.Vector3; b: THREE.Vector3; color: THREE.Color; count: number; flow: boolean };
  let runs: ArrowRun[] = [];
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const cablePoint = (x: number, zSign: number) => v(x, mainCableHeightM(x, cableMidM), zSign * DIM.halfWidthM);

  const forceRuns = (id: string): ArrowRun[] => {
    const out: ArrowRun[] = [];
    if (id === 'main-cables' || id === 'anchorages') {
      // Pulled: arrow pairs pointing away from each other along the cable.
      const xs = id === 'main-cables' ? [-480, -240, 0, 240, 480] : [-DIM.towerX - 200, DIM.towerX + 200];
      for (const x of xs) {
        for (const zSign of [-1, 1]) {
          out.push({ a: cablePoint(x, zSign), b: cablePoint(x - 70, zSign), color: TENSION, count: 1, flow: false });
          out.push({ a: cablePoint(x, zSign), b: cablePoint(x + 70, zSign), color: TENSION, count: 1, flow: false });
        }
      }
      if (id === 'anchorages') {
        for (const sign of [-1, 1]) {
          const face = sign * (DIM.anchorageCentreM - DIM.anchorageHalfXM);
          out.push({ a: v(face, DIM.cableEntryM + 4, 0), b: v(face - sign * 90, DIM.cableEntryM + 30, 0), color: TENSION, count: 1, flow: false });
          out.push({ a: v(face + sign * 30, DIM.anchorageTopM + 20, 0), b: v(face + sign * 30, DIM.anchorageTopM - 10, 0), color: COMPRESSION, count: 1, flow: false });
        }
      }
    } else if (id === 'suspenders') {
      for (const x of [-560, -320, -80, 160, 400]) {
        const mid = (deckTopM + mainCableHeightM(x, cableMidM)) / 2;
        for (const zSign of [-1, 1]) {
          out.push({ a: v(x, mid, zSign * DIM.halfWidthM), b: v(x, mid + 25, zSign * DIM.halfWidthM), color: TENSION, count: 1, flow: false });
          out.push({ a: v(x, mid, zSign * DIM.halfWidthM), b: v(x, mid - 25, zSign * DIM.halfWidthM), color: TENSION, count: 1, flow: false });
        }
      }
    } else if (id === 'towers' || id === 'piers') {
      // Squeezed: arrows pointing toward each other along the legs.
      for (const x of [-DIM.towerX, DIM.towerX]) {
        for (const zSign of [-1, 1]) {
          const z = zSign * (DIM.halfWidthM + 12);
          if (id === 'towers') {
            out.push({ a: v(x, DIM.towerTopM + 35, z), b: v(x, DIM.towerTopM - 5, z), color: COMPRESSION, count: 1, flow: false });
            out.push({ a: v(x, DIM.pierTopM - 20, z), b: v(x, DIM.pierTopM + 20, z), color: COMPRESSION, count: 1, flow: false });
          } else {
            out.push({ a: v(x, DIM.pierTopM + 40, z), b: v(x, DIM.pierTopM + 2, z), color: COMPRESSION, count: 1, flow: false });
            out.push({ a: v(x, DIM.pierBottomM - 30, z), b: v(x, DIM.pierBottomM + 4, z), color: COMPRESSION, count: 1, flow: false });
          }
        }
      }
    } else if (id === 'deck') {
      // The deck's weight hangs on the suspenders: weight down, suspenders pulling up.
      for (const x of [-480, -240, 0, 240, 480]) {
        out.push({ a: v(x, deckTopM + 30, 0), b: v(x, deckTopM + 2, 0), color: WEIGHT, count: 1, flow: false });
        for (const zSign of [-1, 1]) out.push({ a: v(x, deckTopM + 2, zSign * DIM.halfWidthM), b: v(x, deckTopM + 30, zSign * DIM.halfWidthM), color: TENSION, count: 1, flow: false });
      }
    }
    return out;
  };

  /** The load path from a point of the main span: deck, suspenders, cables, towers and piers, side cables and anchorages. */
  const loadRuns = (fraction: number): ArrowRun[] => {
    const x = -DIM.towerX + 2 * DIM.towerX * clamp01(fraction);
    const out: ArrowRun[] = [];
    out.push({ a: v(x, deckTopM + 40, 0), b: v(x, deckTopM + 4, 0), color: LOAD, count: 1, flow: false });
    for (const zSign of [-1, 1]) {
      const z = zSign * DIM.halfWidthM;
      out.push({ a: v(x, deckTopM, z), b: cablePoint(x, zSign), color: LOAD, count: 2, flow: true });
      for (const towerX of [-DIM.towerX, DIM.towerX]) {
        const steps = 6;
        for (let i = 0; i < steps; i++) {
          const x0 = x + ((towerX - x) * i) / steps;
          const x1 = x + ((towerX - x) * (i + 1)) / steps;
          out.push({ a: cablePoint(x0, zSign), b: cablePoint(x1, zSign), color: LOAD, count: 1, flow: true });
        }
        out.push({ a: v(towerX, DIM.towerTopM, z), b: v(towerX, DIM.pierTopM, z), color: COMPRESSION, count: 4, flow: true });
        const sign = Math.sign(towerX);
        const entry = sign * (DIM.anchorageCentreM - DIM.anchorageHalfXM);
        out.push({ a: cablePoint(towerX, zSign), b: v(entry, DIM.cableEntryM, z), color: TENSION, count: 3, flow: true });
      }
    }
    return out;
  };

  /** A lesson's load point, else the general load path (a load in the middle), else none. */
  const shownLoad = () => loadAt ?? (loadPathOn ? 0.5 : null);

  const writeArrows = () => {
    const load = shownLoad();
    runs = [...(forcesPart ? forceRuns(forcesPart) : []), ...(load !== null ? loadRuns(load) : [])];
    let index = 0;
    const phase = still ? 0.5 : (time * ARROW_FLOW) % 1;
    for (const run of runs) {
      for (let k = 0; k < run.count && index < MAX_ARROWS; k++) {
        const t = run.flow ? (k + phase) / run.count : 1;
        direction.subVectors(run.b, run.a);
        const tip = new THREE.Vector3().copy(run.a).addScaledVector(direction, t);
        quaternion.setFromUnitVectors(up, direction.lengthSq() > 0 ? direction.normalize() : up);
        // The arrow geometry points along +Y with its tip at the origin.
        matrix.compose(tip.multiplyScalar(S), quaternion, scale.set(1, 1, 1));
        arrows.setMatrixAt(index, matrix);
        arrows.setColorAt(index, run.color);
        index++;
      }
    }
    arrows.count = index;
    arrows.instanceMatrix.needsUpdate = true;
    if (arrows.instanceColor) arrows.instanceColor.needsUpdate = true;
    if (load !== null) {
      const x = -DIM.towerX + 2 * DIM.towerX * clamp01(load);
      loadMarker.position.set(x * S, (deckTopM + 3.2) * S, 4 * S);
      loadMarker.visible = true;
    } else loadMarker.visible = false;
  };

  const writeWind = () => {
    const s = windStrength ?? 0;
    for (let i = 0; i < quality.windCount; i++) {
      matrix.compose(position.set(windX[i], windY[i], windZ[i]), quaternion.identity(), scale.set(1, 1, 0.6 + 1.8 * s));
      wind.setMatrixAt(i, matrix);
    }
    wind.instanceMatrix.needsUpdate = true;
    windMaterial.opacity = 0.35 + 0.6 * s;
  };

  applyVisibility();
  applyLook();
  writeArrows();

  return {
    root,
    partIds,
    topY,
    envelopeParts: new Set<string>(['anchorages']),
    // Seen from three-quarters on, so both towers fit beside the side panels; halfLength keeps the towers (+-640 m) in view.
    overview: { targetY: 9, distance: 150, azimuth: 58, elevation: 13, halfLength: DIM.towerX * S },
    part: (id) => (knownParts.has(id) ? partGroup(id as GoldenGatePartId) : undefined),
    heightToY: (metres) => metres * S,
    setView(next) {
      view = next;
      applyVisibility();
      applyLook();
    },
    setConstructionProgress(progress01) {
      progress = clamp01(progress01);
      if (view === 'construction') applyVisibility();
    },
    setHighlight(ids) {
      highlight = new Set((ids ?? []).filter((id) => knownParts.has(id)));
      applyLook();
    },
    setLoadPath(on) {
      // The general load path: the same route as a load in the middle of the bridge.
      loadPathOn = on;
      writeArrows();
    },
    setForces(partId) {
      forcesPart = partId && knownParts.has(partId) ? partId : null;
      writeArrows();
    },
    setLoadPoint(fraction01, cable = 'normal') {
      loadAt = fraction01 === null ? null : clamp01(fraction01);
      const mid = DIM.cableTopM - 2 * DIM.towerX * (cable === 'flat' && fraction01 !== null ? GOLDEN_GATE_SAG_RATIO.flat : GOLDEN_GATE_SAG_RATIO.normal);
      if (mid !== cableMidM) {
        cableMidM = mid;
        writeStructure();
      }
      writeArrows();
    },
    setWind(strength01) {
      windStrength = strength01 === null ? null : clamp01(strength01);
      wind.visible = windStrength !== null;
      if (windStrength !== null) writeWind();
    },
    applyTextures(textures) {
      if (disposed) return;
      for (const material of concreteMaterials) {
        material.map = textures.concrete ?? null;
        material.needsUpdate = true;
      }
      landMaterial.map = textures.ground ?? null;
      landMaterial.needsUpdate = true;
    },
    setReducedMotion(on) {
      still = on;
      writeArrows();
    },
    update(deltaSeconds) {
      if (disposed) return;
      const dt = still ? 0 : Math.min(Math.max(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0), 0.1);
      time += dt;
      if (windStrength !== null) {
        const speed = 8 + 30 * windStrength;
        for (let i = 0; i < quality.windCount; i++) {
          windZ[i] += speed * dt;
          if (windZ[i] > WIND_Z_END) windZ[i] -= WIND_Z_END - WIND_Z_START;
        }
        writeWind();
      }
      if (runs.some((run) => run.flow)) writeArrows();
    },
    pick(object) {
      for (let node: THREE.Object3D | null = object; node; node = node.parent) {
        const id = node.userData.partId;
        if (typeof id === 'string' && knownParts.has(id)) return id;
        if (node === root) break;
      }
      return null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      root.traverse((object) => {
        if (object instanceof THREE.InstancedMesh) object.dispose();
        if (object instanceof THREE.Mesh) ownedGeometries.add(object.geometry);
      });
      for (const g of ownedGeometries) g.dispose();
      for (const material of ownedMaterials) material.dispose();
      ownedGeometries.clear();
      ownedMaterials.clear();
    },
  };
}

/** An arrow pointing along +Y with its tip at the origin (head and shaft as one geometry). */
function mergeArrow(): THREE.BufferGeometry {
  const head = new THREE.ConeGeometry(0.55, 1.4, 10).translate(0, -0.7, 0).toNonIndexed();
  const shaft = new THREE.CylinderGeometry(0.16, 0.16, 2.2, 6).translate(0, -2.5, 0).toNonIndexed();
  const count = head.attributes.position.count + shaft.attributes.position.count;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  positions.set(head.attributes.position.array as Float32Array, 0);
  normals.set(head.attributes.normal.array as Float32Array, 0);
  positions.set(shaft.attributes.position.array as Float32Array, head.attributes.position.count * 3);
  normals.set(shaft.attributes.normal.array as Float32Array, head.attributes.position.count * 3);
  head.dispose();
  shaft.dispose();
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return merged;
}
