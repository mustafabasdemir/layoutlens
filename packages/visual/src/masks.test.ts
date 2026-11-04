import { describe, expect, it } from "vitest";
import { applyMaskRegions } from "./masks.js";

describe("applyMaskRegions", () => {
  it("copies baseline pixels into actual for masked region", () => {
    const width = 4;
    const height = 2;
    const baseline = Buffer.from([
      1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255,
      5, 0, 0, 255, 6, 0, 0, 255, 7, 0, 0, 255, 8, 0, 0, 255,
    ]);
    const actual = Buffer.from(baseline);
    actual[0] = 99;
    applyMaskRegions(baseline, actual, width, height, [
      { x: 0, y: 0, width: 1, height: 1 },
    ]);
    expect(actual[0]).toBe(1);
  });
});
