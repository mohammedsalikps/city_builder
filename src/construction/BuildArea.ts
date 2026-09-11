import type { Vec3 } from './PlacedObject';

/**
 * Square region of ground the player may currently build in. In a challenge
 * it is the area around the build origin; in free building it is the whole
 * ground. Ground snapping is anchored to `center`, so blueprint positions
 * relative to a build origin always fall on the snap lattice.
 */
export interface BuildArea {
  center: Vec3;
  halfSize: number;
}

export type BuildAreaProvider = () => BuildArea;
