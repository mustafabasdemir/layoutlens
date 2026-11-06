/** Standard viewports for responsive layout checks (mobile, tablet, desktop). */
export const VIEWPORT_WIDTHS = [390, 768, 1440] as const;

export type ViewportWidth = (typeof VIEWPORT_WIDTHS)[number];

export interface ViewportLabel {
  width: ViewportWidth;
  label: string;
}

export const VIEWPORT_LABELS: readonly ViewportLabel[] = [
  { width: 390, label: "mobile" },
  { width: 768, label: "tablet" },
  { width: 1440, label: "desktop" },
] as const;

export type FindingSeverity = "high" | "medium" | "low";

export interface ElementBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

import type {
  ClassificationCounts,
  ClippingContext,
  ExcludedFinding,
  FindingClassification,
  RelatedElement,
  ViewportAnalysis,
} from "./classification.js";

/** Element responsible for horizontal overflow at a viewport. */
export interface OverflowFinding {
  /** Stable id for cross-referencing (e.g. inspector snapshot). */
  id: string;
  tagName: string;
  selector: string;
  severity: FindingSeverity;
  /** Internal scroll overflow (scrollWidth − clientWidth). */
  overflowPx: number;
  /** Pixels extending past the layout viewport horizontally. */
  documentContributionPx: number;
  scrollWidth: number;
  clientWidth: number;
  boundingBox: ElementBoundingBox;
  /** DOM depth from body (body = 0). Used for deduplication only. */
  depth: number;
  /** Elements the selector matches in the page; more than 1 means it is ambiguous. */
  selectorMatches: number;
  classification: FindingClassification;
  /** Evidence-based explanation of the classification. */
  reason: string;
  /** Pixels this element adds to the page's horizontal scroll range (0 when it cannot). */
  scrollContributionPx: number;
  /** Part of the box that is actually painted inside the viewport; null when none is. */
  visibleBox: ElementBoundingBox | null;
  /** Computed CSS position. */
  position: string;
  /** The element or an ancestor has a CSS transform. */
  transformed: boolean;
  /** visibility: hidden or opacity: 0 — still occupies layout space. */
  invisible: boolean;
  clipping?: ClippingContext;
  /** Three or more equally sized children laid out in a row (typical carousel track). */
  pattern?: "horizontal-track";
  /** Other elements past the edge that share this root cause. */
  related: RelatedElement[];
  relatedCount: number;
}

/** @deprecated Alias kept for compatibility — use OverflowFinding. */
export type OverflowElement = OverflowFinding;

export interface ViewportScanResult {
  width: ViewportWidth;
  label: string;
  viewportHeight: number;
  documentScrollWidth: number;
  documentClientWidth: number;
  hasHorizontalOverflow: boolean;
  overflowPx: number;
  /** Phase 9.2.1 — `completed` when fully inspected; legacy callers omit this. */
  inspectionStatus?: import("./scan-diagnostics.js").ViewportInspectionStatus;
  inspection?: import("./scan-diagnostics.js").ViewportInspectionDiagnostics;
  inspectionError?: import("./scan-diagnostics.js").ViewportInspectionError;
  /** Root-cause overflow elements after false-positive filtering. */
  findings: OverflowFinding[];
  /** Same as findings (Phase 1 field name). */
  overflowingElements: OverflowFinding[];
  /** Elements past the edge that were judged intentional (clipped, offscreen, hidden). */
  excluded: ExcludedFinding[];
  analysis: ViewportAnalysis;
  /** Phase 8 responsive findings (do not affect horizontal overflow exit code). */
  advancedFindings?: import("./responsive.js").AdvancedFinding[];
  advancedAnalysis?: import("./responsive.js").AdvancedViewportAnalysis;
  /** Relative path to viewport screenshot inside an HTML report bundle. */
  screenshot?: string;
  /** Phase 9 — optional inspector snapshot (present when capture was enabled). */
  inspector?: import("./inspector.js").InspectorSnapshot;
}

