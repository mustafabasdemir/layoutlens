import { describe, expect, it } from "vitest";
import { cliCommandFor, createScanApi, ScanServiceUnavailableError } from "../api/scan-api";
import { DEFAULT_FILTERS, filterFindings, findingsForViewport, isLegacyReport, reportHealth } from "../lib/findings";
import { validateScanUrl } from "../lib/url";
import {
  HISTORY_LIMIT,
  historyEntryFromReport,
  readHistory,
  recordHistory,
  type KeyValueStorage,
} from "./history";
import { indexFiles, loadReportFromScan, loadSitePageReport, lookupAsset } from "./load-report";
import { normalizeAssetPath, parseLayoutLensReport, ReportValidationError } from "./report-validate";

const validReport = {
  schemaVersion: "1.0",
  tool: "layoutlens",
  url: "https://example.com/",
  scannedAt: "2026-01-01T00:00:00.000Z",
  summary: { viewportIssueCount: 1, findingCount: 2, bySeverity: { high: 1, medium: 1, low: 0 } },
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
          selector: "#a",
          tagName: "div",
          severity: "high",
          overflowPx: 0,
          documentContributionPx: 110,
          scrollWidth: 500,
          clientWidth: 500,
          boundingBox: { x: 0, y: 0, width: 500, height: 40 },
        },
        {
          selector: "#b",
          tagName: "pre",
          severity: "medium",
          overflowPx: 30,
          documentContributionPx: 0,
          scrollWidth: 300,
          clientWidth: 270,
          boundingBox: { x: 0, y: 100, width: 270, height: 40 },
        },
      ],
    },
  ],
};

function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe("parseLayoutLensReport", () => {
  it("accepts CLI reports", () => {
    const r = parseLayoutLensReport(validReport);
    expect(r.viewports[0]?.findings).toHaveLength(2);
  });

  it("rejects non-LayoutLens JSON", () => {
    expect(() => parseLayoutLensReport({ tool: "other" })).toThrow(ReportValidationError);
  });

  it("rejects invalid severities", () => {
    const bad = structuredClone(validReport);
    (bad.viewports[0]!.findings[0] as { severity: string }).severity = "critical";
    expect(() => parseLayoutLensReport(bad)).toThrow(/severity/);
  });
});

describe("normalizeAssetPath", () => {
  it("allows bundle-relative paths only", () => {
    expect(normalizeAssetPath("screenshots/viewport-390.png")).toBe("screenshots/viewport-390.png");
    expect(normalizeAssetPath("./visual\\diff.png")).toBe("visual/diff.png");
    expect(normalizeAssetPath("../secret.png")).toBeNull();
    expect(normalizeAssetPath("https://evil.test/x.png")).toBeNull();
    expect(normalizeAssetPath("/etc/passwd")).toBeNull();
  });
});

describe("asset lookup", () => {
  const files = [
    { name: "report.json", webkitRelativePath: "out/report.json", text: async () => "" },
    { name: "viewport-390.png", webkitRelativePath: "out/screenshots/viewport-390.png", text: async () => "" },
  ];

  it("resolves folder-relative paths", () => {
    const idx = indexFiles(files);
    expect(lookupAsset(idx, "screenshots/viewport-390.png")?.name).toBe("viewport-390.png");
    expect(lookupAsset(idx, "visual/baseline-viewport-390.png")).toBeNull();
  });

  it("does not substitute a different file for a missing asset", () => {
    const idx = indexFiles(files);
    expect(lookupAsset(idx, "visual/viewport-390.png")).toBeNull();
  });
});

describe("history", () => {
  it("records real entries, dedupes, and caps length", () => {
    const storage = memoryStorage();
    const report = parseLayoutLensReport(validReport);
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
      recordHistory(storage, historyEntryFromReport(`id-${i}`, report, "out", "2026-01-02T00:00:00Z"));
    }
    recordHistory(storage, historyEntryFromReport("id-3", report, "out", "2026-01-03T00:00:00Z"));
    const list = readHistory(storage);
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list[0]?.id).toBe("id-3");
    expect(list.filter((e) => e.id === "id-3")).toHaveLength(1);
  });

  it("ignores corrupted storage", () => {
    const storage = memoryStorage();
    storage.setItem("layoutlens.studio.history.v1", "{nope");
    expect(readHistory(storage)).toEqual([]);
  });
});

