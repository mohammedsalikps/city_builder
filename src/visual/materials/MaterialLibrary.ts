import * as THREE from 'three';
import { createTexture, createWaterNormal, type TextureId } from './textures';

/** How one library material looks: PBR response plus optional detail texture. */
interface MaterialSpec {
  texture?: TextureId;
  /** World-space size of one texture tile, metres. */
  metresPerTile?: number;
  roughness: number;
  metalness?: number;
  envMapIntensity?: number;
}

const SPECS: Record<string, MaterialSpec> = {
  plaster: { texture: 'plaster', metresPerTile: 2, roughness: 0.92 },
  concrete: { texture: 'concrete', metresPerTile: 2, roughness: 0.9 },
  stone: { texture: 'stone', metresPerTile: 1.4, roughness: 0.95 },
  brick: { texture: 'brick', metresPerTile: 1, roughness: 0.9 },
  clay: { texture: 'clay', metresPerTile: 0.5, roughness: 0.85 },
  roof_tile: { texture: 'roof', metresPerTile: 1.2, roughness: 0.82 },
  wood: { texture: 'wood', metresPerTile: 1.2, roughness: 0.75 },
  trim: { texture: 'trim', metresPerTile: 1, roughness: 0.55 },
  shutter: { texture: 'wood', metresPerTile: 0.8, roughness: 0.6 },
  glass: { roughness: 0.06, metalness: 0.25, envMapIntensity: 1.6 },
  metal: { roughness: 0.38, metalness: 0.85 },
  paint: { roughness: 0.3, metalness: 0.3, envMapIntensity: 1.2 },
  rubber: { roughness: 0.92 },
  asphalt: { texture: 'asphalt', metresPerTile: 3, roughness: 0.95 },
  marking: { roughness: 0.7 },
  grass: { texture: 'grass', metresPerTile: 3, roughness: 1 },
  soil: { texture: 'soil', metresPerTile: 2, roughness: 1 },
  bark: { texture: 'bark', metresPerTile: 1, roughness: 0.95 },
  foliage: { texture: 'foliage', metresPerTile: 1.6, roughness: 0.85 },
  fabric: { texture: 'fabric', metresPerTile: 0.4, roughness: 0.95 },
  sail: { texture: 'fabric', metresPerTile: 0.6, roughness: 0.9 },
};

/** Catalogue `material` words (objects.json) to library materials. */
const CONSTRUCTION_ALIASES: Record<string, string> = {
  clay: 'clay',
  concrete: 'concrete',
  plaster: 'plaster',
  timber: 'wood',
  wood: 'wood',
  tiles: 'roof_tile',
  glass: 'glass',
  fabric: 'fabric',
  foliage: 'foliage',
  plant: 'foliage',
  steel: 'paint',
  asphalt: 'asphalt',
};

const WORLD_UV_CHUNK = /* glsl */ `
#ifdef USE_MAP
  vec4 cbWorld = vec4( transformed, 1.0 );
  vec3 cbNormal = objectNormal;
  #ifdef USE_INSTANCING
    cbWorld = instanceMatrix * cbWorld;
    cbNormal = mat3( instanceMatrix ) * cbNormal;
  #endif
  cbWorld = modelMatrix * cbWorld;
  cbNormal = normalize( mat3( modelMatrix ) * cbNormal );
  vec3 cbAbs = abs( cbNormal );
  vec2 cbUv = cbAbs.y >= max( cbAbs.x, cbAbs.z ) ? cbWorld.xz : ( cbAbs.x >= cbAbs.z ? cbWorld.zy : cbWorld.xy );
  vMapUv = cbUv * uWorldUvScale;
#endif
`;

/**
 * Texture a material by world position instead of mesh UVs: the dominant
 * axis of the world normal picks the projection plane, and one texture tile
 * spans `metresPerTile`. Bricks, tiles and planks therefore keep a real-world
 * size on every object, whatever its dimensions or rotation, including
 * instanced meshes.
 */
