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
