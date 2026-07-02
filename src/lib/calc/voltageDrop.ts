import { CIRCULAR_MILS, K_CONSTANT } from "../nec/2023";
import type { Material, WireSize } from "../nec/types";
import { WIRE_SIZES } from "../nec/types";

export type Phase = "single" | "three";

export interface VoltageDropInput {
  phase: Phase;
  material: Material;
  size: WireSize;
  /** Load current in amps. */
  current: number;
  /** One-way circuit length in feet. */
  length: number;
  /** Source (nominal system) voltage. */
  voltage: number;
  /** Conductors per phase (parallel sets). Defaults to 1. */
  sets?: number;
}

export interface VoltageDropResult {
  voltageDrop: number; // volts
  percentDrop: number; // %
  voltageAtLoad: number; // volts
  withinBranchLimit: boolean; // <= 3%
  withinTotalLimit: boolean; // <= 5%
}

function phaseMultiplier(phase: Phase): number {
  return phase === "three" ? Math.sqrt(3) : 2;
}

/**
 * Simplified circular-mil ("K") voltage drop:
 *   VD = (m * K * I * L) / (CM * sets)
 * m = 2 for single-phase, √3 for three-phase.
 */
export function calcVoltageDrop(input: VoltageDropInput): VoltageDropResult {
  const sets = Math.max(1, input.sets ?? 1);
  const cm = CIRCULAR_MILS[input.size];
  const k = K_CONSTANT[input.material];
  const m = phaseMultiplier(input.phase);

  const voltageDrop =
    cm > 0 && sets > 0
      ? (m * k * input.current * input.length) / (cm * sets)
      : 0;

  const percentDrop =
    input.voltage > 0 ? (voltageDrop / input.voltage) * 100 : 0;
  const voltageAtLoad = input.voltage - voltageDrop;

  return {
    voltageDrop,
    percentDrop,
    voltageAtLoad,
    withinBranchLimit: percentDrop <= 3,
    withinTotalLimit: percentDrop <= 5,
  };
}

/**
 * Reverse mode: smallest size whose voltage drop is within `maxPercent`,
 * given the rest of the circuit. Returns null if no listed size qualifies.
 */
export function recommendSize(
  input: Omit<VoltageDropInput, "size">,
  maxPercent = 3,
): WireSize | null {
  for (const size of WIRE_SIZES) {
    const { percentDrop } = calcVoltageDrop({ ...input, size });
    if (percentDrop <= maxPercent) return size;
  }
  return null;
}
