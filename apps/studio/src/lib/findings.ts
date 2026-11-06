import {
  findingKinds,
  type FindingClassification,
  type FindingKind,
  type FindingSeverity,
  type JsonReport,
  type JsonReportFinding,
} from "@layoutlens/shared";

export interface FindingRef {
  viewportWidth: number;
  index: number;
  finding: JsonReportFinding;
}

export type EvidenceFilter = FindingClassification | "unclassified";

export interface FindingFilters {
  severity: FindingSeverity | "all";
  kind: FindingKind | "all";
  evidence: EvidenceFilter | "all";
}

export const DEFAULT_FILTERS: FindingFilters = { severity: "all", kind: "all", evidence: "all" };

export function evidenceOf(finding: JsonReportFinding): EvidenceFilter {
  return finding.classification ?? "unclassified";
}

export function findingsForViewport(report: JsonReport, width: number): FindingRef[] {
  const vp = report.viewports.find((v) => v.width === width);
  if (!vp) return [];
  return vp.findings.map((finding, index) => ({ viewportWidth: width, index, finding }));
}

export function filterFindings(refs: readonly FindingRef[], filters: FindingFilters): FindingRef[] {
  return refs.filter(
    (r) =>
      (filters.severity === "all" || r.finding.severity === filters.severity) &&
      (filters.kind === "all" || findingKinds(r.finding).includes(filters.kind)) &&
      (filters.evidence === "all" || evidenceOf(r.finding) === filters.evidence),
  );
}

export function findingKey(ref: Pick<FindingRef, "viewportWidth" | "index">): string {
  return `${ref.viewportWidth}:${ref.index}`;
}

/** Device label for a viewport width; uses the report's label when present. */
export function deviceName(width: number, label?: string): string {
  const l = (label ?? "").toLowerCase();
  if (l === "mobile" || l === "tablet" || l === "desktop") {
    return l.charAt(0).toUpperCase() + l.slice(1);
  }
  if (width < 600) return "Mobile";
  if (width < 1100) return "Tablet";
  return "Desktop";
}

export type ReportHealth = "clean" | "issues" | "review" | "visual-changes" | "http-response" | "challenge-page";

/** Report-level status that never claims more than the evidence supports. */
export function reportHealth(report: JsonReport): ReportHealth {
  const s = report.summary;
  const trust = s.scanTrust;
  if (trust === "http_error" || trust === "network_error") return "http-response";
  if (trust === "challenge_uncertain") return "challenge-page";
  if (s.byClassification) {
    if (s.byClassification.confirmed > 0) return "issues";
    if (s.byClassification.potential > 0 || s.byClassification.insufficientEvidence > 0) return "review";
    const masked = report.viewports.some((v) => v.hasHorizontalOverflow && v.analysis && !v.analysis.userScrollable);
    if (s.viewportIssueCount > 0) return masked ? "review" : "issues";
  } else if (s.viewportIssueCount > 0 || s.findingCount > 0) {
    return "issues";
  }
  if ((s.visualFailures ?? 0) > 0) return "visual-changes";
  return "clean";
}

/** True when this report is from before findings were classified by evidence. */
export function isLegacyReport(report: JsonReport): boolean {
  return report.summary.byClassification === undefined;
}
