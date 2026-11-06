import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_VIEWPORT_SPECS,
  mergeSiteScanScope,
  mergeViewportSpecs,
  REPORT_SCHEMA_VERSION_1_4,
  type JsonSiteScanReport,
  type JsonSiteWideFinding,
  type ScanOptions,
  type ScanProgressEvent,
  type ScanResult,
  type SiteScanAggregateReport,
  type SiteScanPageSummary,
  type SiteScanScope,
  serializeJsonReport,
} from "@layoutlens/shared";
import {
  assertScanTargetAllowed,
  parseScanTargetUrl,
  type ScanTargetPolicy,
} from "@layoutlens/shared/scan-url-policy";
import { discoverSitePages } from "./discovery/discover-pages.js";
import { scanResultFromJsonReport } from "./json-report-to-scan.js";
import { scanUrl } from "./scan.js";
import { layoutFindingTotalsFromClassification, viewportCountWithLayoutOverflow } from "./site-scan-metrics.js";

export interface SiteScanRunOptions {
  /** Starting URL (same site). */
  rootUrl: string;
  scope?: Partial<SiteScanScope>;
  /** Base scan options applied to every page (must include `artifacts.directory` for per-page bundles). */
  scan: ScanOptions;
  /** SSRF policy — same shape as CLI/server. */
  targetPolicy: ScanTargetPolicy;
  /** Discovery navigation timeout. */
  discoveryNavigationMs?: number;
}

export interface SiteScanPageRecord {
  url: string;
  result?: ScanResult;
  error?: string;
  pageDir: string;
}

export interface SiteScanRunResult {
  rootUrl: string;
  scannedAt: string;
  scope: SiteScanScope;
  pages: readonly SiteScanPageRecord[];
  aggregate: SiteScanAggregateReport;
  siteReport: JsonSiteScanReport;
}

function worstTrust(
  a: import("@layoutlens/shared").NavigationQuality | undefined,
  b: import("@layoutlens/shared").NavigationQuality | undefined,
): import("@layoutlens/shared").NavigationQuality | undefined {
  const order: Record<import("@layoutlens/shared").NavigationQuality, number> = {
    trusted: 0,
    http_error: 1,
    network_error: 2,
    challenge_uncertain: 3,
  };
  if (!a) return b;
  if (!b) return a;
  return order[a] >= order[b] ? a : b;
}

function buildSiteWideFindings(pages: readonly SiteScanPageRecord[]): JsonSiteWideFinding[] {
  const out: JsonSiteWideFinding[] = [];
  let gid = 0;
  for (let pi = 0; pi < pages.length; pi++) {
    const rec = pages[pi]!;
    const r = rec.result;
    if (!r) continue;
    for (const vp of r.viewports) {
      if (vp.inspectionStatus === "failed" || vp.inspectionStatus === "skipped") continue;
      const layoutFindings = vp.findings ?? [];
      for (const f of layoutFindings) {
        gid += 1;
        out.push({
          id: `sw:${gid}`,
          pageUrl: r.url,
          pageIndex: pi,
          viewportWidth: vp.width,
          viewportHeight: vp.viewportHeight,
          viewportLabel: vp.label,
          kind: "overflow",
          issueType: f.classification ?? "horizontal-overflow",
          severity: f.severity,
          classification: f.classification,
          findingId: f.id,
          selector: f.selector,
          title: `${f.tagName} · ${f.classification ?? "overflow"}`,
        });
      }
      for (const f of vp.advancedFindings ?? []) {
        gid += 1;
        out.push({
          id: `sw:${gid}`,
          pageUrl: r.url,
          pageIndex: pi,
          viewportWidth: vp.width,
          viewportHeight: vp.viewportHeight,
          viewportLabel: vp.label,
          kind: "advanced",
          issueType: f.category,
          severity: f.severity,
          classification: f.classification,
          findingId: f.id,
          selector: f.selector,
          title: f.reason.slice(0, 120),
        });
      }
    }
  }
  return out;
}

