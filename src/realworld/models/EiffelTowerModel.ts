/**
 * The Eiffel Tower learning model, in scene units (SCENE_SCALE: 1 unit =
 * 10 m), base centred on the origin.
 *
 * Two ways to build it, with the same parts and behaviour:
 * - the downloaded model ("Eiffel Tower" by ingoenius, CC0, via 3DMR): a glTF
 *   scene in metres. Its pieces are sorted into the landmark's parts by
 *   height (measured from the file) and its see-through lattice textures are
 *   drawn as crisp cut-outs;
 * - a simplified lattice tower built in code, used when the downloaded model
 *   is not available (the screen says so).
 *
 * Underground foundations and the antennas are drawn in code for both: the
 * foundations as a schematic learning view, the antennas simply.
 */
import * as THREE from 'three';
import { exaggeratedSwayMetres } from '@/realworld/physics';
import { CONSTRUCTION_PROGRESS, SCENE_SCALE, builtHeightForProgress, clamp01 } from '@/realworld/types';
import type { LandmarkModel, LandmarkView } from '@/realworld/models/BurjKhalifaModel';

export const EIFFEL_MODEL_PART_IDS = ['foundations', 'pillars', 'arches', 'first-floor', 'legs', 'second-floor', 'upper-tower', 'top', 'antennas'] as const;
export type EiffelPartId = (typeof EIFFEL_MODEL_PART_IDS)[number];

export interface EiffelTowerOptions {
  quality?: 'low' | 'high';
  textures?: { ground?: THREE.Texture; concrete?: THREE.Texture };
  /**
   * The downloaded model's scene (glTF: metres, Y up, base at y = 0), or
   * null / missing for the built-in fallback. The model takes ownership and
   * disposes it.
   */
  source?: THREE.Object3D | null;
}

const S = SCENE_SCALE;

const DIM = {
  /** Sourced (official key figures): height today with the antennas, and the floors. */
  topM: 330,
  firstFloorM: 57,
  secondFloorM: 115,
  topFloorM: 276,
  /** Sourced: the four pillars stand on the corners of a square 125 m across, each 25 m wide on the ground. */
  baseHalfM: 62.5,
  pillarM: 25,
  /** Sourced: floor areas (m2) give the platform sizes of the built-in model. */
  firstFloorAreaM2: 4415,
  secondFloorAreaM2: 1430,
  topFloorAreaM2: 250,
  /** Where the iron structure ends and the antennas begin (the downloaded model is 300 m tall). Visual. */
  structureTopM: 300,
  /** Schematic, not sourced ("a few metres below ground"): the learning view's foundation blocks. */
  footingM: 30,
  footingHeightM: 8,
  footingTopM: -3,
  /** Visual: the ground disc and the opening that shows the foundations. */
  groundRadiusM: 1600,
  pitRadiusM: 95,
  pitDepthM: 14,
};

/**
 * Half-width of the tower's outline at a height (metres): fitted to the
 * official base width (125 m) and floor areas, and to the downloaded model's
 * outline. A visual approximation for the built-in model and the arrows.
 */
export function outlineHalfWidthM(heightM: number): number {
  return 4 + (DIM.baseHalfM - 4) * Math.exp(-Math.max(0, heightM) / 78);
}

/** Centre line of each leg (and, above the second floor, each corner of the single column), metres from the axis along x and z. */
function legCentreM(heightM: number): number {
  return 0.82 * outlineHalfWidthM(heightM);
}

/**
 * Real heights to heights in the downloaded model, whose floors sit a
 * little differently (measured from the file: first floor pieces up to
 * 67 m, second floor pieces up to 122 m, top 300 m). Used to decide which
 * of its sections are built in the construction view.
 */
const DOWNLOADED_HEIGHTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [57, 68],
  [115, 122],
  [312, 300],
  [330, 330],
];

function mapHeight(points: ReadonlyArray<readonly [number, number]>, heightM: number): number {
  if (heightM <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (heightM <= x1) return y0 + ((heightM - x0) / (x1 - x0)) * (y1 - y0);
  }
  return points[points.length - 1][1];
}

