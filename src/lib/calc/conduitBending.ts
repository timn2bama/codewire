/**
 * Conduit bending — pure geometry (no NEC tables). Covers the four bends an
 * electrician makes by hand: offset, three-point saddle, four-point saddle,
 * and the 90° stub-up.
 */

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Common field bend angles and their exact cosecant (distance) multipliers. */
export const OFFSET_ANGLES = [10, 22.5, 30, 45, 60] as const;
export type OffsetAngle = (typeof OFFSET_ANGLES)[number];

/** Exact distance-between-bends multiplier = 1 / sin(angle). */
export function offsetMultiplier(angleDeg: number): number {
  return 1 / Math.sin(toRad(angleDeg));
}

export interface OffsetResult {
  /** Distance between the two bend marks, measured along the conduit. */
  distanceBetweenMarks: number;
  /** Conduit "shrink" (lost length) caused by the offset. */
  shrink: number;
  multiplier: number;
}

/**
 * Offset: raise the run by `offsetHeight` using two equal bends of `angleDeg`.
 *   distance = offsetHeight / sin(angle)
 *   shrink   = offsetHeight * tan(angle / 2)
 */
export function calcOffset(
  offsetHeight: number,
  angleDeg: number,
): OffsetResult {
  const multiplier = offsetMultiplier(angleDeg);
  return {
    distanceBetweenMarks: offsetHeight * multiplier,
    shrink: offsetHeight * Math.tan(toRad(angleDeg / 2)),
    multiplier,
  };
}

export interface ThreePointSaddleResult {
  /** Distance from the center mark to each outer mark. */
  outerMarkDistance: number;
  shrink: number;
}

/**
 * Three-point saddle over an obstruction of height `depth`, using a 45°
 * center bend and two 22.5° outer bends (standard field method):
 *   outer marks = 2.5 × depth from center,  shrink = 0.1875 × depth.
 */
export function calcThreePointSaddle(depth: number): ThreePointSaddleResult {
  return {
    outerMarkDistance: depth * 2.5,
    shrink: depth * 0.1875,
  };
}

export interface FourPointSaddleResult {
  /** Rise distance for each of the two offsets (outer to inner bend). */
  riseDistance: number;
  shrink: number;
  multiplier: number;
}

/**
 * Four-point saddle = two offsets, back to back, of `depth` at `angleDeg`.
 * Inner bends straddle the obstruction; each outer→inner span = depth/sin.
 */
export function calcFourPointSaddle(
  depth: number,
  angleDeg: number,
): FourPointSaddleResult {
  const o = calcOffset(depth, angleDeg);
  return {
    riseDistance: o.distanceBetweenMarks,
    shrink: o.shrink * 2,
    multiplier: o.multiplier,
  };
}

/** Typical 90° take-up (inches) by EMT trade size. */
export const TAKE_UP: Record<string, number> = {
  '1/2"': 5,
  '3/4"': 6,
  '1"': 8,
  '1-1/4"': 11,
  '1-1/2"': 14,
  '2"': 16,
};

/**
 * 90° stub-up: mark = desired stub height − take-up for the conduit size.
 */
export function calcStub90(stubHeight: number, takeUp: number): number {
  return stubHeight - takeUp;
}
