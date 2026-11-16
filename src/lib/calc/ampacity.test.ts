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

  it("recommendAmpacitySize honours the 240.4(D) small-conductor caps", () => {
    const base = {
      material: "cu" as const,
      tempRating: 90 as const,
      ambientC: 30,
      currentCarrying: 1,
      terminationRating: 75 as const,
    };

    // 16 AWG @90°C carries 18 A on 310.16, which used to win a 15 A
    // recommendation — but 240.4(D)(2) limits 16 AWG to a 10 A device, so a
    // 15 A branch circuit needs 14 AWG.
    expect(recommendAmpacitySize(base, 15)).toBe("14");

    // 14 AWG @90°C carries 25 A, which used to win a 20 A recommendation, but
    // 240.4(D)(3) limits 14 AWG to a 15 A device -> 12 AWG.
    expect(recommendAmpacitySize(base, 20)).toBe("12");

    // 240.4(D)(1) allows 18 AWG up to 7 A, so a 5 A load still fits there.
    expect(recommendAmpacitySize(base, 5)).toBe("18");

    // 10 AWG @75°C termination is 35 A, but 240.4(D)(5) limits it to a 30 A
    // device, so 35 A moves up to 8 AWG.
    expect(recommendAmpacitySize(base, 35)).toBe("8");

    // Unchanged where the cap is not the binding limit: 30 A is exactly the
    // 240.4(D)(5) allowance for 10 AWG.
    expect(recommendAmpacitySize(base, 30)).toBe("10");
  });

  it("recommendAmpacitySize applies the 240.4(D) cap to aluminum too", () => {
    // 240.4(D)(4) covers 12 AWG aluminum at 20 A; 12 AWG Al @90°C carries
    // 25 A, so without the cap a 25 A load would have been offered 12 AWG Al.
    const size = recommendAmpacitySize(
      {
        material: "al",
        tempRating: 90,
        ambientC: 30,
        currentCarrying: 1,
        terminationRating: 90,
      },
      25,
    );
    expect(size).toBe("10");
  });
});
