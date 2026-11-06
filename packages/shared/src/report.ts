import type {
  ClassificationCounts,
  ClippingContext,
  ExcludedFinding,
  FindingClassification,
  RelatedElement,
  ViewportAnalysis,
} from "./classification.js";
import type {
  AdvancedCategoryCounts,
  AdvancedFindingCategory,
  AdvancedViewportAnalysis,
  OffscreenControlEvidence,
  OverlapEvidence,
  TextClipEvidence,
  TouchTargetEvidence,
} from "./responsive.js";
import type { FindingSeverity, SeverityCounts } from "./severity.js";
import type { NavigationQuality, ScanNavigation } from "./navigation.js";
import type { ViewportInspectionStatus } from "./scan-diagnostics.js";

export type { NavigationQuality, ScanNavigation } from "./navigation.js";

/** `1.3` adds Phase 9.2.1 per-viewport inspection status and navigation/readiness diagnostics. */
export const REPORT_SCHEMA_VERSION = "1.3" as const;

export type JsonReportSchemaVersion = "1.0" | "1.1" | "1.2" | typeof REPORT_SCHEMA_VERSION;

export interface JsonReportBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Fields marked optional were added in Phase 7. Reports written before then omit them;
 * readers must treat a missing `classification` as "unclassified (legacy report)".
 */
export interface JsonReportFinding {
  /** Stable id within the report (e.g. `overflow:390:0`); optional for legacy JSON. */
  id?: string;
  selector: string;
  tagName: string;
  severity: FindingSeverity;
  /** Internal scroll overflow (scrollWidth − clientWidth). */
  overflowPx: number;
  /** Pixels extending past the layout viewport horizontally (before clipping). */
  documentContributionPx: number;
  scrollWidth: number;
  clientWidth: number;
  boundingBox: JsonReportBoundingBox;
  selectorMatches?: number;
  classification?: FindingClassification;
  reason?: string;
  scrollContributionPx?: number;
  visibleBox?: JsonReportBoundingBox | null;
  position?: string;
  transformed?: boolean;
  invisible?: boolean;
  clipping?: ClippingContext;
  pattern?: "horizontal-track";
  related?: RelatedElement[];
  relatedCount?: number;
}

/** Phase 8 responsive findings (separate from horizontal overflow `findings`). */
export interface JsonReportAdvancedFinding {
  id: string;
  category: AdvancedFindingCategory;
  selector: string;
  tagName: string;
  severity: FindingSeverity;
  classification: FindingClassification;
  reason: string;
  guidance: string;
  boundingBox: JsonReportBoundingBox;
  visibleBox?: JsonReportBoundingBox | null;
  selectorMatches?: number;
  invisible?: boolean;
  clipping?: ClippingContext;
  overlap?: OverlapEvidence;
  textClip?: TextClipEvidence;
  offscreenControl?: OffscreenControlEvidence;
  touchTarget?: TouchTargetEvidence;
  related?: import("./responsive.js").AdvancedRelatedSample[];
  relatedCount?: number;
  groupKey?: string;
}

export interface JsonReportViewport {
  width: number;
  label: string;
  viewportHeight: number;
  documentScrollWidth: number;
  documentClientWidth: number;
  hasHorizontalOverflow: boolean;
  overflowPx: number;
  /** Phase 9.2.1 — omitted or `completed` in legacy reports. */
  inspectionStatus?: ViewportInspectionStatus;
  inspection?: import("./scan-diagnostics.js").ViewportInspectionDiagnostics;
  inspectionError?: import("./scan-diagnostics.js").ViewportInspectionError;
  findings: JsonReportFinding[];
  /** Phase 8 — overlap, text clipping, offscreen controls, touch targets. */
  advancedFindings?: JsonReportAdvancedFinding[];
  advancedAnalysis?: AdvancedViewportAnalysis;
  excluded?: ExcludedFinding[];
  analysis?: ViewportAnalysis;
  /** Relative path to a viewport screenshot (HTML bundles only). */
  screenshot?: string;
  /** Phase 9 — bounded DOM snapshot for the Visual Inspector (optional). */
  inspector?: import("./inspector.js").InspectorSnapshot;
  visualCompare?: JsonReportVisualCompare;
}

export interface JsonReportVisualCompare {
  status: "pass" | "fail" | "missing-baseline";
  diffPixels: number;
  diffPixelRatio: number;
  baselineScreenshot?: string;
  diffScreenshot?: string;
}

export interface JsonReportVisualSummary {
  passedCount: number;
  failedCount: number;
  comparisons: JsonReportVisualCompareView[];
}

export interface JsonReportVisualCompareView extends JsonReportVisualCompare {
  width: number;
  label: string;
  currentScreenshot?: string;
}

export interface JsonReportSummary {
  viewportIssueCount: number;
  findingCount: number;
  bySeverity: SeverityCounts;
  byClassification?: ClassificationCounts;
  excludedCount?: number;
  truncated?: boolean;
  /** Phase 8 — count of advanced findings (not included in `findingCount`). */
  advancedFindingCount?: number;
  byAdvancedCategory?: AdvancedCategoryCounts;
  advancedTruncated?: boolean;
  visualFailures?: number;
  /** Phase 9.2 — HTTP navigation / response metadata (first viewport load). */
  navigation?: ScanNavigation;
  /** Phase 9.2 — derived UX hint: whether layout findings are from a trusted document load. */
  scanTrust?: NavigationQuality;
  /** Phase 9.2.1 — how many viewports completed full inspection. */
  viewportInspectionCompleteCount?: number;
  viewportInspectionFailedCount?: number;
  viewportInspectionSkippedCount?: number;
  scanCompletionStatus?: "full" | "partial" | "failed";
  /** Phase 9.2.1 — per viewport one-line outcome for Studio (no secrets). */
  viewportOutcomes?: readonly {
    width: number;
    label: string;
    status: ViewportInspectionStatus;
    message?: string;
  }[];
}

export interface JsonReport {
  schemaVersion: JsonReportSchemaVersion;
  tool: "layoutlens";
  url: string;
  scannedAt: string;
  summary: JsonReportSummary;
  viewports: JsonReportViewport[];
  visual?: JsonReportVisualSummary;
  /** Phase 9.2 — same as `summary.navigation` when present (top-level for readers that skip summary). */
  navigation?: ScanNavigation;
  /** Phase 9.2.1 — first viewport navigation/readiness timing (optional). */
  navigationDiagnostics?: import("./scan-diagnostics.js").ScanNavigationDiagnostics;
}
