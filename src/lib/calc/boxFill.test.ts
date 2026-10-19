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

  it("clamp allowance uses the largest conductor in the box, including the EGC", () => {
    // 314.16(B)(2): clamps count once, based on the largest conductor
    // contained in the box. 4× 16 AWG (1.75) + a 12 AWG EGC (2.25):
    // conductors 4*1.75 = 7.00 ; device 2*1.75 = 3.50 ; ground 2.25 ;
    // clamps = largest conductor in the box = 12 AWG = 2.25
    // required = 15.00 (the clamp cannot be sized to 16 AWG while a 12 AWG
    // EGC sits in the same box)
    const r = calcBoxFill({
      boxVolume: 15,
      conductors: [{ size: "16", quantity: 4 }],
      devices: 1,
      hasClamps: true,
      groundSize: "12",
    });
    expect(r.requiredVolume).toBeCloseTo(15.0, 2);
    expect(r.pass).toBe(true);

    // The same box with one fewer conductor must now fail: it only fits 15.0
    const smaller = calcBoxFill({
      boxVolume: 14,
      conductors: [{ size: "16", quantity: 4 }],
      devices: 1,
      hasClamps: true,
      groundSize: "12",
    });
    expect(smaller.requiredVolume).toBeCloseTo(15.0, 2);
    expect(smaller.pass).toBe(false);
  });

  it("clamps still ignore the EGC when there are no clamps", () => {
    const r = calcBoxFill({
      boxVolume: 15,
      conductors: [{ size: "16", quantity: 4 }],
      devices: 1,
      hasClamps: false,
      groundSize: "12",
    });
    // 7.00 + 3.50 + 2.25 = 12.75
    expect(r.requiredVolume).toBeCloseTo(12.75, 2);
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
