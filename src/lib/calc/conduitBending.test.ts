import { describe, expect, it } from "vitest";
import {
  calcFourPointSaddle,
  calcOffset,
  calcStub90,
  calcThreePointSaddle,
  offsetMultiplier,
} from "./conduitBending";

describe("conduit bending (geometry)", () => {
  it("30° offset uses a ~2.0 multiplier", () => {
    expect(offsetMultiplier(30)).toBeCloseTo(2.0, 5);
    const r = calcOffset(6, 30); // 6" offset at 30°
    expect(r.distanceBetweenMarks).toBeCloseTo(12.0, 4); // 6 * 2.0
    expect(r.shrink).toBeCloseTo(6 * Math.tan((15 * Math.PI) / 180), 5);
  });

  it("45° multiplier is √2", () => {
    expect(offsetMultiplier(45)).toBeCloseTo(Math.SQRT2, 5);
  });

  it("60° multiplier is ~1.155", () => {
    expect(offsetMultiplier(60)).toBeCloseTo(1.1547, 4);
  });

  it("three-point saddle uses 2.5× depth and 3/16 shrink", () => {
    const r = calcThreePointSaddle(4);
    expect(r.outerMarkDistance).toBeCloseTo(10, 5); // 4 * 2.5
    expect(r.shrink).toBeCloseTo(0.75, 5); // 4 * 0.1875
  });

  it("four-point saddle doubles the offset shrink", () => {
    const offset = calcOffset(3, 30);
    const saddle = calcFourPointSaddle(3, 30);
    expect(saddle.riseDistance).toBeCloseTo(offset.distanceBetweenMarks, 5);
    expect(saddle.shrink).toBeCloseTo(offset.shrink * 2, 5);
  });

  it("90° stub subtracts take-up", () => {
    expect(calcStub90(12, 5)).toBe(7); // 1/2" EMT, take-up 5"
  });
});