export function applyWorldUv(material: THREE.Material, metresPerTile: number): void {
  const scale = 1 / metresPerTile;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWorldUvScale = { value: scale };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWorldUvScale;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>\n${WORLD_UV_CHUNK}`);
  };
  material.customProgramCacheKey = () => 'world-uv';
}

/** Clone a material including its shader patch (Material.clone drops onBeforeCompile). */
export function cloneMaterial<T extends THREE.Material>(material: T): T {
  const clone = material.clone() as T;
  clone.onBeforeCompile = material.onBeforeCompile;
  clone.customProgramCacheKey = material.customProgramCacheKey;
  return clone;
}

/**
 * Shared PBR materials for the whole game: construction objects, glTF assets
 * bound by material name, terrain and water. Every material and texture is
 * created once and reused; nothing here allocates per frame.
 */
export class MaterialLibrary {
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly anisotropy: number;
  private waterNormal: THREE.Texture | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }

  has(id: string): boolean {
    return id in SPECS;
  }

  /** Library id for a glTF material name ("foliage_dark" -> "foliage"), or null to keep it. */
  resolveAssetMaterial(name: string): string | null {
    if (this.has(name)) return name;
    const cut = name.lastIndexOf('_');
    if (cut > 0 && this.has(name.slice(0, cut))) return name.slice(0, cut);
    return null;
  }

  /** Library id for a catalogue `material` word, or null for the plain vertex-colour look. */
  constructionMaterialId(material: string): string | null {
    return CONSTRUCTION_ALIASES[material] ?? (this.has(material) ? material : null);
  }

  /** Construction objects: vertex colours give the hue, the texture the detail. */
  forConstruction(id: string): THREE.MeshStandardMaterial {
    return this.cached(`c:${id}`, () => this.create(id, SPECS[id], true, new THREE.Color(0xffffff)));
  }

  /** glTF assets bound by name: the asset's base colour tints the shared look. */
  forAsset(id: string, color: THREE.Color): THREE.MeshStandardMaterial {
    return this.cached(`a:${id}:${color.getHexString()}`, () => this.create(id, SPECS[id], false, color.clone()));
  }

  /** Terrain: vertex colours (grass, rock, snow) over grass detail. */
  terrain(): THREE.MeshStandardMaterial {
    return this.cached('terrain', () => this.create('grass', SPECS.grass, true, new THREE.Color(0xffffff)));
  }

  water(): THREE.MeshStandardMaterial {
    return this.cached('water', () => {
      this.waterNormal = createWaterNormal();
      this.waterNormal.repeat.set(10, 10);
      const material = new THREE.MeshStandardMaterial({
        name: 'water',
        color: new THREE.Color('#2b6d8a'),
        roughness: 0.07,
        metalness: 0.08,
        transparent: true,
        opacity: 0.9,
        normalMap: this.waterNormal,
        normalScale: new THREE.Vector2(0.45, 0.45),
      });
      material.envMapIntensity = 1.5;
      return material;
    });
  }

  /** Per-frame animation of animated surfaces (water ripples). Allocation-free. */
  update(deltaSeconds: number): void {
    if (this.waterNormal) {
      this.waterNormal.offset.x += deltaSeconds * 0.012;
      this.waterNormal.offset.y += deltaSeconds * 0.007;
    }
  }

  get stats(): { materials: number; textures: number } {
    return { materials: this.materials.size, textures: this.textures.size };
  }

  dispose(): void {
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.waterNormal?.dispose();
    this.materials.clear();
    this.textures.clear();
  }

  private cached(key: string, make: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    let material = this.materials.get(key);
    if (!material) {
      material = make();
      this.materials.set(key, material);
    }
    return material;
  }

  private create(id: string, spec: MaterialSpec, vertexColors: boolean, color: THREE.Color): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      name: id,
      color,
      vertexColors,
      roughness: spec.roughness,
      metalness: spec.metalness ?? 0,
    });
    if (spec.envMapIntensity !== undefined) material.envMapIntensity = spec.envMapIntensity;
    if (spec.texture) {
      material.map = this.texture(spec.texture);
      applyWorldUv(material, spec.metresPerTile ?? 1);
    }
    return material;
  }

  private texture(id: TextureId): THREE.Texture {
    let texture = this.textures.get(id);
    if (!texture) {
      texture = createTexture(id);
      texture.anisotropy = this.anisotropy;
      this.textures.set(id, texture);
    }
    return texture;
  }
}
