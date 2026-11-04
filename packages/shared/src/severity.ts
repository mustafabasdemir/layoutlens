export type FindingSeverity = "high" | "medium" | "low";

export const SEVERITY_ORDER: readonly FindingSeverity[] = [
  "high",
  "medium",
  "low",
] as const;

/** Classify how serious a horizontal overflow contribution is. */
export function classifySeverity(
  documentContributionPx: number,
  viewportWidth: number,
): FindingSeverity {
  const ratio = documentContributionPx / viewportWidth;
  if (documentContributionPx >= 80 || ratio >= 0.25) {
    return "high";
  }
  if (documentContributionPx >= 16 || ratio >= 0.05) {
    return "medium";
  }
  return "low";
}

export interface SeverityCounts {
  high: number;
  medium: number;
  low: number;
}

export function emptySeverityCounts(): SeverityCounts {
  return { high: 0, medium: 0, low: 0 };
}

export function countSeverities(
  severities: readonly FindingSeverity[],
): SeverityCounts {
  const counts = emptySeverityCounts();
  for (const s of severities) {
    counts[s] += 1;
  }
  return counts;
}
