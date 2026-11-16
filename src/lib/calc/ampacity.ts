import {
  ambientCorrection,
  baseAmpacity,
  bundlingAdjustment,
} from "../nec/2023";
import type { Material, TempRating, WireSize } from "../nec/types";
import { WIRE_SIZES } from "../nec/types";

export interface AmpacityInput {
  material: Material;
  size: WireSize;
  /** Insulation temperature column used for derating (60/75/90 °C). */
  tempRating: TempRating;
  /** Ambient temperature in °C. */
  ambientC: number;
  /** Number of current-carrying conductors in the raceway. */
  currentCarrying: number;
  /**
   * Termination temperature limit per 110.14(C). Final ampacity may not
   * exceed the base ampacity in this column. Defaults to 75 °C.
   */
  terminationRating?: TempRating;
}

export interface AmpacityResult {
  base: number | null; // Table 310.16 base at tempRating
  ambientFactor: number | null;
  bundlingFactor: number;
  derated: number | null; // base * ambient * bundling
  terminationLimit: number | null; // base at terminationRating
  /** Final usable ampacity = min(derated, terminationLimit). */
  ampacity: number | null;
}

export function calcAmpacity(input: AmpacityInput): AmpacityResult {
  const termRating = input.terminationRating ?? 75;
  const base = baseAmpacity(input.material, input.size, input.tempRating);
  const ambientFactor = ambientCorrection(input.ambientC, input.tempRating);
  const bundlingFactor = bundlingAdjustment(input.currentCarrying);
  const terminationLimit = baseAmpacity(
    input.material,
    input.size,
    termRating,
  );

  const derated =
    base !== null && ambientFactor !== null
      ? base * ambientFactor * bundlingFactor
      : null;

  let ampacity: number | null = derated;
  if (derated !== null && terminationLimit !== null) {
    ampacity = Math.min(derated, terminationLimit);
  }

  return {
    base,
    ambientFactor,
    bundlingFactor,
    derated,
    terminationLimit,
    ampacity,
  };
}

/**
 * NEC 240.4(D) — small-conductor overcurrent protection limits. The branch
 * circuit's overcurrent device may not exceed these ratings, so a conductor
 * that carries `load` on its 310.16 ampacity alone is still unusable when the
 * breaker protecting it would have to be larger than the 240.4(D) cap.
 *
 * Without this cap the reverse mode offered 16 AWG for a 15 A load (16 AWG is
 * limited to 10 A) and 14 AWG for a 20 A load (14 AWG is limited to 15 A).
 * Sizes at or above 8 AWG are not listed in 240.4(D) and are unconstrained
 * here; 240.4(E)/(G) applications (taps, motor circuits) are out of scope for
 * a general-purpose sizing suggestion, so the general rule is applied.
 */
const SMALL_CONDUCTOR_OCPD: Partial<Record<WireSize, number>> = {
  "18": 7, // 240.4(D)(1) — 18 AWG copper
  "16": 10, // 240.4(D)(2) — 16 AWG copper
  "14": 15, // 240.4(D)(3) — 14 AWG copper
  "12": 20, // 240.4(D)(4) — 12 AWG copper or aluminum
  "10": 30, // 240.4(D)(5) — 10 AWG copper or aluminum
};

/**
 * Reverse mode: smallest size whose final ampacity carries `load` amps and
 * whose 240.4(D) overcurrent limit is not exceeded by that load.
 */
export function recommendAmpacitySize(
  input: Omit<AmpacityInput, "size">,
  load: number,
): WireSize | null {
  for (const size of WIRE_SIZES) {
    const ocpdLimit = SMALL_CONDUCTOR_OCPD[size];
    if (ocpdLimit !== undefined && ocpdLimit < load) continue;
    const { ampacity } = calcAmpacity({ ...input, size });
    if (ampacity !== null && ampacity >= load) return size;
  }
  return null;
}
