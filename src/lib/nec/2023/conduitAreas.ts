/**
 * NEC Chapter 9, Table 4 — total interior cross-sectional area (100%),
 * in square inches, by conduit type and trade size. The fill calculator
 * multiplies these by the Table 1 percentage.
 */
export type ConduitType =
  | "EMT"
  | "IMC"
  | "RMC"
  | "PVC40"
  | "PVC80"
  | "FMC"
  | "LFMC";

export const CONDUIT_TYPE_LABEL: Record<ConduitType, string> = {
  EMT: "EMT",
  IMC: "IMC",
  RMC: "Rigid Metal (RMC)",
  PVC40: "PVC Schedule 40",
  PVC80: "PVC Schedule 80",
  FMC: "Flexible Metal (FMC)",
  LFMC: "Liquidtight Flex (LFMC)",
};

/** Trade sizes are keyed by their conventional label. */
export type TradeSize = string;

const TABLE_4: Record<ConduitType, Record<TradeSize, number>> = {
  EMT: {
    '1/2"': 0.304,
    '3/4"': 0.533,
    '1"': 0.864,
    '1-1/4"': 1.496,
    '1-1/2"': 2.036,
    '2"': 3.356,
    '2-1/2"': 5.858,
    '3"': 8.846,
    '3-1/2"': 11.545,
    '4"': 14.753,
  },
  IMC: {
    '1/2"': 0.342,
    '3/4"': 0.586,
    '1"': 0.959,
    '1-1/4"': 1.647,
    '1-1/2"': 2.225,
    '2"': 3.63,
    '2-1/2"': 5.135,
    '3"': 7.922,
    '3-1/2"': 10.584,
    '4"': 13.631,
  },
  RMC: {
    '1/2"': 0.314,
    '3/4"': 0.549,
    '1"': 0.887,
    '1-1/4"': 1.526,
    '1-1/2"': 2.071,
    '2"': 3.408,
    '2-1/2"': 4.866,
    '3"': 7.499,
    '3-1/2"': 10.01,
    '4"': 12.882,
    '5"': 20.212,
    '6"': 29.158,
  },
  PVC40: {
    '1/2"': 0.285,
    '3/4"': 0.508,
    '1"': 0.832,
    '1-1/4"': 1.453,
    '1-1/2"': 1.986,
    '2"': 3.291,
    '2-1/2"': 4.695,
    '3"': 7.268,
    '3-1/2"': 9.737,
    '4"': 12.554,
    '5"': 19.761,
    '6"': 28.567,
  },
  PVC80: {
    '1/2"': 0.217,
    '3/4"': 0.409,
    '1"': 0.688,
    '1-1/4"': 1.237,
    '1-1/2"': 1.711,
    '2"': 2.874,
    '2-1/2"': 4.119,
    '3"': 6.442,
    '3-1/2"': 8.688,
    '4"': 11.258,
    '5"': 17.855,
    '6"': 25.598,
  },
  FMC: {
    '3/8"': 0.116,
    '1/2"': 0.317,
    '3/4"': 0.533,
    '1"': 0.817,
    '1-1/4"': 1.277,
    '1-1/2"': 1.858,
    '2"': 3.269,
    '2-1/2"': 4.909,
    '3"': 7.069,
    '3-1/2"': 9.621,
    '4"': 12.566,
  },
  LFMC: {
    '3/8"': 0.192,
    '1/2"': 0.314,
    '3/4"': 0.541,
    '1"': 0.873,
    '1-1/4"': 1.528,
    '1-1/2"': 1.981,
    '2"': 3.246,
    '2-1/2"': 4.881,
    '3"': 7.475,
    '3-1/2"': 9.731,
    '4"': 12.692,
  },
};

/** Ordered trade sizes available for a conduit type (smallest first). */
export function tradeSizesFor(type: ConduitType): TradeSize[] {
  return Object.keys(TABLE_4[type]);
}

/** Total interior area (100%) for a conduit type + trade size. */
export function conduitArea(type: ConduitType, size: TradeSize): number {
  return TABLE_4[type][size];
}

export { TABLE_4 };
