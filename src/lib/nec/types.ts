/** Canonical conductor sizes used across the app (AWG then kcmil). */
export type WireSize =
  | "18"
  | "16"
  | "14"
  | "12"
  | "10"
  | "8"
  | "6"
  | "4"
  | "3"
  | "2"
  | "1"
  | "1/0"
  | "2/0"
  | "3/0"
  | "4/0"
  | "250"
  | "300"
  | "350"
  | "400"
  | "500"
  | "600"
  | "700"
  | "750"
  | "800"
  | "900"
  | "1000";

export type Material = "cu" | "al";

/** Insulation temperature rating columns of NEC Table 310.16. */
export type TempRating = 60 | 75 | 90;

/** Ordered list of every size, smallest to largest. */
export const WIRE_SIZES: WireSize[] = [
  "18",
  "16",
  "14",
  "12",
  "10",
  "8",
  "6",
  "4",
  "3",
  "2",
  "1",
  "1/0",
  "2/0",
  "3/0",
  "4/0",
  "250",
  "300",
  "350",
  "400",
  "500",
  "600",
  "700",
  "750",
  "800",
  "900",
  "1000",
];

/** Human label for a size ("250" -> "250 kcmil"). */
export function sizeLabel(size: WireSize): string {
  return /^\d{3,}$/.test(size) ? `${size} kcmil` : `${size} AWG`;
}
