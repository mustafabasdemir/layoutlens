import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import {
  DEFAULT_VIEWPORT_SPECS,
  countAdvancedCategories,
  countClassifications,
  countSeverities,
  getViewportLabel,
  mergeInspectorConfig,
  mergeScanTimeouts,
  mergeViewportSpecs,
  mergeVisualConfig,
  navigationQuality,
  urlForReport,
  type ScanNavigation,
  type ScanNavigationDiagnostics,
  type ScanOptions,
  type ScanResult,
  type ScanSummary,
  type ViewportFailurePhase,
  type ViewportScanResult,
  type ViewportSpec,
} from "@layoutlens/shared";
import {
  computeDocumentOverflow,
  detectHorizontalOverflow,
} from "./overflow.js";
import { CANDIDATE_LIMIT, EXCLUDED_LIMIT, FINDING_LIMIT, RELATED_LIMIT } from "./classify.js";
import { ADVANCED_ELEMENT_LIMIT, ADVANCED_FINDING_LIMIT } from "./responsive-classify.js";
import { detectResponsiveIssues } from "./detect-responsive.js";
import { captureViewportScreenshot } from "./screenshot.js";
import {
  collectInspectorSnapshotInPage,
  type CollectInspectorSnapshotParams,
} from "./inspector-snapshot.js";
import { runVisualRegression } from "./visual-regression.js";
import { stabilizePageForScreenshot } from "@layoutlens/visual";
import { buildScanNavigation } from "./scan-navigation.js";
import { waitForLoadOrRecover } from "./page-readiness.js";

const DEFAULT_VIEWPORT_HEIGHT = 844;

function resolveViewportSpecs(options: ScanOptions): ViewportSpec[] {
  if (options.viewports && options.viewports.length > 0) {
    return mergeViewportSpecs([...options.viewports]);
  }
  if (options.viewportHeight !== undefined) {
    const h = options.viewportHeight;
    return mergeViewportSpecs(
      DEFAULT_VIEWPORT_SPECS.map((s) => ({
        width: s.width,
        height: h,
        label: s.label,
      })),
    );
  }
  return mergeViewportSpecs();
}

function buildViewportResult(
  spec: ViewportSpec,
  viewportHeight: number,
  overflowData: Awaited<ReturnType<typeof detectHorizontalOverflow>>,
  responsiveData: Awaited<ReturnType<typeof detectResponsiveIssues>>,
  extras?: {
    screenshot?: string;
    inspector?: import("@layoutlens/shared").InspectorSnapshot;
  },
): ViewportScanResult {
  const width = spec.width;
  const docOverflow = computeDocumentOverflow(
    overflowData.documentScrollWidth,
    overflowData.documentClientWidth,
  );

  const findings = overflowData.findings;

  const base: ViewportScanResult = {
    width,
    label: spec.label ?? getViewportLabel(width, viewportHeight),
    viewportHeight,
    documentScrollWidth: overflowData.documentScrollWidth,
    documentClientWidth: overflowData.documentClientWidth,
    hasHorizontalOverflow: docOverflow.hasHorizontalOverflow,
    overflowPx: docOverflow.overflowPx,
    findings,
    overflowingElements: findings,
    excluded: overflowData.excluded,
    analysis: overflowData.analysis,
    advancedFindings: responsiveData.findings,
    advancedAnalysis: responsiveData.analysis,
  };

  const out: ViewportScanResult = { ...base, inspectionStatus: "completed" };
  if (extras?.screenshot !== undefined) out.screenshot = extras.screenshot;
  if (extras?.inspector !== undefined) out.inspector = extras.inspector;
  return out;
}

