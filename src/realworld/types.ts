/**
 * Data model for the Real World Explorer: real landmarks children can
 * explore, with sourced facts, a construction timeline, lessons and
 * missions. Content lives in `landmarks/*.ts`; the 3D models live in
 * `models/*.ts`. Everything here is plain data, safe to import headlessly.
 *
 * Accuracy rules the content follows:
 * - every factual claim carries `sourceIds` pointing at a `Source` of the same landmark;
 * - numbers that differ between sources say so in `note` and use `confidence: 'medium'`;
 * - learning simulations use relative model units and are kept apart from real engineering values.
 */

/** Scene units per metre: the explorer scene shows real heights at 1:10, so an 828 m tower is 82.8 units tall. */
export const SCENE_SCALE = 0.1;

/** A published page a fact is taken from. `url` is always https. */
export interface Source {
  id: string;
  title: string;
  publisher: string;
  url: string;
}

/** One sourced fact for a fact card. `note` carries "sources differ" caveats. */
export interface Fact {
  id: string;
  label: string;
  value: string;
  note?: string;
  sourceIds: string[];
  confidence: 'high' | 'medium';
}

/**
 * Camera framing for a floor-navigator stop, in scene units (see SCENE_SCALE).
 * The camera looks at the tower axis at the stop's height.
 */
export interface StopCamera {
  /** Distance from the look-at point, scene units. */
  distance: number;
  /** Camera pitch in degrees above the horizontal (positive looks down at the stop, negative looks up). */
  elevation: number;
  /** Degrees around the tower, 0 = looking from +Z toward the tower, increasing toward +X. */
  azimuth: number;
}

/**
 * A floor-navigator stop. `reconstructed: true` means the view is an
 * educational cutaway or learning space, never the real interior.
 */
export interface Stop {
  id: string;
  name: string;
  /** Height above ground in metres (negative = below ground). */
  heightM: number;
  kind: 'foundation' | 'ground' | 'floors' | 'top';
  description: string;
  reconstructed: boolean;
  camera: StopCamera;
  /**
   * Where along the landmark the camera looks, in metres from its centre
   * (x along the landmark, z across it). Missing = the central axis, which
   * suits a tower; a bridge stop looks at a tower, the middle or an end.
   */
  focusM?: { x: number; z: number };
  /** Replaces the height shown in the floor navigator (e.g. "Under the water"). */
  heightLabel?: string;
}

/** A structural component. Ids match the 3D model's part ids. */
export interface Part {
  id: string;
  name: string;
  description: string;
  sourceIds: string[];
}

/** A tappable info point attached to a model part. */
export interface Hotspot {
  id: string;
  partId: string;
  title: string;
  text: string;
  sourceIds: string[];
}

/** Construction stages shown by the timeline and the 3D model. */
export type StageId = 'site' | 'foundation' | 'structure' | 'exterior' | 'complete';

export interface Stage {
  id: StageId;
  name: string;
  description: string;
  /** How much of the model to show for this stage, 0..1 (see CONSTRUCTION_PROGRESS). */
  progress: number;
}

