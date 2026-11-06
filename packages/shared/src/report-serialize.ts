import type { JsonReport, ScanResult } from "@layoutlens/shared";
import { REPORT_SCHEMA_VERSION } from "@layoutlens/shared";
import { navigationQuality } from "./navigation.js";

export function scanResultToJsonReport(result: ScanResult): JsonReport {
  const visualByWidth = new Map(
    (result.visual?.comparisons ?? []).map((c) => [c.width, c]),
  );

  const nav = result.navigation ?? result.summary.navigation;
  const scanTrust = nav ? navigationQuality(nav) : result.summary.scanTrust;

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: "layoutlens",
    url: result.url,
    scannedAt: result.scannedAt,
    summary: {
      viewportIssueCount: result.issueCount,
      findingCount: result.summary.findingCount,
      bySeverity: result.summary.bySeverity,
      byClassification: { ...result.summary.byClassification },
      excludedCount: result.summary.excludedCount,
      truncated: result.summary.truncated,
      ...(result.summary.advancedFindingCount !== undefined
        ? { advancedFindingCount: result.summary.advancedFindingCount }
        : {}),
      ...(result.summary.byAdvancedCategory
        ? { byAdvancedCategory: { ...result.summary.byAdvancedCategory } }
        : {}),
      ...(result.summary.advancedTruncated !== undefined
        ? { advancedTruncated: result.summary.advancedTruncated }
        : {}),
      ...(result.summary.visualFailures !== undefined
        ? { visualFailures: result.summary.visualFailures }
        : {}),
      ...(result.summary.viewportInspectionCompleteCount !== undefined
        ? { viewportInspectionCompleteCount: result.summary.viewportInspectionCompleteCount }
        : {}),
      ...(result.summary.viewportInspectionFailedCount !== undefined
        ? { viewportInspectionFailedCount: result.summary.viewportInspectionFailedCount }
        : {}),
      ...(result.summary.viewportInspectionSkippedCount !== undefined
        ? { viewportInspectionSkippedCount: result.summary.viewportInspectionSkippedCount }
        : {}),
      ...(result.summary.scanCompletionStatus
        ? { scanCompletionStatus: result.summary.scanCompletionStatus }
        : {}),
      ...(result.summary.viewportOutcomes
        ? { viewportOutcomes: [...result.summary.viewportOutcomes] }
        : {}),
      ...(nav ? { navigation: nav, scanTrust } : {}),
    },
    ...(nav ? { navigation: nav } : {}),
    ...(result.navigationDiagnostics ? { navigationDiagnostics: result.navigationDiagnostics } : {}),
    viewports: result.viewports.map((v) => {
      const visual = visualByWidth.get(v.width);
      return {
        width: v.width,
        label: v.label,
        viewportHeight: v.viewportHeight,
        documentScrollWidth: v.documentScrollWidth,
        documentClientWidth: v.documentClientWidth,
        hasHorizontalOverflow: v.hasHorizontalOverflow,
        overflowPx: v.overflowPx,
        ...(v.inspectionStatus !== undefined ? { inspectionStatus: v.inspectionStatus } : {}),
        ...(v.inspection ? { inspection: { ...v.inspection } } : {}),
        ...(v.inspectionError ? { inspectionError: { ...v.inspectionError } } : {}),
        ...(v.screenshot !== undefined ? { screenshot: v.screenshot } : {}),
        ...(visual
          ? {
              visualCompare: {
                status: visual.status,
                diffPixels: visual.diffPixels,
                diffPixelRatio: visual.diffPixelRatio,
                ...(visual.baselineScreenshot
                  ? { baselineScreenshot: visual.baselineScreenshot }
                  : {}),
                ...(visual.diffScreenshot
                  ? { diffScreenshot: visual.diffScreenshot }
                  : {}),
              },
            }
          : {}),
        findings: v.findings.map((f) => ({
          id: f.id,
          selector: f.selector,
          tagName: f.tagName,
          severity: f.severity,
          overflowPx: f.overflowPx,
          documentContributionPx: f.documentContributionPx,
          scrollWidth: f.scrollWidth,
          clientWidth: f.clientWidth,
          boundingBox: { ...f.boundingBox },
          selectorMatches: f.selectorMatches,
          classification: f.classification,
          reason: f.reason,
          scrollContributionPx: f.scrollContributionPx,
          visibleBox: f.visibleBox ? { ...f.visibleBox } : null,
          position: f.position,
          transformed: f.transformed,
          invisible: f.invisible,
          ...(f.clipping ? { clipping: { ...f.clipping, boundingBox: { ...f.clipping.boundingBox } } } : {}),
          ...(f.pattern ? { pattern: f.pattern } : {}),
          related: f.related.map((r) => ({ ...r, boundingBox: { ...r.boundingBox } })),
          relatedCount: f.relatedCount,
        })),
        ...(v.inspector ? { inspector: v.inspector } : {}),
        excluded: v.excluded.map((e) => ({
          ...e,
          boundingBox: { ...e.boundingBox },
          samples: e.samples.map((s) => ({ ...s, boundingBox: { ...s.boundingBox } })),
        })),
        analysis: { ...v.analysis },
        ...(v.advancedFindings?.length
          ? {
              advancedFindings: v.advancedFindings.map((f) => ({
                ...f,
                boundingBox: { ...f.boundingBox },
                visibleBox: f.visibleBox ? { ...f.visibleBox } : null,
                ...(f.clipping ? { clipping: { ...f.clipping, boundingBox: { ...f.clipping.boundingBox } } } : {}),
                ...(f.related?.length
                  ? {
                      related: f.related.map((r) => ({ ...r, boundingBox: { ...r.boundingBox } })),
                    }
                  : {}),
              })),
            }
          : v.advancedFindings
            ? { advancedFindings: [] }
            : {}),
        ...(v.advancedAnalysis ? { advancedAnalysis: { ...v.advancedAnalysis } } : {}),
      };
    }),
    ...(result.visual
      ? {
          visual: {
            passedCount: result.visual.passedCount,
            failedCount: result.visual.failedCount,
            comparisons: result.visual.comparisons.map((c) => ({
              width: c.width,
              label: c.label,
              status: c.status,
              diffPixels: c.diffPixels,
              diffPixelRatio: c.diffPixelRatio,
              ...(c.baselineScreenshot
                ? { baselineScreenshot: c.baselineScreenshot }
                : {}),
              ...(c.currentScreenshot
                ? { currentScreenshot: c.currentScreenshot }
                : {}),
              ...(c.diffScreenshot ? { diffScreenshot: c.diffScreenshot } : {}),
            })),
          },
        }
      : {}),
  };
}

export function serializeJsonReport(result: ScanResult): string {
  return `${JSON.stringify(scanResultToJsonReport(result), null, 2)}\n`;
}
