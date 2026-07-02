import { describe, expect, it } from "vitest";
import { calcVoltageDrop, recommendSize } from "./voltageDrop";

describe("voltage drop (circular-mil method)", () => {
  it("single-phase copper, worked example", () => {
    // 1Ø, 12 AWG Cu (6530 cmil), 20 A, 100 ft, 120 V
    // VD = 2 * 12.9 * 20 * 100 / 6530 = 7.9 V  (~6.6%)
    const r = calcVoltageDrop({
      phase: "single",
      material: "cu",
      size: "12",
      current: 20,
      length: 100,
      voltage: 120,
    });
    expect(r.voltageDrop).toBeCloseTo(7.902, 2);
    expect(r.percentDrop).toBeCloseTo(6.585, 2);
    expect(r.voltageAtLoad).toBeCloseTo(112.098, 2);
    expect(r.withinBranchLimit).toBe(false);
  });

  it("three-phase copper uses √3 multiplier", () => {
    // 3Ø, 4/0 Cu (211600 cmil), 200 A, 250 ft, 480 V
    // VD = 1.732 * 12.9 * 200 * 250 / 211600 = 5.28 V
    const r = calcVoltageDrop({
      phase: "three",
      material: "cu",
      size: "4/0",
      current: 200,
      length: 250,
      voltage: 480,
    });
    expect(r.voltageDrop).toBeCloseTo(5.279, 2);
    expect(r.percentDrop).toBeCloseTo(1.1, 1);
    expect(r.withinBranchLimit).toBe(true);
  });

  it("parallel sets halve the drop", () => {
    const base = {
      phase: "single" as const,
      material: "cu" as const,
      size: "1/0" as const,
      current: 100,
      length: 200,
      voltage: 240,
    };
    const one = calcVoltageDrop({ ...base, sets: 1 });
    const two = calcVoltageDrop({ ...base, sets: 2 });
    expect(two.voltageDrop).toBeCloseTo(one.voltageDrop / 2, 5);
  });

  it("aluminum has higher drop than copper", () => {
    const common = {
      phase: "single" as const,
      size: "2" as const,
      current: 50,
      length: 150,
      voltage: 240,
    };
    const cu = calcVoltageDrop({ ...common, material: "cu" });
    const al = calcVoltageDrop({ ...common, material: "al" });
    expect(al.voltageDrop).toBeGreaterThan(cu.voltageDrop);
  });

  it("recommendSize returns a size within the limit", () => {
    const size = recommendSize(
      {
        phase: "single",
        material: "cu",
        current: 20,
        length: 100,
        voltage: 120,
      },
      3,
    );
    expect(size).not.toBeNull();
    const r = calcVoltageDrop({
      phase: "single",
      material: "cu",
      size: size!,
      current: 20,
      length: 100,
      voltage: 120,
    });
    expect(r.percentDrop).toBeLessThanOrEqual(3);
  });
});
