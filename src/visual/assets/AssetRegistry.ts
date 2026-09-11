import type { ConstructionObjectDefinition } from '@/construction/ConstructionObjectDefinition';

export const ASSET_CATEGORIES = [
  'architecture',
  'construction',
  'furniture',
  'vegetation',
  'roads',
  'vehicles',
  'props',
  'environment',
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export interface AssetVariant {
  id: string;
  /** glTF material name -> replacement base colour. */
  tints: Record<string, string>;
}

/**
 * One 3D model in the library (src/data/assets.json). Visual data only: the
 * gameplay footprint here is authoring information for things placed from
 * the library, never a collision or matching source on its own.
 */
export interface AssetDefinition {
  id: string;
  /** Relative to public/assets/3d/. .glb or .gltf. */
  path: string;
  category: AssetCategory;
  /** Uniform scale correction applied to the file. Default 1. */
  scale?: number;
  /** Yaw correction in degrees so the model's front faces +Z. Default 0. */
  rotationY?: number;
  /** Offset so the model's bottom-centre sits at the origin. Default 0. */
  offset?: { x: number; y: number; z: number };
  /** Ground footprint (metres, after correction) a placed copy occupies. */
  footprint: { width: number; depth: number };
  /** Expected size after correction; used for fallbacks and sanity checks. */
  bounds: { width: number; height: number; depth: number };
  /** 'library' binds glTF materials by name to the shared MaterialLibrary. */
  materials?: 'library' | 'embedded';
  castShadow?: boolean;
  receiveShadow?: boolean;
  variants?: AssetVariant[];
  /** Animation to start on every instance (clip name, or "*" for the first). */
  animations?: { autoplay: string; loop?: boolean };
  /** Lower-detail files and the camera distance they take over at. */
  lod?: Array<{ path: string; distance: number }>;
  /** True for generated stand-ins that should be replaced by real art. */
  placeholder?: boolean;
  /** Where the model comes from (pack name); its licence sits beside the file. */
  source?: string;
  /**
   * Re-centre the corrected model on its bottom-centre (x/z centre, lowest
   * point at y = 0). For source files whose origin sits on an edge or hinge.
   */
  recenter?: boolean;
  /**
   * 'palette': the model samples a small colour atlas; turn off mipmaps so
   * distant models do not bleed neighbouring swatches.
   */
  textureFilter?: 'palette' | 'default';
  /** PBR response applied to the file's materials (materials named "glass" are kept). */
  surface?: { roughness?: number; metalness?: number };
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validate(d: AssetDefinition): string | null {
  if (typeof d.id !== 'string' || !/^[a-z0-9_]+$/.test(d.id)) return 'id must be snake_case';
  if (typeof d.path !== 'string' || !/\.(glb|gltf)$/i.test(d.path)) return 'path must end in .glb or .gltf';
  if (!ASSET_CATEGORIES.includes(d.category)) return `unknown category "${String(d.category)}"`;
  if (d.scale !== undefined && !(isNumber(d.scale) && d.scale > 0)) return 'scale must be positive';
  if (d.rotationY !== undefined && !isNumber(d.rotationY)) return 'rotationY must be a number (degrees)';
  if (d.offset !== undefined && !(isNumber(d.offset.x) && isNumber(d.offset.y) && isNumber(d.offset.z))) return 'offset must be {x,y,z}';
  if (!d.footprint || !(d.footprint.width > 0 && d.footprint.depth > 0)) return 'footprint must have positive width/depth';
  if (!d.bounds || !(d.bounds.width > 0 && d.bounds.height > 0 && d.bounds.depth > 0)) return 'bounds must be positive';
  if (d.materials !== undefined && d.materials !== 'library' && d.materials !== 'embedded') return 'materials must be "library" or "embedded"';
  if (d.variants !== undefined) {
    if (!Array.isArray(d.variants)) return 'variants must be an array';
    for (const v of d.variants) {
      if (typeof v.id !== 'string' || typeof v.tints !== 'object') return 'each variant needs an id and tints';
    }
  }
  if (d.animations !== undefined && typeof d.animations.autoplay !== 'string') return 'animations.autoplay must be a clip name';
  if (d.source !== undefined && typeof d.source !== 'string') return 'source must be a string';
  if (d.recenter !== undefined && typeof d.recenter !== 'boolean') return 'recenter must be boolean';
  if (d.textureFilter !== undefined && d.textureFilter !== 'palette' && d.textureFilter !== 'default') return 'textureFilter must be "palette" or "default"';
  if (d.surface !== undefined && typeof d.surface !== 'object') return 'surface must be an object';
  if (d.lod !== undefined) {
    for (const level of d.lod) {
      if (typeof level.path !== 'string' || !(isNumber(level.distance) && level.distance > 0)) return 'lod entries need path and distance';
    }
  }
  return null;
}

/** Validated, read-only index of the 3D asset library. */
export class AssetRegistry {
  private readonly assets = new Map<string, AssetDefinition>();

  constructor(definitions: AssetDefinition[]) {
    for (const definition of definitions) {
      const problem = validate(definition);
      if (problem) throw new Error(`Invalid asset "${definition.id}": ${problem}`);
      if (this.assets.has(definition.id)) throw new Error(`Duplicate asset id "${definition.id}"`);
      this.assets.set(definition.id, definition);
    }
  }

  get(id: string): AssetDefinition | undefined {
    return this.assets.get(id);
  }

  has(id: string): boolean {
    return this.assets.has(id);
  }

  list(): AssetDefinition[] {
    return [...this.assets.values()];
  }

  get size(): number {
    return this.assets.size;
  }

  /** Every catalogue object that asks for a visual asset must name a registered one. */
  checkReferences(objects: ConstructionObjectDefinition[]): void {
    for (const object of objects) {
      const asset = object.visual?.asset;
      if (asset !== undefined && !this.assets.has(asset)) {
        throw new Error(`Object "${object.id}" uses unknown visual asset "${asset}"`);
      }
    }
  }
}
