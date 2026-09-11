import type * as THREE from 'three';
import type { ConstructionObjectDefinition } from './ConstructionObjectDefinition';
import type { PlacedObject, Vec3 } from './PlacedObject';
import { boundsOfPlaced, roundCoord, type Bounds } from './bounds';
import { PartList, box } from './shapes/PartList';
import { snap } from '@/utils/math';

/** Horizontal 2D vector (world X/Z). */
export interface Vec2 {
  x: number;
  z: number;
}

/**
 * A wall as a line segment with thickness: its centre, the unit direction
 * along its length, the unit normal across it, and its size. Walls only
 * rotate around Y, so both axes are horizontal.
 *
 * three.js rotation.y = θ maps local +X to (cos θ, 0, -sin θ) and local +Z
 * to (sin θ, 0, cos θ); width runs along local X, thickness along local Z.
 */
export interface WallFrame {
  center: Vec3;
  dir: Vec2;
  normal: Vec2;
  length: number;
  thickness: number;
  height: number;
}

/** The two connection points of a wall (bottom-centre of each end face). */
export interface WallEndpoint {
  point: Vec2;
  /** Unit direction pointing out of the wall through this end. */
  outward: Vec2;
}

export function wallFrame(definition: ConstructionObjectDefinition, position: Vec3, rotationY: number): WallFrame {
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  return {
    center: position,
    dir: { x: cos, z: -sin },
    normal: { x: sin, z: cos },
    length: definition.dimensions.width,
    thickness: definition.dimensions.depth,
    height: definition.dimensions.height,
  };
}

