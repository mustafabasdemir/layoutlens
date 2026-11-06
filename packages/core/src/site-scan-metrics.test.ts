import { describe, expect, it } from "vitest";
import { layoutFindingTotalsFromClassification, viewportCountWithLayoutOverflow } from "./site-scan-metrics.js";

describe("site-scan-metrics", () => {
  it("splits confirmed vs potential layout counts from byClassification", () => {
    expect(
      layoutFindingTotalsFromClassification({ confirmed: 10, potential: 5, insufficientEvidence: 3 }),
    ).toEqual({ confirmed: 10, potential: 8 });
    expect(layoutFindingTotalsFromClassification(undefined)).toEqual({ confirmed: 0, potential: 0 });
  });

  it("counts viewports that have at least one layout finding and skips failed/skipped", () => {
    expect(
      viewportCountWithLayoutOverflow([
        { findings: [{ x: 1 }], inspectionStatus: "completed" },
        { findings: [], inspectionStatus: "completed" },
        { findings: [{ x: 1 }], inspectionStatus: "failed" },
        { findings: [{ x: 1 }], inspectionStatus: "skipped" },
      ] as { findings: readonly unknown[]; inspectionStatus?: string }[]),
    ).toBe(1);
  });
});
