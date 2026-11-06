import type { JsonSiteScanReport } from "@layoutlens/shared";
import { pageDisplayPath } from "./site-scan-dashboard-utils";

export type SiteNavSummaryTone = "neutral" | "info" | "warning" | "danger";

/** Copy + tone for the site scan navigation quality panel (never warns on `trusted` only). */
export function navigationQualitySiteSummary(site: JsonSiteScanReport): {
  tone: SiteNavSummaryTone;
  title: string;
  body: string;
} | null {
  const rows = site.pages.filter((p) => p.status === "completed" && p.scanTrust !== undefined);
  const trustValues = rows.map((p) => p.scanTrust!);
  const completedCount = site.pages.filter((p) => p.status === "completed").length;
  const allTrusted =
    completedCount > 0 && trustValues.length === completedCount && trustValues.every((t) => t === "trusted");
  const rawWorst = site.summary.scanTrustWorst;
  const worst = rawWorst === "trusted" ? undefined : rawWorst;

  if (trustValues.length === 0 && worst === undefined) {
    return null;
  }

  if (trustValues.length > 0 && trustValues.length < completedCount && worst === undefined) {
    return {
      tone: "info",
      title: "Navigation quality (partial data)",
      body: `Only ${trustValues.length} of ${completedCount} completed pages include navigation trust metadata. Open page reports for HTTP details.`,
    };
  }

  if (allTrusted && worst === undefined) {
    return {
      tone: "neutral",
      title: "Navigation quality",
      body: `Every completed page loaded with trusted HTTP navigation (${trustValues.length} page${trustValues.length === 1 ? "" : "s"} checked). Layout metrics apply to the document the browser received.`,
    };
  }

  const cautionPages = rows.filter((p) => p.scanTrust === "challenge_uncertain");
  const httpPages = rows.filter((p) => p.scanTrust === "http_error");
  const netPages = rows.filter((p) => p.scanTrust === "network_error");

  const parts: string[] = [];
  if (httpPages.length > 0) {
    parts.push(
      `HTTP error response: ${httpPages.map((p) => pageDisplayPath(p.url)).join(", ")} — overflow counts describe that response.`,
    );
  }
  if (netPages.length > 0) {
    parts.push(
      `Load/network failure: ${netPages.map((p) => pageDisplayPath(p.url)).join(", ")} — findings may be incomplete.`,
    );
  }
  if (cautionPages.length > 0) {
    parts.push(
      `Possible interstitial / challenge page: ${cautionPages.map((p) => pageDisplayPath(p.url)).join(", ")} — verify before treating layout results as representative.`,
    );
  }

  if (worst === "http_error") {
    return {
      tone: "danger",
      title: "Navigation blocked or error response",
      body: parts.join(" ") || "At least one page did not return a normal document.",
    };
  }
  if (worst === "network_error") {
    return {
      tone: "danger",
      title: "Navigation or load failure",
      body: parts.join(" ") || "At least one page did not load reliably.",
    };
  }
  if (worst === "challenge_uncertain") {
    return {
      tone: "warning",
      title: "Navigation needs verification",
      body: parts.join(" ") || "At least one page may be a challenge or interstitial.",
    };
  }

  return {
    tone: "warning",
    title: "Mixed navigation quality",
    body: parts.join(" ") || "Some pages may need verification.",
  };
}