export function wallEndpoints(frame: WallFrame): [WallEndpoint, WallEndpoint] {
  const half = frame.length / 2;
  const { center, dir } = frame;
  return [
    { point: { x: center.x + dir.x * half, z: center.z + dir.z * half }, outward: { x: dir.x, z: dir.z } },
    { point: { x: center.x - dir.x * half, z: center.z - dir.z * half }, outward: { x: -dir.x, z: -dir.z } },
  ];
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.z * b.z;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export type WallSnapKind = 'corner' | 'inline';

export interface WallSnapResult {
  position: Vec3;
  kind: WallSnapKind;
  /** The wall that was snapped to. */
  neighbourId: string;
}

/**
 * Snap a wall being placed to the end of a nearby wall at the same level.
 *
 * Two joins are offered, both overlap-free and flush on the outside:
 *
 *   inline  – the walls are parallel: the new wall continues the old one
 *             end to end.
 *   corner  – the walls are perpendicular. Two overlap-free butt joints exist
 *             at every end and both are offered; the one nearer the pointer
 *             wins: the new wall butts against the old wall's face (new wall
 *             inside the old wall's length), or the new wall runs past the
 *             old wall's end with the old wall butting into it. Which side
 *             the new wall extends to is the side the player is pointing at.
 *
 * Four such corners close a room exactly (a pinwheel of butt joints), and
 * because both joint variants are offered the ring can be built in any
 * order and still land on a blueprint's ghosts.
 */
export function snapWallToNeighbours(
  definition: ConstructionObjectDefinition,
  position: Vec3,
  rotationY: number,
  neighbours: Array<{ placed: PlacedObject; definition: ConstructionObjectDefinition }>,
  snapRadius: number,
  pointer?: Vec2,
): WallSnapResult | null {
  const candidate = wallFrame(definition, position, rotationY);
  // Joins are found and chosen relative to where the player is actually
  // pointing, not the lattice-snapped position: the lattice can put a 2 m
  // wall's ends a full metre from the corner the player is aiming at, and
  // pointing at a ghost wall must pick the join that lands on it.
  const rawCenter: Vec2 = pointer ?? { x: position.x, z: position.z };
  const candidateEnds = wallEndpoints(
    wallFrame(definition, { x: rawCenter.x, y: position.y, z: rawCenter.z }, rotationY),
  );

  let best: { result: WallSnapResult; displacement: number } | null = null;

  for (const { placed, definition: neighbourDef } of neighbours) {
    if (Math.abs(placed.position.y - position.y) > 1e-4) continue;
    const frame = wallFrame(neighbourDef, placed.position, placed.rotationY);
    const alignment = Math.abs(dot(frame.dir, candidate.dir));
    const parallel = alignment > 0.9;
    const perpendicular = alignment < 0.1;
    if (!parallel && !perpendicular) continue;

    for (const end of wallEndpoints(frame)) {
      // Only consider ends the candidate is actually near.
      const nearest = Math.min(...candidateEnds.map((c) => distance(c.point, end.point)));
      if (nearest > snapRadius) continue;

      const options: Array<{ target: Vec2; kind: WallSnapKind }> = [];
      if (parallel) {
        options.push({
          kind: 'inline',
          target: {
            x: end.point.x + end.outward.x * (candidate.length / 2),
            z: end.point.z + end.outward.z * (candidate.length / 2),
          },
        });
      } else {
        const side = dot({ x: rawCenter.x - end.point.x, z: rawCenter.z - end.point.z }, frame.normal) >= 0 ? 1 : -1;
        const n: Vec2 = { x: frame.normal.x * side, z: frame.normal.z * side };
        const halfLen = candidate.length / 2;
        // Variant 1: new wall butts into the old wall's face (inside the old
        // wall's length): pulled back by half its own thickness, pushed out to
        // the old wall's face.
        const buttIn: Vec2 = {
          x: end.point.x - end.outward.x * (candidate.thickness / 2) + n.x * (frame.thickness / 2),
          z: end.point.z - end.outward.z * (candidate.thickness / 2) + n.z * (frame.thickness / 2),
        };
        // Variant 2: new wall runs past the old wall's end (outside its
        // length) and starts at the old wall's far face, so the old wall butts
        // into it instead.
        const runPast: Vec2 = {
          x: end.point.x + end.outward.x * (candidate.thickness / 2) - n.x * (frame.thickness / 2),
          z: end.point.z + end.outward.z * (candidate.thickness / 2) - n.z * (frame.thickness / 2),
        };
        for (const nearEnd of [buttIn, runPast]) {
          options.push({
            kind: 'corner',
            target: { x: nearEnd.x + n.x * halfLen, z: nearEnd.z + n.z * halfLen },
          });
        }
      }

      for (const option of options) {
        const displacement = distance(option.target, rawCenter);
        if (!best || displacement < best.displacement) {
          best = {
            displacement,
            result: {
              position: { x: roundCoord(option.target.x), y: position.y, z: roundCoord(option.target.z) },
              kind: option.kind,
              neighbourId: placed.id,
            },
          };
        }
      }
    }
  }

  return best?.result ?? null;
}

// --------------------------------------------------------------- structure

/**
 * Bounds of every wall connected to `start` at the same level: walls whose
 * boxes touch or overlap, followed transitively. Four walls joined at their
 * corners form one structure; a roof is centred over it. Lightweight on
 * purpose: nothing is stored, it is derived from placed objects on demand.
 */
export function connectedWallBounds(
  start: PlacedObject,
  walls: Array<{ placed: PlacedObject; definition: ConstructionObjectDefinition }>,
): Bounds {
  const byId = new Map(walls.map((w) => [w.placed.id, w]));
  const boundsById = new Map(walls.map((w) => [w.placed.id, boundsOfPlaced(w.definition, w.placed)]));
  const touch = 1e-3;
  const touches = (a: Bounds, b: Bounds): boolean =>
    a.minX <= b.maxX + touch &&
    a.maxX >= b.minX - touch &&
    a.minZ <= b.maxZ + touch &&
    a.maxZ >= b.minZ - touch &&
    Math.abs(a.minY - b.minY) < 1e-4;

  const visited = new Set<string>([start.id]);
  const queue = [start.id];
  while (queue.length > 0) {
    const id = queue.pop() as string;
    const a = boundsById.get(id);
    if (!a) continue;
    for (const [otherId, other] of byId) {
      if (visited.has(otherId)) continue;
      const b = boundsById.get(otherId);
      if (b && touches(a, b) && other) {
        visited.add(otherId);
        queue.push(otherId);
      }
    }
  }

  const union: Bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const id of visited) {
    const b = boundsById.get(id);
    if (!b) continue;
    union.minX = Math.min(union.minX, b.minX);
    union.maxX = Math.max(union.maxX, b.maxX);
    union.minY = Math.min(union.minY, b.minY);
    union.maxY = Math.max(union.maxY, b.maxY);
    union.minZ = Math.min(union.minZ, b.minZ);
    union.maxZ = Math.max(union.maxZ, b.maxZ);
  }
  return union;
}

// ---------------------------------------------------------------- openings

