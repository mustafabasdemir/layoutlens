export interface ScreenshotDimensions {
  width: number;
  height: number;
}

export type DimensionCheckResult =
  | { ok: true }
  | { ok: false; message: string };

/** Reject mismatched PNGs instead of scaling them in the UI. */
export function assertScreenshotDimensionsMatch(
  baseline: ScreenshotDimensions,
  current: ScreenshotDimensions,
): DimensionCheckResult {
  if (
    !Number.isFinite(baseline.width) ||
    !Number.isFinite(baseline.height) ||
    !Number.isFinite(current.width) ||
    !Number.isFinite(current.height) ||
    baseline.width <= 0 ||
    baseline.height <= 0 ||
    current.width <= 0 ||
    current.height <= 0
  ) {
    return { ok: false, message: "Invalid screenshot dimensions." };
  }

  if (
    baseline.width !== current.width ||
    baseline.height !== current.height
  ) {
    return {
      ok: false,
      message:
        `Incompatible screenshot sizes: baseline ${baseline.width}×${baseline.height}px vs current ${current.width}×${current.height}px. ` +
        "Recreate the baseline with the same viewport width and height, or run baseline update after changing scan settings.",
    };
  }

  return { ok: true };
}

/** Slider value (0–100) → width of the baseline clip overlay. */
export function beforeClipWidthPercent(sliderValue: number): number {
  return Math.min(100, Math.max(0, sliderValue));
}

/** Expected rendered box size when both layers use the same object-fit in a fixed frame. */
export function expectedAlignedLayerRects(frame: {
  left: number;
  top: number;
  width: number;
  height: number;
}): { after: typeof frame; before: typeof frame } {
  return {
    after: { ...frame },
    before: { ...frame },
  };
}

export function layersAlignedWithinTolerance(
  afterRect: { left: number; top: number; width: number; height: number },
  beforeRect: { left: number; top: number; width: number; height: number },
  tolerancePx = 1,
): boolean {
  return (
    Math.abs(afterRect.left - beforeRect.left) <= tolerancePx &&
    Math.abs(afterRect.top - beforeRect.top) <= tolerancePx &&
    Math.abs(afterRect.width - beforeRect.width) <= tolerancePx &&
    Math.abs(afterRect.height - beforeRect.height) <= tolerancePx
  );
}

export const COMPARE_SLIDER_HELP =
  "Drag the slider to compare the previous and current screenshots.";

export const COMPARE_SLIDER_IDENTICAL_HINT =
  "Baseline and current screenshots match — the slider split will look the same on both sides. Use Difference mode or scan a changed page to see highlights.";

export const VISUAL_DIFF_EXPLANATION =
  "Pixel differences are areas where the current screenshot does not match the baseline. Magenta highlights mark changed pixels; dimmed areas still match the baseline.";

export const VISUAL_DIFF_NOT_LAYOUT_COUNT =
  "Visual pixel counts measure screenshot change only — they are not the same as layout overflow findings or a bug count.";

/** Human-readable diff stats for the report (not a layout bug count). */
export function formatVisualDiffStats(
  diffPixels: number,
  diffPixelRatio: number,
): string {
  const pct = (diffPixelRatio * 100).toFixed(2);
  return `${diffPixels.toLocaleString("en-US")} pixels changed (${pct}% of image)`;
}

export const VISUAL_VIEW_MODES = [
  { id: "slider", label: "Slider" },
  { id: "sideBySide", label: "Side by Side" },
  { id: "diff", label: "Diff" },
] as const;

export type VisualViewModeId = (typeof VISUAL_VIEW_MODES)[number]["id"];

export function defaultVisualViewMode(options: {
  diffPixels: number;
  hasDiffScreenshot: boolean;
}): VisualViewModeId {
  if (options.diffPixels > 0 && options.hasDiffScreenshot) {
    return "diff";
  }
  return "slider";
}
