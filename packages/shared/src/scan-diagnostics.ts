/**
 * Phase 9.2.1 — Bounded diagnostics for navigation and per-viewport inspection (no secrets).
 */

export type ViewportInspectionStatus = "completed" | "failed" | "skipped";

export type ViewportFailurePhase =
  | "navigation"
  | "readiness"
  | "viewport-resize"
  | "measurement"
  | "inspector"
  | "screenshot";

export interface ViewportInspectionError {
  phase: ViewportFailurePhase;
  /** Single-line, safe to show in UI (truncated upstream). */
  message: string;
}

export type ReadinessMilestone = "none" | "commit" | "domcontentloaded" | "load";

/** Alias for Playwright document lifecycle naming in diagnostics. */
export type EffectiveReadinessMilestone = ReadinessMilestone;

export interface ViewportInspectionDiagnostics {
  /** Only on first viewport: Playwright primary goto waitUntil. */
  gotoWaitUntil?: "domcontentloaded";
  /** Time from navigation start to goto return (ms). */
  gotoDurationMs?: number;
  /** Result of post-goto load wait (see page-readiness). */
  readinessWaitDurationMs?: number;
  domContentLoadedReached?: boolean;
  loadEventReached?: boolean;
  effectiveReadinessMilestone?: EffectiveReadinessMilestone;
  /** True when load timed out but DOM still looked usable — scan continued with limitation. */
  partialReadinessRecovery?: boolean;
  /** Short machine-readable reason when applicable. */
  readinessRecoveryNote?: string;
  postLoadSettleMs?: number;
  /** When false, later viewports were not run. */
  navigationCommitted?: boolean;
  screenshotCaptureMs?: number;
  screenshotTimedOut?: boolean;
}

export interface ScanNavigationDiagnostics {
  firstViewportWidth: number;
  firstGotoWaitUntil: "domcontentloaded";
  firstGotoDurationMs: number;
  firstNavigationCommitted: boolean;
  firstReadinessDurationMs: number;
  firstDomContentLoaded: boolean;
  firstLoadEvent: boolean;
  firstEffectiveMilestone: EffectiveReadinessMilestone;
  firstPartialReadinessRecovery: boolean;
  firstReadinessNote?: string;
}
