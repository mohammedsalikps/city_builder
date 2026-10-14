export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Snap a value to the nearest multiple of `step`. Used later for grid placement. */
export function snap(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

/**
 * Turn a horizontal offset around the vertical axis exactly as three.js
 * `rotation.y` turns a child of a group (local +X towards -Z), so positions
 * computed in data agree with the meshes and ghosts drawn for them.
 */
export function rotateAroundY(x: number, z: number, angle: number): { x: number; z: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: x * cos + z * sin, z: -x * sin + z * cos };
}
