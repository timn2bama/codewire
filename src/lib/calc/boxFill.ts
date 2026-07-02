import { boxFillAllowance } from "../nec/2023";
import type { WireSize } from "../nec/types";

export interface BoxFillInput {
  /** Box interior volume in cubic inches (Table 314.16(A) or marked). */
  boxVolume: number;
  /** Insulated current-carrying / grounded conductors entering the box, by size. */
  conductors: { size: WireSize; quantity: number }[];
  /** Number of device yokes/straps (each counts as 2× the largest connected conductor). */
  devices: number;
  /** True if internal cable clamps are present (count once, largest conductor). */
  hasClamps: boolean;
  /**
   * Equipment grounding conductors. All EGCs together count as ONE conductor
   * of the largest EGC size (314.16(B)(5)). Provide the largest EGC size, or
   * omit when there are none.
   */
  groundSize?: WireSize;
}

export interface BoxFillResult {
  requiredVolume: number; // cu in
  boxVolume: number;
  remaining: number; // box - required
  fillPercent: number; // required / box (0–100)
  pass: boolean;
  /** Largest conductor size found (used for device/clamp allowances). */
  largestSize: WireSize | null;
}

/** Returns the allowance (cu in) for a size, treating unknown sizes as 0. */
function allowance(size: WireSize): number {
  return boxFillAllowance(size) ?? 0;
}

/** Compares two sizes by their volume allowance; returns the larger. */
function largerSize(a: WireSize | null, b: WireSize): WireSize {
  if (a === null) return b;
  return allowance(b) > allowance(a) ? b : a;
}

export function calcBoxFill(input: BoxFillInput): BoxFillResult {
  let largest: WireSize | null = null;
  let conductorVol = 0;

  for (const c of input.conductors) {
    const qty = Math.max(0, c.quantity);
    conductorVol += allowance(c.size) * qty;
    if (qty > 0) largest = largerSize(largest, c.size);
  }

  // Devices: 2× the largest conductor allowance, per yoke.
  const deviceVol =
    largest !== null ? 2 * allowance(largest) * Math.max(0, input.devices) : 0;

  // Clamps: one allowance of the largest conductor, total.
  const clampVol = input.hasClamps && largest !== null ? allowance(largest) : 0;

  // Grounding: all EGCs = one allowance of the largest EGC.
  const groundVol = input.groundSize ? allowance(input.groundSize) : 0;

  const requiredVolume = conductorVol + deviceVol + clampVol + groundVol;

  return {
    requiredVolume,
    boxVolume: input.boxVolume,
    remaining: input.boxVolume - requiredVolume,
    fillPercent:
      input.boxVolume > 0 ? (requiredVolume / input.boxVolume) * 100 : 0,
    pass: requiredVolume <= input.boxVolume && input.boxVolume > 0,
    largestSize: largest,
  };
}
