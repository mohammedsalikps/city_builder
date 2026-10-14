import type { StudioCatalog } from '@/creative/Studio';
import type { ThumbnailRenderer } from '@/creative/ThumbnailRenderer';
import type { HistoryService } from '@/creative/HistoryService';
import type { BuildAssistant } from '@/creative/ai/BuildAssistant';
import type { InteriorExplorer } from '@/game/InteriorExplorer';
import type { PlanKind } from '@/creative/plan/ConstructionPlan';
import type { PlacedObject } from '@/construction/PlacedObject';
import type { DistrictDefinition, WorldLake } from '@/world/WorldSpace';

export type CameraView = 'world' | 'close' | 'city';

/** Where a placed object appears on screen, in CSS pixels relative to the viewport. */
export interface ScreenPoint {
  /** Top centre of the object. */
  x: number;
  y: number;
  /** Middle of the object (half its height). */
  centerY: number;
  /** Roughly how far the object reaches sideways from its centre, on screen. */
  radius: number;
  /** False when the object is behind the camera or outside the view. */
  onScreen: boolean;
}

/** The world as the toy map draws it (static parts). */
export interface WorldMapData {
  /** Half the side of the square the map shows, metres. */
  halfSize: number;
  districts: DistrictDefinition[];
  lakes: WorldLake[];
  /** Road tile centres and tile size of the world's own streets. */
  roadTiles: Array<{ x: number; z: number }>;
  tile: number;
  homePlot: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Lots left open for building inside busy districts. */
  openPlots: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
}

/** Where the camera is looking. */
export interface CameraFocus {
  x: number;
  z: number;
  /** Heading in degrees (0 looks from +Z towards -Z). */
  azimuth: number;
  distance: number;
}

/**
 * What World Studio's screens need from the running game beyond state and
 * actions: presentation helpers (thumbnails, projection, camera framing)
 * and the undo history. Implemented by Game; screens never reach into
 * three.js or controllers directly.
 */
export interface StudioServices {
  catalog: StudioCatalog;
  thumbnails: ThumbnailRenderer;
  history: HistoryService;
  /** EAVARA's AI builder conversation (see src/creative/ai). */
  assistant: BuildAssistant;
  /** Interior Explorer: going inside planned houses, rooms, furniture (see src/game/InteriorExplorer.ts). */
  interior: InteriorExplorer;
  /** What a planned creation really is (kind and name), for honest creation cards; null when it was not planned. */
  plannedCreation(groupId: string): { kind: PlanKind; name: string } | null;
  /** For a neighbourhood being worked on: how many houses it has and the one picked to change (null: the whole street). */
  houseChoice(): { groupId: string; houses: number; picked: number | null } | null;
  /** Pick one house of a neighbourhood to change (null: the whole street); a picked house is selected in the world so it shows. */
  pickHouse(groupId: string, index: number | null): void;
  /** Which house of a planned neighbourhood a placed piece belongs to (0-based), or null. */
  houseOf(instanceId: string): number | null;
  /** Place the template ghost at its current spot ("Place here"). */
  confirmTemplate(): boolean;
  /** Whether every piece of the template ghost fits where it is now. */
  templateFits(): boolean;
  /** Whether the template ghost has found a spot on the ground yet. */
  templateHasSpot(): boolean;
  /** Where the top of a placed object appears on screen. */
  projectInstance(instanceId: string): ScreenPoint | null;
  /** Friendly camera framings. */
  cameraView(view: CameraView): void;
  /** The current data of a placed object (read-only). */
  findPlaced(instanceId: string): PlacedObject | null;
  /** Everything in My World right now (read-only). */
  allPlaced(): readonly PlacedObject[];
  /** Static map data, or null until the world has been composed. */
  mapData(): WorldMapData | null;
  cameraFocus(): CameraFocus;
  /** What to call the part of the world in view ("Maple Grove", "The whole valley"). */
  placeName(): string;
  /** The named area around a point, if any. */
  districtAt(x: number, z: number): DistrictDefinition | null;
  /** Travel to a point in the world (keeps a comfortable building distance). */
  flyTo(x: number, z: number): void;
  /** Travel to a whole district. */
  flyToDistrict(id: string): void;
  /** See-through roofs so the rooms inside show (presentation only). */
  setPeekInside(on: boolean): void;
  isPeekingInside(): boolean;
}
