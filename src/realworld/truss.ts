/**
 * A small 2D pin-jointed truss solver for the triangulation lesson.
 *
 * Bars are straight springs joined by frictionless pins (the classic
 * textbook truss); loads act at the pins. The solver uses the direct
 * stiffness method for small movements: it either returns how far each pin
 * moves and how hard each bar is pulled or pushed, or reports that the frame
 * is a mechanism - it can change shape without any bar changing length, so
 * no amount of stiffness holds it (a four-bar square pushed sideways).
 *
 * Units are relative (the lesson's pretend bars and pushes); the results are
 * exact for the model, which is what the lesson shows: a square folds, a
 * triangulated frame barely moves.
 */

export interface TrussNode {
  x: number;
  y: number;
  /** Held in place horizontally / vertically (a support). */
  fixX?: boolean;
  fixY?: boolean;
}

export interface TrussBar {
  a: number;
  b: number;
}

export interface TrussLoad {
  node: number;
  fx: number;
  fy: number;
}

export interface TrussResult {
  /** Movement of each pin, same order as the nodes. */
  displacements: Array<{ x: number; y: number }>;
  /** Pull (+) or push (-) in each bar, same order as the bars. */
  forces: number[];
}

/** Pivots smaller than this (relative to the largest stiffness) mean the frame can move freely. */
const MECHANISM_TOLERANCE = 1e-9;

/**
 * Solves the truss, or returns null when it is a mechanism (some pins can
 * move without stretching any bar) or the input is unusable (no bars,
 * zero-length bars, bad indices, non-finite numbers).
 * `stiffness` is the same for every bar (EA in the textbook formula).
 */
export function solveTruss(nodes: readonly TrussNode[], bars: readonly TrussBar[], loads: readonly TrussLoad[], stiffness = 1000): TrussResult | null {
  if (nodes.length === 0 || bars.length === 0 || !(stiffness > 0) || !Number.isFinite(stiffness)) return null;
  if (nodes.some((n) => !Number.isFinite(n.x) || !Number.isFinite(n.y))) return null;
  const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < nodes.length;
  const size = nodes.length * 2;
  const k: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const geometry: Array<{ c: number; s: number; length: number }> = [];
  for (const bar of bars) {
    if (!valid(bar.a) || !valid(bar.b) || bar.a === bar.b) return null;
    const dx = nodes[bar.b].x - nodes[bar.a].x;
    const dy = nodes[bar.b].y - nodes[bar.a].y;
    const length = Math.hypot(dx, dy);
    if (!(length > 1e-9)) return null;
    const c = dx / length;
    const s = dy / length;
    geometry.push({ c, s, length });
    const ke = stiffness / length;
    const local = [
      [c * c, c * s, -c * c, -c * s],
      [c * s, s * s, -c * s, -s * s],
      [-c * c, -c * s, c * c, c * s],
      [-c * s, -s * s, c * s, s * s],
    ];
    const dofs = [bar.a * 2, bar.a * 2 + 1, bar.b * 2, bar.b * 2 + 1];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) k[dofs[i]][dofs[j]] += ke * local[i][j];
  }
  const f = new Array<number>(size).fill(0);
  for (const load of loads) {
    if (!valid(load.node) || !Number.isFinite(load.fx) || !Number.isFinite(load.fy)) return null;
    f[load.node * 2] += load.fx;
    f[load.node * 2 + 1] += load.fy;
  }
  // Free degrees of freedom (supports removed).
  const free: number[] = [];
  nodes.forEach((node, i) => {
    if (!node.fixX) free.push(i * 2);
    if (!node.fixY) free.push(i * 2 + 1);
  });
  const u = new Array<number>(size).fill(0);
  if (free.length > 0) {
    const a = free.map((r) => free.map((c) => k[r][c]));
    const rhs = free.map((r) => f[r]);
    const solution = solveLinear(a, rhs);
    if (!solution) return null;
    free.forEach((dof, i) => (u[dof] = solution[i]));
  }
  const displacements = nodes.map((_, i) => ({ x: u[i * 2], y: u[i * 2 + 1] }));
  const forces = bars.map((bar, i) => {
    const { c, s, length } = geometry[i];
    const stretch = (u[bar.b * 2] - u[bar.a * 2]) * c + (u[bar.b * 2 + 1] - u[bar.a * 2 + 1]) * s;
    return (stiffness / length) * stretch;
  });
  return { displacements, forces };
}