/**
 * The part a piece of the downloaded model belongs to, from its height range
 * in the file (metres) and its material name. Bands are measured from the
 * file: pedestals and lower legs below 45 m, the first-floor girders and
 * platform between 42 and 68 m, the legs up to the second floor, the second
 * floor around 103-122 m, the top above 252 m.
 */
export function partForDownloadedPiece(minY: number, maxY: number, materialName: string): EiffelPartId {
  if (/arch/i.test(materialName)) return 'arches';
  if (maxY <= 45) return 'pillars';
  if (minY >= 42 && maxY <= 68) return 'first-floor';
  const mid = (minY + maxY) / 2;
  if (mid < 101) return 'legs';
  if (mid < 122) return 'second-floor';
  if (minY >= 252) return 'top';
  return 'upper-tower';
}

interface QualitySettings {
  legPanels: number;
  columnPanels: number;
  windCount: number;
  groundSegments: number;
}

const QUALITY: Record<'low' | 'high', QualitySettings> = {
  high: { legPanels: 14, columnPanels: 16, windCount: 140, groundSegments: 64 },
  low: { legPanels: 8, columnPanels: 10, windCount: 60, groundSegments: 36 },
};

const DIM_OPACITY = 0.12;
const HIGHLIGHT_EMISSIVE = 0xffc23d;
const SWAY_PERIOD_S = 3.2;
const ARROW_SPACING_M = 26;
const ARROW_FLOW_M_PER_S = 22;
const WIND_X_START = -40;
const WIND_X_END = -6;
/** Pieces taller than this would pop in too early during construction (fraction of a section, metres). */
const BUILT_TOLERANCE_M = 0.5;

/** A section that appears in the construction view once the work reaches its top. */
interface Section {
  object: THREE.Object3D;
  topM: number;
}

