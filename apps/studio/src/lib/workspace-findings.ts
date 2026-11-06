import type { JsonReport, JsonReportAdvancedFinding, JsonReportFinding } from "@layoutlens/shared";

const ADV_PREFIX = "a:";

/** Reference to a horizontal-overflow finding (Phase 7). */
export interface OverflowFindingRef {
  kind: "overflow";
  viewportWidth: number;
  index: number;
  finding: JsonReportFinding;
}

/** Reference to a Phase 8 responsive finding. */
export interface AdvancedFindingRef {
  kind: "advanced";
  viewportWidth: number;
  index: number;
  finding: JsonReportAdvancedFinding;
}

export type WorkspaceFindingRef = OverflowFindingRef | AdvancedFindingRef;

export function overflowRefsForViewport(report: JsonReport, width: number): OverflowFindingRef[] {
  const vp = report.viewports.find((v) => v.width === width);
  if (!vp) return [];
  return vp.findings.map((finding, index) => ({ kind: "overflow" as const, viewportWidth: width, index, finding }));
}

export function advancedRefsForViewport(report: JsonReport, width: number): AdvancedFindingRef[] {
  const vp = report.viewports.find((v) => v.width === width);
  if (!vp?.advancedFindings?.length) return [];
  return vp.advancedFindings.map((finding, index) => ({
    kind: "advanced" as const,
    viewportWidth: width,
    index,
    finding,
  }));
}

export function workspaceKey(ref: WorkspaceFindingRef): string {
  if (ref.kind === "overflow") return `${ref.viewportWidth}:${ref.index}`;
  return `${ADV_PREFIX}${ref.viewportWidth}:${ref.index}`;
}

export function parseWorkspaceKey(key: string): { kind: "overflow" | "advanced"; viewportWidth: number; index: number } | null {
  if (key.startsWith(ADV_PREFIX)) {
    const rest = key.slice(ADV_PREFIX.length);
    const [w, i] = rest.split(":");
    const viewportWidth = Number(w);
    const index = Number(i);
    if (!Number.isFinite(viewportWidth) || !Number.isFinite(index)) return null;
    return { kind: "advanced", viewportWidth, index };
  }
  const [w, i] = key.split(":");
  const viewportWidth = Number(w);
  const index = Number(i);
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(index)) return null;
  return { kind: "overflow", viewportWidth, index };
}
