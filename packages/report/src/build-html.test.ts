import { describe, expect, it } from "vitest";
import { scanResultToJsonReport, type ScanResult } from "@layoutlens/shared";
import { buildHtmlReportDocument } from "./build-html.js";
import { assertOfflineHtml } from "./write-report.js";

const sample: ScanResult = {
  url: "https://example.com/<script>alert(1)</script>",
  scannedAt: "2026-01-01T00:00:00.000Z",
  issueCount: 1,
  summary: {
    viewportIssueCount: 1,
    findingCount: 1,
    bySeverity: { high: 1, medium: 0, low: 0 },
    byClassification: { confirmed: 1, potential: 0, insufficientEvidence: 0 },
    excludedCount: 0,
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
      screenshot: "screenshots/viewport-390.png",
      findings: [
        {
          id: "overflow:390:0",
          tagName: "div",
          selector: "#x",
          severity: "high",
          overflowPx: 0,
          documentContributionPx: 110,
          scrollWidth: 500,
          clientWidth: 500,
          boundingBox: { x: 0, y: 0, width: 500, height: 40 },
          depth: 1,
          selectorMatches: 1,
          classification: "confirmed",
          reason: "<img src=x onerror=alert(2)>",
          scrollContributionPx: 110,
          visibleBox: { x: 0, y: 0, width: 390, height: 40 },
          position: "static",
          transformed: false,
          invisible: false,
          related: [],
          relatedCount: 0,
        },
      ],
      overflowingElements: [],
      excluded: [],
      analysis: {
        elementsInspected: 10,
        candidateCount: 1,
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
      },
    },
  ],
};

sample.viewports[0]!.overflowingElements = sample.viewports[0]!.findings;

describe("buildHtmlReportDocument", () => {
  it("embeds safe JSON and escaped title", () => {
    const html = buildHtmlReportDocument(scanResultToJsonReport(sample));
    expect(html).toContain('type="application/json"');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<img src=x");
    assertOfflineHtml(html);
  });
});