function buildJsonSiteScanReport(
  rootUrl: string,
  scannedAt: string,
  scope: SiteScanScope,
  pages: readonly SiteScanPageRecord[],
  state: JsonSiteScanReport["state"],
  viewports: readonly { width: number; height: number; label: string }[],
): JsonSiteScanReport {
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let totalVc = 0;
  let layoutConfirmed = 0;
  let layoutPotential = 0;
  let adv = 0;
  let worst: import("@layoutlens/shared").NavigationQuality | undefined;

  for (const p of pages) {
    if (p.error) {
      failed += 1;
      continue;
    }
    const r = p.result;
    if (!r) {
      skipped += 1;
      continue;
    }
    completed += 1;
    worst = worstTrust(worst, r.summary.scanTrust);
    const bc = r.summary.byClassification;
    const { confirmed, potential } = layoutFindingTotalsFromClassification(bc);
    layoutConfirmed += confirmed;
    layoutPotential += potential;
    adv += r.summary.advancedFindingCount ?? 0;
    const perPageVc =
      r.summary.viewportInspectionCompleteCount !== undefined &&
      r.summary.viewportInspectionFailedCount !== undefined &&
      r.summary.viewportInspectionSkippedCount !== undefined
        ? r.summary.viewportInspectionCompleteCount +
          r.summary.viewportInspectionFailedCount +
          r.summary.viewportInspectionSkippedCount
        : r.viewports.length;
    totalVc += perPageVc;
  }

  const siteWideFindings = buildSiteWideFindings(pages);

  return {
    schemaVersion: REPORT_SCHEMA_VERSION_1_4,
    tool: "layoutlens-site",
    rootUrl,
    scannedAt,
    state,
    scope,
    viewports,
    summary: {
      totalPages: pages.length,
      completedPages: completed,
      failedPages: failed,
      skippedPages: skipped,
      totalViewportsCompleted: totalVc,
      confirmedLayoutIssues: layoutConfirmed,
      potentialFindings: layoutPotential,
      responsiveAdvisories: adv,
      ...(worst !== undefined && worst !== "trusted" ? { scanTrustWorst: worst } : {}),
    },
    pages: pages.map((p, i) => {
      const path = `/pages/${i}`;
      if (p.error || !p.result) {
        return {
          url: p.url,
          path,
          status: "failed" as const,
          error: p.error ?? "Scan failed",
        };
      }
      const r = p.result;
      const firstShot = r.viewports.find((v) => v.screenshot)?.screenshot;
      const previewRel = firstShot !== undefined ? `pages/${i}/${firstShot.replace(/^\.\//, "")}` : undefined;
      const { confirmed: pageConfirmed, potential: pagePotential } = layoutFindingTotalsFromClassification(
        r.summary.byClassification,
      );
      return {
        url: r.url,
        path,
        status: "completed" as const,
        issueCount: r.issueCount,
        viewportsWithLayoutIssues: viewportCountWithLayoutOverflow(r.viewports),
        confirmedLayoutFindings: pageConfirmed,
        potentialLayoutFindings: pagePotential,
        findingCount: r.summary.findingCount,
        ...(r.summary.advancedFindingCount !== undefined
          ? { advancedFindingCount: r.summary.advancedFindingCount }
          : {}),
        ...(previewRel !== undefined ? { previewScreenshot: previewRel } : {}),
        ...(r.summary.scanTrust !== undefined ? { scanTrust: r.summary.scanTrust } : {}),
        ...(r.summary.scanCompletionStatus !== undefined
          ? { scanCompletionStatus: r.summary.scanCompletionStatus }
          : {}),
      };
    }),
    siteWideFindings,
  };
}

