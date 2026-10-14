/**
 * Getting a landmark's 3D model ready, including landmarks whose model is a
 * downloaded file. Kept apart from the scene (and from any loader) so the
 * rule can be tested headlessly: a file that cannot be loaded - missing,
 * offline, broken - never leaves the child with nothing; the landmark's
 * built-in model is drawn instead and the result says so honestly.
 */
import type { Object3D } from 'three';
import { buildLandmarkModel, type LandmarkModel, type LandmarkModelOptions, type RealLandmark } from '@/realworld';

/** Where the model on show came from: built in code by design, the downloaded file, or the built-in stand-in for a file that failed. */
export type ModelOrigin = 'procedural' | 'downloaded' | 'fallback';

export interface PreparedModel {
  model: LandmarkModel | null;
  origin: ModelOrigin | null;
  /** Why the downloaded file was not used (for the console, never shown to the child). */
  error?: unknown;
}

/** Loads a downloaded model file and returns its scene (e.g. with GLTFLoader). */
export type ModelFileLoader = (url: string) => Promise<Object3D>;

/**
 * Builds the landmark's model, loading its file first when it has one.
 * `baseUrl` resolves the file's relative path (the page address in the app).
 */
export async function prepareLandmarkModel(
  landmark: RealLandmark,
  options: Omit<LandmarkModelOptions, 'source'>,
  loadFile: ModelFileLoader,
  baseUrl?: string,
): Promise<PreparedModel> {
  const description = landmark.model;
  if (!description || description.kind !== 'glb') {
    const model = buildLandmarkModel(landmark, options);
    return { model, origin: model ? 'procedural' : null };
  }
  const url = baseUrl ? new URL(description.path, baseUrl).href : description.path;
  let source: Object3D | null = null;
  let error: unknown;
  try {
    source = await loadFile(url);
  } catch (failure) {
    error = failure;
  }
  if (source) {
    try {
      return { model: buildLandmarkModel(landmark, { ...options, source }), origin: 'downloaded' };
    } catch (failure) {
      // The file loaded but could not be used: free it and draw the built-in model.
      error = failure;
      disposeScene(source);
    }
  }
  return { model: buildLandmarkModel(landmark, { ...options, source: null }), origin: 'fallback', error };
}

/** Frees the GPU-side resources of a loaded scene that will not be shown (a broken scene is skipped, never thrown on). */
export function disposeScene(scene: Object3D): void {
  try {
    scene.traverse((object) => {
      const mesh = object as { geometry?: { dispose?(): void }; material?: unknown };
      mesh.geometry?.dispose?.();
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const material of materials as Array<Record<string, unknown> & { dispose?(): void }>) {
        for (const value of Object.values(material)) if (value && (value as { isTexture?: boolean }).isTexture) (value as { dispose(): void }).dispose();
        material.dispose?.();
      }
    });
    scene.removeFromParent();
  } catch {
    // Nothing more to free from a scene that cannot even be walked.
  }
}
