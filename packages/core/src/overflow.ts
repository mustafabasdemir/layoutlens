import type { Page } from "playwright";
import type {
  ExcludedFinding,
  OverflowFinding,
  ViewportAnalysis,
  ViewportWidth,
} from "@layoutlens/shared";
import { CANDIDATE_LIMIT, EDGE_TOLERANCE_PX, classifyLayoutEvidence } from "./classify.js";
import { collectLayoutEvidence } from "./layout-evidence.js";

/**
 * Measure every element crossing a viewport edge, then separate real document-level
 * overflow from clipped, scrollable, offscreen, and hidden content.
 */
export async function detectHorizontalOverflow(
  page: Page,
  viewportWidth: number,
): Promise<{
  documentScrollWidth: number;
  documentClientWidth: number;
  findings: OverflowFinding[];
  excluded: ExcludedFinding[];
  analysis: ViewportAnalysis;
}> {
  const evidence = await page.evaluate(collectLayoutEvidence, {
    viewportWidth,
    tolerance: EDGE_TOLERANCE_PX,
    maxCandidates: CANDIDATE_LIMIT,
  });
  const { findings, excluded, analysis } = classifyLayoutEvidence(evidence);
  return {
    documentScrollWidth: evidence.documentScrollWidth,
    documentClientWidth: evidence.documentClientWidth,
    findings,
    excluded,
    analysis,
  };
}

export function computeDocumentOverflow(
  documentScrollWidth: number,
  documentClientWidth: number,
): { hasHorizontalOverflow: boolean; overflowPx: number } {
  const overflowPx = Math.max(
    0,
    Math.round((documentScrollWidth - documentClientWidth) * 10) / 10,
  );
  return {
    hasHorizontalOverflow: overflowPx > EDGE_TOLERANCE_PX,
    overflowPx,
  };
}

export type { ViewportWidth };