export async function scanSite(options: SiteScanRunOptions): Promise<SiteScanRunResult> {
  const scope = mergeSiteScanScope(options.scope);
  const rootParsed = parseScanTargetUrl(options.rootUrl);
  await assertScanTargetAllowed(rootParsed, options.targetPolicy);

  const artifactsRoot = options.scan.artifacts?.directory;
  if (!artifactsRoot) throw new Error("Site scan requires scan.artifacts.directory.");

  const onProgress = options.scan.onProgress;
  const signal = options.scan.signal;
  const discoveryMs = options.discoveryNavigationMs ?? Math.min(30_000, options.scan.timeouts?.navigationMs ?? 30_000);

  onProgress?.({
    type: "site-scan-progress",
    rootUrl: rootParsed.href,
    discoveredPages: 0,
    scheduledPages: 0,
    completedPages: 0,
    failedPages: 0,
    phase: "discovering",
  });

  const discovered = await discoverSitePages({
    startUrl: rootParsed,
    scope,
    ...(signal ? { signal } : {}),
    navigationTimeoutMs: discoveryMs,
    headless: options.scan.headless ?? true,
  });

  const pageUrls = discovered.slice(0, scope.maxPages);
  if (pageUrls.length === 0) {
    throw new Error("No pages discovered under the given constraints.");
  }

  const viewportSpecsForSite =
    options.scan.viewports !== undefined
      ? mergeViewportSpecs([...options.scan.viewports])
      : options.scan.viewportHeight !== undefined
        ? mergeViewportSpecs(
            DEFAULT_VIEWPORT_SPECS.map((s) => ({
              width: s.width,
              height: options.scan.viewportHeight!,
              label: s.label,
            })),
          )
        : DEFAULT_VIEWPORT_SPECS;
  const viewportsPerPage = viewportSpecsForSite.length;
  const viewportTasksTotalCap = pageUrls.length * viewportsPerPage;

  onProgress?.({
    type: "site-scan-progress",
    rootUrl: rootParsed.href,
    discoveredPages: pageUrls.length,
    scheduledPages: pageUrls.length,
    completedPages: 0,
    failedPages: 0,
    viewportTasksCompleted: 0,
    viewportTasksTotal: viewportTasksTotalCap,
    phase: "scanning",
  });

  const pages: SiteScanPageRecord[] = pageUrls.map((u) => ({
    url: u.href,
    pageDir: "",
  }));

  const scannedAt = new Date().toISOString();

  function tally(): { completed: number; failed: number } {
    let completed = 0;
    let failed = 0;
    for (const p of pages) {
      if (p.result) completed += 1;
      else if (p.error) failed += 1;
    }
    return { completed, failed };
  }

  const userOnProgress = options.scan.onProgress;
  let viewportTasksCompleted = 0;

  const runPage = async (i: number) => {
    throwIfAborted(signal);
    const u = pageUrls[i]!;
    const pageDir = join(artifactsRoot, "pages", String(i));
    await mkdir(pageDir, { recursive: true });
    pages[i] = { url: u.href, pageDir };

    onProgress?.({
      type: "page-scan-started",
      url: u.href,
      index: i + 1,
      total: pageUrls.length,
    });

    const relayPageProgress = (e: ScanProgressEvent) => {
      if (!userOnProgress) return;
      if (e.type === "viewport-started" || e.type === "viewport-completed") {
        userOnProgress({
          ...e,
          url: u.href,
          pageIndex: i + 1,
          pageTotal: pageUrls.length,
        });
      } else if (e.type === "visual-compare-started" || e.type === "visual-compare-completed") {
        userOnProgress({
          ...e,
          url: u.href,
          pageIndex: i + 1,
          pageTotal: pageUrls.length,
        });
      } else {
        userOnProgress(e);
      }
    };

    try {
      const scanOpts: ScanOptions = {
        ...options.scan,
        url: u.href,
        artifacts: {
          ...options.scan.artifacts,
          directory: pageDir,
        },
      };
      scanOpts.onProgress = (e) => {
        if (e.type === "viewport-completed") {
          viewportTasksCompleted += 1;
        }
        relayPageProgress(e);
      };
      const result = await scanUrl(scanOpts);
      pages[i] = { url: u.href, pageDir, result };
      await writeFile(join(pageDir, "report.json"), serializeJsonReport(result), "utf8");
      onProgress?.({
        type: "page-scan-completed",
        url: u.href,
        index: i + 1,
        total: pageUrls.length,
        success: true,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      pages[i] = { url: u.href, pageDir, error: msg.slice(0, 500) };
      onProgress?.({
        type: "page-scan-completed",
        url: u.href,
        index: i + 1,
        total: pageUrls.length,
        success: false,
        error: msg.slice(0, 200),
      });
    }

    const { completed: cDone, failed: cFail } = tally();
    onProgress?.({
      type: "site-scan-progress",
      rootUrl: rootParsed.href,
      discoveredPages: pageUrls.length,
      scheduledPages: pageUrls.length,
      completedPages: cDone,
      failedPages: cFail,
      viewportTasksCompleted,
      viewportTasksTotal: viewportTasksTotalCap,
      phase: "scanning",
    });
  };

  const conc = Math.max(1, scope.concurrency);
  const indices = pageUrls.map((_, i) => i);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const worker = async () => {
    while (cursor < indices.length) {
      const i = cursor++;
      await runPage(i);
    }
  };
  for (let w = 0; w < Math.min(conc, indices.length); w++) workers.push(worker());
  await Promise.all(workers);

  const viewports = viewportSpecsForSite.map((v) => ({
    width: v.width,
    height: v.height,
    label: v.label,
  }));

  const { completed: finalDone, failed: finalFail } = tally();
  const state: JsonSiteScanReport["state"] = signal?.aborted
    ? "cancelled"
    : finalFail > 0 || finalDone < pages.length
      ? "partial"
      : "completed";

  const siteReport = buildJsonSiteScanReport(rootParsed.href, scannedAt, scope, pages, state, viewports);

  const aggregate: SiteScanAggregateReport = {
    schemaVersion: "0.2",
    tool: "layoutlens-site-scan",
    rootUrl: rootParsed.href,
    scannedAt,
    scope,
    pages: pages.map((p, i) => {
      const row: SiteScanPageSummary = { url: p.url };
      if (p.result) row.reportPath = `pages/${i}/report.json`;
      if (p.error !== undefined) row.error = p.error;
      if (p.result?.scannedAt !== undefined) row.scannedAt = p.result.scannedAt;
      if (p.result?.issueCount !== undefined) row.issueCount = p.result.issueCount;
      if (p.result) {
        const r = p.result;
        const { confirmed, potential } = layoutFindingTotalsFromClassification(r.summary.byClassification);
        row.confirmedLayoutFindings = confirmed;
        row.potentialLayoutFindings = potential;
        row.viewportsWithLayoutIssues = viewportCountWithLayoutOverflow(r.viewports);
      }
      if (p.result?.summary.findingCount !== undefined) row.findingCount = p.result.summary.findingCount;
      if (p.result?.summary.advancedFindingCount !== undefined) {
        row.advancedFindingCount = p.result.summary.advancedFindingCount;
      }
      if (p.result?.summary.scanTrust !== undefined) row.scanTrust = p.result.summary.scanTrust;
      if (p.result?.summary.scanCompletionStatus !== undefined) {
        row.scanCompletionStatus = p.result.summary.scanCompletionStatus;
      }
      return row;
    }),
  };

  await writeFile(join(artifactsRoot, "site-scan.json"), `${JSON.stringify(aggregate, null, 2)}\n`, "utf8");
  await writeFile(join(artifactsRoot, "report.json"), `${JSON.stringify(siteReport, null, 2)}\n`, "utf8");

  onProgress?.({
    type: "site-scan-progress",
    rootUrl: rootParsed.href,
    discoveredPages: pageUrls.length,
    scheduledPages: pageUrls.length,
    completedPages: finalDone,
    failedPages: finalFail,
    viewportTasksCompleted,
    viewportTasksTotal: viewportTasksTotalCap,
    phase: "done",
  });

  return {
    rootUrl: rootParsed.href,
    scannedAt,
    scope,
    pages,
    aggregate,
    siteReport,
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason: unknown = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new DOMException("The scan was aborted.", "AbortError");
}

export interface RebuildSiteScanArtifactsOptions {
  artifactsRoot: string;
  pages: readonly SiteScanPageRecord[];
  rootUrl: string;
  scope: SiteScanScope;
  scannedAt: string;
  signal?: AbortSignal;
}

/** Recompute `report.json` and `site-scan.json` from current `pages[]` on disk (Phase 10.3 retry). */
export async function rebuildSiteScanArtifacts(options: RebuildSiteScanArtifactsOptions): Promise<SiteScanRunResult> {
  const { artifactsRoot, pages, rootUrl, scope, scannedAt, signal } = options;
  const viewports = options.pages[0]?.result?.viewports.length
    ? mergeViewportSpecs(
        options.pages[0]!.result!.viewports.map((v) => ({
          width: v.width,
          height: v.viewportHeight,
          label: v.label,
        })),
      ).map((v) => ({
        width: v.width,
        height: v.height,
        label: v.label,
      }))
    : DEFAULT_VIEWPORT_SPECS.map((v) => ({
        width: v.width,
        height: v.height,
        label: v.label,
      }));

  const { completed: finalDone, failed: finalFail } = (() => {
    let completed = 0;
    let failed = 0;
    for (const p of pages) {
      if (p.result) completed += 1;
      else if (p.error) failed += 1;
    }
    return { completed, failed };
  })();

  const state: JsonSiteScanReport["state"] = signal?.aborted
    ? "cancelled"
    : finalFail > 0 || finalDone < pages.length
      ? "partial"
      : "completed";

  const siteReport = buildJsonSiteScanReport(rootUrl, scannedAt, scope, pages, state, viewports);

  const aggregate: SiteScanAggregateReport = {
    schemaVersion: "0.2",
    tool: "layoutlens-site-scan",
    rootUrl,
    scannedAt,
    scope,
    pages: pages.map((p, i) => {
      const row: SiteScanPageSummary = { url: p.url };
      if (p.result) row.reportPath = `pages/${i}/report.json`;
      if (p.error !== undefined) row.error = p.error;
      if (p.result?.scannedAt !== undefined) row.scannedAt = p.result.scannedAt;
      if (p.result?.issueCount !== undefined) row.issueCount = p.result.issueCount;
      if (p.result) {
        const r = p.result;
        const { confirmed, potential } = layoutFindingTotalsFromClassification(r.summary.byClassification);
        row.confirmedLayoutFindings = confirmed;
        row.potentialLayoutFindings = potential;
        row.viewportsWithLayoutIssues = viewportCountWithLayoutOverflow(r.viewports);
      }
      if (p.result?.summary.findingCount !== undefined) row.findingCount = p.result.summary.findingCount;
      if (p.result?.summary.advancedFindingCount !== undefined) {
        row.advancedFindingCount = p.result.summary.advancedFindingCount;
      }
      if (p.result?.summary.scanTrust !== undefined) row.scanTrust = p.result.summary.scanTrust;
      if (p.result?.summary.scanCompletionStatus !== undefined) {
        row.scanCompletionStatus = p.result.summary.scanCompletionStatus;
      }
      return row;
    }),
  };

  await writeFile(join(artifactsRoot, "site-scan.json"), `${JSON.stringify(aggregate, null, 2)}\n`, "utf8");
  await writeFile(join(artifactsRoot, "report.json"), `${JSON.stringify(siteReport, null, 2)}\n`, "utf8");

  return {
    rootUrl,
    scannedAt,
    scope,
    pages,
    aggregate,
    siteReport,
  };
}
