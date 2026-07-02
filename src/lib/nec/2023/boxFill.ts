import type { WireSize } from "../types";

/**
 * NEC Table 314.16(B) — free space (cubic inches) required per conductor,
 * by conductor size. Only sizes 18–6 AWG appear in the table.
 */
export const BOX_FILL_ALLOWANCE: Partial<Record<WireSize, number>> = {
  "18": 1.5,
  "16": 1.75,
  "14": 2.0,
  "12": 2.25,
  "10": 2.5,
  "8": 3.0,
  "6": 5.0,
};

/** Sizes that the box-fill calculator supports. */
export const BOX_FILL_SIZES: WireSize[] = ["18", "16", "14", "12", "10", "8", "6"];

/** Volume allowance for a size, or undefined if not in Table 314.16(B). */
export function boxFillAllowance(size: WireSize): number | undefined {
  return BOX_FILL_ALLOWANCE[size];
}

/**
 * Common metal-box trade sizes and their volumes (cu in) from
 * Table 314.16(A), offered as a convenience picker.
 */
export const COMMON_BOXES: { label: string; volume: number }[] = [
  { label: '4" × 1¼" round/octagon', volume: 12.5 },
  { label: '4" × 1½" round/octagon', volume: 15.5 },
  { label: '4" × 2⅛" round/octagon', volume: 21.5 },
  { label: '4" × 1¼" square', volume: 18.0 },
  { label: '4" × 1½" square', volume: 21.0 },
  { label: '4" × 2⅛" square', volume: 30.3 },
  { label: '4-11/16" × 1¼" square', volume: 25.5 },
  { label: '4-11/16" × 1½" square', volume: 29.5 },
  { label: '4-11/16" × 2⅛" square', volume: 42.0 },
  { label: '3" × 2" × 2¼" device', volume: 10.5 },
  { label: '3" × 2" × 2½" device', volume: 12.5 },
  { label: '3" × 2" × 2¾" device', volume: 14.0 },
  { label: '3" × 2" × 3½" device', volume: 18.0 },
];
