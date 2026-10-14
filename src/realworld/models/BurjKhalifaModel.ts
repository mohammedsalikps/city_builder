/**
 * Procedural 3D learning model of the Burj Khalifa for the Real World Explorer.
 *
 * APPROXIMATE BY DESIGN. The shape follows the sourced structural idea (a
 * Y-shaped plan of three wings at 120 degrees around a hexagonal core, wings
 * stepping back in an upward spiral, reinforced concrete to about level 156
 * (~585 m) and a steel spire to 828 m, a piled raft below ground), but plan
 * sizes, setback heights, the podium, the foundation depth and the pile layout
 * are visual approximations, not survey data. Piles are a representative set,
 * not the real count or layout.
 *
 * Headless-safe: geometry and materials only. No textures are loaded; callers
 * may inject textures, which are never disposed by the model.
 *
 * Scale: SCENE_SCALE (1 unit = 10 m), ground at y = 0, top of the spire at
 * 82.8 units. Every part mesh carries `userData.partId`; helper meshes (ground,
 * arrows, wind) carry `userData.partId = null`.
 */
import * as THREE from 'three';
import { exaggeratedSwayMetres } from '@/realworld/physics';
import { CONSTRUCTION_PROGRESS, SCENE_SCALE, builtHeightForProgress, clamp01 } from '@/realworld/types';

/** How the model is shown. */
export type LandmarkView = 'complete' | 'cutaway' | 'construction' | 'inspect';

/** What the explorer scene needs from any landmark model. */
export interface LandmarkModel {
  root: THREE.Group;
  readonly partIds: string[];
  /** The group holding a part's meshes, or undefined for an unknown id. */
  part(id: string): THREE.Object3D | undefined;
  /** Scene y for a real height in metres (negative = below ground). */
  heightToY(metres: number): number;
  /** Scene y of the top of the model. */
  readonly topY: number;
  /**
   * 'complete': opaque facade, foundation hidden under a solid ground.
   * 'cutaway': facade at 0.25 opacity (no depth writes), floors/core/wings shown, ground opened so raft and piles show.
   * 'construction': like complete but driven by setConstructionProgress (ground opened so the foundation work shows).
   * 'inspect': ground opened; highlighted parts solid and glowing, everything else dim (with no highlight it looks like 'cutaway').
   */
  setView(view: LandmarkView): void;
  /** 0 = empty site .. 1 = finished. Shown while the view is 'construction' (remembered otherwise). */
  setConstructionProgress(progress01: number): void;
  setHighlight(partIds: string[] | null): void;
  setLoadPath(on: boolean): void;
  /** Wind slider 0..1, or null to remove the wind effect and reset the sway. */
  setWind(strength01: number | null): void;
  update(deltaSeconds: number): void;
  /** Reduced motion: arrows, wind streaks and sway stand still (where they point and how far the tower leans stay). */
  setReducedMotion?(on: boolean): void;
  /** The part id an object (e.g. a raycast hit) belongs to, or null. */
  pick(object: THREE.Object3D): string | null;
  /** Outer-skin parts (faded in the cutaway): a tap that only crosses see-through parts prefers an inner part (see realworld/picking). */
  readonly envelopeParts: ReadonlySet<string>;
  /** For models made from a downloaded file: whether the file was used, or a built-in fallback had to be drawn instead. */
  readonly origin?: 'downloaded' | 'built-in';
  /** Models that can take the ground and concrete photos without being rebuilt (the others are rebuilt when they arrive). */
  applyTextures?(textures: { ground?: THREE.Texture; concrete?: THREE.Texture }): void;
  /**
   * Overview framing for landmarks that are wide rather than tall (a
   * bridge): look-at height and distance in scene units. Missing = framed
   * from the model's height.
   */
  readonly overview?: {
    targetY: number;
    /** The nearest the overview camera comes, scene units. */
    distance: number;
    azimuth: number;
    elevation: number;
    /** Half the landmark's length along x (scene units) to keep in view: the camera steps back until it fits the free part of the screen. */
    halfLength?: number;
  };
  /** Force arrows on one part (pulled = tension, squeezed = compression), or null to hide them. */
  setForces?(partId: string | null): void;
  /**
   * A load standing on the deck at a fraction of the main span (0..1) and the
   * route its weight takes, or null to hide it. 'flat' redraws the main
   * cables with a hypothetical flatter sag for comparison.
   */
  setLoadPoint?(fraction01: number | null, cable?: 'normal' | 'flat'): void;
  dispose(): void;
}

