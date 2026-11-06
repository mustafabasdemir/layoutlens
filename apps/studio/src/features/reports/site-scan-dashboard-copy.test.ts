import { describe, expect, it } from "vitest";
import { REPORT_SCHEMA_VERSION_1_4, type JsonSiteScanReport } from "@layoutlens/shared";
import { navigationQualitySiteSummary } from "./site-scan-dashboard-copy";

const baseSite = (): JsonSiteScanReport => ({
  schemaVersion: REPORT_SCHEMA_VERSION_1_4,
  tool: "layoutlens-site",
  rootUrl: "https://example.com/",
  scannedAt: "2026-01-01T00:00:00.000Z",
  state: "completed",
  scope: {
    sameOriginOnly: true,
    maxPages: 10,
    maxDepth: 2,
    concurrency: 2,
    maxRedirectHops: 10,
    queryParamPolicy: "preserve",
  },
  viewports: [
    { width: 390, height: 844, label: "mobile" },
    { width: 1280, height: 720, label: "desktop" },
  ],
  summary: {
    totalPages: 1,
    completedPages: 1,
    failedPages: 0,
    skippedPages: 0,
    totalViewportsCompleted: 2,
    confirmedLayoutIssues: 0,
    potentialFindings: 0,
    responsiveAdvisories: 0,
  },
  pages: [],
  siteWideFindings: [],
});

describe("navigationQualitySiteSummary", () => {
  it("shows neutral summary when every page is trusted and worst is omitted", () => {
    const site = baseSite();
    site.pages = [
      {
        url: "https://example.com/a",
        path: "/pages/0",
        status: "completed",
        scanTrust: "trusted",
      },
    ];
    const out = navigationQualitySiteSummary(site);
    expect(out?.tone).toBe("neutral");
    expect(out?.title).toBe("Navigation quality");
    expect(out?.body).toContain("trusted HTTP navigation");
  });

  it("does not treat legacy scanTrustWorst trusted as a warning signal", () => {
    const site = baseSite();
    site.summary.scanTrustWorst = "trusted";
    site.pages = [
      {
        url: "https://example.com/a",
        path: "/pages/0",
        status: "completed",
        scanTrust: "trusted",
      },
    ];
    const out = navigationQualitySiteSummary(site);
    expect(out?.tone).toBe("neutral");
  });

  it("lists pages that need verification for challenge_uncertain", () => {
    const site = baseSite();
    site.summary.scanTrustWorst = "challenge_uncertain";
    site.pages = [
      {
        url: "https://example.com/marine/",
        path: "/pages/0",
        status: "completed",
        scanTrust: "challenge_uncertain",
      },
      {
        url: "https://example.com/ok/",
        path: "/pages/1",
        status: "completed",
        scanTrust: "trusted",
      },
    ];
    const out = navigationQualitySiteSummary(site);
    expect(out?.tone).toBe("warning");
    expect(out?.body).toContain("/marine/");
  });
});
