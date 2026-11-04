import { describe, expect, it } from "vitest";
import {
  clipWidthPx,
  defaultVisualComparisonMode,
  dividerPercentFromPointer,
} from "./before-after-slider.js";

describe("dividerPercentFromPointer", () => {
  const stage = { left: 100, width: 400 };

  it("maps stage edges to 0 and 100", () => {
    expect(dividerPercentFromPointer(100, stage)).toBe(0);
    expect(dividerPercentFromPointer(500, stage)).toBe(100);
  });

  it("maps center to 50", () => {
    expect(dividerPercentFromPointer(300, stage)).toBe(50);
  });
});

describe("clipWidthPx", () => {
  it("scales with stage width", () => {
    expect(clipWidthPx(800, 50)).toBe(400);
    expect(clipWidthPx(800, 0)).toBe(0);
    expect(clipWidthPx(800, 100)).toBe(800);
  });
});

describe("defaultVisualComparisonMode", () => {
  it("prefers diff when diff image exists", () => {
    expect(
      defaultVisualComparisonMode({ diffPixels: 10, hasDiffScreenshot: true }),
    ).toBe("diff");
  });

  it("defaults to slider otherwise", () => {
    expect(
      defaultVisualComparisonMode({ diffPixels: 0, hasDiffScreenshot: false }),
    ).toBe("slider");
  });
});
