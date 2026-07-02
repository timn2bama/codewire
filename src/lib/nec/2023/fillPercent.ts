/**
 * NEC Chapter 9, Table 1 — maximum percent of conduit cross-section
 * that may be filled by conductors, by number of conductors.
 */
export function maxFillPercent(conductorCount: number): number {
  if (conductorCount <= 0) return 0;
  if (conductorCount === 1) return 0.53;
  if (conductorCount === 2) return 0.31;
  return 0.4; // 3 or more
}
