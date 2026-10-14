/**
 * Real World Explorer: sourced landmark content, lesson physics and
 * procedural 3D learning models. Everything here imports headlessly (no DOM
 * or WebGL), so the UI and the tests share the same modules.
 */
import type { Object3D } from 'three';
import { buildBurjKhalifa, type BurjKhalifaOptions, type LandmarkModel } from '@/realworld/models/BurjKhalifaModel';
import { buildEiffelTower } from '@/realworld/models/EiffelTowerModel';
import { buildGoldenGateBridge } from '@/realworld/models/GoldenGateBridgeModel';
import type { RealLandmark } from '@/realworld/types';

export * from '@/realworld/types';
export * from '@/realworld/physics';
export { LANDMARKS, availableLandmarks, landmarkById, monthIndex, stageProgress, timelineProgress, validateLandmark } from '@/realworld/catalogue';
export * from '@/realworld/truss';
export { BURJ_KHALIFA, BURJ_HEIGHT_M } from '@/realworld/landmarks/burjKhalifa';
export { EIFFEL_TOWER, EIFFEL_HEIGHT_M } from '@/realworld/landmarks/eiffelTower';
export { GOLDEN_GATE_BRIDGE, GOLDEN_GATE_TOWER_M } from '@/realworld/landmarks/goldenGateBridge';
export { BURJ_MODEL_PART_IDS, buildBurjKhalifa } from '@/realworld/models/BurjKhalifaModel';
export { EIFFEL_MODEL_PART_IDS, buildEiffelTower, outlineHalfWidthM, partForDownloadedPiece } from '@/realworld/models/EiffelTowerModel';
export type { BurjKhalifaOptions, BurjPartId, LandmarkModel, LandmarkView } from '@/realworld/models/BurjKhalifaModel';
export type { EiffelPartId, EiffelTowerOptions } from '@/realworld/models/EiffelTowerModel';
export { GOLDEN_GATE_MODEL_PART_IDS, GOLDEN_GATE_SAG_RATIO, buildGoldenGateBridge, mainCableHeightM } from '@/realworld/models/GoldenGateBridgeModel';
export type { GoldenGatePartId, GoldenGateBridgeOptions } from '@/realworld/models/GoldenGateBridgeModel';

/** Options every landmark builder accepts. */
export interface LandmarkModelOptions extends BurjKhalifaOptions {
  /**
   * For landmarks with a downloaded model: the loaded scene (the model takes
   * ownership), or null when the file could not be loaded - the landmark's
   * built-in fallback is drawn instead.
   */
  source?: Object3D | null;
}

/**
 * Builds the 3D model for a landmark, or returns null when it has none yet
 * ('coming-soon' entries). Landmarks with a downloaded model take the loaded
 * scene in `options.source` (see prepareLandmarkModel, which loads it).
 */
export function buildLandmarkModel(landmark: RealLandmark, options?: LandmarkModelOptions): LandmarkModel | null {
  const model = landmark.model;
  if (landmark.status !== 'available' || model === null) return null;
  if (model.kind === 'procedural' && model.builder === 'burj-khalifa') return buildBurjKhalifa(options);
  if (model.kind === 'procedural' && model.builder === 'golden-gate-bridge') return buildGoldenGateBridge({ quality: options?.quality, textures: options?.textures });
  if (model.kind === 'glb' && model.fallbackBuilder === 'eiffel-tower') {
    return buildEiffelTower({ quality: options?.quality, textures: options?.textures, source: options?.source ?? null });
  }
  return null;
}
