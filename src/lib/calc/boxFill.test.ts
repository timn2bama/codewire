import { describe, expect, it } from "vitest";
import { calcBoxFill } from "./boxFill";

describe("box fill (NEC 314.16)", () => {
  it("classic worked example: receptacle in a box", () => {
    // 3× 12 AWG conductors, 1 device, clamps, 1× 12 AWG EGC, box = 18 cu in
    // conductors: 3 * 2.25 = 6.75
    // device:     2 * 2.25 = 4.50
    // clamps:     1 * 2.25 = 2.25
    // ground:     1 * 2.25 = 2.25
    // required = 15.75  -> fits 18.0
    const r = calcBoxFill({
      boxVolume: 18.0,
      conductors: [{ size: "12", quantity: 3 }],
      devices: 1,
      hasClamps: true,
      groundSize: "12",
    });
    expect(r.requiredVolume).toBeCloseTo(15.75, 2);
    expect(r.pass).toBe(true);
    expect(r.largestSize).toBe("12");
  });

  it("device allowance uses the largest conductor", () => {
    // mixed 14 + 10; device should use 10 AWG (2.5) allowance
    const r = calcBoxFill({
      boxVolume: 30,
      conductors: [
        { size: "14", quantity: 2 },
        { size: "10", quantity: 2 },
      ],
      devices: 1,
      hasClamps: false,
    });
    // conductors: 2*2.0 + 2*2.5 = 9.0 ; device: 2*2.5 = 5.0 ; total 14.0
    expect(r.requiredVolume).toBeCloseTo(14.0, 2);
    expect(r.largestSize).toBe("10");
  });

  it("flags an over-filled box", () => {
    const r = calcBoxFill({
      boxVolume: 12.5,
      conductors: [{ size: "12", quantity: 6 }],
      devices: 1,
      hasClamps: true,
      groundSize: "12",
    });
    // 6*2.25 + 2*2.25 + 2.25 + 2.25 = 13.5 + 4.5 + 2.25 + 2.25 = 22.5 > 12.5
    expect(r.requiredVolume).toBeCloseTo(22.5, 2);
    expect(r.pass).toBe(false);
  });
});
