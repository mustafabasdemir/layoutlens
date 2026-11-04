import { describe, expect, it } from "vitest";
import {
  assertScreenshotDimensionsMatch,
  beforeClipWidthPercent,
  defaultVisualViewMode,
  expectedAlignedLayerRects,
  formatVisualDiffStats,
  layersAlignedWithinTolerance,
} from "./compare-slider.js";

describe("assertScreenshotDimensionsMatch", () => {
  it("accepts identical dimensions", () => {
    expect(
      assertScreenshotDimensionsMatch(
        { width: 390, height: 844 },
        { width: 390, height: 844 },
      ).ok,
    ).toBe(true);
  });

  it("rejects mismatched dimensions with a clear message", () => {
    const result = assertScreenshotDimensionsMatch(
      { width: 390, height: 844 },
      { width: 768, height: 844 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Incompatible screenshot sizes");
      expect(result.message).toContain("390×844");
      expect(result.message).toContain("768×844");
    }
  });
});

describe("beforeClipWidthPercent", () => {
  it("clamps to 0–100", () => {
    expect(beforeClipWidthPercent(50)).toBe(50);
    expect(beforeClipWidthPercent(0)).toBe(0);
    expect(beforeClipWidthPercent(100)).toBe(100);
    expect(beforeClipWidthPercent(-5)).toBe(0);
    expect(beforeClipWidthPercent(150)).toBe(100);
  });
});

describe("layer alignment helpers", () => {
  it("expects identical rects for aligned layers", () => {
    const frame = { left: 10, top: 20, width: 390, height: 844 };
    const { after, before } = expectedAlignedLayerRects(frame);
    expect(layersAlignedWithinTolerance(after, before)).toBe(true);
  });

  it("detects misaligned widths", () => {
    expect(
      layersAlignedWithinTolerance(
        { left: 0, top: 0, width: 390, height: 844 },
        { left: 0, top: 0, width: 200, height: 844 },
      ),
    ).toBe(false);
  });
});

describe("formatVisualDiffStats", () => {
  it("includes count and percentage", () => {
    expect(formatVisualDiffStats(1234, 0.0042)).toBe(
      "1,234 pixels changed (0.42% of image)",
    );
  });
});

describe("defaultVisualViewMode", () => {
  it("opens difference when diff exists", () => {
    expect(
      defaultVisualViewMode({ diffPixels: 10, hasDiffScreenshot: true }),
    ).toBe("diff");
  });

  it("falls back to slider when no diff image", () => {
    expect(
      defaultVisualViewMode({ diffPixels: 10, hasDiffScreenshot: false }),
    ).toBe("slider");
  });
});
