import { describe, expect, it } from "vitest";
import { buildHighlightDiffRgba, isPixelmatchDiffPixel } from "./diff-highlight.js";

describe("buildHighlightDiffRgba", () => {
  it("highlights only pixels marked in the pixelmatch buffer", () => {
    const baseline = Buffer.from([
      100, 100, 100, 255, 200, 200, 200, 255,
    ]);
    const diff = Buffer.from([
      255, 0, 0, 255, 0, 0, 0, 0,
    ]);
    const out = buildHighlightDiffRgba(baseline, diff, 2, 1);
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(180);
    expect(out[4]).toBe(Math.round(200 * 0.38));
  });
});

describe("isPixelmatchDiffPixel", () => {
  it("detects non-zero diff channels", () => {
    const diff = Buffer.from([0, 0, 0, 0, 1, 0, 0, 0]);
    expect(isPixelmatchDiffPixel(diff, 0)).toBe(false);
    expect(isPixelmatchDiffPixel(diff, 1)).toBe(true);
  });
});
