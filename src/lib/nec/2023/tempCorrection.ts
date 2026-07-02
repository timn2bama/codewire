import type { TempRating } from "../types";

interface CorrectionRange {
  maxC: number; // upper bound of ambient range, in °C
  f: Record<TempRating, number | null>;
}

/**
 * NEC Table 310.15(B)(1) — ambient temperature correction factors,
 * based on 30°C. Look up by the highest range whose maxC >= ambient.
 * `null` means the conductor may not be used at that ambient/rating.
 */
const CORRECTION: CorrectionRange[] = [
  { maxC: 10, f: { 60: 1.29, 75: 1.2, 90: 1.15 } },
  { maxC: 15, f: { 60: 1.22, 75: 1.15, 90: 1.12 } },
  { maxC: 20, f: { 60: 1.15, 75: 1.11, 90: 1.08 } },
  { maxC: 25, f: { 60: 1.08, 75: 1.05, 90: 1.04 } },
  { maxC: 30, f: { 60: 1.0, 75: 1.0, 90: 1.0 } },
  { maxC: 35, f: { 60: 0.91, 75: 0.94, 90: 0.96 } },
  { maxC: 40, f: { 60: 0.82, 75: 0.88, 90: 0.91 } },
  { maxC: 45, f: { 60: 0.71, 75: 0.82, 90: 0.87 } },
  { maxC: 50, f: { 60: 0.58, 75: 0.75, 90: 0.82 } },
  { maxC: 55, f: { 60: 0.41, 75: 0.67, 90: 0.76 } },
  { maxC: 60, f: { 60: null, 75: 0.58, 90: 0.71 } },
  { maxC: 65, f: { 60: null, 75: 0.47, 90: 0.65 } },
  { maxC: 70, f: { 60: null, 75: 0.33, 90: 0.58 } },
  { maxC: 75, f: { 60: null, 75: null, 90: 0.5 } },
  { maxC: 80, f: { 60: null, 75: null, 90: 0.41 } },
  { maxC: 85, f: { 60: null, 75: null, 90: 0.29 } },
];

/** Ambient correction factor for a given ambient °C and insulation rating. */
export function ambientCorrection(
  ambientC: number,
  temp: TempRating,
): number | null {
  for (const range of CORRECTION) {
    if (ambientC <= range.maxC) return range.f[temp];
  }
  return null; // above the highest listed range
}

/**
 * NEC Table 310.15(C)(1) — adjustment factor for more than three
 * current-carrying conductors bundled in a raceway.
 */
export function bundlingAdjustment(currentCarrying: number): number {
  if (currentCarrying <= 3) return 1.0;
  if (currentCarrying <= 6) return 0.8;
  if (currentCarrying <= 9) return 0.7;
  if (currentCarrying <= 20) return 0.5;
  if (currentCarrying <= 30) return 0.45;
  if (currentCarrying <= 40) return 0.4;
  return 0.35;
}
