import {
  conduitArea,
  conductorArea,
  maxFillPercent,
  tradeSizesFor,
} from "../nec/2023";
import type { ConduitType, TradeSize } from "../nec/2023/conduitAreas";
import type { Insulation } from "../nec/2023/insulationAreas";
import type { WireSize } from "../nec/types";

export interface ConductorEntry {
  insulation: Insulation;
  size: WireSize;
  quantity: number;
}

export interface ConduitFillInput {
  type: ConduitType;
  tradeSize: TradeSize;
  conductors: ConductorEntry[];
}

export interface ConduitFillResult {
  conductorCount: number;
  usedArea: number; // sq in of conductors
  conduitArea: number; // total interior area (100%)
  allowableArea: number; // conduit area * Table 1 %
  allowablePercent: number; // Table 1 % (0–1)
  fillPercent: number; // used / conduit area (0–100)
  pass: boolean;
}

export function totalConductors(conductors: ConductorEntry[]): number {
  return conductors.reduce((n, c) => n + Math.max(0, c.quantity), 0);
}

export function conductorsArea(conductors: ConductorEntry[]): number {
  return conductors.reduce(
    (a, c) => a + conductorArea(c.insulation, c.size) * Math.max(0, c.quantity),
    0,
  );
}

export function calcConduitFill(input: ConduitFillInput): ConduitFillResult {
  const count = totalConductors(input.conductors);
  const used = conductorsArea(input.conductors);
  const area = conduitArea(input.type, input.tradeSize) ?? 0;
  const allowablePercent = maxFillPercent(count);
  const allowableArea = area * allowablePercent;

  return {
    conductorCount: count,
    usedArea: used,
    conduitArea: area,
    allowableArea,
    allowablePercent,
    fillPercent: area > 0 ? (used / area) * 100 : 0,
    pass: used <= allowableArea && area > 0,
  };
}

/**
 * Reverse mode: smallest trade size of the given conduit type that fits the
 * conductor set. Returns null if even the largest listed size won't pass.
 */
export function recommendConduitSize(
  type: ConduitType,
  conductors: ConductorEntry[],
): TradeSize | null {
  for (const size of tradeSizesFor(type)) {
    const r = calcConduitFill({ type, tradeSize: size, conductors });
    if (r.pass) return size;
  }
  return null;
}
