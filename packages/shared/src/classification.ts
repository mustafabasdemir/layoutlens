import type { FindingSeverity } from "./severity.js";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How much evidence backs a finding.
 * - confirmed: the page measurably scrolls horizontally and this element's unclipped box is past the edge.
 * - potential: content is visibly cut off at the viewport edge but does not create a horizontal scrollbar.
 * - insufficient-evidence: geometry says the element is past the edge, but the document measurements do not agree.
 */
export type FindingClassification = "confirmed" | "potential" | "insufficient-evidence";

export const FINDING_CLASSIFICATIONS: readonly FindingClassification[] = [
  "confirmed",
  "potential",
  "insufficient-evidence",
] as const;

export const CLASSIFICATION_LABELS: Record<FindingClassification, string> = {
  confirmed: "Confirmed",
  potential: "Potential",
  "insufficient-evidence": "Insufficient evidence",
};

/** Why an element past the viewport edge was not reported as an issue. */
export type ExclusionReason =
  | "clipped-by-ancestor"
  | "inside-scroll-container"
  | "offscreen"
  | "hidden";

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  "clipped-by-ancestor": "Clipped by an ancestor",
  "inside-scroll-container": "Inside a scroll container",
  offscreen: "Positioned offscreen",
  hidden: "Hidden",
};

/** The ancestor whose overflow clipping cuts an element horizontally. */
export interface ClippingContext {
  selector: string;
  /** Elements the selector matches in the page; more than 1 means it is ambiguous. */
  selectorMatches?: number;
  tagName: string;
  /** Computed overflow-x (or "contain"/"clip-path" when those clip instead). */
  overflowX: string;
  kind: "clip" | "scroll";
  boundingBox: Box;
}

export interface RelatedElement {
  selector: string;
  tagName: string;
  boundingBox: Box;
  /** Pixels past the viewport edge before any clipping. */
  documentContributionPx: number;
}

export interface ExcludedFinding {
  reason: ExclusionReason;
  explanation: string;
  /** The responsible container: the clipping ancestor, or the outermost excluded element. */
  selector: string;
  tagName: string;
  boundingBox: Box;
  clipping?: ClippingContext;
  /** Elements past the viewport edge that share this reason and container. */
  elementCount: number;
  samples: RelatedElement[];
}

export interface ViewportAnalysis {
  /** Elements with a layout box that were measured. */
  elementsInspected: number;
  /** Elements whose box or content crossed a viewport edge. */
  candidateCount: number;
  candidateLimit: number;
  candidatesOmitted: number;
  /** Effective overflow-x of the viewport after html/body propagation. */
  rootOverflowX: string;
  /** Whether a user can scroll the page horizontally at this width. */
  userScrollable: boolean;
  /** Document overflow that a root overflow-x: hidden/clip hides from the user. */
  maskedOverflowPx: number;
  /** Document overflow that no measured element explains. */
  unattributedOverflowPx: number;
  findingLimit: number;
  findingsOmitted: number;
  excludedLimit: number;
  excludedOmitted: number;
  relatedLimit: number;
}

export interface ClassificationCounts {
  confirmed: number;
  potential: number;
  insufficientEvidence: number;
}

export function emptyClassificationCounts(): ClassificationCounts {
  return { confirmed: 0, potential: 0, insufficientEvidence: 0 };
}

export function countClassifications(
  items: readonly { classification?: FindingClassification | undefined }[],
): ClassificationCounts {
  const counts = emptyClassificationCounts();
  for (const item of items) {
    if (item.classification === "confirmed") counts.confirmed += 1;
    else if (item.classification === "potential") counts.potential += 1;
    else if (item.classification === "insufficient-evidence") counts.insufficientEvidence += 1;
  }
  return counts;
}

/** Severity is only as strong as the evidence behind it. */
export function capSeverity(
  classification: FindingClassification,
  severity: FindingSeverity,
): FindingSeverity {
  if (classification === "confirmed") return severity;
  if (classification === "potential") return severity === "high" ? "medium" : severity;
  return "low";
}
