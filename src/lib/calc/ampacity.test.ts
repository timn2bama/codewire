import { describe, expect, it } from "vitest";
import { calcAmpacity, recommendAmpacitySize } from "./ampacity";

describe("ampacity with derating (310.16, 310.15)", () => {
  it("no derating at 30°C ambient, ≤3 conductors", () => {
    // 10 AWG Cu, 90°C column = 40 A base; termination 75°C = 35 A limit
    const r = calcAmpacity({
      material: "cu",
      size: "10",
      tempRating: 90,
      ambientC: 30,
      currentCarrying: 3,
    });
    expect(r.base).toBe(40);
    expect(r.ambientFactor).toBe(1.0);
    expect(r.bundlingFactor).toBe(1.0);
    expect(r.derated).toBeCloseTo(40, 5);
    // limited by 75°C termination (35 A)
    expect(r.ampacity).toBe(35);
  });

  it("applies ambient correction and bundling adjustment", () => {
    // 6 AWG Cu, 90°C = 75 A base; 40°C ambient (0.91); 6 conductors (0.80)
    // derated = 75 * 0.91 * 0.80 = 54.6 A
    const r = calcAmpacity({
      material: "cu",
      size: "6",
      tempRating: 90,
      ambientC: 40,
      currentCarrying: 6,
      terminationRating: 90,
    });
    expect(r.ambientFactor).toBe(0.91);
    expect(r.bundlingFactor).toBe(0.8);
    expect(r.derated).toBeCloseTo(54.6, 1);
    expect(r.ampacity).toBeCloseTo(54.6, 1);
  });

  it("returns null base for unlisted aluminum 14 AWG", () => {
    const r = calcAmpacity({
      material: "al",
      size: "14",
      tempRating: 75,
      ambientC: 30,
      currentCarrying: 1,
    });
    expect(r.base).toBeNull();
    expect(r.ampacity).toBeNull();
  });

  it("recommendAmpacitySize picks a size that carries the load", () => {
    const size = recommendAmpacitySize(
      {
        material: "cu",
        tempRating: 75,
        ambientC: 30,
        currentCarrying: 3,
        terminationRating: 75,
      },
      100,
    );
    // 1 AWG Cu @75°C = 130 A; 2 AWG = 115; 3 AWG = 100 -> 3 AWG carries 100
    expect(size).toBe("3");
  });
});
