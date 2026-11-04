import { describe, expect, it } from "vitest";
import type { OverflowFinding } from "@layoutlens/shared";
import { preferLeafCulprits } from "./findings.js";

const finding = (
  partial: Partial<OverflowFinding> & Pick<OverflowFinding, "selector" | "depth">,
): OverflowFinding => ({
  tagName: "div",
  severity: "medium",
  overflowPx: 0,
  documentContributionPx: 100,
  scrollWidth: 500,
  clientWidth: 500,
  boundingBox: { x: 0, y: 0, width: 500, height: 40 },
  selectorMatches: 1,
  classification: "confirmed",
  reason: "",
  scrollContributionPx: 100,
  visibleBox: null,
  position: "static",
  transformed: false,
  invisible: false,
  related: [],
  relatedCount: 0,
  ...partial,
});

describe("preferLeafCulprits", () => {
  it("drops ancestor wrappers when a nested selector exists", () => {
    const result = preferLeafCulprits([
      finding({
        selector: "main",
        depth: 1,
        documentContributionPx: 800,
      }),
      finding({
        selector: "main > div.wide-banner",
        depth: 3,
        documentContributionPx: 810,
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.selector).toBe("main > div.wide-banner");
  });
});
