import { describe, expect, it } from "vitest";
import { designTokensCss } from "./design-tokens.js";
import { explainFinding, findingKinds } from "./finding-insights.js";
import { mapBoxToScreenshot } from "./overlay-geometry.js";
import type { JsonReportFinding } from "./report.js";

const viewport = { width: 390, viewportHeight: 844 };

describe("mapBoxToScreenshot", () => {
  it("maps a fully visible box to percentages (1x)", () => {
    const m = mapBoxToScreenshot(
      { x: 39, y: 84.4, width: 195, height: 84.4 },
      viewport,
      { naturalWidth: 390, naturalHeight: 844 },
    );
    expect(m.status).toBe("visible");
    if (m.status === "visible") {
      expect(m.rect.leftPct).toBeCloseTo(10);
      expect(m.rect.topPct).toBeCloseTo(10);
      expect(m.rect.widthPct).toBeCloseTo(50);
      expect(m.rect.heightPct).toBeCloseTo(10);
    }
  });

  it("handles device pixel ratio 2 screenshots", () => {
    const m = mapBoxToScreenshot(
      { x: 0, y: 422, width: 390, height: 42.2 },
      viewport,
      { naturalWidth: 780, naturalHeight: 1688 },
    );
    expect(m.status).toBe("visible");
    if (m.status === "visible") {
      expect(m.rect.topPct).toBeCloseTo(50);
      expect(m.rect.widthPct).toBeCloseTo(100);
    }
  });

  it("clips boxes wider than the viewport", () => {
    const m = mapBoxToScreenshot(
      { x: 20, y: 100, width: 1200, height: 56 },
      viewport,
      { naturalWidth: 390, naturalHeight: 844 },
    );
    expect(m.status).toBe("clipped");
  });

  it("reports boxes below the captured area as outside", () => {
    const m = mapBoxToScreenshot(
      { x: 0, y: 2000, width: 100, height: 20 },
      viewport,
      { naturalWidth: 390, naturalHeight: 844 },
    );
    expect(m.status).toBe("outside");
  });

  it("refuses to map without image dimensions", () => {
    const m = mapBoxToScreenshot(
      { x: 0, y: 0, width: 10, height: 10 },
      viewport,
      { naturalWidth: 0, naturalHeight: 0 },
    );
    expect(m.status).toBe("unmappable");
  });
});

describe("finding insights", () => {
  const finding: JsonReportFinding = {
    selector: "#wide",
    tagName: "div",
    severity: "high",
    overflowPx: 0,
    documentContributionPx: 830,
    scrollWidth: 1200,
    clientWidth: 1200,
    boundingBox: { x: 20, y: 0, width: 1200, height: 56 },
  };

  it("derives kinds from measurements only", () => {
    expect(findingKinds(finding)).toEqual(["extends-viewport"]);
    expect(findingKinds({ ...finding, overflowPx: 12 })).toEqual([
      "extends-viewport",
      "internal-overflow",
    ]);
  });

  it("explains with real numbers", () => {
    expect(explainFinding(finding, 390)).toContain("830px past the 390px viewport");
  });
});

describe("designTokensCss", () => {
  it("defines dark default and light override", () => {
    const css = designTokensCss();
    expect(css).toContain("--ll-bg: #09090B");
    expect(css).toContain(':root[data-theme="light"]');
    expect(css).toContain("prefers-reduced-motion");
  });
});
