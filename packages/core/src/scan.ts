import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import {
  VIEWPORT_WIDTHS,
  countAdvancedCategories,
  countClassifications,
  countSeverities,
  getViewportLabel,
  mergeVisualConfig,
  type ScanOptions,
  type ScanResult,
  type ScanSummary,
  type ViewportScanResult,
} from "@layoutlens/shared";
import {
  computeDocumentOverflow,
  detectHorizontalOverflow,
} from "./overflow.js";
import { detectResponsiveIssues } from "./detect-responsive.js";
import { captureViewportScreenshot } from "./screenshot.js";
import { runVisualRegression } from "./visual-regression.js";

const DEFAULT_VIEWPORT_HEIGHT = 844;
const NAVIGATION_TIMEOUT_MS = 30_000;

function buildViewportResult(
  width: (typeof VIEWPORT_WIDTHS)[number],
  viewportHeight: number,
  overflowData: Awaited<ReturnType<typeof detectHorizontalOverflow>>,
  responsiveData: Awaited<ReturnType<typeof detectResponsiveIssues>>,
  screenshot?: string,
): ViewportScanResult {
  const docOverflow = computeDocumentOverflow(
    overflowData.documentScrollWidth,
    overflowData.documentClientWidth,
  );

  const findings = overflowData.findings;

  const base: ViewportScanResult = {
    width,
    label: getViewportLabel(width),
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

  if (screenshot !== undefined) {
    return { ...base, screenshot };
  }

  return base;
}

export function summarizeViewports(viewports: readonly ViewportScanResult[]): Omit<ScanSummary, "visualFailures"> {
  const allFindings = viewports.flatMap((v) => v.findings);
  const allAdvanced = viewports.flatMap((v) => v.advancedFindings ?? []);
  const issueCount = viewports.filter((v) => v.hasHorizontalOverflow).length;
  return {
    viewportIssueCount: issueCount,
    findingCount: allFindings.length,
    bySeverity: countSeverities(allFindings.map((f) => f.severity)),
    byClassification: countClassifications(allFindings),
    excludedCount: viewports.reduce((n, v) => n + v.excluded.length, 0),
    truncated: viewports.some(
      (v) =>
        v.analysis.findingsOmitted > 0 ||
        v.analysis.excludedOmitted > 0 ||
        v.analysis.candidatesOmitted > 0 ||
        (v.advancedAnalysis?.findingsOmitted ?? 0) > 0 ||
        (v.advancedAnalysis?.candidatesOmitted ?? 0) > 0,
    ),
    advancedFindingCount: allAdvanced.length,
    byAdvancedCategory: countAdvancedCategories(allAdvanced),
    advancedTruncated: viewports.some((v) => (v.advancedAnalysis?.findingsOmitted ?? 0) > 0),
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason: unknown = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new DOMException("The scan was aborted.", "AbortError");
}

export async function scanUrl(options: ScanOptions): Promise<ScanResult> {
  const {
    url,
    viewportHeight = DEFAULT_VIEWPORT_HEIGHT,
    headless = true,
    artifacts,
    baselineDirectory,
    visualConfig,
    onProgress,
    signal,
    detection,
  } = options;

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

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const [index, width] of VIEWPORT_WIDTHS.entries()) {
      throwIfAborted(signal);
      onProgress?.({ type: "viewport-started", width, index, total: VIEWPORT_WIDTHS.length });
      await page.setViewportSize({ width, height: viewportHeight });
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: NAVIGATION_TIMEOUT_MS,
      });

      const overflowData = await detectHorizontalOverflow(page, width);
      const responsiveData = await detectResponsiveIssues(page, width, viewportHeight, detection);
      let screenshot: string | undefined;
      if (workDir) {
        screenshot = await captureViewportScreenshot(
          page,
          workDir,
          width,
          stability,
        );
      }

      const viewportResult = buildViewportResult(
        width,
        viewportHeight,
        overflowData,
        responsiveData,
        screenshot,
      );
      viewports.push(viewportResult);
      onProgress?.({
        type: "viewport-completed",
        width,
        index,
        total: VIEWPORT_WIDTHS.length,
        findingCount: viewportResult.findings.length,
      });
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

  const summary = summarizeViewports(viewports);
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
