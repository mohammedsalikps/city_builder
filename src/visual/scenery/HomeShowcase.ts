import * as THREE from 'three';
import type { AssetLibrary } from '../assets/AssetLibrary';

/** One piece of the vignette: an asset id, its footprint box (for 'stretch') and where it sits. */
interface ShowcasePiece {
  asset: string;
  x: number;
  z: number;
  rotationY?: number;
  /** Omitted = the asset's own natural size (props like the cone/dumpster). */
  box?: { width: number; height: number; depth: number };
}

/**
 * A small "under construction" vignette for the home menu only: a floor,
 * two walls meeting at a corner (roofless - the build is still in progress),
 * a spare column waiting to be placed, and a couple of site props. Built
 * from the exact same Kenney pieces and fit sizes the real catalogue already
 * uses (`kenney_bk_floor`/`wall`/`column` at the floor_large/wall_long/
 * wall_short/pillar_round box sizes), so nothing here is stretched further
 * than the game already stretches it elsewhere.
 *
 * Purely decorative: never added to `placedObjects`, never raycast, and
 * hidden whenever the player is not looking at the main menu.
 */
const PIECES: ShowcasePiece[] = [
  { asset: 'kenney_bk_floor', x: -10, z: 17, box: { width: 2, height: 0.2, depth: 2 } },
  { asset: 'kenney_bk_wall', x: -10, z: 18.9, rotationY: 0, box: { width: 2.2, height: 2.7, depth: 0.2 } },
  { asset: 'kenney_bk_wall', x: -8.9, z: 17, rotationY: 90, box: { width: 1.8, height: 2.7, depth: 0.2 } },
  { asset: 'kenney_bk_column', x: -6.8, z: 19.6, box: { width: 0.4, height: 2.7, depth: 0.4 } },
  { asset: 'kenney_road_cone', x: -7.6, z: 17.6 },
  { asset: 'kenney_road_cone', x: -12.6, z: 18.6 },
  { asset: 'kenney_road_dumpster', x: -12.9, z: 15.9, rotationY: 200 },
];

export class HomeShowcase {
  readonly root = new THREE.Group();
  private built = false;

  constructor(
    private readonly assets: AssetLibrary,
    private readonly heightAt: (x: number, z: number) => number,
  ) {
    this.root.name = 'homeShowcase';
  }

  async build(): Promise<void> {
    if (this.built) return;
    this.built = true;
    await this.assets.preload(PIECES.map((p) => p.asset));
    for (const piece of PIECES) {
      const object = piece.box ? this.assets.instantiateFitted(piece.asset, piece.box, 'stretch') : this.assets.instantiate(piece.asset);
      object.position.set(piece.x, this.heightAt(piece.x, piece.z), piece.z);
      object.rotation.y = THREE.MathUtils.degToRad(piece.rotationY ?? 0);
      object.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = true;
      });
      this.root.add(object);
    }
  }
}