/** One dated step of the construction story. */
export interface TimelineEntry {
  id: string;
  /** Child-readable date, e.g. "21 July 2007" or "Early 2007". */
  dateLabel: string;
  /** ISO-like 'YYYY-MM' used for ordering. */
  sortKey: string;
  title: string;
  text: string;
  stage: StageId;
  /** Documented height of the structure at that point in metres, or null when no source gives one. */
  builtHeightM: number | null;
  sourceIds: string[];
  confidence: 'high' | 'medium';
  note?: string;
  /**
   * How much of the learning model to show (0..1) for landmarks whose
   * construction is not a matter of height (a bridge: piers, towers, cables,
   * then the deck). A display value, not a measurement.
   */
  progress?: number;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

/** One step of a lesson: experience it, try it, understand it, check it. */
export interface LessonStep {
  kind: 'experience' | 'interact' | 'explain' | 'check';
  title: string;
  text: string;
  focusPartIds?: string[];
  stopId?: string;
  simulation?: 'foundation-pressure' | 'wind' | 'triangulation' | 'bridge-forces' | 'suspension-load';
  quizId?: string;
}

export interface Lesson {
  id: string;
  title: string;
  subject: string;
  summary: string;
  steps: LessonStep[];
  /** Shown with every simulation: what the model leaves out. */
  caveat: string;
  sourceIds: string[];
}

/** A gentle goal. Rewards celebrate understanding: no points, streaks, timers or currency. */
export interface Mission {
  id: string;
  title: string;
  description: string;
  kind: 'find-part' | 'tap-sequence' | 'lesson' | 'quiz' | 'timeline' | 'compare';
  partIds?: string[];
  /** For 'tap-sequence': each step accepts any of its part ids. */
  sequence?: string[][];
  lessonId?: string;
  quizId?: string;
  reward: string;
}

/** How the explorer gets a 3D model for a landmark. */
export type LandmarkModelSource =
  | { kind: 'procedural'; builder: 'burj-khalifa' | 'golden-gate-bridge' }
  | { kind: 'glb'; path: string; fallbackBuilder: string }
  | null;

export interface RealLandmark {
  id: string;
  name: string;
  place: string;
  /** Only 'available' landmarks carry content; the UI shows "Coming soon" for the rest. */
  status: 'available' | 'coming-soon';
  tagline: string;
  summary: string;
  disclaimer: string;
  model: LandmarkModelSource;
  /** Height used for model scaling and timeline progress, metres. */
  heightM?: number;
  facts: Fact[];
  sources: Source[];
  stops: Stop[];
  parts: Part[];
  hotspots: Hotspot[];
  stages: Stage[];
  timeline: TimelineEntry[];
  lessons: Lesson[];
  quiz: QuizQuestion[];
  missions: Mission[];
  subjects: string[];
  /** EAVARA's landmark-specific lines; anything missing falls back to the general ones. */
  companion?: LandmarkCompanion;
}

/** A suggestion chip under EAVARA's line: travel to a stop, open a lesson or switch view. */
export interface CompanionChoice {
  label: string;
  stopId?: string;
  lessonId?: string;
  view?: 'complete' | 'construction' | 'cutaway' | 'inspect';
}

/** What EAVARA says on arrival, about a tapped part, and during a lesson. */
export interface LandmarkCompanion {
  welcome?: string;
  welcomeChoices?: CompanionChoice[];
  parts?: Record<string, { text: string; choices?: CompanionChoice[] }>;
  lessons?: Record<string, string>;
}

/**
 * The shared construction-progress scale (0 = empty site, 1 = finished)
 * that both the timeline and the 3D models use:
 * - 0 .. foundationDone: piles, then the raft;
 * - foundationDone .. structureDone: the structure rises from the ground to full height;
 * - structureDone .. exteriorDone: the outer skin is finished;
 * - exteriorDone .. complete: final touches.
 * These are display bands for a learning model, not real durations.
 */
export const CONSTRUCTION_PROGRESS = {
  pilesDone: 0.02,
  foundationDone: 0.05,
  structureDone: 0.9,
  exteriorDone: 0.95,
  complete: 1,
} as const;

/** Clamps to 0..1, treating NaN as 0. */
export function clamp01(value: number): number {
  if (!(value > 0)) return 0;
  return value > 1 ? 1 : value;
}

/** Model progress at which the structure has reached `builtM` of a `totalM` tall landmark. */
export function progressForBuiltHeight(builtM: number, totalM: number): number {
  const { foundationDone, structureDone } = CONSTRUCTION_PROGRESS;
  if (!(totalM > 0)) return foundationDone;
  return foundationDone + (structureDone - foundationDone) * clamp01(builtM / totalM);
}

/** Inverse of progressForBuiltHeight: the structure height (metres) shown at `progress`. */
export function builtHeightForProgress(progress: number, totalM: number): number {
  const { foundationDone, structureDone } = CONSTRUCTION_PROGRESS;
  return clamp01((progress - foundationDone) / (structureDone - foundationDone)) * Math.max(0, totalM);
}
