import type { JsonReportSummary, JsonReport, ScanNavigation } from "./report.js";

type JsonReportSummaryWithNav = JsonReportSummary & { navigation?: ScanNavigation };
type StoredScanSummary = JsonReportSummaryWithNav &
  Partial<Pick<JsonReport, "navigationDiagnostics">>;

/** Contract between LayoutLens Studio and the local scanning API (`@layoutlens/server`). */

export const SCAN_API_SERVICE = "layoutlens-scan-api" as const;
export const SCAN_API_PREFIX = "/api" as const;

export type ScanJobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface ScanJobProgress {
  /** Scan stages finished so far (browser launch, each viewport, visual compare, report write). */
  completedSteps: number;
  totalSteps: number;
  /** Human-readable description of the current stage. */
  message: string;
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
}

export interface CreateScanRequestBody {
  url: string;
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
}

export interface ScanServiceInfo {
  service: typeof SCAN_API_SERVICE;
  version: string;
  viewportWidths: readonly number[];
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

/** Report-relative files the API is willing to serve for a scan. */
export const SCAN_FILE_PATTERN = /^(?:screenshots|visual)\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.png$/;

export function scanFileUrl(scanId: string, relativePath: string): string {
  return `${SCAN_API_PREFIX}/scans/${encodeURIComponent(scanId)}/files/${relativePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export function progressPercent(progress: ScanJobProgress): number | null {
  if (progress.totalSteps <= 0) return null;
  return Math.round((Math.min(progress.completedSteps, progress.totalSteps) / progress.totalSteps) * 100);
}
