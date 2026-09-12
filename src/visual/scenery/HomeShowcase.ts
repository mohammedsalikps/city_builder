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
 * a spare column and a door waiting to be installed, a delivery van and a
 * few site props, and some trees standing around it. Built from the exact
 * same Kenney pieces and fit sizes the real catalogue already uses
 * (`kenney_bk_floor`/`wall`/`column`/`door` at the floor_large/wall_long/
 * wall_short/pillar_round/door_single box sizes), so nothing here is
 * stretched further than the game already stretches it elsewhere; the new
 * nature and car-kit pieces are placed at their own natural size.
 *
 * Two smaller, quieter clusters balance the frame either side of the build
 * site (a garden corner on the far side of the home camera's view, and a
 * couple of near-camera trees below where the two mode cards sit) so the
 * foreground reads as a lived-in yard rather than a hero prop on bare grass.
 *
 * Purely decorative: never added to `placedObjects`, never raycast, and
 * hidden whenever the player is not looking at the main menu.
 */
const PIECES: ShowcasePiece[] = [
  // --- the construction site itself ---
  { asset: 'kenney_bk_floor', x: -10, z: 17, box: { width: 2, height: 0.2, depth: 2 } },
  { asset: 'kenney_bk_wall', x: -10, z: 18.9, rotationY: 0, box: { width: 2.2, height: 2.7, depth: 0.2 } },
  { asset: 'kenney_bk_wall', x: -8.9, z: 17, rotationY: 90, box: { width: 1.8, height: 2.7, depth: 0.2 } },
  { asset: 'kenney_bk_column', x: -6.8, z: 19.6, box: { width: 0.4, height: 2.7, depth: 0.4 } },
  // The door for the coming opening, leaning against the wall until it's set in.
  { asset: 'kenney_bk_door', x: -10.6, z: 17.9, rotationY: 100, box: { width: 0.9, height: 2.1, depth: 0.1 } },
  { asset: 'kenney_road_cone', x: -7.6, z: 17.6 },
  { asset: 'kenney_road_cone', x: -12.6, z: 18.6 },
  { asset: 'kenney_road_dumpster', x: -12.9, z: 15.9, rotationY: 200 },
  { asset: 'kenney_car_van', x: -4.6, z: 21.5, rotationY: -75 },
  // A stepping-stone path leading away from the site, so it reads as
  // connected to somewhere rather than floating on open grass.
  { asset: 'kenney_sub_path_stones', x: -2, z: 18.5, rotationY: -75 },
  { asset: 'kenney_nat_tree_round', x: -14.5, z: 20.5, rotationY: 30 },
  { asset: 'kenney_nat_tree_oak', x: -3.5, z: 15.5, rotationY: 160 },
  { asset: 'kenney_nat_bush', x: -13.5, z: 15, rotationY: 60 },
  { asset: 'kenney_nat_bush_large', x: -6.2, z: 18.6, rotationY: 200 },

  // --- a small garden corner on the far side of the site, balancing the frame ---
  { asset: 'kenney_nat_tree_pine_round', x: 22, z: 8, rotationY: 40 },
  { asset: 'kenney_nat_tree_oak', x: 27, z: 13, rotationY: 190 },

  // A single near-camera tree below the cards, so the foreground doesn't
  // read as empty grass at the bottom edge of the frame.
  { asset: 'kenney_nat_tree_round', x: 2, z: 24, rotationY: 80 },
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