/** Gaussian elimination with partial pivoting; null when the matrix is singular (a mechanism). */
function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  let scale = 0;
  for (const row of matrix) for (const value of row) scale = Math.max(scale, Math.abs(value));
  if (!(scale > 0)) return null;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) <= MECHANISM_TOLERANCE * scale) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / a[col][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) a[row][c] -= factor * a[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = a[row][n];
    for (let c = row + 1; c < n; c++) sum -= a[row][c] * x[c];
    x[row] = sum / a[row][row];
  }
  return x.every(Number.isFinite) ? x : null;
}

/**
 * The lesson's two frames: a square of four bars standing on two pinned
 * supports, with or without one diagonal, pushed sideways at the top left.
 * Nodes: 0 bottom-left, 1 bottom-right, 2 top-right, 3 top-left (unit square).
 */
export function lessonFrame(braced: boolean): { nodes: TrussNode[]; bars: TrussBar[] } {
  const nodes: TrussNode[] = [
    { x: 0, y: 0, fixX: true, fixY: true },
    { x: 1, y: 0, fixX: true, fixY: true },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const bars: TrussBar[] = [
    { a: 0, b: 1 },
    { a: 1, b: 2 },
    { a: 2, b: 3 },
    { a: 3, b: 0 },
  ];
  if (braced) bars.push({ a: 0, b: 2 });
  return { nodes, bars };
}

/** The diagonal's index in lessonFrame(true).bars. */
export const LESSON_DIAGONAL = 4;

export interface CableLoadResult {
  /** Where the load hangs, 0..1 from the left tower (kept a little away from the towers). */
  position: number;
  /** Pull (tension) in the cable toward the left / right tower, in multiples of the load. */
  leftPull: number;
  rightPull: number;
  /** Share of the load each tower carries down to its foundation (they add up to 1). */
  leftTower: number;
  rightTower: number;
  /** The sideways part of the pull at the tower tops, which the anchorages hold back. */
  sidewaysPull: number;
}

/** Loads closer to a tower than this (share of the span) are moved out to it: the V would be almost flat. */
const CABLE_EDGE = 0.05;

/**
 * The bridge lesson's pretend cable: one cable between two tower tops (span
 * 1), pulled into a V by a load (weight 1) hanging at `position01`. The V
 * dips 4 x sag x p x (1 - p) at the load, as deep as a cable with
 * `sagRatio` (dip / span) would hang there. Solved with the same truss
 * solver as the triangle lesson: the pull in each half of the cable and how
 * much of the load each tower carries. Null for unusable input.
 * Relative units for a teaching model: the real bridge spreads loads through
 * its stiff deck and many suspenders, so its numbers are different.
 */
export function cableUnderLoad(position01: number, sagRatio: number): CableLoadResult | null {
  if (!Number.isFinite(position01) || !Number.isFinite(sagRatio) || !(sagRatio > 0)) return null;
  const p = Math.min(1 - CABLE_EDGE, Math.max(CABLE_EDGE, position01));
  const drop = 4 * sagRatio * p * (1 - p);
  const nodes: TrussNode[] = [
    { x: 0, y: 0, fixX: true, fixY: true },
    { x: 1, y: 0, fixX: true, fixY: true },
    { x: p, y: -drop },
  ];
  const bars: TrussBar[] = [
    { a: 0, b: 2 },
    { a: 1, b: 2 },
  ];
  const result = solveTruss(nodes, bars, [{ node: 2, fx: 0, fy: -1 }]);
  if (!result) return null;
  const [leftPull, rightPull] = result.forces;
  const leftLength = Math.hypot(p, drop);
  const rightLength = Math.hypot(1 - p, drop);
  return {
    position: p,
    leftPull,
    rightPull,
    leftTower: (leftPull * drop) / leftLength,
    rightTower: (rightPull * drop) / rightLength,
    sidewaysPull: (leftPull * p) / leftLength,
  };
}
