export {
  baselineScreenshotPath,
  diffScreenshotRelativePath,
  reportBaselineCopyRelativePath,
  BASELINE_MANIFEST_FILE,
  BASELINE_CONFIG_FILE,
  compareScreenshotFiles,
  readBaselineManifest,
  writeBaselineFromScreenshots,
  assertSafeBaselineUpdate,
  loadVisualConfigFromBaseline,
  writeDiffPng,
  copyBaselineIntoReport,
} from "./manifest.js";
export { stabilizePageForScreenshot } from "./stability.js";
export { masksForViewport, applyMaskRegions } from "./masks.js";
export { buildHighlightDiffRgba, isPixelmatchDiffPixel } from "./diff-highlight.js";
export { readPngBuffer } from "./manifest.js";
export { normalizeUrlForBaseline, urlKeyForBaseline } from "./hash.js";
export {
  SCREENSHOT_SUBDIR,
  viewportScreenshotRelativePath,
} from "./paths.js";
