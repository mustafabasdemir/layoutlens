import {
  mapBoxToScreenshot,
  overlayBoxFor,
  overlayBoxForAdvanced,
  type JsonReportViewport,
  type OverlayMapping,
} from "@layoutlens/shared";
import type { WorkspaceFindingRef } from "../../lib/workspace-findings";

export function overlayForWorkspace(
  ref: WorkspaceFindingRef,
  viewport: JsonReportViewport,
  natural: { naturalWidth: number; naturalHeight: number },
): OverlayMapping {
  if (ref.kind === "overflow") {
    const box = overlayBoxFor(ref.finding);
    if (!box) {
      return {
        status: "outside",
        reason: `No part of this element is painted inside the ${viewport.width}px viewport, so the screenshot cannot show it.`,
      };
    }
    return mapBoxToScreenshot(box, viewport, natural);
  }
  const box = overlayBoxForAdvanced(ref.finding);
  if (!box) {
    return {
      status: "outside",
      reason: `No part of this element is painted inside the ${viewport.width}px viewport, so the screenshot cannot highlight it.`,
    };
  }
  return mapBoxToScreenshot(box, viewport, natural);
}
