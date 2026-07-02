/**
 * NEC 2023 edition data bundle. All calculator logic imports NEC tables
 * from this single module so a future edition (e.g. NEC 2026) can be
 * dropped in by swapping the import — the "live code tables" hook.
 */
export const EDITION = {
  code: "NEC 2023",
  id: "nec-2023",
  note: "NFPA 70, 2023 edition. Verify against the edition adopted by your AHJ.",
} as const;

export * from "./conductors";
export * from "./ampacity";
export * from "./tempCorrection";
export * from "./boxFill";
export * from "./fillPercent";
export * from "./conduitAreas";
export * from "./insulationAreas";