export interface ScanSummary {
  viewportIssueCount: number;
  findingCount: number;
  bySeverity: {
    high: number;
    medium: number;
    low: number;
  };
  byClassification: ClassificationCounts;
  /** Excluded groups across all viewports. */
  excludedCount: number;
  /** True when any viewport hit a finding, excluded-group, or candidate limit. */
  truncated: boolean;
  /** Phase 8 advanced findings across viewports (not in findingCount). */
  advancedFindingCount?: number;
  byAdvancedCategory?: import("./responsive.js").AdvancedCategoryCounts;
  advancedTruncated?: boolean;
  visualFailures?: number;
  /** Phase 9.2 — HTTP navigation (first viewport). */
  navigation?: import("./navigation.js").ScanNavigation;
  /** Phase 9.2 — derived trust hint for UX. */
  scanTrust?: import("./navigation.js").NavigationQuality;
  viewportInspectionCompleteCount?: number;
  viewportInspectionFailedCount?: number;
  viewportInspectionSkippedCount?: number;
  scanCompletionStatus?: "full" | "partial" | "failed";
  viewportOutcomes?: readonly {
    width: ViewportWidth;
    label: string;
    status: import("./scan-diagnostics.js").ViewportInspectionStatus;
    message?: string;
  }[];
}

export interface ScanResult {
  url: string;
  scannedAt: string;
  viewports: ViewportScanResult[];
  /** Viewports with document-level horizontal overflow (exit code). */
  issueCount: number;
  summary: ScanSummary;
  /** Phase 9.2 — HTTP response / redirect metadata (first navigation). */
  navigation?: import("./navigation.js").ScanNavigation;
  /** Phase 9.2.1 — first-viewport navigation/readiness diagnostics. */
  navigationDiagnostics?: import("./scan-diagnostics.js").ScanNavigationDiagnostics;
  /** Present when `--baseline-dir` is used during scan. */
  visual?: import("./visual.js").VisualRegressionResult;
}

export interface ScanOptions {
  url: string;
  /** Default viewport height for all widths. */
  viewportHeight?: number;
  headless?: boolean;
  /** When set, captures per-viewport PNG screenshots under `directory/screenshots/`. */
  artifacts?: ScanArtifactOptions;
  /** Compare captures against this baseline directory (requires screenshots). */
  baselineDirectory?: string;
  visualConfig?: import("./visual.js").VisualRegressionConfig;
  /** Called as real scan stages start and finish. */
  onProgress?: (event: ScanProgressEvent) => void;
  /** Aborting closes the browser and rejects with an AbortError. */
  signal?: AbortSignal;
  /** Phase 8 detector toggles and thresholds. */
  detection?: Partial<import("./responsive.js").DetectionConfig>;
  /** Phase 9 — bounded DOM snapshot for Visual Inspector (default off). */
  inspector?: Partial<import("./inspector.js").InspectorCaptureOptions>;
  /** Phase 9.2.1 — navigation, readiness, screenshot timeouts (defaults are conservative). */
  timeouts?: import("./scan-timeouts.js").ScanTimeoutOptions;
}

export type ScanProgressEvent =
  | { type: "browser-launched" }
  | { type: "viewport-started"; width: ViewportWidth; index: number; total: number }
  | {
      type: "viewport-completed";
      width: ViewportWidth;
      index: number;
      total: number;
      findingCount: number;
      status: import("./scan-diagnostics.js").ViewportInspectionStatus;
      message?: string;
    }
  | { type: "visual-compare-started" }
  | { type: "visual-compare-completed"; failedCount: number };

export interface ScanArtifactOptions {
  directory: string;
  /** Compare screenshots to this baseline directory (manifest + screenshots). */
  baselineDirectory?: string;
  visualConfig?: import("./visual.js").VisualRegressionConfig;
  /** Write diff PNGs under `directory/visual/`. */
  visualDiffs?: boolean;
}

export function getViewportLabel(width: ViewportWidth): string {
  const found = VIEWPORT_LABELS.find((v) => v.width === width);
  return found?.label ?? `${width}px`;
}

