import type { VisualRegressionConfig } from "./visual.js";
import { DEFAULT_STABILITY, DEFAULT_VISUAL_CONFIG } from "./visual.js";

export function mergeVisualConfig(
  partial?: VisualRegressionConfig,
): VisualRegressionConfig & {
  pixelmatchThreshold: number;
  maxDiffPixels: number;
  maxDiffPixelRatio: number;
  stability: Required<import("./visual.js").ScreenshotStabilityOptions>;
} {
  return {
    pixelmatchThreshold:
      partial?.pixelmatchThreshold ?? DEFAULT_VISUAL_CONFIG.pixelmatchThreshold,
    maxDiffPixels:
      partial?.maxDiffPixels ?? DEFAULT_VISUAL_CONFIG.maxDiffPixels,
    maxDiffPixelRatio:
      partial?.maxDiffPixelRatio ?? DEFAULT_VISUAL_CONFIG.maxDiffPixelRatio,
    masks: partial?.masks ?? [],
    stability: {
      waitAfterLoadMs:
        partial?.stability?.waitAfterLoadMs ??
        DEFAULT_STABILITY.waitAfterLoadMs,
      disableAnimations:
        partial?.stability?.disableAnimations ??
        DEFAULT_STABILITY.disableAnimations,
      reducedMotion:
        partial?.stability?.reducedMotion ?? DEFAULT_STABILITY.reducedMotion,
    },
  };
}