export interface BurjKhalifaOptions {
  quality?: 'low' | 'high';
  textures?: { ground?: THREE.Texture; concrete?: THREE.Texture };
}

/** Part ids of the model; they match the landmark's `parts`. */
export const BURJ_MODEL_PART_IDS = ['piles', 'raft', 'podium', 'core', 'wing-a', 'wing-b', 'wing-c', 'floors', 'mechanical', 'facade', 'spire'] as const;
export type BurjPartId = (typeof BURJ_MODEL_PART_IDS)[number];

const S = SCENE_SCALE;

/** Model dimensions in metres. "Sourced" values come from the landmark's facts; the rest are visual approximations. */
const DIM = {
  /** Sourced: architectural top 828 m (CTBUH). */
  topM: 828,
  /** Sourced: reinforced concrete to about level 156, about 585 m; structural steel above. */
  concreteTopM: 585,
  /** Sourced: 163 floors above ground (CTBUH). Drawn evenly spaced up to the concrete top. */
  levels: 163,
  /** Sourced (medium): about 24-26 setbacks. Drawn as 24, eight per wing; the last one of each wing ends it. */
  setbacks: 24,
  firstSetbackM: 70,
  lastSetbackM: 555,
  wingBaseLengthM: 60,
  wingTopLengthM: 26,
  wingWidthM: 28,
  coreRadiusM: 14,
  podiumTopRadiusM: 84,
  podiumBottomRadiusM: 88,
  podiumHeightM: 9,
  raftTopM: -2,
  /** Sourced: raft 3.7 m thick (official site). */
  raftThicknessM: 3.7,
  raftRadiusM: 68,
  /** Sourced: piles 1.5 m in diameter, 43 m long (official site; other sources say about 45-50 m). */
  pileDiameterM: 1.5,
  pileLengthM: 43,
  /** Where the cladded lower spire meets the slender pinnacle. */
  spireJointM: 700,
  spireBaseRadiusM: 12,
  spireJointRadiusM: 5.5,
  pinnacleBaseRadiusM: 3,
  pinnacleTipRadiusM: 0.6,
  slabThicknessM: 0.7,
  groundRadiusM: 900,
  pitRadiusM: 150,
  pitDepthM: 60,
} as const;

/** Wing directions: 120 degrees apart. Setbacks go A, B, C, A... clockwise seen from above (the wind-test redesign made them clockwise). */
const WINGS: ReadonlyArray<{ id: BurjPartId; angle: number }> = [
  { id: 'wing-a', angle: Math.PI / 2 },
  { id: 'wing-b', angle: Math.PI / 2 - (2 * Math.PI) / 3 },
  { id: 'wing-c', angle: Math.PI / 2 - (4 * Math.PI) / 3 },
];

/** Facade start in construction progress: the outer skin lags the structure and finishes at 1. */
const FACADE_START = 0.15;
/** Cutaway opacity per part (others stay opaque). */
const CUTAWAY_OPACITY: Partial<Record<BurjPartId, number>> = { facade: 0.25, podium: 0.35 };
/** Opacity of parts that are not highlighted in the 'inspect' view. */
const DIM_OPACITY = 0.12;
const HIGHLIGHT_EMISSIVE = 0xffc23d;
/** Visual sway period in seconds (a gentle animation, not the real building's period). */
const SWAY_PERIOD_S = 3.2;
const ARROW_SPACING = 2.6;
const ARROW_FLOW_SPEED = 2.2;
const WIND_X_START = -48;
const WIND_X_END = -7;

interface QualitySettings {
  capSegments: number;
  pileSegments: number;
  pileCount: number;
  windCount: number;
  groundSegments: number;
  podiumSegments: number;
}

const QUALITY: Record<'low' | 'high', QualitySettings> = {
  high: { capSegments: 24, pileSegments: 10, pileCount: 192, windCount: 160, groundSegments: 72, podiumSegments: 48 },
  low: { capSegments: 12, pileSegments: 6, pileCount: 64, windCount: 70, groundSegments: 40, podiumSegments: 24 },
};

interface WingTier {
  baseM: number;
  topM: number;
  lengthM: number;
}

/** A vertical slice that construction progress can clip by scaling y (its geometry spans y 0..1). */
interface ClipTier {
  object: THREE.Object3D;
  baseY: number;
  heightY: number;
}

/** Height of setback `index` (0..23), spread evenly: an illustrative pattern. */
function setbackHeightM(index: number): number {
  const t = index / (DIM.setbacks - 1);
  return DIM.firstSetbackM + (DIM.lastSetbackM - DIM.firstSetbackM) * t;
}

