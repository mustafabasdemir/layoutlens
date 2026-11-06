/**
 * Phase 10 — Site-wide scan contracts.
 * Single-page `JsonReport` remains per-page; aggregate references page reports on disk.
 */

export const SITE_SCAN_SCHEMA_VERSION = "0.2" as const;

export type SiteScanMode = "single_page" | "multi_page";

export type SiteScanQueryParamPolicy = "preserve" | "strip_known_tracking" | "strip_all";

export interface SiteScanScope {
  readonly sameOriginOnly: true;
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  maxRedirectHops: number;
  queryParamPolicy: SiteScanQueryParamPolicy;
  readonly includePathPrefixes?: readonly string[];
  readonly excludePathPrefixes?: readonly string[];
}

export const SITE_SCAN_SCOPE_BOUNDS = {
  maxPages: { min: 1, max: 50, default: 10 },
  maxDepth: { min: 0, max: 5, default: 2 },
  concurrency: { min: 1, max: 4, default: 2 },
  maxRedirectHops: { min: 0, max: 15, default: 10 },
} as const;

export function mergeSiteScanScope(partial?: Partial<SiteScanScope>): SiteScanScope {
  const maxPages = clampInt(
    partial?.maxPages,
    SITE_SCAN_SCOPE_BOUNDS.maxPages.default,
    SITE_SCAN_SCOPE_BOUNDS.maxPages.min,
    SITE_SCAN_SCOPE_BOUNDS.maxPages.max,
  );
  const maxDepth = clampInt(
    partial?.maxDepth,
    SITE_SCAN_SCOPE_BOUNDS.maxDepth.default,
    SITE_SCAN_SCOPE_BOUNDS.maxDepth.min,
    SITE_SCAN_SCOPE_BOUNDS.maxDepth.max,
  );
  const concurrency = clampInt(
    partial?.concurrency,
    SITE_SCAN_SCOPE_BOUNDS.concurrency.default,
    SITE_SCAN_SCOPE_BOUNDS.concurrency.min,
    SITE_SCAN_SCOPE_BOUNDS.concurrency.max,
  );
  const maxRedirectHops = clampInt(
    partial?.maxRedirectHops,
    SITE_SCAN_SCOPE_BOUNDS.maxRedirectHops.default,
    SITE_SCAN_SCOPE_BOUNDS.maxRedirectHops.min,
    SITE_SCAN_SCOPE_BOUNDS.maxRedirectHops.max,
  );
  const queryParamPolicy: SiteScanQueryParamPolicy = partial?.queryParamPolicy ?? "preserve";
  return {
    sameOriginOnly: true,
    maxPages,
    maxDepth,
    concurrency,
    maxRedirectHops,
    queryParamPolicy,
    ...(partial?.includePathPrefixes !== undefined ? { includePathPrefixes: partial.includePathPrefixes } : {}),
    ...(partial?.excludePathPrefixes !== undefined ? { excludePathPrefixes: partial.excludePathPrefixes } : {}),
  };
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** Aggregated multi-page run written next to per-page bundles (Phase 10 CLI). */
export interface SiteScanPageSummary {
  url: string;
  /** Relative to bundle root, e.g. `pages/0/report.json`. */
  reportPath?: string;
  error?: string;
  scannedAt?: string;
  /** @deprecated Prefer `viewportsWithLayoutIssues`. */
  issueCount?: number;
  viewportsWithLayoutIssues?: number;
  confirmedLayoutFindings?: number;
  potentialLayoutFindings?: number;
  findingCount?: number;
  advancedFindingCount?: number;
  scanTrust?: import("../navigation.js").NavigationQuality;
  scanCompletionStatus?: "full" | "partial" | "failed";
}

export interface SiteScanAggregateReport {
  schemaVersion: typeof SITE_SCAN_SCHEMA_VERSION;
  tool: "layoutlens-site-scan";
  rootUrl: string;
  scannedAt: string;
  scope: SiteScanScope;
  pages: readonly SiteScanPageSummary[];
}
