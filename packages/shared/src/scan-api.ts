import type { JsonReportSummary, JsonReport, ScanNavigation } from "./report.js";

type JsonReportSummaryWithNav = JsonReportSummary & { navigation?: ScanNavigation };
type StoredScanSummary = JsonReportSummaryWithNav &
  Partial<Pick<JsonReport, "navigationDiagnostics">>;

/** Contract between LayoutLens Studio and the local scanning API (`@layoutlens/server`). */

export const SCAN_API_SERVICE = "layoutlens-scan-api" as const;
export const SCAN_API_PREFIX = "/api" as const;

export type ScanJobState = "queued" | "running" | "completed" | "failed" | "cancelled";

/** Phase 10.3 — a task that may be retried (viewport-level or whole-page rescan). */
export interface SiteScanRetryTaskView {
  kind: "viewport" | "page";
  pageIndex: number;
  /** Set for viewport retries (zero-based index into the page’s viewport list). */
  viewportIndex?: number;
  phase?: import("./scan-diagnostics.js").ViewportFailurePhase;
  message: string;
  attemptCount: number;
  eligible: boolean;
  /** When ineligible, short reason for the UI (e.g. max attempts, access denied). */
  ineligibleReason?: string;
}

export interface SiteScanRetryView {
  state: "idle" | "running";
  maxAttemptsPerTask: number;
  /** Tasks that are retryable or blocked (with reason). Refreshed when the job is loaded or after a retry. */
  tasks: readonly SiteScanRetryTaskView[];
  /** Last viewport or page being retried (while `state === "running"`). */
  current?: { kind: "viewport" | "page"; pageIndex: number; viewportIndex?: number; attempt: number };
  /** Short status line for Studio. */
  message?: string;
  /** Append-only history of retry attempts (bounded on the server). */
  history?: readonly {
    at: string;
    kind: "viewport" | "page";
    pageIndex: number;
    viewportIndex?: number;
    outcome: "success" | "failed" | "cancelled";
    detail?: string;
  }[];
}

export interface ScanJobProgress {
  /** Scan stages finished so far (browser launch, each viewport, visual compare, report write). */
  completedSteps: number;
  totalSteps: number;
  /** Human-readable description of the current stage. */
  message: string;
  /** Phase 10 — `single_page` (default) or `multi_page` site crawl. */
  mode?: "single_page" | "multi_page";
  /**
   * When true, `totalSteps` is unknown — UIs should show an indeterminate progress bar.
   * Typical for multi-page discovery + scanning.
   */
  indeterminate?: boolean;
  /** Phase 10 — live site-scan telemetry (multi-page). */
  site?: {
    rootUrl: string;
    phase: "discovering" | "scanning" | "writing" | "done";
    discoveredPages?: number;
    scheduledPages?: number;
    completedPages?: number;
    failedPages?: number;
    currentPageUrl?: string;
    /** 1-based index of the page that started or is currently scanning (not the same as completed page count when pages run in parallel). */
    activePageIndex?: number;
    /** Total pages scheduled for this site scan. */
    activePageTotal?: number;
    currentViewport?: { width: number; height: number; label: string; index: number; total: number };
    /** Viewport inspection tasks finished (each page × each configured viewport). */
    viewportTasksCompleted?: number;
    /** Total viewport tasks once all pages are scheduled (`scheduledPages` × viewports per page). */
    viewportTasksTotal?: number;
  };
}

export interface ScanJobBaseline {
  /** Folder name under the baselines directory. */
  name: string;
  createdAt: string;
}

export interface ScanJobView {
  id: string;
  url: string;
  state: ScanJobState;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress: ScanJobProgress;
  /** 1-based position while queued. */
  queuePosition?: number;
  /** Present for failed or cancelled scans. */
  error?: string;
  /** Baseline used for visual comparison, when a compatible one existed. */
  baseline?: ScanJobBaseline;
  /** Present once the report has been written. */
  summary?: StoredScanSummary & { viewportWidths: number[] };
  /** Phase 10 */
  scanMode?: "single_page" | "multi_page";
  maxPages?: number;
  maxDepth?: number;
  /** Effective viewport dimensions for this job (for display). */
  viewports?: readonly { width: number; height: number }[];
  siteSummary?: import("./report.js").JsonSiteScanReport["summary"];
  /** Phase 10.3 — site-scan retry eligibility and in-flight retry (multi-page completed jobs). */
  siteRetry?: SiteScanRetryView;
  /**
   * Persisted retry attempt counts (keys: viewport `"<pageIndex>:<viewportIndex>"`, page `"<pageIndex>"`).
   * Omitted in API responses; used for server-side enforcement and reconciliation.
   */
  siteRetryAttempts?: { v: Record<string, number>; p: Record<string, number> };
  siteRetryHistory?: SiteScanRetryView["history"];
}

export interface RetryScanRequestBody {
  /** Retry every eligible task (viewport + whole-page failures). */
  all?: boolean;
  /** Zero-based page index (required unless `all`). */
  pageIndex?: number;
  /**
   * Zero-based viewport index for that page. Omit to rescan the whole page (all viewports).
   * When the page has no saved report (hard failure), only whole-page retry is valid.
   */
  viewportIndex?: number;
}

export interface CreateScanRequestBody {
  url: string;
  mode?: "single_page" | "multi_page";
  maxPages?: number;
  maxDepth?: number;
  viewports?: readonly { width: number; height: number; label?: string }[];
}

export interface ScanListResponse {
  scans: ScanJobView[];
}

export interface ScanServiceLimits {
  maxConcurrentScans: number;
  maxQueuedScans: number;
  scanTimeoutMs: number;
  maxStoredScans: number;
  maxStorageBytes: number;
  /** Phase 10.3 — max user-initiated retries per viewport or per failed page task. */
  maxRetryAttemptsPerTask: number;
}

export interface ScanServiceInfo {
  service: typeof SCAN_API_SERVICE;
  version: string;
  viewportWidths: readonly number[];
  /** width → default height for that preset width */
  defaultViewportHeights?: Readonly<Record<number, number>>;
  limits: ScanServiceLimits;
  /** Private-network (RFC 1918 / ULA) targets are allowed. Loopback is always allowed. */
  allowPrivateNetwork: boolean;
  /** Local folder where scan reports are stored. */
  dataDirectory: string;
  /** Local folder searched (read-only) for baselines matching the scanned URL. */
  baselinesDirectory: string;
}

export interface ScanApiErrorBody {
  error: { code: string; message: string };
}

/** Report-relative files the API is willing to serve for a scan (incl. multi-page `pages/<i>/...`). */
export const SCAN_FILE_PATTERN =
  /^(?:(?:pages\/[0-9]+\/)?(?:screenshots|visual)\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.png)$/;

export function scanFileUrl(scanId: string, relativePath: string): string {
  return `${SCAN_API_PREFIX}/scans/${encodeURIComponent(scanId)}/files/${relativePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export function progressPercent(progress: ScanJobProgress): number | null {
  if (progress.indeterminate) return null;
  if (progress.totalSteps <= 0) return null;
  return Math.round((Math.min(progress.completedSteps, progress.totalSteps) / progress.totalSteps) * 100);
}
