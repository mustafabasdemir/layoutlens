import type { JsonReport } from "@layoutlens/shared";
import { workspaceKey, type AdvancedFindingRef, type OverflowFindingRef } from "./workspace-findings";

/** Map a finding id from the inspector snapshot to a workspace selection key, when present in this viewport. */
export function workspaceKeyForFindingId(
  report: JsonReport,
  viewportWidth: number,
  findingId: string,
): string | null {
  const vp = report.viewports.find((v) => v.width === viewportWidth);
  if (!vp) return null;
  const oi = vp.findings.findIndex((f) => f.id === findingId);
  if (oi >= 0) {
    const ref: OverflowFindingRef = {
      kind: "overflow",
      viewportWidth,
      index: oi,
      finding: vp.findings[oi]!,
    };
    return workspaceKey(ref);
  }
  const adv = vp.advancedFindings;
  if (!adv?.length) return null;
  const ai = adv.findIndex((f) => f.id === findingId);
  if (ai >= 0) {
    const ref: AdvancedFindingRef = {
      kind: "advanced",
      viewportWidth,
      index: ai,
      finding: adv[ai]!,
    };
    return workspaceKey(ref);
  }
  return null;
}

export function shortInspectorSelector(sel: string, max = 72): string {
  const t = sel.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}
