import type { JsonReportBoundingBox, JsonReportFinding } from "./report.js";

export type FindingKind = "extends-viewport" | "internal-overflow";

export const FINDING_KIND_LABELS: Record<FindingKind, string> = {
  "extends-viewport": "Extends past viewport",
  "internal-overflow": "Internal scroll overflow",
};

/** Kinds derived strictly from measured values in the report. */
export function findingKinds(finding: JsonReportFinding): FindingKind[] {
  const kinds: FindingKind[] = [];
  if (finding.documentContributionPx > 0) kinds.push("extends-viewport");
  if (finding.overflowPx > 0) kinds.push("internal-overflow");
  return kinds;
}

export function primaryFindingKind(finding: JsonReportFinding): FindingKind {
  return findingKinds(finding)[0] ?? "extends-viewport";
}

/** One-sentence explanation built from the finding's measurements. */
export function explainFinding(
  finding: JsonReportFinding,
  viewportWidth: number,
): string {
  if (finding.reason) return finding.reason;
  const parts: string[] = [];
  if (finding.documentContributionPx > 0) {
    parts.push(
      `This <${finding.tagName}> pushes the page ${finding.documentContributionPx}px past the ${viewportWidth}px viewport.`,
    );
  }
  if (finding.overflowPx > 0) {
    parts.push(
      `Its content is ${finding.scrollWidth}px wide inside a ${finding.clientWidth}px box (${finding.overflowPx}px internal overflow).`,
    );
  }
  if (parts.length === 0) {
    parts.push(`This <${finding.tagName}> was reported as an overflow contributor.`);
  }
  return parts.join(" ");
}

/**
 * The box to outline on the viewport screenshot: the painted part when known,
 * null when nothing of the element is painted in the viewport. Legacy reports fall back to the raw box.
 */
export function overlayBoxFor(finding: JsonReportFinding): JsonReportBoundingBox | null {
  if (finding.visibleBox === null) return null;
  return finding.visibleBox ?? finding.boundingBox;
}

/** Explains what the screenshot can and cannot prove for this finding; null when it shows the element fully. */
export function screenshotEvidenceNote(
  finding: JsonReportFinding,
  viewport: { width: number; viewportHeight: number },
): { shown: "none" | "partial"; text: string } | null {
  const b = finding.boundingBox;
  const actual = `Actual box: x ${b.x}, y ${b.y}, ${b.width}×${b.height}px.`;
  if (finding.invisible) {
    return { shown: "none", text: `Not visible in the screenshot: the element is invisible (visibility or opacity) but still takes up layout space. ${actual}` };
  }
  if (finding.visibleBox === null) {
    const clip = finding.clipping ? ` It is clipped by ${finding.clipping.selector} (overflow-x: ${finding.clipping.overflowX}).` : "";
    return { shown: "none", text: `Not visible in the screenshot: no part of it is painted inside the ${viewport.width}px viewport.${clip} ${actual}` };
  }
  const box = overlayBoxFor(finding);
  if (box && box.y >= viewport.viewportHeight) {
    return { shown: "none", text: `Below the visible viewport, outside the captured screenshot area: the screenshot shows only the first ${viewport.viewportHeight}px of the page. ${actual}` };
  }
  if (finding.visibleBox && finding.visibleBox.width < b.width - 1) {
    return {
      shown: "partial",
      text: `The outline shows only the visible part (${finding.visibleBox.width}px of ${b.width}px); the rest lies past the viewport edge and is not in the screenshot. ${actual}`,
    };
  }
  return null;
}

/** Diagnostic hints to investigate. LayoutLens never changes the page's CSS. */
export function diagnosticHints(
  finding: JsonReportFinding,
  viewportWidth: number,
): string[] {
  const hints: string[] = [];
  if (finding.pattern === "horizontal-track") {
    hints.push(
      "Its children sit in one row like a carousel track — if that is intended, give the carousel viewport overflow: hidden (or a scroll container); otherwise allow the row to wrap.",
    );
  }
  if (finding.invisible) {
    hints.push("The element is invisible but still occupies layout space — check visibility: hidden / opacity: 0 elements that should be display: none or sized to the viewport.");
  }
  if (finding.boundingBox.width > viewportWidth) {
    hints.push(
      `The element box is ${Math.round(finding.boundingBox.width)}px wide at a ${viewportWidth}px viewport — look for a fixed width or min-width.`,
    );
  }
  if (finding.overflowPx > 0) {
    hints.push(
      "Content is wider than its container — check long unbroken strings, white-space: nowrap, or wide children.",
    );
  }
  if (finding.boundingBox.x + finding.boundingBox.width > viewportWidth && finding.boundingBox.width <= viewportWidth) {
    hints.push(
      "The element starts too far right for its width — check margins, transforms, or absolute positioning.",
    );
  }
  if ((finding.selectorMatches ?? 1) > 1) {
    hints.push(`This selector matches ${finding.selectorMatches} elements (for example duplicate ids) — use the bounding box to tell them apart.`);
  }
  hints.push("Inspect the selector in browser DevTools at this viewport width to confirm the cause.");
  return hints;
}