/** The tiers of one wing: it steps back at every third setback and ends at its last one. */
function wingTiers(wing: number): WingTier[] {
  const perWing = DIM.setbacks / 3;
  const tiers: WingTier[] = [];
  for (let k = 0; k < perWing; k++) {
    tiers.push({
      baseM: k === 0 ? 0 : setbackHeightM(3 * (k - 1) + wing),
      topM: setbackHeightM(3 * k + wing),
      lengthM: DIM.wingBaseLengthM + ((DIM.wingTopLengthM - DIM.wingBaseLengthM) * k) / (perWing - 1),
    });
  }
  return tiers;
}

/** Centre-to-tip length of a wing at a height, metres (0 once the wing has ended). */
function wingLengthAtM(tiers: WingTier[], heightM: number): number {
  for (const tier of tiers) if (heightM >= tier.baseM && heightM < tier.topM) return tier.lengthM;
  return 0;
}

/** Height of floor plate `level` (1..163), metres: evenly spaced up to the concrete top. */
function levelHeightM(level: number): number {
  return (level * DIM.concreteTopM) / DIM.levels;
}

/** Centre heights of the seven double-height mechanical floors, metres: illustrative, evenly spread. */
function mechanicalHeightsM(): number[] {
  return Array.from({ length: 7 }, (_, k) => (DIM.concreteTopM * (k + 1)) / 8);
}

/** A representative pile layout: a hex grid inside a circle, nearest `count` points to the centre. */
function pilePositions(count: number, radius: number): Array<[number, number]> {
  const spacing = Math.sqrt((Math.PI * radius * radius) / count) * 0.9;
  const steps = Math.ceil(radius / spacing) + 1;
  const points: Array<[number, number]> = [];
  for (let j = -steps; j <= steps; j++) {
    for (let i = -steps; i <= steps; i++) {
      const x = (i + (j % 2 !== 0 ? 0.5 : 0)) * spacing;
      const z = j * spacing * 0.866;
      if (x * x + z * z <= radius * radius) points.push([x, z]);
    }
  }
  points.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  return points.slice(0, count);
}

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

/** Geometry spanning y 0..1 so a mesh's scale.y is its height. */
function unitHeight(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  return geometry.translate(0, 0.5, 0);
}

/** Marks an object as a non-part helper (ground, arrows, wind). */
function helper<T extends THREE.Object3D>(object: T): T {
  object.userData.partId = null;
  return object;
}