/** Instanced bars of the built-in model, sorted by their top height, shown in order as the tower rises. */
interface BarSet {
  mesh: THREE.InstancedMesh;
  topsM: number[];
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

/** Marks an object as a non-part helper (ground, arrows, wind). */
function helper<T extends THREE.Object3D>(object: T): T {
  object.userData.partId = null;
  return object;
}

/** Builds the Eiffel Tower learning model (downloaded scene or built-in fallback). */
export function buildEiffelTower(opts: EiffelTowerOptions = {}): LandmarkModel {
  const quality = QUALITY[opts.quality ?? 'high'];
  const root = new THREE.Group();
  root.name = 'eiffel-tower';
  /** Everything above ground that sways in the wind (pivot at the ground). */
  const tower = new THREE.Group();
  tower.name = 'tower';
  root.add(tower);
  const topY = DIM.topM * S;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const down = new THREE.Vector3(0, -1, 0);
  const direction = new THREE.Vector3();

  const ownedGeometries = new Set<THREE.BufferGeometry>();
  const geometry = <T extends THREE.BufferGeometry>(g: T): T => {
    ownedGeometries.add(g);
    return g;
  };
  const ownedMaterials = new Set<THREE.Material>();
  const ownedTextures = new Set<THREE.Texture>();
  const optionTextures = new Set<THREE.Texture>([opts.textures?.ground, opts.textures?.concrete].filter((t): t is THREE.Texture => !!t));

  // --- Parts ---
  const parts = new Map<EiffelPartId, { group: THREE.Group; materials: THREE.MeshStandardMaterial[] }>();
  const partGroup = (id: EiffelPartId): THREE.Group => {
    let entry = parts.get(id);
    if (!entry) {
      const group = new THREE.Group();
      group.name = id;
      group.userData.partId = id;
      entry = { group, materials: [] };
      parts.set(id, entry);
    }
    return entry.group;
  };
  const partMaterial = (id: EiffelPartId, material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
    partGroup(id);
    parts.get(id)!.materials.push(material);
    ownedMaterials.add(material);
    return material;
  };
  const iron = (id: EiffelPartId) => partMaterial(id, new THREE.MeshStandardMaterial({ color: 0x7a5a43, roughness: 0.62, metalness: 0.35 }));

  const sections: Section[] = [];
  const barSets: BarSet[] = [];
  /** The four legs' directions from the axis (x, z signs). */
  const legSigns = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
  let origin: 'downloaded' | 'built-in';

  if (opts.source) {
    origin = 'downloaded';
    // --- The downloaded model: pieces sorted into parts by height ---
    const glb = new THREE.Group();
    glb.name = 'downloaded-model';
    glb.scale.setScalar(S);
    tower.add(glb);
    const source = opts.source;
    source.position.set(0, 0, 0);
    source.rotation.set(0, 0, 0);
    source.scale.setScalar(1);
    glb.add(source);
    glb.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(glb.matrixWorld).invert();
    const meshes: THREE.Mesh[] = [];
    source.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
    });
    const box = new THREE.Box3();
    for (const mesh of meshes) {
      // Height range in the file's metres (the model's own space).
      box.setFromObject(mesh).applyMatrix4(inverse);
      const originals = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const part = partForDownloadedPiece(box.min.y, box.max.y, originals[0]?.name ?? '');
      const converted = originals.map((original) => {
        const material = toOpaqueCutout(original);
        for (const texture of texturesOf(material)) ownedTextures.add(texture);
        return partMaterial(part, material);
      });
      for (const original of originals) original.dispose();
      mesh.material = Array.isArray(mesh.material) ? converted : converted[0];
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      ownedGeometries.add(mesh.geometry);
      const group = partGroup(part);
      if (group.parent !== glb) glb.add(group);
      group.attach(mesh);
      sections.push({ object: mesh, topM: box.max.y });
    }
    source.removeFromParent();
  } else {
    origin = 'built-in';
    buildLatticeTower();
  }

  // --- Antennas (both models): a simple mast from the top of the iron structure ---
  {
    const group = partGroup('antennas');
    tower.add(group);
    const material = partMaterial('antennas', new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.4, metalness: 0.7 }));
    const height = (DIM.topM - DIM.structureTopM) * S;
    const mast = new THREE.Mesh(geometry(new THREE.CylinderGeometry(0.03, 0.09, height, 8).translate(0, height / 2, 0)), material);
    mast.position.y = DIM.structureTopM * S;
    mast.castShadow = true;
    const dish = new THREE.Mesh(geometry(new THREE.CylinderGeometry(0.22, 0.22, 0.25, 10)), material);
    dish.position.y = (DIM.structureTopM + 8) * S;
    group.add(mast, dish);
  }

  // --- Foundations (schematic): one concrete block under each corner, joined by walls ---
  const concrete = partMaterial(
    'foundations',
    new THREE.MeshStandardMaterial({ color: 0xa9a49a, roughness: 0.95, metalness: 0, map: opts.textures?.concrete ?? null }),
  );
  const footings = partGroup('foundations');
  root.add(footings);
  {
    const size = DIM.footingM * S;
    const height = DIM.footingHeightM * S;
    const block = geometry(new THREE.BoxGeometry(size, height, size).translate(0, -height / 2, 0));
    const corner = legCentreM(0) * S;
    for (const [sx, sz] of legSigns) {
      const mesh = new THREE.Mesh(block, concrete);
      mesh.position.set(sx * corner, DIM.footingTopM * S, sz * corner);
      mesh.receiveShadow = true;
      footings.add(mesh);
    }
    // The walls joining the blocks (thin, schematic).
    const wallLength = 2 * corner - size;
    const wall = geometry(new THREE.BoxGeometry(wallLength, height * 0.5, 0.4).translate(0, -height * 0.25, 0));
    for (let k = 0; k < 4; k++) {
      const mesh = new THREE.Mesh(wall, concrete);
      const angle = (k * Math.PI) / 2;
      mesh.position.set(Math.cos(angle) * corner, DIM.footingTopM * S, Math.sin(angle) * corner);
      mesh.rotation.y = -angle + Math.PI / 2;
      footings.add(mesh);
    }
  }

  // --- Ground: solid, or opened around the base so the foundations show ---
  const sand = new THREE.MeshStandardMaterial({ color: 0xc9b98f, roughness: 1, metalness: 0, map: opts.textures?.ground ?? null });
  const soil = new THREE.MeshStandardMaterial({ color: 0x9b8160, roughness: 1, metalness: 0, side: THREE.BackSide });
  const soilFloor = new THREE.MeshStandardMaterial({ color: 0x86704f, roughness: 1, metalness: 0 });
  for (const material of [sand, soil, soilFloor]) ownedMaterials.add(material);
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

  // --- Load path: arrows flowing down the four legs into the foundations ---
  const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
  ownedMaterials.add(arrowMaterial);
  const arrowGeometry = geometry(
    mergeArrow(new THREE.ConeGeometry(0.36, 0.8, 10).rotateX(Math.PI).translate(0, 0.4, 0), new THREE.CylinderGeometry(0.1, 0.1, 1.1, 6).translate(0, 1.35, 0)),
  );
  const arrowTopM = 290;
  const arrowBottomM = DIM.footingTopM;
  const perTrack = Math.max(1, Math.floor((arrowTopM - arrowBottomM) / ARROW_SPACING_M));
  const arrows = helper(new THREE.InstancedMesh(arrowGeometry, arrowMaterial, perTrack * legSigns.length));
  arrows.frustumCulled = false;
  arrows.renderOrder = 10;
  const loadPath = helper(new THREE.Group());
  loadPath.name = 'load-path';
  loadPath.add(arrows);
  loadPath.visible = false;
  tower.add(loadPath);
  const writeArrows = (time: number) => {
    const span = perTrack * ARROW_SPACING_M;
    const offset = (time * ARROW_FLOW_M_PER_S) % ARROW_SPACING_M;
    legSigns.forEach(([sx, sz], track) => {
      for (let j = 0; j < perTrack; j++) {
        const along = (j * ARROW_SPACING_M + offset) % span;
        const h = arrowTopM - along;
        const c = legCentreM(h);
        // Downward along the leg: the leg leans outward as it goes down.
        const slope = (legCentreM(h - 1) - c) / 1;
        direction.set(sx * slope, -1, sz * slope).normalize();
        quaternion.setFromUnitVectors(down, direction);
        matrix.compose(position.set(sx * c * S, h * S, sz * c * S), quaternion, scale.set(1, 1, 1));
        arrows.setMatrixAt(track * perTrack + j, matrix);
      }
    });
    arrows.instanceMatrix.needsUpdate = true;
  };
  writeArrows(0);

  // --- Wind: streaks flowing toward the tower from -X ---
  const windMaterial = new THREE.MeshBasicMaterial({ color: 0x2f8cff, transparent: true, opacity: 0.5, depthWrite: false });
  ownedMaterials.add(windMaterial);
  const windGeometry = geometry(new THREE.ConeGeometry(0.2, 1.6, 6).rotateZ(-Math.PI / 2));
  const wind = helper(new THREE.InstancedMesh(windGeometry, windMaterial, quality.windCount));
  wind.frustumCulled = false;
  wind.visible = false;
  wind.name = 'wind';
  root.add(wind);
  const random = seededRandom(312);
  const windX = new Float32Array(quality.windCount);
  const windY = new Float32Array(quality.windCount);
  const windZ = new Float32Array(quality.windCount);
  const windPace = new Float32Array(quality.windCount);
  for (let i = 0; i < quality.windCount; i++) {
    windX[i] = WIND_X_START + random() * (WIND_X_END - WIND_X_START);
    windY[i] = 1 + random() * (DIM.structureTopM * S - 3);
    windZ[i] = (random() - 0.5) * 16;
    windPace[i] = 0.7 + random() * 0.6;
  }

  // --- State ---
  const partIds: string[] = [...EIFFEL_MODEL_PART_IDS];
  const knownParts = new Set<string>(partIds);
  const heightInModel = (heightM: number) => (origin === 'downloaded' ? mapHeight(DOWNLOADED_HEIGHTS, heightM) : heightM);
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
      matrix.compose(position.set(windX[i], windY[i], windZ[i]), quaternion.identity(), scale.set(stretch, 1, 1));
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

  const setCount = (mesh: THREE.InstancedMesh, count: number) => {
    if (mesh.count === count) return;
    mesh.count = count;
    mesh.boundingBox = null;
    mesh.boundingSphere = null;
  };

  /** Everything at full size (all views except 'construction'). */
  const showAll = (showFoundation: boolean) => {
    for (const [id, { group }] of parts) group.visible = id === 'foundations' ? showFoundation : true;
    footings.scale.y = 1;
    for (const section of sections) section.object.visible = true;
    for (const set of barSets) setCount(set.mesh, set.topsM.length);
  };

  /**
   * Construction progress: up to foundationDone the foundation blocks are
   * built; then the iron rises to the height builtHeightForProgress gives
   * (sections appear once the work reaches their top); the antennas come
   * last, with the 'complete' stage (they were added from 1957).
   */
  const applyConstruction = () => {
    const p = clamp01(progress);
    const { foundationDone, structureDone } = CONSTRUCTION_PROGRESS;
    const footingShare = clamp01(p / foundationDone);
    partGroup('foundations').visible = footingShare > 0;
    footings.scale.y = Math.max(1e-3, footingShare);
    const builtM = builtHeightForProgress(p, DIM.topM);
    const limit = heightInModel(builtM) + BUILT_TOLERANCE_M;
    for (const section of sections) section.object.visible = builtM > 0 && section.topM <= limit;
    for (const set of barSets) setCount(set.mesh, builtM > 0 ? countAtOrBelow(set.topsM, limit) : 0);
    for (const id of EIFFEL_MODEL_PART_IDS) {
      if (id === 'foundations') continue;
      partGroup(id).visible = id === 'antennas' ? p >= structureDone : builtM > 0;
    }
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

  /** Opacity and glow for every part from the current view and highlight. */
  const applyLook = () => {
    const inspecting = view === 'inspect' && highlight.size > 0;
    for (const [id, { materials }] of parts) {
      const highlighted = highlight.has(id);
      const opacity = inspecting && !highlighted ? DIM_OPACITY : 1;
      const transparent = opacity < 1;
      for (const material of materials) {
        if (material.transparent !== transparent) {
          material.transparent = transparent;
          material.needsUpdate = true;
        }
        material.opacity = opacity;
        material.depthWrite = !transparent;
        // Cut-out lattice textures: the cut-off follows the opacity, so a dimmed part stays faintly visible.
        if (material.map) material.alphaTest = 0.5 * opacity;
        material.emissive.setHex(highlighted ? HIGHLIGHT_EMISSIVE : 0x000000);
        material.emissiveIntensity = highlighted ? 0.55 : 1;
      }
    }
  };

  // Part groups live in the tower (the downloaded ones were placed in its scaled group above).
  for (const [id, { group }] of parts) if (!group.parent && id !== 'foundations') tower.add(group);

  applyVisibility();
  applyLook();

  return {
    root,
    partIds,
    topY,
    envelopeParts: new Set<string>(),
    origin,
    part: (id) => (knownParts.has(id) ? partGroup(id as EiffelPartId) : undefined),
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
    applyTextures(textures) {
      if (disposed) return;
      sand.map = textures.ground ?? null;
      sand.needsUpdate = true;
      concrete.map = textures.concrete ?? null;
      concrete.needsUpdate = true;
      for (const texture of [textures.ground, textures.concrete]) if (texture) optionTextures.add(texture);
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
      // Textures that came with the downloaded model; the scene's sand and concrete photos are the scene's.
      for (const texture of ownedTextures) if (!optionTextures.has(texture)) texture.dispose();
      ownedGeometries.clear();
      ownedMaterials.clear();
      ownedTextures.clear();
    },
  };

  /**
   * The built-in fallback: four lattice legs (chords, ties and one diagonal
   * per panel face, so the triangles show) that meet at the second floor
   * and rise as one lattice column; floors sized from the official floor
   * areas; arches between the pillars. Instanced bars, sorted bottom-up.
   */
  function buildLatticeTower(): void {
    const bar = geometry(new THREE.BoxGeometry(1, 1, 1));
    const collect = (id: EiffelPartId) => ({ id, bars: [] as Array<{ a: THREE.Vector3; b: THREE.Vector3; thickness: number }> });
    const pillars = collect('pillars');
    const legs = collect('legs');
    const column = collect('upper-tower');
    const arches = collect('arches');
    const point = (x: number, h: number, z: number) => new THREE.Vector3(x * S, h * S, z * S);
    const addBar = (target: ReturnType<typeof collect>, a: THREE.Vector3, b: THREE.Vector3, thicknessM: number) => target.bars.push({ a, b, thickness: thicknessM * S });

    // Four legs from the ground to the second floor. Below the first floor they are the pillars.
    for (const [sx, sz] of legSigns) {
      const corners = (h: number) => {
        const c = legCentreM(h);
        const half = (DIM.pillarM / 2) * (outlineHalfWidthM(h) / DIM.baseHalfM);
        return [
          point(sx * c - half, h, sz * c - half),
          point(sx * c + half, h, sz * c - half),
          point(sx * c + half, h, sz * c + half),
          point(sx * c - half, h, sz * c + half),
        ];
      };
      for (let i = 0; i < quality.legPanels; i++) {
        const h0 = (DIM.secondFloorM * i) / quality.legPanels;
        const h1 = (DIM.secondFloorM * (i + 1)) / quality.legPanels;
        const target = h1 <= DIM.firstFloorM + 1 ? pillars : legs;
        const lower = corners(h0);
        const upper = corners(h1);
        for (let k = 0; k < 4; k++) {
          const next = (k + 1) % 4;
          addBar(target, lower[k], upper[k], 1.8);
          addBar(target, upper[k], upper[next], 1.0);
          // One diagonal per face, alternating direction from panel to panel: a zig-zag of triangles.
          if (i % 2 === 0) addBar(target, lower[k], upper[next], 0.8);
          else addBar(target, lower[next], upper[k], 0.8);
        }
      }
    }
    // One lattice column from the second floor to the top of the iron.
    const columnCorners = (h: number) => {
      const c = legCentreM(h);
      return [point(c, h, c), point(-c, h, c), point(-c, h, -c), point(c, h, -c)];
    };
    for (let i = 0; i < quality.columnPanels; i++) {
      const h0 = DIM.secondFloorM + ((DIM.topFloorM - DIM.secondFloorM) * i) / quality.columnPanels;
      const h1 = DIM.secondFloorM + ((DIM.topFloorM - DIM.secondFloorM) * (i + 1)) / quality.columnPanels;
      const lower = columnCorners(h0);
      const upper = columnCorners(h1);
      for (let k = 0; k < 4; k++) {
        const next = (k + 1) % 4;
        addBar(column, lower[k], upper[k], 1.6);
        addBar(column, upper[k], upper[next], 0.8);
        if (i % 2 === 0) addBar(column, lower[k], upper[next], 0.7);
        else addBar(column, lower[next], upper[k], 0.7);
      }
    }
    // Arches between neighbouring pillars (a visual approximation of Sauvestre's arches).
    const archSegments = 14;
    for (let k = 0; k < 4; k++) {
      const angle = (k * Math.PI) / 2;
      const along = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
      const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const reach = legCentreM(4) - (DIM.pillarM / 2) * 0.9;
      const face = legCentreM(30);
      const crownM = 40;
      let previous: THREE.Vector3 | null = null;
      for (let j = 0; j <= archSegments; j++) {
        const t = (j / archSegments) * Math.PI;
        const lateral = -Math.cos(t) * reach;
        const h = 4 + Math.sin(t) * (crownM - 4);
        const p = new THREE.Vector3().addScaledVector(out, face).addScaledVector(along, lateral);
        const current = point(p.x, h, p.z);
        if (previous) addBar(arches, previous, current, 1.4);
        previous = current;
      }
    }

    const makeSet = (set: ReturnType<typeof collect>) => {
      set.bars.sort((p, q) => Math.max(p.a.y, p.b.y) - Math.max(q.a.y, q.b.y));
      const material = iron(set.id);
      const mesh = new THREE.InstancedMesh(bar, material, set.bars.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      set.bars.forEach(({ a, b, thickness }, index) => {
        direction.subVectors(b, a);
        const length = direction.length();
        quaternion.setFromUnitVectors(up, direction.normalize());
        matrix.compose(position.addVectors(a, b).multiplyScalar(0.5), quaternion, scale.set(thickness, length, thickness));
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      partGroup(set.id).add(mesh);
      barSets.push({ mesh, topsM: set.bars.map(({ a, b }) => Math.max(a.y, b.y) / S) });
    };
    for (const set of [pillars, legs, column, arches]) makeSet(set);

    // Floors: square platforms sized from the official floor areas, and the top with its lantern.
    const deck = (id: EiffelPartId, heightM: number, areaM2: number, thicknessM: number, ring: boolean) => {
      const side = Math.sqrt(areaM2);
      const material = iron(id);
      const group = partGroup(id);
      if (ring) {
        // The first floor is a square ring around an open middle.
        const width = side * 0.22;
        for (let k = 0; k < 4; k++) {
          const angle = (k * Math.PI) / 2;
          const slab = new THREE.Mesh(geometry(new THREE.BoxGeometry(side * S, thicknessM * S, width * S)), material);
          slab.position.set(Math.sin(angle) * (side - width) * 0.5 * S, heightM * S, Math.cos(angle) * (side - width) * 0.5 * S);
          slab.rotation.y = angle;
          slab.castShadow = true;
          group.add(slab);
          sections.push({ object: slab, topM: heightM });
        }
      } else {
        const slab = new THREE.Mesh(geometry(new THREE.BoxGeometry(side * S, thicknessM * S, side * S)), material);
        slab.position.y = heightM * S;
        slab.castShadow = true;
        group.add(slab);
        sections.push({ object: slab, topM: heightM });
      }
    };
    deck('first-floor', DIM.firstFloorM, DIM.firstFloorAreaM2, 4, true);
    deck('second-floor', DIM.secondFloorM, DIM.secondFloorAreaM2, 3, false);
    deck('top', DIM.topFloorM, DIM.topFloorAreaM2, 2.5, false);
    const lanternHeight = (DIM.structureTopM - DIM.topFloorM) * S;
    const lantern = new THREE.Mesh(geometry(new THREE.CylinderGeometry(0.25, 0.45, lanternHeight, 8).translate(0, lanternHeight / 2, 0)), iron('top'));
    lantern.position.y = DIM.topFloorM * S;
    lantern.castShadow = true;
    partGroup('top').add(lantern);
    sections.push({ object: lantern, topM: DIM.structureTopM });
  }
}

/** How many of the sorted heights are at or below a limit. */
function countAtOrBelow(sortedTops: readonly number[], limit: number): number {
  let count = 0;
  while (count < sortedTops.length && sortedTops[count] <= limit + 1e-6) count++;
  return count;
}

/** An arrow (head and shaft) as one geometry. */
function mergeArrow(head: THREE.BufferGeometry, shaft: THREE.BufferGeometry): THREE.BufferGeometry {
  const parts = [head.toNonIndexed(), shaft.toNonIndexed()];
  head.dispose();
  shaft.dispose();
  const count = parts.reduce((sum, g) => sum + g.attributes.position.count, 0);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  let offset = 0;
  for (const g of parts) {
    positions.set(g.attributes.position.array as Float32Array, offset * 3);
    normals.set(g.attributes.normal.array as Float32Array, offset * 3);
    offset += g.attributes.position.count;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return merged;
}

/** Textures a material uses (to dispose the downloaded model's own). */
function texturesOf(material: THREE.Material): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  for (const value of Object.values(material)) if (value && (value as THREE.Texture).isTexture) out.push(value as THREE.Texture);
  return out;
}

/**
 * The downloaded file marks every material as blended (alpha 0.999999, a
 * converter's habit). Drawn that way the lattice would sort badly and never
 * write depth, so: textured materials become crisp cut-outs (alpha test)
 * that write depth, plain ones become opaque. Always a fresh standard
 * material owned by the model, so highlights never leak between parts.
 */
function toOpaqueCutout(original: THREE.Material): THREE.MeshStandardMaterial {
  const source = original as THREE.MeshStandardMaterial;
  const material = source.isMeshStandardMaterial
    ? source.clone()
    : new THREE.MeshStandardMaterial({ color: (source as unknown as { color?: THREE.Color }).color ?? new THREE.Color(0xffffff), map: (source as unknown as { map?: THREE.Texture | null }).map ?? null });
  material.transparent = false;
  material.opacity = 1;
  material.depthWrite = true;
  material.alphaTest = material.map ? 0.5 : 0;
  material.side = THREE.DoubleSide;
  material.needsUpdate = true;
  return material;
}
