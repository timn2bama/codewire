import type { WireSize } from "../types";
import { WIRE_SIZES } from "../types";

/**
 * NEC Chapter 9, Table 5 — approximate cross-sectional area (sq in)
 * of insulated conductors, by insulation type and size.
 * THHN/THWN/THWN-2 share dimensions, as do most XHHW sizes.
 */
export type Insulation = "THHN" | "XHHW";

export const INSULATION_LABEL: Record<Insulation, string> = {
  THHN: "THHN / THWN-2",
  XHHW: "XHHW / XHHW-2",
};

const THHN: Partial<Record<WireSize, number>> = {
  "14": 0.0097,
  "12": 0.0133,
  "10": 0.0211,
  "8": 0.0366,
  "6": 0.0507,
  "4": 0.0824,
  "3": 0.0973,
  "2": 0.1158,
  "1": 0.1562,
  "1/0": 0.1855,
  "2/0": 0.2223,
  "3/0": 0.2679,
  "4/0": 0.3237,
  "250": 0.397,
  "300": 0.4608,
  "350": 0.5242,
  "400": 0.5863,
  "500": 0.7073,
  "600": 0.8676,
  "700": 0.9887,
  "750": 1.0496,
  "800": 1.1085,
  "900": 1.2311,
  "1000": 1.3478,
};

const XHHW: Partial<Record<WireSize, number>> = {
  "14": 0.0139,
  "12": 0.0181,
  "10": 0.0243,
  "8": 0.0437,
  "6": 0.059,
  "4": 0.0814,
  "3": 0.0962,
  "2": 0.1146,
  "1": 0.1534,
  "1/0": 0.1825,
  "2/0": 0.219,
  "3/0": 0.2642,
  "4/0": 0.3197,
  "250": 0.3904,
  "300": 0.4536,
  "350": 0.5166,
  "400": 0.5782,
  "500": 0.6984,
  "600": 0.8709,
  "700": 0.9923,
  "750": 1.0532,
  "800": 1.1122,
  "900": 1.2351,
  "1000": 1.3519,
};

const TABLE_5: Record<Insulation, Partial<Record<WireSize, number>>> = {
  THHN,
  XHHW,
};

/**
 * Sizes available for an insulation type, in canonical small→large order.
 * Filtering WIRE_SIZES (rather than Object.keys) avoids JS reordering
 * integer-like keys like "250" ahead of "1/0".
 */
export function insulationSizes(ins: Insulation): WireSize[] {
  return WIRE_SIZES.filter((s) => TABLE_5[ins][s] !== undefined);
}

/** Conductor area (sq in) for an insulation + size. */
export function conductorArea(ins: Insulation, size: WireSize): number {
  return TABLE_5[ins][size] ?? 0;
}
