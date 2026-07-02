import { describe, expect, it } from "vitest";
import {
  calcConduitFill,
  conductorsArea,
  recommendConduitSize,
} from "./conduitFill";

describe("conduit fill (Ch.9 Tables 1, 4, 5)", () => {
  it("3+ THHN conductors use the 40% column", () => {
    // 3× 12 AWG THHN (0.0133 each = 0.0399) in 1/2" EMT (0.304 sq in)
    // allowable = 0.304 * 0.40 = 0.1216 -> pass
    const r = calcConduitFill({
      type: "EMT",
      tradeSize: '1/2"',
      conductors: [{ insulation: "THHN", size: "12", quantity: 3 }],
    });
    expect(r.conductorCount).toBe(3);
    expect(r.usedArea).toBeCloseTo(0.0399, 4);
    expect(r.allowablePercent).toBe(0.4);
    expect(r.allowableArea).toBeCloseTo(0.1216, 4);
    expect(r.pass).toBe(true);
  });

  it("single conductor uses the 53% column", () => {
    const r = calcConduitFill({
      type: "EMT",
      tradeSize: '1/2"',
      conductors: [{ insulation: "THHN", size: "8", quantity: 1 }],
    });
    expect(r.allowablePercent).toBe(0.53);
  });

  it("two conductors use the 31% column", () => {
    const r = calcConduitFill({
      type: "EMT",
      tradeSize: '1/2"',
      conductors: [{ insulation: "THHN", size: "10", quantity: 2 }],
    });
    expect(r.allowablePercent).toBe(0.31);
  });

  it("over-filled conduit fails", () => {
    // 10× 4/0 THHN cannot fit in 1" EMT
    const r = calcConduitFill({
      type: "EMT",
      tradeSize: '1"',
      conductors: [{ insulation: "THHN", size: "4/0", quantity: 10 }],
    });
    expect(r.pass).toBe(false);
    expect(r.fillPercent).toBeGreaterThan(100);
  });

  it("recommendConduitSize finds the smallest passing size", () => {
    const conductors = [
      { insulation: "THHN" as const, size: "12" as const, quantity: 9 },
    ];
    const size = recommendConduitSize("EMT", conductors);
    expect(size).not.toBeNull();
    const r = calcConduitFill({ type: "EMT", tradeSize: size!, conductors });
    expect(r.pass).toBe(true);
  });

  it("conductorsArea sums quantity × area", () => {
    const area = conductorsArea([
      { insulation: "THHN", size: "12", quantity: 2 },
      { insulation: "THHN", size: "10", quantity: 1 },
    ]);
    expect(area).toBeCloseTo(0.0133 * 2 + 0.0211, 4);
  });
});
