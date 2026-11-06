import type { JsonReportAdvancedFinding } from "./report.js";
import { ADVANCED_CATEGORY_LABELS } from "./responsive.js";

export function advancedCategoryLabel(category: JsonReportAdvancedFinding["category"]): string {
  return ADVANCED_CATEGORY_LABELS[category];
}

export function explainAdvancedFinding(finding: JsonReportAdvancedFinding): string {
  return finding.reason;
}

export function overlayBoxForAdvanced(finding: JsonReportAdvancedFinding) {
  if (finding.visibleBox === null) return null;
  return finding.visibleBox ?? finding.boundingBox;
}

/** Explains what the screenshot can show for a Phase 8 finding; uses the same coordinate system as overflow overlays. */
export function advancedScreenshotEvidenceNote(
  finding: JsonReportAdvancedFinding,
  viewport: { width: number; viewportHeight: number },
): { shown: "none" | "partial"; text: string } | null {
  const b = finding.boundingBox;
  const actual = `Actual box: x ${b.x}, y ${b.y}, ${b.width}×${b.height}px.`;
  if (finding.invisible) {
    return { shown: "none", text: `Not visible in the screenshot: the element is invisible (visibility or opacity). ${actual}` };
  }
  if (finding.visibleBox === null) {
    const clip = finding.clipping
      ? ` It is clipped by ${finding.clipping.selector} (overflow-x: ${finding.clipping.overflowX}).`
      : "";
    if (finding.category === "offscreen-control" && finding.offscreenControl?.notVisibleInViewport) {
      return {
        shown: "none",
        text: `No painted intersection with the ${viewport.width}px viewport — often a submenu or panel hidden until opened.${clip} ${actual}`,
      };
    }
    return { shown: "none", text: `No part of it is painted inside the ${viewport.width}px viewport.${clip} ${actual}` };
  }
  const shown = overlayBoxForAdvanced(finding);
  if (shown && shown.y >= viewport.viewportHeight) {
    return {
      shown: "none",
      text: `Below the captured area: the screenshot shows only the first ${viewport.viewportHeight}px of the page. ${actual}`,
    };
  }
  if (finding.visibleBox && finding.visibleBox.width < finding.boundingBox.width - 1) {
    return {
      shown: "partial",
      text: `The outline shows only the visible part (${finding.visibleBox.width}px of ${finding.boundingBox.width}px). ${actual}`,
    };
  }
  if (finding.category === "overlap" && finding.overlap) {
    return {
      shown: "partial",
      text: `${finding.overlap.hitTestBlocked ? "Pointer hit-tests may hit the overlapping element." : "Overlap detected;"} blocker: ${finding.overlap.blockerSelector}. ${actual}`,
    };
  }
  return null;
}

export function diagnosticHintsAdvanced(finding: JsonReportAdvancedFinding): string[] {
  const hints: string[] = [finding.guidance];
  if (finding.overlap?.hitTestBlocked) {
    hints.push(
      "Pointer hit-tests at sample points on the control hit a different element — verify clicks/taps in DevTools or on a device.",
    );
  }
  if (finding.textClip?.intentional) {
    hints.push("Styles suggest intentional truncation — confirm with design before changing.");
  }
  if ((finding.selectorMatches ?? 1) > 1) {
    hints.push(`Selector matches ${finding.selectorMatches} elements — use the bounding box to identify which one.`);
  }
  hints.push("LayoutLens never modifies your CSS — inspect the selector at this viewport width.");
  return hints.filter(Boolean);
}