describe("findings filters", () => {
  const report = parseLayoutLensReport(validReport);
  it("filters by severity and kind", () => {
    const refs = findingsForViewport(report, 390);
    expect(filterFindings(refs, DEFAULT_FILTERS)).toHaveLength(2);
    expect(filterFindings(refs, { ...DEFAULT_FILTERS, severity: "high" })).toHaveLength(1);
    expect(filterFindings(refs, { ...DEFAULT_FILTERS, kind: "internal-overflow" })[0]?.finding.selector).toBe("#b");
  });
});

const classifiedReport = {
  ...structuredClone(validReport),
  summary: {
    viewportIssueCount: 0,
    findingCount: 2,
    bySeverity: { high: 0, medium: 1, low: 1 },
    byClassification: { confirmed: 0, potential: 1, insufficientEvidence: 1 },
    excludedCount: 1,
    truncated: false,
  },
  viewports: [
    {
      ...structuredClone(validReport.viewports[0]!),
      hasHorizontalOverflow: false,
      findings: [
        { ...validReport.viewports[0]!.findings[0]!, severity: "medium", classification: "potential", reason: "cut off", visibleBox: { x: 0, y: 0, width: 390, height: 40 } },
        { ...validReport.viewports[0]!.findings[1]!, severity: "low", classification: "insufficient-evidence", visibleBox: null, relatedCount: 0 },
      ],
      excluded: [
        {
          reason: "clipped-by-ancestor",
          explanation: "30 elements are clipped by .swiper",
          selector: ".swiper",
          tagName: "div",
          boundingBox: { x: 13, y: 100, width: 365, height: 300 },
          elementCount: 30,
          samples: [{ selector: ".swiper-slide", tagName: "div", boundingBox: { x: 400, y: 100, width: 365, height: 300 }, documentContributionPx: 375 }],
        },
      ],
      analysis: {
        elementsInspected: 900,
        candidateCount: 32,
        candidateLimit: 5000,
        candidatesOmitted: 0,
        rootOverflowX: "hidden",
        userScrollable: false,
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

describe("evidence classification in Studio", () => {
  it("parses classification, exclusions and analysis from Phase 7 reports", () => {
    const r = parseLayoutLensReport(classifiedReport);
    const vp = r.viewports[0]!;
    expect(vp.findings.map((f) => f.classification)).toEqual(["potential", "insufficient-evidence"]);
    expect(vp.findings[1]!.visibleBox).toBeNull();
    expect(vp.excluded?.[0]).toMatchObject({ reason: "clipped-by-ancestor", elementCount: 30 });
    expect(vp.analysis?.rootOverflowX).toBe("hidden");
    expect(r.summary.byClassification).toEqual({ confirmed: 0, potential: 1, insufficientEvidence: 1 });
    expect(isLegacyReport(r)).toBe(false);
    expect(isLegacyReport(parseLayoutLensReport(validReport))).toBe(true);
  });

  it("drops unknown classifications and rejects unknown exclusion reasons", () => {
    const weird = structuredClone(classifiedReport);
    (weird.viewports[0]!.findings[0] as { classification: string }).classification = "definitely-bad";
    expect(parseLayoutLensReport(weird).viewports[0]!.findings[0]!.classification).toBeUndefined();
    const bad = structuredClone(classifiedReport);
    (bad.viewports[0]!.excluded[0] as { reason: string }).reason = "whatever";
    expect(() => parseLayoutLensReport(bad)).toThrow(/reason/);
  });

  it("filters by evidence and keeps counts consistent with the tab badge", () => {
    const r = parseLayoutLensReport(classifiedReport);
    const refs = findingsForViewport(r, 390);
    expect(refs).toHaveLength(r.viewports[0]!.findings.length);
    expect(filterFindings(refs, { ...DEFAULT_FILTERS, evidence: "potential" }).map((x) => x.finding.selector)).toEqual(["#a"]);
    expect(filterFindings(refs, { ...DEFAULT_FILTERS, evidence: "confirmed" })).toEqual([]);
  });

  it("never labels a report with only potential findings as confirmed issues", () => {
    expect(reportHealth(parseLayoutLensReport(classifiedReport))).toBe("review");
    const allExcluded = structuredClone(classifiedReport);
    allExcluded.summary = { ...allExcluded.summary, findingCount: 0, byClassification: { confirmed: 0, potential: 0, insufficientEvidence: 0 } };
    allExcluded.viewports[0]!.findings = [];
    expect(reportHealth(parseLayoutLensReport(allExcluded))).toBe("clean");
    expect(reportHealth(parseLayoutLensReport(validReport))).toBe("issues");
  });
});

describe("validateScanUrl", () => {
  it("validates and normalizes", () => {
    expect(validateScanUrl("")).toMatchObject({ ok: false });
    expect(validateScanUrl("example.com")).toEqual({ ok: true, url: "https://example.com/" });
    expect(validateScanUrl("javascript:alert(1)")).toMatchObject({ ok: false });
    expect(validateScanUrl("http://localhost:3000")).toMatchObject({ ok: true });
    expect(validateScanUrl("notaurl")).toMatchObject({ ok: false });
    expect(validateScanUrl("localhost:3000")).toEqual({ ok: true, url: "http://localhost:3000/" });
    expect(validateScanUrl("file:///C:/secret.html")).toMatchObject({ ok: false });
    expect(validateScanUrl("https://u:p@example.com")).toMatchObject({ ok: false });
    expect(validateScanUrl("https://example.com/a#b")).toEqual({ ok: true, url: "https://example.com/a" });
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("scan API client", () => {
  it("posts the URL as JSON and returns the server's job", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const api = createScanApi(async (input, init) => {
      calls.push([input, init]);
      return jsonResponse(202, { id: "x", state: "queued" });
    });
    await expect(api.startScan("https://a.test/")).resolves.toMatchObject({ id: "x" });
    expect(calls[0]?.[0]).toBe("/api/scans");
    expect(calls[0]?.[1]?.method).toBe("POST");
    expect(calls[0]?.[1]?.body).toBe(JSON.stringify({ url: "https://a.test/" }));
  });

  it("surfaces server errors with their code and message", async () => {
    const api = createScanApi(async () => jsonResponse(429, { error: { code: "too_many_scans", message: "Busy." } }));
    await expect(api.startScan("https://a.test/")).rejects.toMatchObject({ status: 429, code: "too_many_scans", message: "Busy." });
  });

  it("treats network failures and non-API responses as an unavailable service", async () => {
    const offline = createScanApi(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(offline.health()).rejects.toBeInstanceOf(ScanServiceUnavailableError);
    const html = createScanApi(async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } }));
    await expect(html.health()).rejects.toBeInstanceOf(ScanServiceUnavailableError);
    const other = createScanApi(async () => jsonResponse(200, { service: "something-else" }));
    await expect(other.health()).rejects.toBeInstanceOf(ScanServiceUnavailableError);
  });

  it("provides the equivalent CLI command", () => {
    expect(cliCommandFor("https://a.test/")).toBe('pnpm cli scan "https://a.test/" --format html --output ./layoutlens-report');
  });
});

describe("loadReportFromScan", () => {
  it("resolves only whitelisted assets to the API file endpoint", () => {
    const loaded = loadReportFromScan("0b5c2a6e-1d1e-4f1a-9c3b-2f9a7d0e1a11", validReport);
    expect(loaded.scanId).toBe("0b5c2a6e-1d1e-4f1a-9c3b-2f9a7d0e1a11");
    expect(loaded.resolveAsset("screenshots/viewport-390.png")).toBe(
      "/api/scans/0b5c2a6e-1d1e-4f1a-9c3b-2f9a7d0e1a11/files/screenshots/viewport-390.png",
    );
    for (const bad of ["../scan.json", "report.json", "https://evil.test/x.png", "screenshots/x.svg", undefined]) {
      expect(loaded.resolveAsset(bad), String(bad)).toBeNull();
    }
  });

  it("rejects invalid payloads from the service", () => {
    expect(() => loadReportFromScan("0b5c2a6e-1d1e-4f1a-9c3b-2f9a7d0e1a11", { tool: "x" })).toThrow(ReportValidationError);
  });
});

describe("loadSitePageReport", () => {
  it("prefixes per-page asset paths for the API file endpoint", () => {
    const loaded = loadSitePageReport(validReport, "0b5c2a6e-1d1e-4f1a-9c3b-2f9a7d0e1a11", 3);
    expect(loaded.resolveAsset("screenshots/viewport-390.png")).toBe(
      "/api/scans/0b5c2a6e-1d1e-4f1a-9c3b-2f9a7d0e1a11/files/pages/3/screenshots/viewport-390.png",
    );
    expect(loaded.resolveAsset("../scan.json")).toBeNull();
  });
});
