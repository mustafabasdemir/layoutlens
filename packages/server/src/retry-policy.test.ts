import type { JsonReport, JsonSiteScanReport } from "@layoutlens/shared";
import { describe, expect, it } from "vitest";
import { isPageNavigationTrustedForRetry, listEligibleViewportRetries } from "./retry-policy.js";

describe("retry-policy (HTTP 403)", () => {
  it("does not treat viewport failures as retry-eligible when navigation reports HTTP 403", () => {
    const site: JsonSiteScanReport = {
      schemaVersion: "1.4",
      tool: "layoutlens-site",
      rootUrl: "https://example.com/",
      scannedAt: new Date().toISOString(),
      state: "completed",
      scope: { maxPages: 2, maxDepth: 1 },
      viewports: [{ width: 390, height: 844, label: "390" }],
      summary: {
        totalPages: 1,
        completedPages: 1,
        failedPages: 0,
        skippedPages: 0,
        totalViewportsCompleted: 0,
        confirmedLayoutIssues: 0,
        potentialFindings: 0,
        responsiveAdvisories: 0,
      },
      pages: [{ url: "https://example.com/", path: "/", status: "completed" }],
      siteWideFindings: [],
    };
    const rep: JsonReport = {
      schemaVersion: "1.4",
      tool: "layoutlens",
      url: "https://example.com/",
      scannedAt: new Date().toISOString(),
      summary: {
        viewportIssueCount: 0,
        findingCount: 0,
        bySeverity: { high: 0, medium: 0, low: 0 },
        byClassification: { confirmed: 0, potential: 0, insufficientEvidence: 0 },
        excludedCount: 0,
        truncated: false,
        scanCompletionStatus: "partial",
        viewportInspectionCompleteCount: 0,
        viewportInspectionFailedCount: 1,
        viewportInspectionSkippedCount: 0,
        navigation: {
          requestedUrl: "https://example.com/",
          finalUrl: "https://example.com/",
          httpStatus: 403,
          redirectChain: [],
          responseOk: false,
          documentLoaded: true,
          kind: "ok",
        },
      },
      navigation: {
        requestedUrl: "https://example.com/",
        finalUrl: "https://example.com/",
        httpStatus: 403,
        redirectChain: [],
        responseOk: false,
        documentLoaded: true,
        kind: "ok",
      },
      viewports: [
        {
          width: 390,
          label: "390",
          viewportHeight: 844,
          documentScrollWidth: 400,
          documentClientWidth: 390,
          hasHorizontalOverflow: false,
          overflowPx: 0,
          inspectionStatus: "failed",
          inspectionError: { phase: "screenshot", message: "timed out" },
          findings: [],
          excluded: [],
          analysis: {
            elementsInspected: 0,
            candidateCount: 0,
            candidateLimit: 0,
            candidatesOmitted: 0,
            rootOverflowX: "visible",
            userScrollable: false,
            maskedOverflowPx: 0,
            unattributedOverflowPx: 0,
            findingLimit: 0,
            findingsOmitted: 0,
            excludedLimit: 0,
            excludedOmitted: 0,
            relatedLimit: 0,
          },
        },
      ],
    };
    expect(isPageNavigationTrustedForRetry(rep.summary)).toBe(false);
    const eligible = listEligibleViewportRetries(site, new Map([[0, rep]]));
    expect(eligible).toEqual([]);
  });
});
