import { viewportArtifactBasename } from "@layoutlens/shared";

export const SCREENSHOT_SUBDIR = "screenshots" as const;
/** Alias for manifest/baseline folder name. */
export const BASELINE_SCREENSHOTS_DIR = SCREENSHOT_SUBDIR;
export const VISUAL_DIFF_SUBDIR = "visual" as const;

export function viewportScreenshotRelativePath(width: number, height: number): string {
  return `${SCREENSHOT_SUBDIR}/${viewportArtifactBasename(width, height)}`;
}

function diffBasename(width: number, height: number): string {
  return viewportArtifactBasename(width, height).replace(/^viewport-/, "diff-viewport-");
}

function baselineCopyBasename(width: number, height: number): string {
  return viewportArtifactBasename(width, height).replace(/^viewport-/, "baseline-viewport-");
}

export function diffScreenshotRelativePath(width: number, height: number): string {
  return `${VISUAL_DIFF_SUBDIR}/${diffBasename(width, height)}`;
}

export function reportBaselineCopyRelativePath(width: number, height: number): string {
  return `${VISUAL_DIFF_SUBDIR}/${baselineCopyBasename(width, height)}`;
}

export function baselineScreenshotPath(width: number, height: number): string {
  return `${SCREENSHOT_SUBDIR}/${viewportArtifactBasename(width, height)}`;
}
