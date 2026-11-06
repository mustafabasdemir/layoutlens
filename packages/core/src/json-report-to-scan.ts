import type {
  JsonReport,
  JsonReportAdvancedFinding,
  JsonReportFinding,
  OverflowFinding,
  ScanResult,
  ViewportScanResult,
} from "@layoutlens/shared";

function findingToOverflow(f: JsonReportFinding): OverflowFinding {
  const classification = f.classification ?? "potential";
  return {
    id: f.id ?? `overflow:${f.selector}`,
    selector: f.selector,
    tagName: f.tagName,
    severity: f.severity,
    overflowPx: f.overflowPx,
    documentContributionPx: f.documentContributionPx,
    scrollWidth: f.scrollWidth,
    clientWidth: f.clientWidth,
    boundingBox: { ...f.boundingBox },
    selectorMatches: f.selectorMatches ?? 1,
    classification,
    reason: f.reason ?? "",
    scrollContributionPx: f.scrollContributionPx ?? 0,
    depth: 0,
    visibleBox: f.visibleBox === undefined ? null : f.visibleBox ? { ...f.visibleBox } : null,
    position: f.position ?? "static",
    transformed: f.transformed ?? false,
    invisible: f.invisible ?? false,
    ...(f.clipping !== undefined ? { clipping: f.clipping } : {}),
    ...(f.pattern !== undefined ? { pattern: f.pattern } : {}),
    related: f.related ? f.related.map((r) => ({ ...r, boundingBox: { ...r.boundingBox } })) : [],
    relatedCount: f.relatedCount ?? 0,
  };
}

function advancedToShared(f: JsonReportAdvancedFinding): import("@layoutlens/shared").AdvancedFinding {
  const base: import("@layoutlens/shared").AdvancedFinding = {
    id: f.id,
    category: f.category,
    tagName: f.tagName,
    selector: f.selector,
    selectorMatches: f.selectorMatches ?? 1,
    severity: f.severity,
    classification: f.classification,
    reason: f.reason,
    guidance: f.guidance,
    boundingBox: { ...f.boundingBox },
    visibleBox: f.visibleBox === undefined ? null : f.visibleBox ? { ...f.visibleBox } : null,
  };
  if (f.invisible !== undefined) base.invisible = f.invisible;
  if (f.clipping !== undefined) base.clipping = f.clipping;
  if (f.overlap !== undefined) base.overlap = f.overlap;
  if (f.textClip !== undefined) base.textClip = f.textClip;
  if (f.offscreenControl !== undefined) base.offscreenControl = f.offscreenControl;
  if (f.touchTarget !== undefined) base.touchTarget = f.touchTarget;
  if (f.related !== undefined) base.related = f.related.map((r) => ({ ...r, boundingBox: { ...r.boundingBox } }));
  if (f.relatedCount !== undefined) base.relatedCount = f.relatedCount;
  if (f.groupKey !== undefined) base.groupKey = f.groupKey;
  return base;
}

/** Reconstruct a `ScanResult` shape from persisted `JsonReport` for merge/retry (best-effort). */
export function scanResultFromJsonReport(json: JsonReport): ScanResult {
  const viewports: ViewportScanResult[] = json.viewports.map((vp) => {
    const findings = vp.findings.map(findingToOverflow);
    const base: ViewportScanResult = {
      width: vp.width as import("@layoutlens/shared").ViewportWidth,
      label: vp.label,
      viewportHeight: vp.viewportHeight,
      documentScrollWidth: vp.documentScrollWidth,
      documentClientWidth: vp.documentClientWidth,
      hasHorizontalOverflow: vp.hasHorizontalOverflow,
      overflowPx: vp.overflowPx,
      findings,
      overflowingElements: findings,
      excluded: vp.excluded ? vp.excluded.map((e) => ({ ...e, boundingBox: { ...e.boundingBox } })) : [],
      analysis: vp.analysis
        ? { ...vp.analysis }
        : {
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
      ...(vp.inspectionStatus !== undefined ? { inspectionStatus: vp.inspectionStatus } : {}),
      ...(vp.inspection ? { inspection: { ...vp.inspection } } : {}),
      ...(vp.inspectionError ? { inspectionError: { ...vp.inspectionError } } : {}),
      ...(vp.screenshot !== undefined ? { screenshot: vp.screenshot } : {}),
      ...(vp.inspector !== undefined ? { inspector: vp.inspector } : {}),
    };
    if (vp.advancedFindings?.length) {
      base.advancedFindings = vp.advancedFindings.map(advancedToShared);
    }
    if (vp.advancedAnalysis) {
      base.advancedAnalysis = { ...vp.advancedAnalysis };
    }
    return base;
  });

  const summary = json.summary;
  const out: ScanResult = {
    url: json.url,
    scannedAt: json.scannedAt,
    viewports,
    issueCount: summary.viewportIssueCount,
    summary: {
      viewportIssueCount: summary.viewportIssueCount,
      findingCount: summary.findingCount,
      bySeverity: { ...summary.bySeverity },
      byClassification: summary.byClassification
        ? { ...summary.byClassification }
        : { confirmed: 0, potential: 0, insufficientEvidence: 0 },
      excludedCount: summary.excludedCount ?? 0,
      truncated: summary.truncated ?? false,
      ...(summary.advancedFindingCount !== undefined ? { advancedFindingCount: summary.advancedFindingCount } : {}),
      ...(summary.byAdvancedCategory ? { byAdvancedCategory: { ...summary.byAdvancedCategory } } : {}),
      ...(summary.advancedTruncated !== undefined ? { advancedTruncated: summary.advancedTruncated } : {}),
      ...(summary.visualFailures !== undefined ? { visualFailures: summary.visualFailures } : {}),
      ...(summary.navigation ? { navigation: summary.navigation } : {}),
      ...(summary.scanTrust !== undefined ? { scanTrust: summary.scanTrust } : {}),
      ...(summary.viewportInspectionCompleteCount !== undefined
        ? { viewportInspectionCompleteCount: summary.viewportInspectionCompleteCount }
        : {}),
      ...(summary.viewportInspectionFailedCount !== undefined
        ? { viewportInspectionFailedCount: summary.viewportInspectionFailedCount }
        : {}),
      ...(summary.viewportInspectionSkippedCount !== undefined
        ? { viewportInspectionSkippedCount: summary.viewportInspectionSkippedCount }
        : {}),
      ...(summary.scanCompletionStatus ? { scanCompletionStatus: summary.scanCompletionStatus } : {}),
      ...(summary.viewportOutcomes ? { viewportOutcomes: [...summary.viewportOutcomes] } : {}),
    },
    ...(json.navigation ? { navigation: json.navigation } : {}),
    ...(json.navigationDiagnostics ? { navigationDiagnostics: json.navigationDiagnostics } : {}),
  };
  if (json.visual !== undefined) {
    out.visual = json.visual as NonNullable<ScanResult["visual"]>;
  }
  return out;
}
