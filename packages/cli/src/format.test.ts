import { describe, expect, it } from "vitest";
import type { OverflowFinding, ScanResult, ViewportAnalysis } from "@layoutlens/shared";
import { exitCodeForResult, formatScanResult } from "./format.js";
import { renderScanOutput } from "./output.js";

const analysis: ViewportAnalysis = {
  elementsInspected: 10,
  candidateCount: 0,
  candidateLimit: 5000,
  candidatesOmitted: 0,
  rootOverflowX: "visible",
  userScrollable: false,
  maskedOverflowPx: 0,
  unattributedOverflowPx: 0,
  findingLimit: 50,
  findingsOmitted: 0,
  excludedLimit: 50,
  excludedOmitted: 0,
  relatedLimit: 20,
};

const baseResult: ScanResult = {
  url: "https://example.com",
  scannedAt: "2026-01-01T00:00:00.000Z",
  issueCount: 0,
  summary: {
    viewportIssueCount: 0,
    findingCount: 0,
    bySeverity: { high: 0, medium: 0, low: 0 },
    byClassification: { confirmed: 0, potential: 0, insufficientEvidence: 0 },
    excludedCount: 0,
    truncated: false,
  },
  viewports: [
    {
      width: 390,
      label: "mobile",
      viewportHeight: 844,
      documentScrollWidth: 390,
      documentClientWidth: 390,
      hasHorizontalOverflow: false,
      overflowPx: 0,
      findings: [],
      overflowingElements: [],
      excluded: [],
      analysis,
    },
  ],
};

const finding: OverflowFinding = {
  id: "overflow:390:0",
  tagName: "div",
  selector: "#x",
  selectorMatches: 1,
  severity: "high",
  overflowPx: 0,
  documentContributionPx: 42,
  scrollWidth: 432,
  clientWidth: 432,
  boundingBox: { x: 0, y: 0, width: 432, height: 20 },
  depth: 1,
  classification: "confirmed",
  reason: "",
  scrollContributionPx: 42,
  visibleBox: { x: 0, y: 0, width: 390, height: 20 },
  position: "static",
  transformed: false,
  invisible: false,
  related: [],
  relatedCount: 2,
};

describe("formatScanResult", () => {
  it("includes URL and success message when clean", () => {
    const out = formatScanResult(baseResult);
    expect(out).toContain("https://example.com");
    expect(out).toContain("No layout or visual issues");
  });

  it("reports overflow viewports, classification and severity", () => {
    const out = formatScanResult({
      ...baseResult,
      issueCount: 1,
      summary: {
        ...baseResult.summary,
        viewportIssueCount: 1,
        findingCount: 1,
        bySeverity: { high: 1, medium: 0, low: 0 },
        byClassification: { confirmed: 1, potential: 0, insufficientEvidence: 0 },
      },
      viewports: [
        {
          ...baseResult.viewports[0]!,
          hasHorizontalOverflow: true,
          overflowPx: 42,
          documentScrollWidth: 432,
          findings: [finding],
          analysis: { ...analysis, userScrollable: true },
        },
      ],
    });
    expect(out).toContain("horizontal overflow");
    expect(out).toContain("42px");
    expect(out).toContain("HIGH");
    expect(out).toContain("CONFIRMED #x");
    expect(out).toContain("+2 related elements");
    expect(out).toContain("1 confirmed, 0 potential");
  });

  it("states truncation, masked overflow and exclusions explicitly", () => {
    const out = formatScanResult({
      ...baseResult,
      issueCount: 1,
      summary: { ...baseResult.summary, viewportIssueCount: 1, excludedCount: 1, truncated: true },
      viewports: [
        {
          ...baseResult.viewports[0]!,
          hasHorizontalOverflow: true,
          overflowPx: 300,
          documentScrollWidth: 690,
          analysis: { ...analysis, rootOverflowX: "hidden", maskedOverflowPx: 300, findingsOmitted: 12 },
          excluded: [
            {
              reason: "clipped-by-ancestor",
              explanation: "",
              selector: ".swiper",
              tagName: "div",
              boundingBox: { x: 0, y: 0, width: 390, height: 200 },
              elementCount: 127,
              samples: [],
            },
          ],
        },
      ],
    });
    expect(out).toContain("hidden by overflow-x: hidden");
    expect(out).toContain("Truncated: 12 more finding group(s) beyond the 50-group limit");
    expect(out).toContain("Results are truncated");
    expect(out).toContain("Clipped by an ancestor: .swiper (127)");
  });
});

describe("renderScanOutput", () => {
  it("returns valid JSON with schema version", () => {
    const json = renderScanOutput(baseResult, "json");
    const parsed = JSON.parse(json) as { schemaVersion: string; tool: string };
    expect(parsed.schemaVersion).toBe("1.3");
    expect(parsed.tool).toBe("layoutlens");
  });
});

describe("exitCodeForResult", () => {
  it("returns 0 when no issues", () => {
    expect(exitCodeForResult(baseResult)).toBe(0);
  });

  it("returns 1 when issues exist", () => {
    expect(exitCodeForResult({ ...baseResult, issueCount: 2 })).toBe(1);
  });
});