/** Placeholder row when navigation did not commit — not a successful layout inspection. */
function createSkippedViewport(
  spec: ViewportSpec,
  viewportHeight: number,
  reason: string,
): ViewportScanResult {
  const width = spec.width;
  const analysis: import("@layoutlens/shared").ViewportAnalysis = {
    elementsInspected: 0,
    candidateCount: 0,
    candidateLimit: CANDIDATE_LIMIT,
    candidatesOmitted: 0,
    rootOverflowX: "visible",
    userScrollable: false,
    maskedOverflowPx: 0,
    unattributedOverflowPx: 0,
    findingLimit: FINDING_LIMIT,
    findingsOmitted: 0,
    excludedLimit: EXCLUDED_LIMIT,
    excludedOmitted: 0,
    relatedLimit: RELATED_LIMIT,
  };
  const advancedAnalysis: import("@layoutlens/shared").AdvancedViewportAnalysis = {
    elementsInspected: 0,
    candidateCount: 0,
    candidateLimit: ADVANCED_ELEMENT_LIMIT,
    candidatesOmitted: 0,
    findingLimit: ADVANCED_FINDING_LIMIT,
    findingsOmitted: 0,
  };
  return {
    width,
    label: spec.label ?? getViewportLabel(width, viewportHeight),
    viewportHeight,
    documentScrollWidth: width,
    documentClientWidth: width,
    hasHorizontalOverflow: false,
    overflowPx: 0,
    inspectionStatus: "skipped",
    inspectionError: { phase: "navigation", message: reason.slice(0, 400) },
    findings: [],
    overflowingElements: [],
    excluded: [],
    analysis,
    advancedFindings: [],
    advancedAnalysis,
  };
}

function isViewportComplete(v: ViewportScanResult): boolean {
  return v.inspectionStatus === "completed" || v.inspectionStatus === undefined;
}

