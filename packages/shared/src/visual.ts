import type { ViewportWidth } from "./index.js";

export const BASELINE_MANIFEST_VERSION = "1.0" as const;

export interface VisualMaskRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualViewportMask {
  /** Apply to one viewport or `"all"`. */
  viewport: ViewportWidth | "all";
  regions: VisualMaskRegion[];
}

export interface ScreenshotStabilityOptions {
  waitAfterLoadMs?: number;
  disableAnimations?: boolean;
  reducedMotion?: boolean;
}

export interface VisualRegressionConfig {
  /** Pixelmatch color threshold (0–1). Default 0.1 */
  pixelmatchThreshold?: number;
  maxDiffPixels?: number;
  /** Max differing pixel ratio (0–1). Default 0.002 */
  maxDiffPixelRatio?: number;
  masks?: VisualViewportMask[];
  stability?: ScreenshotStabilityOptions;
}

export type VisualComparisonStatus = "pass" | "fail" | "missing-baseline";

export interface ViewportVisualComparison {
  width: ViewportWidth;
  /** Phase 10 — height for disambiguation when widths repeat. */
  viewportHeight?: number;
  label: string;
  status: VisualComparisonStatus;
  diffPixels: number;
  diffPixelRatio: number;
  totalPixels: number;
  /** Relative paths inside a report/baseline bundle. */
  baselineScreenshot?: string;
  currentScreenshot?: string;
  diffScreenshot?: string;
}

export interface VisualRegressionResult {
  baselineDirectory: string;
  comparisons: ViewportVisualComparison[];
  passedCount: number;
  failedCount: number;
}

export interface BaselineManifestEntry {
  width: ViewportWidth;
  /** Phase 10 — logical viewport height when dimensions are explicit. */
  viewportHeight?: number;
  relativePath: string;
  sha256: string;
  widthPx: number;
  heightPx: number;
}

export interface BaselineManifest {
  schemaVersion: typeof BASELINE_MANIFEST_VERSION;
  url: string;
  urlKey: string;
  viewportHeight: number;
  /** Phase 10 — when set, baseline screenshots use explicit width×height paths. */
  viewportDimensions?: readonly { width: number; height: number }[];
  createdAt: string;
  updatedAt: string;
  entries: BaselineManifestEntry[];
}

export const DEFAULT_VISUAL_CONFIG: Required<
  Pick<
    VisualRegressionConfig,
    "pixelmatchThreshold" | "maxDiffPixels" | "maxDiffPixelRatio"
  >
> = {
  pixelmatchThreshold: 0.1,
  maxDiffPixels: 500,
  maxDiffPixelRatio: 0.002,
};

export const DEFAULT_STABILITY: Required<ScreenshotStabilityOptions> = {
  waitAfterLoadMs: 250,
  disableAnimations: true,
  reducedMotion: true,
};