/** Builds the Burj Khalifa learning model. */
export function buildBurjKhalifa(opts: BurjKhalifaOptions = {}): LandmarkModel {
  const quality = QUALITY[opts.quality ?? 'high'];
  const root = new THREE.Group();
  root.name = 'burj-khalifa';
  /** Everything above ground that sways in the wind (pivot at the ground). */
  const tower = new THREE.Group();
  tower.name = 'tower';
  root.add(tower);

  const ownedGeometries = new Set<THREE.BufferGeometry>();
  const geometry = <T extends THREE.BufferGeometry>(g: T): T => {
    ownedGeometries.add(g);
    return g;
  };

  // --- Base materials (cloned once per part so highlights never leak) ---
  const base = {
    glass: new THREE.MeshStandardMaterial({ color: 0xbcd2e4, metalness: 0.85, roughness: 0.18 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xc8c2b7, roughness: 0.9, metalness: 0, map: opts.textures?.concrete ?? null }),
    slab: new THREE.MeshStandardMaterial({ color: 0xdcd7cd, roughness: 0.85, metalness: 0 }),
    raft: new THREE.MeshStandardMaterial({ color: 0xa8a298, roughness: 0.95, metalness: 0, map: opts.textures?.concrete ?? null }),
    pile: new THREE.MeshStandardMaterial({ color: 0x8e887e, roughness: 0.95, metalness: 0 }),
    mechanical: new THREE.MeshStandardMaterial({ color: 0x6c7682, roughness: 0.6, metalness: 0.4 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xd5dce3, roughness: 0.25, metalness: 0.9 }),
    podium: new THREE.MeshStandardMaterial({ color: 0x9fb4c6, roughness: 0.3, metalness: 0.6 }),
  };
  const sand = new THREE.MeshStandardMaterial({ color: 0xdcc69c, roughness: 1, metalness: 0, map: opts.textures?.ground ?? null });
  const soil = new THREE.MeshStandardMaterial({ color: 0xa88b5f, roughness: 1, metalness: 0, side: THREE.BackSide });
  const soilFloor = new THREE.MeshStandardMaterial({ color: 0x8f7650, roughness: 1, metalness: 0 });
  const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
  const windMaterial = new THREE.MeshBasicMaterial({ color: 0x2f8cff, transparent: true, opacity: 0.5, depthWrite: false });

  // --- Part registry ---
  const parts = new Map<BurjPartId, { group: THREE.Group; materials: THREE.MeshStandardMaterial[] }>();
  const partMaterialCache = new Map<string, THREE.MeshStandardMaterial>();
  for (const id of BURJ_MODEL_PART_IDS) {
    const group = new THREE.Group();
    group.name = id;
    group.userData.partId = id;
    parts.set(id, { group, materials: [] });
  }
  const partGroup = (id: BurjPartId): THREE.Group => parts.get(id)!.group;
  /** The part's own clone of a base material (made once per part). */
  const partMaterial = (id: BurjPartId, material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
    const key = `${id}|${material.uuid}`;
    let clone = partMaterialCache.get(key);
    if (!clone) {
      clone = material.clone();
      partMaterialCache.set(key, clone);
      parts.get(id)!.materials.push(clone);
    }
    return clone;
  };
  const partMesh = (id: BurjPartId, g: THREE.BufferGeometry, material: THREE.MeshStandardMaterial): THREE.Mesh => {
    const mesh = new THREE.Mesh(g, partMaterial(id, material));
    mesh.userData.partId = id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  const partInstances = (id: BurjPartId, g: THREE.BufferGeometry, material: THREE.MeshStandardMaterial, count: number): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(g, partMaterial(id, material), count);
    mesh.userData.partId = id;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  // --- Shared unit geometries ---
  const unitBox = geometry(new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0));
  const unitCap = geometry(unitHeight(new THREE.CylinderGeometry(1, 1, 1, quality.capSegments)));
  const unitHex = geometry(unitHeight(new THREE.CylinderGeometry(1, 1, 1, 6)));

  const coreR = DIM.coreRadiusM * S;
  const wingW = DIM.wingWidthM * S;
  const concreteTopY = DIM.concreteTopM * S;
  const raftTopY = DIM.raftTopM * S;
  const raftBottomY = raftTopY - DIM.raftThicknessM * S;
  const pileLength = DIM.pileLengthM * S;
  const topY = DIM.topM * S;
  const quaternions = WINGS.map((wing) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), wing.angle));
  const directions = WINGS.map((wing) => new THREE.Vector2(Math.cos(wing.angle), -Math.sin(wing.angle)));
  const tiersByWing = WINGS.map((_, index) => wingTiers(index));

  // --- Foundation: piles and raft (below ground) ---
  const pileGeometry = geometry(new THREE.CylinderGeometry((DIM.pileDiameterM / 2) * S, (DIM.pileDiameterM / 2) * S, pileLength, quality.pileSegments, 1, true));
  const pileSpots = pilePositions(quality.pileCount, DIM.raftRadiusM * S * 0.866 * 0.92);
  const piles = partInstances('piles', pileGeometry, base.pile, pileSpots.length);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const identity = new THREE.Quaternion();
  pileSpots.forEach(([x, z], index) => {
    piles.setMatrixAt(index, matrix.compose(position.set(x, raftBottomY - pileLength / 2, z), identity, scale.set(1, 1, 1)));
  });
  partGroup('piles').add(piles);

  const raft = partMesh('raft', unitHex, base.raft);
  raft.position.y = raftBottomY;
  raft.scale.set(DIM.raftRadiusM * S, DIM.raftThicknessM * S, DIM.raftRadiusM * S);
  partGroup('raft').add(raft);

  // --- Podium (simple round platform; the real podium is more complex) ---
  const podiumHeight = DIM.podiumHeightM * S;
  const podium = partMesh(
    'podium',
    geometry(unitHeight(new THREE.CylinderGeometry(DIM.podiumTopRadiusM * S, DIM.podiumBottomRadiusM * S, 1, quality.podiumSegments))),
    base.podium,
  );
  podium.scale.y = podiumHeight;
  partGroup('podium').add(podium);

  // --- Core (hexagonal, from the raft to the concrete top) ---
  const core = partMesh('core', unitHex, base.concrete);
  core.position.y = raftTopY;
  core.scale.set(coreR, concreteTopY - raftTopY, coreR);
  partGroup('core').add(core);

  // --- Wings (structural spine walls) and facade lobes, tier by tier ---
  const structureTiers: ClipTier[] = [];
  const facadeTiers: ClipTier[] = [];
  WINGS.forEach((wing, index) => {
    for (const tier of tiersByWing[index]) {
      const baseY = tier.baseM * S;
      const heightY = (tier.topM - tier.baseM) * S;
      const length = tier.lengthM * S;

      const wallSlice = new THREE.Group();
      wallSlice.position.y = baseY;
      wallSlice.rotation.y = wing.angle;
      wallSlice.scale.y = heightY;
      wallSlice.userData.partId = wing.id;
      const wall = partMesh(wing.id, unitBox, base.concrete);
      const wallStart = coreR * 0.6;
      wall.position.x = wallStart;
      wall.scale.set(Math.max(0.2, length - 0.6 - wallStart), 1, 0.45);
      wallSlice.add(wall);
      partGroup(wing.id).add(wallSlice);
      structureTiers.push({ object: wallSlice, baseY, heightY });

      const lobe = new THREE.Group();
      lobe.position.y = baseY;
      lobe.rotation.y = wing.angle;
      lobe.scale.y = heightY;
      lobe.userData.partId = 'facade';
      const body = partMesh('facade', unitBox, base.glass);
      body.scale.set(length - wingW / 2, 1, wingW);
      const cap = partMesh('facade', unitCap, base.glass);
      cap.position.x = length - wingW / 2;
      cap.scale.set(wingW / 2, 1, wingW / 2);
      lobe.add(body, cap);
      partGroup('facade').add(lobe);
      facadeTiers.push({ object: lobe, baseY, heightY });
    }
  });
  // The glass around the core shows above the point where the wings end.
  const coreShell = partMesh('facade', unitHex, base.glass);
  coreShell.scale.set(coreR + 0.15, 1, coreR + 0.15);
  const coreShellSlice = new THREE.Group();
  coreShellSlice.scale.y = concreteTopY;
  coreShellSlice.userData.partId = 'facade';
  coreShellSlice.add(coreShell);
  partGroup('facade').add(coreShellSlice);
  facadeTiers.push({ object: coreShellSlice, baseY: 0, heightY: concreteTopY });

  // --- Floor plates: one per level and wing, ordered bottom-up so a count reveals them in order ---
  const slab = DIM.slabThicknessM * S;
  /**
   * Plate size (length along the wing, width across it) at a height: it reaches
   * just inside the rounded wing tip, or stays hidden inside the core once
   * that wing has ended.
   */
  const plateSize = (wing: number, heightM: number, extra: number, width: number): [number, number] => {
    const lengthM = wingLengthAtM(tiersByWing[wing], heightM);
    return lengthM > 0 ? [lengthM * S - wingW / 2 + extra, width] : [coreR * 0.6, coreR * 0.6];
  };
  const floors = partInstances('floors', unitBox, base.slab, DIM.levels * WINGS.length);
  const floorHeightsY: number[] = [];
  for (let level = 1; level <= DIM.levels; level++) {
    const heightM = levelHeightM(level);
    floorHeightsY.push(heightM * S);
    WINGS.forEach((_, wing) => {
      const index = (level - 1) * WINGS.length + wing;
      // A tiny per-wing lift keeps the overlapping plates near the core from flickering (z-fighting).
      const y = heightM * S - slab + wing * 0.004;
      const [length, width] = plateSize(wing, heightM, 0.45, wingW - 0.3);
      floors.setMatrixAt(index, matrix.compose(position.set(0, y, 0), quaternions[wing], scale.set(length, slab, width)));
    });
  }
  partGroup('floors').add(floors);

  // --- Mechanical floors: seven double-height bands (positions illustrative) ---
  const mechanicalY = mechanicalHeightsM().map((m) => m * S);
  const bandHeight = 2 * (DIM.concreteTopM / DIM.levels) * S;
  const mechanical = partInstances('mechanical', unitBox, base.mechanical, mechanicalY.length * WINGS.length);
  mechanicalY.forEach((y, band) => {
    WINGS.forEach((_, wing) => {
      const [length, width] = plateSize(wing, y / S, 0.5, wingW - 0.24);
      const bottom = y - bandHeight / 2 + wing * 0.004;
      mechanical.setMatrixAt(band * WINGS.length + wing, matrix.compose(position.set(0, bottom, 0), quaternions[wing], scale.set(length, bandHeight, width)));
    });
  });
  partGroup('mechanical').add(mechanical);

  // --- Steel spire: a cladded lower section and a slender pinnacle (proportions approximate) ---
  const spire = partGroup('spire');
  const lowerHeight = (DIM.spireJointM - DIM.concreteTopM) * S;
  const pinnacleHeight = (DIM.topM - DIM.spireJointM) * S;
  const lowerSpire = partMesh(
    'spire',
    geometry(new THREE.CylinderGeometry(DIM.spireJointRadiusM * S, DIM.spireBaseRadiusM * S, lowerHeight, 12).translate(0, lowerHeight / 2, 0)),
    base.steel,
  );
  const pinnacle = partMesh(
    'spire',
    geometry(new THREE.CylinderGeometry(DIM.pinnacleTipRadiusM * S, DIM.pinnacleBaseRadiusM * S, pinnacleHeight, 10).translate(0, lowerHeight + pinnacleHeight / 2, 0)),
    base.steel,
  );
  spire.add(lowerSpire, pinnacle);
  spire.position.y = concreteTopY;

  for (const id of ['piles', 'raft', 'podium'] as const) root.add(partGroup(id));
  for (const id of ['core', 'wing-a', 'wing-b', 'wing-c', 'floors', 'mechanical', 'facade', 'spire'] as const) tower.add(partGroup(id));

  // --- Ground: a solid disc, or a disc with a hole and a pit so the foundation shows ---
  const groundRadius = DIM.groundRadiusM * S;
  const pitRadius = DIM.pitRadiusM * S;
  const pitDepth = DIM.pitDepthM * S;
  const groundSolid = helper(new THREE.Mesh(geometry(new THREE.CircleGeometry(groundRadius, quality.groundSegments).rotateX(-Math.PI / 2)), sand));
  const groundCut = helper(new THREE.Mesh(geometry(new THREE.RingGeometry(pitRadius, groundRadius, quality.groundSegments, 1).rotateX(-Math.PI / 2)), sand));
  const pitWall = helper(new THREE.Mesh(geometry(new THREE.CylinderGeometry(pitRadius, pitRadius, pitDepth, quality.groundSegments, 1, true).translate(0, -pitDepth / 2, 0)), soil));
  const pitFloor = helper(new THREE.Mesh(geometry(new THREE.CircleGeometry(pitRadius, quality.groundSegments).rotateX(-Math.PI / 2).translate(0, -pitDepth, 0)), soilFloor));
  for (const mesh of [groundSolid, groundCut, pitFloor]) mesh.receiveShadow = true;
  const ground = helper(new THREE.Group());
  ground.name = 'ground';
  ground.add(groundSolid, groundCut, pitWall, pitFloor);
  root.add(ground);

  // --- Load path arrows: downward along the core and wings, into the raft and piles ---
  const arrowHead = geometry(new THREE.ConeGeometry(0.32, 0.7, 10).rotateX(Math.PI).translate(0, 0.35, 0));
  const arrowShaft = geometry(new THREE.CylinderGeometry(0.09, 0.09, 1, 6).translate(0, 1.2, 0));
  const tracks: Array<{ x: number; z: number; top: number; bottom: number; first: number; count: number }> = [];
  const addTrack = (x: number, z: number, top: number, bottom: number) => {
    const count = Math.max(1, Math.floor((top - bottom) / ARROW_SPACING));
    const first = tracks.reduce((sum, track) => sum + track.count, 0);
    tracks.push({ x, z, top, bottom, first, count });
  };
  addTrack(0, 0, concreteTopY + 8, raftTopY);
  WINGS.forEach((_, wing) => {
    const lastTier = tiersByWing[wing][tiersByWing[wing].length - 1];
    addTrack(directions[wing].x * 2.6, directions[wing].y * 2.6, lastTier.topM * S - 0.5, raftTopY);
  });
  for (let k = 0; k < 6; k++) {
    const angle = (k * Math.PI) / 3 + Math.PI / 6;
    addTrack(Math.cos(angle) * 3.4, Math.sin(angle) * 3.4, raftBottomY - 0.1, raftBottomY - pileLength + 0.4);
  }
  const arrowCount = tracks.reduce((sum, track) => sum + track.count, 0);
  const arrowHeads = helper(new THREE.InstancedMesh(arrowHead, arrowMaterial, arrowCount));
  const arrowShafts = helper(new THREE.InstancedMesh(arrowShaft, arrowMaterial, arrowCount));
  for (const mesh of [arrowHeads, arrowShafts]) {
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
  }
  const loadPath = helper(new THREE.Group());
  loadPath.name = 'load-path';
  loadPath.add(arrowHeads, arrowShafts);
  loadPath.visible = false;
  root.add(loadPath);

  /** Places the arrows; they drift slowly downward so the direction of the load path reads clearly. */
  const writeArrows = (time: number) => {
    const offset = (time * ARROW_FLOW_SPEED) % ARROW_SPACING;
    for (const track of tracks) {
      const span = track.count * ARROW_SPACING;
      for (let j = 0; j < track.count; j++) {
        const along = (j * ARROW_SPACING + offset) % span;
        const tipY = Math.max(track.bottom, track.top - along - 1.7);
        matrix.compose(position.set(track.x, tipY, track.z), identity, scale.set(1, 1, 1));
        arrowHeads.setMatrixAt(track.first + j, matrix);
        arrowShafts.setMatrixAt(track.first + j, matrix);
      }
    }
    arrowHeads.instanceMatrix.needsUpdate = true;
    arrowShafts.instanceMatrix.needsUpdate = true;
  };
  writeArrows(0);

  // --- Wind: streaks flowing toward the tower from -X ---
  const windGeometry = geometry(new THREE.ConeGeometry(0.22, 1.8, 6).rotateZ(-Math.PI / 2));
  const wind = helper(new THREE.InstancedMesh(windGeometry, windMaterial, quality.windCount));
  wind.frustumCulled = false;
  wind.visible = false;
  wind.name = 'wind';
  root.add(wind);
  const random = seededRandom(828);
  const windX = new Float32Array(quality.windCount);
  const windY = new Float32Array(quality.windCount);
  const windZ = new Float32Array(quality.windCount);
  const windPace = new Float32Array(quality.windCount);
  for (let i = 0; i < quality.windCount; i++) {
    windX[i] = WIND_X_START + random() * (WIND_X_END - WIND_X_START);
    windY[i] = 1 + random() * (topY - 4);
    windZ[i] = (random() - 0.5) * 18;
    windPace[i] = 0.7 + random() * 0.6;
  }

  // --- State ---
  const partIds: string[] = [...BURJ_MODEL_PART_IDS];
  const knownParts = new Set<string>(partIds);
  let view: LandmarkView = 'complete';
  let progress = 1;
  let highlight = new Set<string>();
  let windStrength: number | null = null;
  let time = 0;
  /** Reduced motion: nothing drifts or swings. */
  let still = false;
  let disposed = false;

  const writeWind = () => {
    const s = windStrength ?? 0;
    const stretch = 0.6 + 1.8 * s;
    for (let i = 0; i < quality.windCount; i++) {
      matrix.compose(position.set(windX[i], windY[i], windZ[i]), identity, scale.set(stretch, 1, 1));
      wind.setMatrixAt(i, matrix);
    }
    wind.instanceMatrix.needsUpdate = true;
    windMaterial.opacity = 0.35 + 0.6 * s;
  };

  /** Tilts the tower about its base so the top moves downwind by the exaggerated sway. */
  const applySway = () => {
    if (windStrength === null) {
      tower.rotation.z = 0;
      return;
    }
    const swing = still ? 0.75 : 0.75 + 0.25 * Math.sin((2 * Math.PI * time) / SWAY_PERIOD_S);
    const displacement = exaggeratedSwayMetres(windStrength) * S * swing;
    tower.rotation.z = -Math.atan2(displacement, topY);
  };

  const clip = (tier: ClipTier, limitY: number) => {
    const height = Math.min(tier.heightY, limitY - tier.baseY);
    tier.object.visible = height > 1e-4;
    tier.object.scale.y = tier.object.visible ? height : tier.heightY;
  };
  const countBelow = (heightsY: number[], limitY: number) => heightsY.filter((y) => y <= limitY + 1e-6).length;
  /** Shows the first `count` instances; cached bounds are dropped so raycasts and boxes see the new set. */
  const setCount = (mesh: THREE.InstancedMesh, count: number) => {
    if (mesh.count === count) return;
    mesh.count = count;
    mesh.boundingBox = null;
    mesh.boundingSphere = null;
  };

  /** Every part at full size (all views except 'construction'). */
  const showAll = (showFoundation: boolean) => {
    for (const { group } of parts.values()) group.visible = true;
    partGroup('piles').visible = showFoundation;
    partGroup('raft').visible = showFoundation;
    setCount(piles, pileSpots.length);
    raft.scale.y = DIM.raftThicknessM * S;
    podium.scale.y = podiumHeight;
    core.scale.y = concreteTopY - raftTopY;
    for (const tier of [...structureTiers, ...facadeTiers]) clip(tier, Number.POSITIVE_INFINITY);
    setCount(floors, DIM.levels * WINGS.length);
    setCount(mechanical, mechanicalY.length * WINGS.length);
    spire.position.y = concreteTopY;
  };

  /**
   * Construction progress: 0 = only the site; up to pilesDone the piles appear;
   * up to foundationDone the raft is poured; then the structure rises to the
   * height builtHeightForProgress gives (concrete parts to the concrete top,
   * then the spire is jacked up from inside); the facade lags behind and
   * finishes at 1.
   */
  const applyConstruction = () => {
    const p = clamp01(progress);
    const { pilesDone, foundationDone } = CONSTRUCTION_PROGRESS;
    const pileCount = p <= 0 ? 0 : Math.min(pileSpots.length, Math.ceil((pileSpots.length * p) / pilesDone));
    setCount(piles, pileCount);
    partGroup('piles').visible = pileCount > 0;
    const raftShare = clamp01((p - pilesDone) / (foundationDone - pilesDone));
    partGroup('raft').visible = raftShare > 0;
    raft.scale.y = DIM.raftThicknessM * S * Math.max(raftShare, 1e-3);

    const builtM = builtHeightForProgress(p, DIM.topM);
    const concreteY = Math.min(builtM, DIM.concreteTopM) * S;
    const rising = builtM > 0;
    partGroup('podium').visible = rising;
    podium.scale.y = podiumHeight * Math.max(1e-3, clamp01(builtM / DIM.podiumHeightM));
    partGroup('core').visible = rising;
    core.scale.y = Math.max(1e-3, concreteY - raftTopY);
    for (const tier of structureTiers) clip(tier, concreteY);
    for (const wing of WINGS) partGroup(wing.id).visible = rising;
    setCount(floors, WINGS.length * countBelow(floorHeightsY, concreteY));
    partGroup('floors').visible = floors.count > 0;
    setCount(mechanical, WINGS.length * countBelow(mechanicalY, concreteY));
    partGroup('mechanical').visible = mechanical.count > 0;

    const facadeY = Math.min(concreteY, clamp01((p - FACADE_START) / (1 - FACADE_START)) * concreteTopY);
    for (const tier of facadeTiers) clip(tier, facadeY);
    partGroup('facade').visible = facadeY > 0;

    const spireUp = builtM > DIM.concreteTopM;
    spire.visible = spireUp;
    spire.position.y = concreteTopY + (Math.min(builtM, DIM.topM) - DIM.topM) * S;
  };

  const applyVisibility = () => {
    const showFoundation = view !== 'complete';
    groundSolid.visible = !showFoundation;
    groundCut.visible = showFoundation;
    pitWall.visible = showFoundation;
    pitFloor.visible = showFoundation;
    if (view === 'construction') applyConstruction();
    else showAll(showFoundation);
  };

  /** Opacity and emissive tint for every part from the current view and highlight. */
  const applyLook = () => {
    const inspecting = view === 'inspect' && highlight.size > 0;
    for (const [id, { materials }] of parts) {
      const highlighted = highlight.has(id);
      let opacity = 1;
      if (inspecting) opacity = highlighted ? 1 : DIM_OPACITY;
      else if (view === 'cutaway' || view === 'inspect') opacity = CUTAWAY_OPACITY[id] ?? 1;
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

  applyVisibility();
  applyLook();

  return {
    root,
    partIds,
    topY,
    part: (id) => (knownParts.has(id) ? partGroup(id as BurjPartId) : undefined),
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
      loadPath.visible = on;
      if (on) writeArrows(time);
    },
    setWind(strength01) {
      windStrength = strength01 === null ? null : clamp01(strength01);
      wind.visible = windStrength !== null;
      if (windStrength !== null) writeWind();
      applySway();
    },
    setReducedMotion(on) {
      still = on;
      applySway();
      if (loadPath.visible) writeArrows(time);
    },
    update(deltaSeconds) {
      if (disposed) return;
      const dt = still ? 0 : Math.min(Math.max(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0), 0.1);
      time += dt;
      if (windStrength !== null) {
        const speed = 6 + 30 * windStrength;
        const span = WIND_X_END - WIND_X_START;
        for (let i = 0; i < quality.windCount; i++) {
          windX[i] += speed * windPace[i] * dt;
          if (windX[i] > WIND_X_END) windX[i] -= span;
        }
        writeWind();
        applySway();
      }
      if (loadPath.visible) writeArrows(time);
    },
    envelopeParts: new Set(Object.keys(CUTAWAY_OPACITY)),
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
      const materials = new Set<THREE.Material>([...Object.values(base), sand, soil, soilFloor, arrowMaterial, windMaterial, ...partMaterialCache.values()]);
      root.traverse((object) => {
        if (object instanceof THREE.InstancedMesh) object.dispose();
        if (object instanceof THREE.Mesh) ownedGeometries.add(object.geometry);
      });
      for (const g of ownedGeometries) g.dispose();
      for (const material of materials) material.dispose();
      ownedGeometries.clear();
    },
  };
}
