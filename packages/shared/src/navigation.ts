/**
 * HTTP / navigation metadata for scans (Phase 9.2).
 * Serialized in JSON reports; URLs omit query strings for privacy.
 */

export type NavigationKind =
  | "ok"
  | "redirect"
  | "client_error"
  | "server_error"
  | "network_error";

/** Document navigation outcome for the scanned URL (one per scan, from first viewport load). */
export interface ScanNavigation {
  /** URL requested by the user (query/hash stripped for reports). */
  requestedUrl: string;
  /** Final URL after redirects (query/hash stripped). */
  finalUrl: string;
  /** Main document HTTP status for the final navigation, or null if unknown. */
  httpStatus: number | null;
  /** Redirect URLs from first hop to last (each stripped); empty if no redirect. */
  redirectChain: readonly string[];
  /** True when final status is 2xx or 3xx (Playwright may expose 3xx only on intermediates — final is usually 200). */
  responseOk: boolean;
  /** Whether the main document loaded a committed frame (goto did not throw). */
  documentLoaded: boolean;
  kind: NavigationKind;
  /** Human-readable reason when `documentLoaded` is false or status is an error. */
  message?: string;
  /**
   * Heuristic only (HTTP 200): page content resembles an interstitial / challenge.
   * Never implies bypass or certain blocking — use with `httpStatus`.
   */
  challengePageLikely?: boolean;
  /** Short strings explaining why challenge heuristic fired (for debugging). */
  challengeSignals?: readonly string[];
}

/** Quality of the scanned page for trust UX (derived from `ScanNavigation`). */
export type NavigationQuality = "trusted" | "http_error" | "network_error" | "challenge_uncertain";

/**
 * Strip query and fragment from http(s) URLs for privacy in reports.
 * Leaves `file:` and other schemes unchanged when URL parsing fails.
 */
export function urlForReport(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") {
      return `${u.origin}${u.pathname}`;
    }
    return url;
  } catch {
    return url;
  }
}

export function navigationQuality(nav: ScanNavigation): NavigationQuality {
  if (!nav.documentLoaded) return "network_error";
  if (nav.httpStatus !== null && nav.httpStatus >= 400) {
    return "http_error";
  }
  if (nav.challengePageLikely === true) return "challenge_uncertain";
  return "trusted";
}

/** Short user-facing English line for Studio / HTML (no fabricated certainty). */
export function navigationBannerMessage(nav: ScanNavigation): string | null {
  const q = navigationQuality(nav);
  if (q === "network_error") {
    return `The page could not be loaded${nav.message ? `: ${nav.message}` : ""}. Findings below are unavailable or incomplete.`;
  }
  if (q === "http_error" && nav.httpStatus !== null) {
    return `The server returned HTTP ${nav.httpStatus}. The screenshot and findings describe that response, not necessarily your intended page.`;
  }
  if (q === "challenge_uncertain") {
    return `The page returned HTTP ${nav.httpStatus ?? 200}, but the content resembles a security check or interstitial. Treat findings as diagnostic only — they may not reflect the real site.`;
  }
  return null;
}

/** Optional informational line when the URL path changed (successful redirect). */
export function navigationRedirectNote(nav: ScanNavigation): string | null {
  if (!nav.documentLoaded) return null;
  if (nav.httpStatus !== null && nav.httpStatus >= 400) return null;
  if (nav.redirectChain.length === 0) return null;
  return `Redirected: results apply to the final URL below.`;
}
