import type { JsonReport, ScanResult } from "@layoutlens/shared";
import { REPORT_SCHEMA_VERSION } from "@layoutlens/shared";

export function scanResultToJsonReport(result: ScanResult): JsonReport {
  const visualByWidth = new Map(
    (result.visual?.comparisons ?? []).map((c) => [c.width, c]),
  );

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
    },
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