export {
  CLASSIFICATION_LABELS,
  EXCLUSION_LABELS,
  FINDING_CLASSIFICATIONS,
  capSeverity,
  countClassifications,
  emptyClassificationCounts,
  type Box,
  type ClassificationCounts,
  type ClippingContext,
  type ExcludedFinding,
  type ExclusionReason,
  type FindingClassification,
  type RelatedElement,
  type ViewportAnalysis,
} from "./classification.js";
export {
  classifySeverity,
  countSeverities,
  emptySeverityCounts,
  SEVERITY_ORDER,
} from "./severity.js";
export type { SeverityCounts } from "./severity.js";
export {
  REPORT_SCHEMA_VERSION,
  type JsonReport,
  type JsonReportSchemaVersion,
  type JsonReportAdvancedFinding,
  type JsonReportFinding,
  type JsonReportSummary,
  type JsonReportViewport,
} from "./report.js";
export { serializeJsonReport, scanResultToJsonReport } from "./report-serialize.js";
export {
  BASELINE_MANIFEST_VERSION,
  DEFAULT_STABILITY,
  DEFAULT_VISUAL_CONFIG,
  type BaselineManifest,
  type BaselineManifestEntry,
  type ScreenshotStabilityOptions,
  type VisualComparisonStatus,
  type VisualMaskRegion,
  type VisualRegressionConfig,
  type VisualRegressionResult,
  type VisualViewportMask,
  type ViewportVisualComparison,
} from "./visual.js";
export { mergeVisualConfig } from "./visual-config.js";
export type {
  JsonReportBoundingBox,
  JsonReportVisualCompare,
  JsonReportVisualCompareView,
  JsonReportVisualSummary,
} from "./report.js";
export {
  DARK_PALETTE,
  LIGHT_PALETTE,
  FONT_MONO,
  FONT_SANS,
  designTokensCss,
  type ThemePalette,
} from "./design-tokens.js";
export {
  mapBoxToScreenshot,
  screenshotPointerToLayoutViewportCss,
  type ImageGeometry,
  type OverlayMapping,
  type OverlayRectPercent,
  type ViewportGeometry,
} from "./overlay-geometry.js";
export {
  INSPECTOR_COMPUTED_STYLE_KEYS,
  INSPECTOR_SNAPSHOT_VERSION,
  DEFAULT_INSPECTOR_CAPTURE,
  mergeInspectorConfig,
  type InspectorCaptureOptions,
  type InspectorComputedStyleKey,
  type InspectorElementNode,
  type InspectorHitTestGrid,
  type InspectorHitTestSample,
  type InspectorSnapshot,
  type InspectorSnapshotMeta,
} from "./inspector.js";
export { hitTestInspectorAtPoint, type HitTestAtPointResult } from "./inspector-hit-test.js";
export { pickInspectorTarget, type InspectorPickResult } from "./inspector-selection.js";
export {
  navigationBannerMessage,
  navigationRedirectNote,
  navigationQuality,
  urlForReport,
  type NavigationKind,
  type NavigationQuality,
  type ScanNavigation,
} from "./navigation.js";
export {
  mergeScanTimeouts,
  DEFAULT_SCAN_NAVIGATION_TIMEOUT_MS,
  DEFAULT_SCAN_READINESS_TIMEOUT_MS,
  DEFAULT_POST_LOAD_SETTLE_MS,
  DEFAULT_SCREENSHOT_TIMEOUT_MS,
  type ScanTimeoutOptions,
} from "./scan-timeouts.js";
export type {
  EffectiveReadinessMilestone,
  ReadinessMilestone,
  ScanNavigationDiagnostics,
  ViewportFailurePhase,
  ViewportInspectionDiagnostics,
  ViewportInspectionError,
  ViewportInspectionStatus,
} from "./scan-diagnostics.js";
export {
  SCAN_API_PREFIX,
  SCAN_API_SERVICE,
  SCAN_FILE_PATTERN,
  progressPercent,
  scanFileUrl,
  type CreateScanRequestBody,
  type ScanApiErrorBody,
  type ScanJobBaseline,
  type ScanJobProgress,
  type ScanJobState,
  type ScanJobView,
  type ScanListResponse,
  type ScanServiceInfo,
  type ScanServiceLimits,
} from "./scan-api.js";
export {
  ADVANCED_CATEGORY_LABELS,
  ADVANCED_FINDING_CATEGORIES,
  DEFAULT_DETECTION_CONFIG,
  countAdvancedCategories,
  emptyAdvancedCategoryCounts,
  mergeDetectionConfig,
  type AdvancedCategoryCounts,
  type AdvancedFinding,
  type AdvancedFindingCategory,
  type AdvancedRelatedSample,
  type AdvancedViewportAnalysis,
  type DetectionConfig,
  type OffscreenControlEvidence,
  type OverlapEvidence,
  type TextClipEvidence,
  type TouchTargetEvidence,
} from "./responsive.js";
export {
  advancedCategoryLabel,
  advancedScreenshotEvidenceNote,
  diagnosticHintsAdvanced,
  explainAdvancedFinding,
  overlayBoxForAdvanced,
} from "./advanced-insights.js";
export {
  FINDING_KIND_LABELS,
  diagnosticHints,
  explainFinding,
  findingKinds,
  overlayBoxFor,
  primaryFindingKind,
  screenshotEvidenceNote,
  type FindingKind,
} from "./finding-insights.js";
