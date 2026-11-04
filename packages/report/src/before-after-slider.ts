import { beforeClipWidthPercent } from "./compare-slider.js";

/** Map pointer X within the stage to divider position (0–100). */
export function dividerPercentFromPointer(
  clientX: number,
  stageRect: { left: number; width: number },
): number {
  if (stageRect.width <= 0) {
    return 50;
  }
  const ratio = (clientX - stageRect.left) / stageRect.width;
  return beforeClipWidthPercent(ratio * 100);
}

/** Clip overlay width in pixels for a divider percentage. */
export function clipWidthPx(
  stageWidthPx: number,
  dividerPercent: number,
): number {
  return (stageWidthPx * beforeClipWidthPercent(dividerPercent)) / 100;
}

export const VISUAL_COMPARISON_MODES = [
  { id: "slider", label: "Slider" },
  { id: "sideBySide", label: "Side by Side" },
  { id: "diff", label: "Diff" },
] as const;

export type VisualComparisonModeId =
  (typeof VISUAL_COMPARISON_MODES)[number]["id"];

export function defaultVisualComparisonMode(options: {
  hasDiffScreenshot: boolean;
  diffPixels: number;
}): VisualComparisonModeId {
  if (options.diffPixels > 0 && options.hasDiffScreenshot) {
    return "diff";
  }
  return "slider";
}

export const MISSING_BASELINE_MESSAGE =
  "Baseline screenshot is unavailable. Run baseline create/update and scan again with --baseline-dir.";

export const MISSING_CURRENT_MESSAGE =
  "Current screenshot is unavailable for this viewport.";

export const MISSING_DIFF_MESSAGE =
  "Diff image is unavailable. Enable visual diffs in scan artifacts or check comparison failed before diff export.";

export const SLIDER_KEYBOARD_STEP = 5;
