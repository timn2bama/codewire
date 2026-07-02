import type { WireSize } from "../types";

/**
 * Conductor circular-mil area (NEC Chapter 9, Table 8).
 * Used by the voltage-drop calculator's circular-mil ("K") method.
 */
export const CIRCULAR_MILS: Record<WireSize, number> = {
  "18": 1620,
  "16": 2580,
  "14": 4110,
  "12": 6530,
  "10": 10380,
  "8": 16510,
  "6": 26240,
  "4": 41740,
  "3": 52620,
  "2": 66360,
  "1": 83690,
  "1/0": 105600,
  "2/0": 133100,
  "3/0": 167800,
  "4/0": 211600,
  "250": 250000,
  "300": 300000,
  "350": 350000,
  "400": 400000,
  "500": 500000,
  "600": 600000,
  "700": 700000,
  "750": 750000,
  "800": 800000,
  "900": 900000,
  "1000": 1000000,
};

/**
 * Approximate resistivity constant K (ohm-circular mil / ft) for the
 * simplified DC voltage-drop method:  VD = (m * K * I * L) / CM
 * where m = 2 (1Ø) or √3 (3Ø). Standard field values.
 */
export const K_CONSTANT: Record<"cu" | "al", number> = {
  cu: 12.9,
  al: 21.2,
};