export function summarizeViewports(viewports: readonly ViewportScanResult[]): Omit<ScanSummary, "visualFailures"> {
  const measured = viewports.filter(isViewportComplete);
  const allFindings = measured.flatMap((v) => v.findings);
  const allAdvanced = measured.flatMap((v) => v.advancedFindings ?? []);
  const issueCount = measured.filter((v) => v.hasHorizontalOverflow).length;
  const completeCount = viewports.filter(
    (v) => v.inspectionStatus === "completed" || v.inspectionStatus === undefined,
  ).length;
  const failedCount = viewports.filter((v) => v.inspectionStatus === "failed").length;
  const skippedCount = viewports.filter((v) => v.inspectionStatus === "skipped").length;
  let scanCompletionStatus: ScanSummary["scanCompletionStatus"];
  if (completeCount === viewports.length) scanCompletionStatus = "full";
  else if (completeCount === 0) scanCompletionStatus = "failed";
  else scanCompletionStatus = "partial";

  return {
    viewportIssueCount: issueCount,
    findingCount: allFindings.length,
    bySeverity: countSeverities(allFindings.map((f) => f.severity)),
    byClassification: countClassifications(allFindings),
    excludedCount: measured.reduce((n, v) => n + v.excluded.length, 0),
    truncated: measured.some(
      (v) =>
        v.analysis.findingsOmitted > 0 ||
        v.analysis.excludedOmitted > 0 ||
        v.analysis.candidatesOmitted > 0 ||
        (v.advancedAnalysis?.findingsOmitted ?? 0) > 0 ||
        (v.advancedAnalysis?.candidatesOmitted ?? 0) > 0,
    ),
    advancedFindingCount: allAdvanced.length,
    byAdvancedCategory: countAdvancedCategories(allAdvanced),
    advancedTruncated: measured.some((v) => (v.advancedAnalysis?.findingsOmitted ?? 0) > 0),
    viewportInspectionCompleteCount: completeCount,
    viewportInspectionFailedCount: failedCount,
    viewportInspectionSkippedCount: skippedCount,
    scanCompletionStatus,
    viewportOutcomes: viewports.map((v) => {
      const st = v.inspectionStatus ?? "completed";
      const msg = v.inspectionError?.message;
      return {
        width: v.width,
        height: v.viewportHeight,
        label: v.label,
        status: st,
        ...(msg !== undefined ? { message: msg } : {}),
      };
    }),
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason: unknown = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new DOMException("The scan was aborted.", "AbortError");
}

function classifyNavFailure(raw: string): { phase: ViewportFailurePhase; message: string } {
  const line = raw.split("\n")[0] ?? raw;
  if (/screenshot|Timeout.*screenshot/i.test(line)) {
    return { phase: "screenshot", message: line.slice(0, 400) };
  }
  if (/waiting for|load state|navigation/i.test(line)) {
    return { phase: "navigation", message: line.slice(0, 400) };
  }
  return { phase: "navigation", message: line.slice(0, 400) };
}

export async function scanUrl(options: ScanOptions): Promise<ScanResult> {
  const {
    url,
    headless = true,
    artifacts,
    baselineDirectory,
    visualConfig,
    onProgress,
    signal,
    detection,
    inspector: inspectorOpts,
    mergePartialScan: mergePartialScanOpt,
    retryViewportIndices,
  } = options;
  const viewportSpecs = resolveViewportSpecs(options);
  const retryOnlySet =
    retryViewportIndices !== undefined && retryViewportIndices.length > 0
      ? new Set(
          retryViewportIndices.filter(
            (i) => typeof i === "number" && Number.isInteger(i) && i >= 0 && i < viewportSpecs.length,
          ),
        )
      : null;
  const mergePartialScan = mergePartialScanOpt && retryOnlySet && retryOnlySet.size > 0 ? mergePartialScanOpt : undefined;
  const inspectorCfg = mergeInspectorConfig(inspectorOpts);
  const timeouts = mergeScanTimeouts(options.timeouts);

  let workDir = artifacts?.directory;
  let tempDir: string | undefined;

  const needsScreenshots =
    Boolean(artifacts) ||
    Boolean(baselineDirectory) ||
    Boolean(artifacts?.baselineDirectory);

  if (needsScreenshots && !workDir) {
    tempDir = await mkdtemp(join(tmpdir(), "layoutlens-scan-"));
    workDir = tempDir;
  }

  if (workDir) {
    await mkdir(workDir, { recursive: true });
  }

  const stability = mergeVisualConfig(
    visualConfig ?? artifacts?.visualConfig,
  ).stability;

  throwIfAborted(signal);
  const browser = await chromium.launch({ headless });
  const onAbort = () => void browser.close().catch(() => undefined);
  signal?.addEventListener("abort", onAbort, { once: true });
  onProgress?.({ type: "browser-launched" });

  const viewports: ViewportScanResult[] = [];
  let scanNavigation: ScanNavigation | undefined = mergePartialScan?.navigation;
  let navigationDiagnostics: ScanNavigationDiagnostics | undefined = mergePartialScan?.navigationDiagnostics;
  /** When true, `page.goto` never committed — remaining viewports are skipped. */
  let navigationFailedBeforeCommit = false;
  /** First viewport could not reach a usable document — skip resize passes. */
  let skipRemainingViewports = false;

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const viewportTotal = viewportSpecs.length;

    const minRetryIdx =
      retryOnlySet && retryOnlySet.size > 0 ? Math.min(...retryOnlySet) : 0;
    const v0Baseline = mergePartialScan?.viewports[0];
    const v0Ok =
      v0Baseline &&
      (v0Baseline.inspectionStatus === "completed" || v0Baseline.inspectionStatus === undefined);
    const needWarmNavigation =
      Boolean(mergePartialScan && retryOnlySet && retryOnlySet.size > 0 && minRetryIdx > 0 && v0Ok);
    if (needWarmNavigation) {
      const v0 = viewportSpecs[0]!;
      await page.setViewportSize({ width: v0.width, height: v0.height });
      const navStart = Date.now();
      let gotoResponse: import("playwright").Response | null = null;
      try {
        gotoResponse = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: timeouts.navigationMs,
        });
      } catch (e: unknown) {
        const raw = e instanceof Error ? e.message : String(e);
        throw new Error(
          `Cannot retry later viewports: initial navigation failed (${raw.split("\n")[0]?.slice(0, 120) ?? "error"}).`,
        );
      }
      if (!navigationFailedBeforeCommit && gotoResponse) {
        const lr = await waitForLoadOrRecover(page, {
          readinessTimeoutMs: timeouts.readinessMs,
          ...(signal ? { signal } : {}),
        });
        if (timeouts.postLoadSettleMs > 0) {
          await page.waitForTimeout(timeouts.postLoadSettleMs);
        }
        scanNavigation = await buildScanNavigation(page, url, gotoResponse, true);
        navigationDiagnostics = {
          firstViewportWidth: v0.width,
          firstViewportHeight: v0.height,
          firstGotoWaitUntil: "domcontentloaded",
          firstGotoDurationMs: Date.now() - navStart,
          firstNavigationCommitted: true,
          firstReadinessDurationMs: lr.durationWaitMs,
          firstDomContentLoaded: lr.domContentLoadedFired,
          firstLoadEvent: lr.loadFired,
          firstEffectiveMilestone: lr.effectiveMilestone,
          firstPartialReadinessRecovery: lr.recoveredPartialReadiness,
          ...(lr.readinessNote ? { firstReadinessNote: lr.readinessNote } : {}),
        };
      }
    }

    for (const [index, spec] of viewportSpecs.entries()) {
      throwIfAborted(signal);
      const width = spec.width;
      const viewportHeight = spec.height;

      const mergedVp = mergePartialScan?.viewports[index];
      const reuseCompleted =
        mergedVp !== undefined &&
        Boolean(mergePartialScan) &&
        (mergedVp.inspectionStatus === "completed" || mergedVp.inspectionStatus === undefined) &&
        (!retryOnlySet || !retryOnlySet.has(index));
      if (reuseCompleted) {
        const baseline = mergedVp;
        viewports.push(JSON.parse(JSON.stringify(baseline)) as ViewportScanResult);
        onProgress?.({
          type: "viewport-completed",
          width,
          height: viewportHeight,
          index,
          total: viewportTotal,
          findingCount: baseline.findings.length,
          status: "completed",
        });
        continue;
      }

      if (navigationFailedBeforeCommit || skipRemainingViewports) {
        const skipped = createSkippedViewport(
          spec,
          viewportHeight,
          navigationFailedBeforeCommit
            ? "Skipped because the first navigation did not load a document."
            : "Skipped because the first viewport did not reach a usable document.",
        );
        viewports.push(skipped);
        onProgress?.({
          type: "viewport-completed",
          width,
          height: viewportHeight,
          index,
          total: viewportTotal,
          findingCount: 0,
          status: "skipped",
          ...(skipped.inspectionError?.message !== undefined
            ? { message: skipped.inspectionError.message }
            : {}),
        });
        continue;
      }

      onProgress?.({ type: "viewport-started", width, height: viewportHeight, index, total: viewportTotal });
      await page.setViewportSize({ width, height: viewportHeight });
      if (index > 0) {
        await page.waitForTimeout(200);
      }

      let gotoResponse: import("playwright").Response | null = null;
      let documentLoaded = false;
      let readinessWait:
        | Awaited<ReturnType<typeof waitForLoadOrRecover>>
        | undefined;
      let gotoMs = 0;

      if (index === 0) {
        const navStart = Date.now();
        try {
          gotoResponse = await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: timeouts.navigationMs,
          });
          gotoMs = Date.now() - navStart;
          documentLoaded = true;
        } catch (e: unknown) {
          const raw = e instanceof Error ? e.message : String(e);
          scanNavigation = {
            requestedUrl: urlForReport(url),
            finalUrl: urlForReport(url),
            httpStatus: null,
            redirectChain: [],
            responseOk: false,
            documentLoaded: false,
            kind: "network_error",
            message: raw.split("\n")[0]?.slice(0, 200) ?? "Navigation failed",
          };
          navigationFailedBeforeCommit = true;
          const fail = createSkippedViewport(
            spec,
            viewportHeight,
            raw.split("\n")[0]?.slice(0, 400) ?? "Navigation failed",
          );
          viewports.push(fail);
          onProgress?.({
            type: "viewport-completed",
            width,
            height: viewportHeight,
            index,
            total: viewportTotal,
            findingCount: 0,
            status: "skipped",
            ...(fail.inspectionError?.message !== undefined ? { message: fail.inspectionError.message } : {}),
          });
          continue;
        }

        const lr = await waitForLoadOrRecover(page, {
          readinessTimeoutMs: timeouts.readinessMs,
          ...(signal ? { signal } : {}),
        });
        readinessWait = lr;

        if (timeouts.postLoadSettleMs > 0) {
          await page.waitForTimeout(timeouts.postLoadSettleMs);
        }

        scanNavigation = await buildScanNavigation(page, url, gotoResponse, documentLoaded);
        navigationDiagnostics = {
          firstViewportWidth: width,
          firstViewportHeight: viewportHeight,
          firstGotoWaitUntil: "domcontentloaded",
          firstGotoDurationMs: gotoMs,
          firstNavigationCommitted: true,
          firstReadinessDurationMs: lr.durationWaitMs,
          firstDomContentLoaded: lr.domContentLoadedFired,
          firstLoadEvent: lr.loadFired,
          firstEffectiveMilestone: lr.effectiveMilestone,
          firstPartialReadinessRecovery: lr.recoveredPartialReadiness,
          ...(lr.readinessNote ? { firstReadinessNote: lr.readinessNote } : {}),
        };
      } else {
        documentLoaded = true;
      }

      const diagnosticsBase: NonNullable<ViewportScanResult["inspection"]> = { gotoWaitUntil: "domcontentloaded" };
      if (index === 0 && readinessWait) {
        diagnosticsBase.gotoDurationMs = gotoMs;
        diagnosticsBase.domContentLoadedReached = readinessWait.domContentLoadedFired;
        diagnosticsBase.loadEventReached = readinessWait.loadFired;
        diagnosticsBase.effectiveReadinessMilestone = readinessWait.effectiveMilestone;
        diagnosticsBase.partialReadinessRecovery = readinessWait.recoveredPartialReadiness;
        if (readinessWait.readinessNote !== undefined) {
          diagnosticsBase.readinessRecoveryNote = readinessWait.readinessNote;
        }
        diagnosticsBase.readinessWaitDurationMs = readinessWait.durationWaitMs;
        diagnosticsBase.postLoadSettleMs = timeouts.postLoadSettleMs;
        diagnosticsBase.navigationCommitted = true;
      }

      if (
        index === 0 &&
        readinessWait &&
        readinessWait.readinessNote === "load-state-timeout-unusable-dom" &&
        !readinessWait.recoveredPartialReadiness
      ) {
        skipRemainingViewports = true;
        const analysis = createSkippedViewport(spec, viewportHeight, "").analysis;
        const advancedAnalysis = createSkippedViewport(spec, viewportHeight, "").advancedAnalysis!;
        const failedVp: ViewportScanResult = {
          width,
          label: spec.label ?? getViewportLabel(width, viewportHeight),
          viewportHeight,
          documentScrollWidth: width,
          documentClientWidth: width,
          hasHorizontalOverflow: false,
          overflowPx: 0,
          inspectionStatus: "failed",
          inspection: {
            ...diagnosticsBase,
          },
          inspectionError: {
            phase: "readiness",
            message: "The document stayed in a loading state and had no usable content before the readiness timeout.",
          },
          findings: [],
          overflowingElements: [],
          excluded: [],
          analysis,
          advancedFindings: [],
          advancedAnalysis,
        };
        viewports.push(failedVp);
        scanNavigation = await buildScanNavigation(page, url, gotoResponse, true);
        navigationDiagnostics = {
          firstViewportWidth: width,
          firstViewportHeight: viewportHeight,
          firstGotoWaitUntil: "domcontentloaded",
          firstGotoDurationMs: gotoMs,
          firstNavigationCommitted: true,
          firstReadinessDurationMs: readinessWait?.durationWaitMs ?? 0,
          firstDomContentLoaded: readinessWait?.domContentLoadedFired ?? false,
          firstLoadEvent: readinessWait?.loadFired ?? false,
          firstEffectiveMilestone: readinessWait?.effectiveMilestone ?? "none",
          firstPartialReadinessRecovery: false,
          ...(readinessWait?.readinessNote ? { firstReadinessNote: readinessWait.readinessNote } : {}),
        };
        onProgress?.({
          type: "viewport-completed",
          width,
          height: viewportHeight,
          index,
          total: viewportTotal,
          findingCount: 0,
          status: "failed",
          ...(failedVp.inspectionError ? { message: failedVp.inspectionError.message } : {}),
        });
        continue;
      }

      try {
        const overflowData = await detectHorizontalOverflow(page, width);
        const responsiveData = await detectResponsiveIssues(page, width, viewportHeight, detection);

        let inspectorSnapshot: import("@layoutlens/shared").InspectorSnapshot | undefined;
        if (inspectorCfg.enabled) {
          await stabilizePageForScreenshot(page, stability);
          const findingRefs: { id: string; selector: string }[] = [
            ...overflowData.findings.map((f) => ({ id: f.id, selector: f.selector })),
            ...responsiveData.findings.map((f) => ({ id: f.id, selector: f.selector })),
          ];
          const params: CollectInspectorSnapshotParams = {
            viewportWidth: width,
            viewportHeight,
            maxElements: inspectorCfg.maxElements,
            maxDepth: inspectorCfg.maxDepth,
            maxSelectorLength: inspectorCfg.maxSelectorLength,
            maxHitTestSamples: inspectorCfg.maxHitTestSamples,
            findingRefs,
          };
          inspectorSnapshot = await page.evaluate(collectInspectorSnapshotInPage, params);
        }

        let screenshot: string | undefined;
        let screenshotTimedOut = false;
        if (workDir) {
          try {
            screenshot = await captureViewportScreenshot(page, workDir, width, viewportHeight, stability, {
              skipStabilize: inspectorCfg.enabled,
              timeoutMs: timeouts.screenshotMs,
            });
          } catch (shotErr: unknown) {
            const raw = shotErr instanceof Error ? shotErr.message : String(shotErr);
            screenshotTimedOut = /Timeout \d+ms exceeded|timeout/i.test(raw);
            const err = new Error(raw) as Error & { phase?: ViewportFailurePhase };
            err.phase = "screenshot";
            throw err;
          }
        }

        const extras: { screenshot?: string; inspector?: import("@layoutlens/shared").InspectorSnapshot } = {};
        if (screenshot !== undefined) extras.screenshot = screenshot;
        if (inspectorSnapshot !== undefined) extras.inspector = inspectorSnapshot;
        const viewportResult = buildViewportResult(spec, viewportHeight, overflowData, responsiveData, extras);
        viewportResult.inspection = {
          ...diagnosticsBase,
          screenshotCaptureMs: timeouts.screenshotMs,
          screenshotTimedOut,
        };
        viewports.push(viewportResult);
        onProgress?.({
          type: "viewport-completed",
          width,
          height: viewportHeight,
          index,
          total: viewportTotal,
          findingCount: viewportResult.findings.length,
          status: "completed",
        });
      } catch (err: unknown) {
        const raw = err instanceof Error ? err.message : String(err);
        const phase =
          err && typeof err === "object" && "phase" in err && (err as { phase?: ViewportFailurePhase }).phase
            ? (err as { phase: ViewportFailurePhase }).phase
            : classifyNavFailure(raw).phase;
        const message = raw.split("\n")[0]?.slice(0, 400) ?? "Viewport inspection failed";
        const analysis = createSkippedViewport(spec, viewportHeight, "").analysis;
        const advancedAnalysis = createSkippedViewport(spec, viewportHeight, "").advancedAnalysis!;
        const failed: ViewportScanResult = {
          width,
          label: spec.label ?? getViewportLabel(width, viewportHeight),
          viewportHeight,
          documentScrollWidth: width,
          documentClientWidth: width,
          hasHorizontalOverflow: false,
          overflowPx: 0,
          inspectionStatus: "failed",
          inspection: { ...diagnosticsBase, screenshotCaptureMs: timeouts.screenshotMs },
          inspectionError: { phase, message },
          findings: [],
          overflowingElements: [],
          excluded: [],
          analysis,
          advancedFindings: [],
          advancedAnalysis,
        };
        viewports.push(failed);
        onProgress?.({
          type: "viewport-completed",
          width,
          height: viewportHeight,
          index,
          total: viewportTotal,
          findingCount: 0,
          status: "failed",
          message,
        });
      }
    }
    await context.close();
  } catch (error) {
    throwIfAborted(signal);
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await browser.close().catch(() => undefined);
  }
  throwIfAborted(signal);

  const summaryBase = summarizeViewports(viewports);
  const summary: ScanSummary = { ...summaryBase };
  if (scanNavigation) {
    summary.navigation = scanNavigation;
    summary.scanTrust = navigationQuality(scanNavigation);
  }
  const issueCount = summary.viewportIssueCount;

  let visual: ScanResult["visual"];
  const baselineDir =
    baselineDirectory ?? artifacts?.baselineDirectory ?? undefined;

  if (baselineDir && workDir) {
    onProgress?.({ type: "visual-compare-started" });
    const persistVisualArtifacts = Boolean(artifacts?.directory);
    visual = await runVisualRegression(
      {
        url,
        scannedAt: new Date().toISOString(),
        viewports,
        issueCount,
        summary,
      },
      workDir,
      baselineDir,
      {
        directory: workDir,
        baselineDirectory: baselineDir,
        visualDiffs: persistVisualArtifacts,
        ...(visualConfig !== undefined
          ? { visualConfig }
          : artifacts?.visualConfig !== undefined
            ? { visualConfig: artifacts.visualConfig }
            : {}),
      },
    );
    onProgress?.({ type: "visual-compare-completed", failedCount: visual.failedCount });
  }

  if (tempDir && !artifacts?.directory) {
    await rm(tempDir, { recursive: true, force: true });
  }

  return {
    url,
    scannedAt: new Date().toISOString(),
    viewports,
    issueCount,
    summary: {
      ...summary,
      visualFailures: visual?.failedCount ?? 0,
    },
    ...(scanNavigation ? { navigation: scanNavigation } : {}),
    ...(navigationDiagnostics ? { navigationDiagnostics } : {}),
    ...(visual !== undefined ? { visual } : {}),
  };
}

export { detectHorizontalOverflow, computeDocumentOverflow } from "./overflow.js";
export { preferLeafCulprits } from "./findings.js";
export {
  CANDIDATE_LIMIT,
  EXCLUDED_LIMIT,
  FINDING_LIMIT,
  RELATED_LIMIT,
  classifyLayoutEvidence,
} from "./classify.js";
export { collectLayoutEvidence, type RawLayoutEvidence, type RawCandidate } from "./layout-evidence.js";
export {
  captureViewportScreenshot,
  viewportScreenshotRelativePath,
  SCREENSHOT_SUBDIR,
} from "./screenshot.js";
export { runVisualRegression } from "./visual-regression.js";
export { createBaseline, updateBaseline } from "./baseline.js";