/** An opening's rectangle in a wall's local frame: u along the wall, v up. */
export interface OpeningRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

export interface OpeningPlacement {
  position: Vec3;
  rotationY: number;
}

/**
 * Set an opening (door/window) into a wall's plane at the point the player
 * is pointing at. The opening takes the wall's rotation (optionally flipped
 * a half turn so a door can face either way), sits centred in the wall's
 * thickness, slides along the wall in `step` increments and is kept within
 * the wall's length. Returns null when the opening cannot fit the wall.
 */
export function placeOpeningInWall(
  wallDefinition: ConstructionObjectDefinition,
  wall: PlacedObject,
  openingDefinition: ConstructionObjectDefinition,
  hitPoint: Vec3,
  flip: boolean,
  step: number,
): OpeningPlacement | null {
  const frame = wallFrame(wallDefinition, wall.position, wall.rotationY);
  const width = openingDefinition.dimensions.width;
  const height = openingDefinition.dimensions.height;
  const sill = openingDefinition.placement?.sillHeight ?? 0;
  if (width > frame.length + 1e-6 || sill + height > frame.height + 1e-6) return null;

  const rel: Vec2 = { x: hitPoint.x - frame.center.x, z: hitPoint.z - frame.center.z };
  const limit = frame.length / 2 - width / 2;
  const u = Math.max(-limit, Math.min(limit, snap(dot(rel, frame.dir), step)));

  return {
    position: {
      x: roundCoord(frame.center.x + frame.dir.x * u),
      y: roundCoord(wall.position.y + sill),
      z: roundCoord(frame.center.z + frame.dir.z * u),
    },
    rotationY: wall.rotationY + (flip ? Math.PI : 0),
  };
}

/** Rectangles of the given openings in the wall's local frame, sorted along the wall. */
export function openingRects(
  wallDefinition: ConstructionObjectDefinition,
  wall: PlacedObject,
  openings: Array<{ placed: PlacedObject; definition: ConstructionObjectDefinition }>,
): OpeningRect[] {
  const frame = wallFrame(wallDefinition, wall.position, wall.rotationY);
  const rects = openings.map(({ placed, definition }) => {
    const rel: Vec2 = { x: placed.position.x - frame.center.x, z: placed.position.z - frame.center.z };
    const u = dot(rel, frame.dir);
    const half = definition.dimensions.width / 2;
    const v0 = placed.position.y - wall.position.y;
    return { u0: u - half, u1: u + half, v0, v1: v0 + definition.dimensions.height };
  });
  return rects.sort((a, b) => a.u0 - b.u0);
}

/** Stable description of a wall's openings, used to skip needless rebuilds. */
export function openingSignature(rects: OpeningRect[]): string {
  return rects.map((r) => [r.u0, r.u1, r.v0, r.v1].map((v) => v.toFixed(4)).join(',')).join('|');
}

/**
 * Wall geometry with rectangular holes: the wall is cut into vertical strips
 * at the opening edges; strips without an opening are full-height boxes,
 * strips with one get a box below (if any) and a box above (if any).
 * Same bottom-centre convention as every other shape.
 */
export function buildWallGeometry(
  wallDefinition: ConstructionObjectDefinition,
  rects: OpeningRect[],
): THREE.BufferGeometry {
  const { width: length, height, depth: thickness } = wallDefinition.dimensions;
  const color = wallDefinition.color;
  const parts = new PartList();
  const eps = 1e-6;

  const addStrip = (u0: number, u1: number, v0: number, v1: number): void => {
    const w = u1 - u0;
    const h = v1 - v0;
    if (w <= eps || h <= eps) return;
    parts.add(box(w, h, thickness), color, { x: (u0 + u1) / 2, y: (v0 + v1) / 2 });
  };

  let cursor = -length / 2;
  for (const rect of rects) {
    const u0 = Math.max(cursor, rect.u0);
    const u1 = Math.min(length / 2, rect.u1);
    if (u0 > cursor) addStrip(cursor, u0, 0, height);
    if (u1 > u0) {
      addStrip(u0, u1, 0, Math.max(0, rect.v0));
      addStrip(u0, u1, Math.min(height, rect.v1), height);
    }
    cursor = Math.max(cursor, u1);
  }
  if (cursor < length / 2) addStrip(cursor, length / 2, 0, height);

  return parts.build();
}
