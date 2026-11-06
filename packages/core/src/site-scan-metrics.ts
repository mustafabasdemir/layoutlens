import type { ClassificationCounts } from "@layoutlens/shared";

/** Layout overflow finding totals from `summary.byClassification` (excluding advanced). */
export function layoutFindingTotalsFromClassification(bc: ClassificationCounts | undefined): {
  confirmed: number;
  potential: number;
} {
  if (!bc) return { confirmed: 0, potential: 0 };
  return {
    confirmed: bc.confirmed,
    potential: bc.potential + bc.insufficientEvidence,
  };
}

export function sumClassificationCounts(a: ClassificationCounts, b: ClassificationCounts): ClassificationCounts {
  return {
    confirmed: a.confirmed + b.confirmed,
    potential: a.potential + b.potential,
    insufficientEvidence: a.insufficientEvidence + b.insufficientEvidence,
  };
}

/** Viewports where at least one layout overflow finding exists (for "affected" count). */
export function viewportCountWithLayoutOverflow(
  viewports: readonly { findings?: readonly unknown[]; inspectionStatus?: string }[],
): number {
  let n = 0;
  for (const vp of viewports) {
    if (vp.inspectionStatus === "failed" || vp.inspectionStatus === "skipped") continue;
    const fc = vp.findings?.length ?? 0;
    if (fc > 0) n += 1;
  }
  return n;
}
