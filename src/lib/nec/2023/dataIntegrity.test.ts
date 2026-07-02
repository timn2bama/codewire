import { describe, expect, it } from "vitest";
import { WIRE_SIZES } from "../types";
import { CIRCULAR_MILS, K_CONSTANT } from "./conductors";
import { AMPACITY_310_16 } from "./ampacity";
import { ambientCorrection, bundlingAdjustment } from "./tempCorrection";
import { BOX_FILL_ALLOWANCE, BOX_FILL_SIZES } from "./boxFill";
import { TABLE_4, tradeSizesFor, type ConduitType } from "./conduitAreas";
import { conductorArea, insulationSizes } from "./insulationAreas";
import { maxFillPercent } from "./fillPercent";

/**
 * NEC data integrity. Two layers:
 *  1. Internal consistency — values must increase monotonically as expected,
 *     so a transcription typo (a value out of order) fails the build.
 *  2. Anchor values — a set of well-known NEC numbers pinned exactly, so an
 *     edit that silently changes a real value is caught.
 */

describe("NEC data — internal consistency", () => {
  it("circular mils strictly increase with size", () => {
    let prev = 0;
    for (const s of WIRE_SIZES) {
      expect(CIRCULAR_MILS[s]).toBeGreaterThan(prev);
      prev = CIRCULAR_MILS[s];
    }
  });

  it("ampacity is non-decreasing with size and 60 ≤ 75 ≤ 90", () => {
    for (const mat of ["cu", "al"] as const) {
      const cols = [60, 75, 90] as const;
      const prev: Record<number, number> = { 60: 0, 75: 0, 90: 0 };
      for (const s of WIRE_SIZES) {
        const row = AMPACITY_310_16[mat][s];
        // within a row, higher temp rating >= lower
        const vals = cols.map((c) => row[c]).filter((v): v is number => v !== null);
        for (let i = 1; i < vals.length; i++) {
          expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1]);
        }
        // down a column, larger size >= smaller size
        for (const c of cols) {
          const v = row[c];
          if (v !== null) {
            expect(v).toBeGreaterThanOrEqual(prev[c]);
            prev[c] = v;
          }
        }
      }
    }
  });

  it("ambient correction factors decrease as temperature rises", () => {
    for (const temp of [60, 75, 90] as const) {
      let prev = Infinity;
      for (let t = 10; t <= 55; t += 5) {
        const f = ambientCorrection(t, temp);
        if (f !== null) {
          expect(f).toBeLessThanOrEqual(prev);
          prev = f;
        }
      }
    }
    expect(ambientCorrection(30, 75)).toBe(1.0); // base is 30°C
  });

  it("bundling adjustment decreases as conductor count rises", () => {
    const counts = [3, 6, 9, 20, 30, 40, 60];
    let prev = Infinity;
    for (const n of counts) {
      const f = bundlingAdjustment(n);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });

  it("box fill allowances increase from 18 to 6 AWG", () => {
    let prev = 0;
    for (const s of BOX_FILL_SIZES) {
      const v = BOX_FILL_ALLOWANCE[s]!;
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it("conduit interior area increases with trade size for every type", () => {
    for (const type of Object.keys(TABLE_4) as ConduitType[]) {
      let prev = 0;
      for (const size of tradeSizesFor(type)) {
        const a = TABLE_4[type][size];
        expect(a).toBeGreaterThan(prev);
        prev = a;
      }
    }
  });

  it("conductor (Table 5) areas increase with size", () => {
    for (const ins of ["THHN", "XHHW"] as const) {
      let prev = 0;
      for (const s of insulationSizes(ins)) {
        const a = conductorArea(ins, s);
        expect(a).toBeGreaterThan(prev);
        prev = a;
      }
    }
  });

  it("Table 1 fill percentages match code (1w 53%, 2w 31%, 3+ 40%)", () => {
    expect(maxFillPercent(1)).toBe(0.53);
    expect(maxFillPercent(2)).toBe(0.31);
    expect(maxFillPercent(3)).toBe(0.4);
    expect(maxFillPercent(10)).toBe(0.4);
  });
});

describe("NEC data — anchor values (pinned to the code book)", () => {
  it("Table 310.16 anchors", () => {
    expect(AMPACITY_310_16.cu["12"][75]).toBe(25);
    expect(AMPACITY_310_16.cu["10"][60]).toBe(30);
    expect(AMPACITY_310_16.cu["4/0"][75]).toBe(230);
    expect(AMPACITY_310_16.cu["500"][90]).toBe(430);
    expect(AMPACITY_310_16.al["12"][75]).toBe(20);
    expect(AMPACITY_310_16.al["4/0"][75]).toBe(180);
  });

  it("Chapter 9 Table 8 circular mils anchors", () => {
    expect(CIRCULAR_MILS["12"]).toBe(6530);
    expect(CIRCULAR_MILS["4/0"]).toBe(211600);
    expect(CIRCULAR_MILS["250"]).toBe(250000);
  });

  it("Table 314.16(B) box fill anchors", () => {
    expect(BOX_FILL_ALLOWANCE["14"]).toBe(2.0);
    expect(BOX_FILL_ALLOWANCE["12"]).toBe(2.25);
    expect(BOX_FILL_ALLOWANCE["6"]).toBe(5.0);
  });

  it("Chapter 9 Table 4 conduit area anchors", () => {
    expect(TABLE_4.EMT['1/2"']).toBe(0.304);
    expect(TABLE_4.EMT['2"']).toBe(3.356);
    expect(TABLE_4.RMC['1"']).toBe(0.887);
    expect(TABLE_4.PVC40['1/2"']).toBe(0.285);
  });

  it("Chapter 9 Table 5 THHN/XHHW area anchors", () => {
    expect(conductorArea("THHN", "12")).toBe(0.0133);
    expect(conductorArea("THHN", "14")).toBe(0.0097);
    expect(conductorArea("THHN", "4/0")).toBe(0.3237);
    expect(conductorArea("XHHW", "12")).toBe(0.0181);
  });

  it("ambient correction anchors (Table 310.15(B)(1))", () => {
    expect(ambientCorrection(40, 75)).toBe(0.88);
    expect(ambientCorrection(40, 90)).toBe(0.91);
    expect(ambientCorrection(50, 60)).toBe(0.58);
  });

  it("K constants are the standard field values", () => {
    expect(K_CONSTANT.cu).toBe(12.9);
    expect(K_CONSTANT.al).toBe(21.2);
  });
});
