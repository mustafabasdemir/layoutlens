import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  getViewportLabel,
  mergeVisualConfig,
  type ScanArtifactOptions,
  type ScanResult,
  type ViewportVisualComparison,
  type VisualRegressionResult,
  VIEWPORT_WIDTHS,
} from "@layoutlens/shared";
import {
  readPngBuffer,
  baselineScreenshotPath,
  compareScreenshotFiles,
  copyBaselineIntoReport,
  loadVisualConfigFromBaseline,
  readBaselineManifest,
  viewportScreenshotRelativePath,
  writeDiffPng,
} from "@layoutlens/visual";

export async function runVisualRegression(
  result: ScanResult,
  artifactsDirectory: string,
  baselineDirectory: string,
  artifactOptions?: ScanArtifactOptions,
): Promise<VisualRegressionResult> {
  await readBaselineManifest(baselineDirectory);
  const fileConfig = await loadVisualConfigFromBaseline(baselineDirectory);
  const config = mergeVisualConfig(
    artifactOptions?.visualConfig ?? fileConfig,
  );

  const comparisons: ViewportVisualComparison[] = [];

  for (const width of VIEWPORT_WIDTHS) {
    const label = getViewportLabel(width);
    const viewport = result.viewports.find((v) => v.width === width);
    const actualRelative =
      viewport?.screenshot ?? viewportScreenshotRelativePath(width);
    const actualAbs = join(artifactsDirectory, actualRelative);
    const baselineAbs = join(
      baselineDirectory,
      baselineScreenshotPath(width),
    );

    let baselineScreenshot: string | undefined;
    let diffScreenshot: string | undefined;

    try {
      await access(baselineAbs);
      await access(actualAbs);
    } catch {
      comparisons.push({
        width,
        label,
        status: "missing-baseline",
        diffPixels: 0,
        diffPixelRatio: 0,
        totalPixels: 0,
        currentScreenshot: actualRelative,
      });
      continue;
    }

    const compare = await compareScreenshotFiles({
      baselinePath: baselineAbs,
      actualPath: actualAbs,
      viewportWidth: width,
      config,
    });

    if (artifactOptions?.visualDiffs !== false) {
      baselineScreenshot = await copyBaselineIntoReport(
        artifactsDirectory,
        baselineDirectory,
        width,
      );
      if (compare.diffBuffer) {
        const baselinePng = await readPngBuffer(baselineAbs);
        diffScreenshot = await writeDiffPng(
          artifactsDirectory,
          width,
          compare.diffBuffer,
          Buffer.from(baselinePng.data),
          compare.widthPx,
          compare.heightPx,
        );
      }
    }

    comparisons.push({
      width,
      label,
      status: compare.passed ? "pass" : "fail",
      diffPixels: compare.diffPixels,
      diffPixelRatio: compare.diffPixelRatio,
      totalPixels: compare.totalPixels,
      currentScreenshot: actualRelative,
      ...(baselineScreenshot !== undefined ? { baselineScreenshot } : {}),
      ...(diffScreenshot !== undefined ? { diffScreenshot } : {}),
    });
  }

  const failedCount = comparisons.filter((c) => c.status !== "pass").length;
  const passedCount = comparisons.filter((c) => c.status === "pass").length;

  return {
    baselineDirectory,
    comparisons,
    passedCount,
    failedCount,
  };
}
