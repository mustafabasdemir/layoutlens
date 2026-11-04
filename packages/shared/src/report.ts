import type {
  ClassificationCounts,
  ClippingContext,
  ExcludedFinding,
  FindingClassification,
  RelatedElement,
  ViewportAnalysis,
} from "./classification.js";
import type { FindingSeverity, SeverityCounts } from "./severity.js";

export const REPORT_SCHEMA_VERSION = "1.0" as const;

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

export interface JsonReportViewport {
  width: number;
  label: string;
  viewportHeight: number;
  documentScrollWidth: number;
  documentClientWidth: number;
  hasHorizontalOverflow: boolean;
  overflowPx: number;
  findings: JsonReportFinding[];
  excluded?: ExcludedFinding[];
  analysis?: ViewportAnalysis;
  /** Relative path to a viewport screenshot (HTML bundles only). */
  screenshot?: string;
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
  visualFailures?: number;
}

export interface JsonReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  tool: "layoutlens";
  url: string;
  scannedAt: string;
  summary: JsonReportSummary;
  viewports: JsonReportViewport[];
  visual?: JsonReportVisualSummary;
}
