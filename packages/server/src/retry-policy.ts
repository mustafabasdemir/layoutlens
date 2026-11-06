import type { JsonReport, JsonSiteScanReport, ViewportFailurePhase, ViewportInspectionStatus } from "@layoutlens/shared";

const RETRYABLE_PHASES: ReadonlySet<ViewportFailurePhase> = new Set([
  "readiness",
  "viewport-resize",
  "measurement",
  "inspector",
  "screenshot",
  "navigation",
]);

/** HTTP statuses where retry is pointless without changing URL/policy. */
function isNonRetryableHttpStatus(status: number | null | undefined): boolean {
  if (status === null || status === undefined) return false;
  if (status === 401 || status === 403 || status === 407) return true;
  return false;
}

export function isPageNavigationTrustedForRetry(summary: JsonReport["summary"]): boolean {
  const nav = summary.navigation;
  if (!nav) return true;
  if (!nav.documentLoaded) return false;
  if (isNonRetryableHttpStatus(nav.httpStatus)) return false;
  return true;
}

export function isViewportRetryEligible(
  inspectionStatus: ViewportInspectionStatus | undefined,
  phase: ViewportFailurePhase | undefined,
): boolean {
  if (inspectionStatus !== "failed") return false;
  if (!phase) return false;
  return RETRYABLE_PHASES.has(phase);
}

export function listEligibleViewportRetries(site: JsonSiteScanReport, reports: ReadonlyMap<number, JsonReport>): {
  pageIndex: number;
  viewportIndex: number;
  phase: ViewportFailurePhase;
  message: string;
}[] {
  const out: { pageIndex: number; viewportIndex: number; phase: ViewportFailurePhase; message: string }[] = [];
  for (let pi = 0; pi < site.pages.length; pi++) {
    const row = site.pages[pi]!;
    if (row.status !== "completed") continue;
    const rep = reports.get(pi);
    if (!rep) continue;
    if (!isPageNavigationTrustedForRetry(rep.summary)) continue;
    rep.viewports.forEach((vp, vi) => {
      const st = vp.inspectionStatus ?? "completed";
      const phase = vp.inspectionError?.phase;
      if (isViewportRetryEligible(st, phase) && phase) {
        out.push({
          pageIndex: pi,
          viewportIndex: vi,
          phase,
          message: vp.inspectionError?.message ?? "Viewport inspection failed",
        });
      }
    });
  }
  return out;
}

/** Whole-page failure (no report written) — retry only when failure looks transient. */
export function isPageErrorRetryEligible(errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase();
  if (/\b403\b|401\b|407\b|forbidden|access denied|captcha|recaptcha|hcaptcha|cloudflare\b/.test(msg)) {
    return false;
  }
  if (/cancelled|aborted|canceled/.test(msg)) return false;
  return /timeout|timed out|net::|network|econnreset|enotfound|econnrefused|navigation|screenshot/i.test(msg);
}

export function listEligiblePageRetries(site: JsonSiteScanReport): { pageIndex: number; message: string }[] {
  const out: { pageIndex: number; message: string }[] = [];
  for (let pi = 0; pi < site.pages.length; pi++) {
    const row = site.pages[pi]!;
    if (row.status !== "failed") continue;
    const err = row.error ?? "Page scan failed";
    if (!isPageErrorRetryEligible(err)) continue;
    out.push({ pageIndex: pi, message: err.slice(0, 400) });
  }
  return out;
}
