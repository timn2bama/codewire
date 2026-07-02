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
 * Reverse mode: smallest size whose final ampacity carries `load` amps.
 */
export function recommendAmpacitySize(
  input: Omit<AmpacityInput, "size">,
  load: number,
): WireSize | null {
  for (const size of WIRE_SIZES) {
    const { ampacity } = calcAmpacity({ ...input, size });
    if (ampacity !== null && ampacity >= load) return size;
  }
  return null;
}
