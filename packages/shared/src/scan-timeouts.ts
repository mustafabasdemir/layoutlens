/**
 * Phase 9.2.1 — Scanner timeout buckets (navigation vs readiness vs screenshot vs overall deadline).
 * Values are bounded; callers clamp when composing AbortSignal deadlines.
 */
export const DEFAULT_SCAN_NAVIGATION_TIMEOUT_MS = 30_000;
export const DEFAULT_SCAN_READINESS_TIMEOUT_MS = 20_000;
/** Extra wait after DOM `load` before treating the page as settled for measurement (not networkidle). */
export const DEFAULT_POST_LOAD_SETTLE_MS = 2_500;
export const DEFAULT_SCREENSHOT_TIMEOUT_MS = 30_000;

export interface ScanTimeoutOptions {
  /** Playwright `page.goto` timeout (primary wait: domcontentloaded). */
  navigationMs?: number;
  /** After commit, wait for `load` event; on timeout, recover if the document is usable. */
  readinessMs?: number;
  /** Bounded delay after `load` (or partial recovery) so layout can settle before measurement. */
  postLoadSettleMs?: number;
  /** `page.screenshot({ timeout })` per viewport. */
  screenshotMs?: number;
}

export function mergeScanTimeouts(partial?: ScanTimeoutOptions): Required<ScanTimeoutOptions> {
  return {
    navigationMs: partial?.navigationMs ?? DEFAULT_SCAN_NAVIGATION_TIMEOUT_MS,
    readinessMs: partial?.readinessMs ?? DEFAULT_SCAN_READINESS_TIMEOUT_MS,
    postLoadSettleMs: partial?.postLoadSettleMs ?? DEFAULT_POST_LOAD_SETTLE_MS,
    screenshotMs: partial?.screenshotMs ?? DEFAULT_SCREENSHOT_TIMEOUT_MS,
  };
}
