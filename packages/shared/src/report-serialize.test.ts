import { describe, expect, it } from "vitest";
import type { ScanResult } from "./index.js";
import { serializeJsonReport } from "./report-serialize.js";

const analysis = {
  elementsInspected: 40,
  candidateCount: 3,
  candidateLimit: 5000,
  candidatesOmitted: 0,
  rootOverflowX: "visible",
  userScrollable: true,
  maskedOverflowPx: 0,
  unattributedOverflowPx: 0,
  findingLimit: 50,
  findingsOmitted: 0,
  excludedLimit: 50,
  excludedOmitted: 0,
  relatedLimit: 20,
};

const sample: ScanResult = {
  url: "https://example.com",
  scannedAt: "2026-01-01T00:00:00.000Z",
  issueCount: 1,
  summary: {
    viewportIssueCount: 1,
    findingCount: 1,
    bySeverity: { high: 1, medium: 0, low: 0 },
    byClassification: { confirmed: 1, potential: 0, insufficientEvidence: 0 },
    excludedCount: 1,
    truncated: false,
  },
  viewports: [
    {
      width: 390,
      label: "mobile",
      viewportHeight: 844,
      documentScrollWidth: 500,
      documentClientWidth: 390,
      hasHorizontalOverflow: true,
      overflowPx: 110,
      findings: [
        {
          tagName: "div",
          selector: "#wide",
          severity: "high",
          overflowPx: 0,
          documentContributionPx: 110,
          scrollWidth: 500,
          clientWidth: 500,
          boundingBox: { x: 0, y: 10, width: 500, height: 40 },
          depth: 2,
          selectorMatches: 1,
          classification: "confirmed",
          reason: "Its right edge is 110px past the 390px viewport.",
          scrollContributionPx: 110,
          visibleBox: { x: 0, y: 10, width: 390, height: 40 },
          position: "static",
          transformed: false,
          invisible: false,
          related: [],
          relatedCount: 0,
        },
      ],
      overflowingElements: [],
      excluded: [
        {
          reason: "clipped-by-ancestor",
          explanation: "2 elements are clipped by .carousel.",
          selector: ".carousel",
          tagName: "div",
          boundingBox: { x: 0, y: 100, width: 390, height: 200 },
          elementCount: 2,
          samples: [],
        },
      ],
      analysis,
    },
  ],
};

sample.viewports[0]!.overflowingElements = sample.viewports[0]!.findings;

describe("serializeJsonReport", () => {
  it("emits schema version and findings", () => {
    const parsed = JSON.parse(serializeJsonReport(sample)) as {
      schemaVersion: string;
      summary: { findingCount: number };
      viewports: Array<{ findings: Array<{ boundingBox: { width: number } }> }>;
    };
    expect(parsed.schemaVersion).toBe("1.0");
    expect(parsed.summary.findingCount).toBe(1);
    expect(parsed.viewports[0]?.findings[0]?.boundingBox.width).toBe(500);
  });

  it("keeps classification, exclusions and limits in the JSON report", () => {
    const parsed = JSON.parse(serializeJsonReport(sample)) as {
      summary: { byClassification: unknown; excludedCount: number; truncated: boolean };
      viewports: Array<{
        findings: Array<{ classification: string; visibleBox: unknown; scrollContributionPx: number }>;
        excluded: Array<{ elementCount: number }>;
        analysis: { findingLimit: number };
      }>;
    };
    expect(parsed.summary.byClassification).toEqual({ confirmed: 1, potential: 0, insufficientEvidence: 0 });
    expect(parsed.summary.excludedCount).toBe(1);
    expect(parsed.summary.truncated).toBe(false);
    const vp = parsed.viewports[0]!;
    expect(vp.findings[0]?.classification).toBe("confirmed");
    expect(vp.findings[0]?.scrollContributionPx).toBe(110);
    expect(vp.findings[0]?.visibleBox).toEqual({ x: 0, y: 10, width: 390, height: 40 });
    expect(vp.excluded[0]?.elementCount).toBe(2);
    expect(vp.analysis.findingLimit).toBe(50);
  });
});
