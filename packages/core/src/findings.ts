import type { OverflowFinding } from "@layoutlens/shared";

type CulpritCandidate = Pick<
  OverflowFinding,
  "selector" | "depth" | "documentContributionPx"
>;

/**
 * When multiple nested elements extend the viewport, keep the deepest culprits
 * so wrappers like `main` do not dominate the report.
 */
export function preferLeafCulprits<T extends CulpritCandidate>(
  findings: T[],
): T[] {
  if (findings.length <= 1) {
    return findings;
  }

  const byDepth = [...findings].sort((a, b) => b.depth - a.depth);
  const kept: T[] = [];

  for (const finding of byDepth) {
    const childAlreadyKept = kept.some((other) =>
      other.selector.startsWith(`${finding.selector} > `),
    );
    if (childAlreadyKept) {
      continue;
    }

    const parentIndex = kept.findIndex((other) =>
      finding.selector.startsWith(`${other.selector} > `),
    );
    if (parentIndex >= 0) {
      kept.splice(parentIndex, 1);
    }

    kept.push(finding);
  }

  return kept.sort(
    (a, b) => b.documentContributionPx - a.documentContributionPx,
  );
}
