import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  getViewportLabel,
  mergeVisualConfig,
  type BaselineManifest,
  type ScanArtifactOptions,
  type ScanResult,
  type ViewportVisualComparison,
  type VisualRegressionResult,
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

function findBaselineEntry(manifest: BaselineManifest, width: number, height: number) {
  const legacy = manifest.entries.find((e) => e.width === width && e.viewportHeight === undefined);
  const exact = manifest.entries.find((e) => e.width === width && e.viewportHeight === height);
  return exact ?? legacy;
}

export async function runVisualRegression(
  result: ScanResult,
  artifactsDirectory: string,
  baselineDirectory: string,
  artifactOptions?: ScanArtifactOptions,
): Promise<VisualRegressionResult> {
  const manifest = await readBaselineManifest(baselineDirectory);
  const fileConfig = await loadVisualConfigFromBaseline(baselineDirectory);
  const config = mergeVisualConfig(
    artifactOptions?.visualConfig ?? fileConfig,
  );

  const comparisons: ViewportVisualComparison[] = [];

  for (const viewport of result.viewports) {
    const width = viewport.width;
    const height = viewport.viewportHeight;
    const label = getViewportLabel(width, height);
    if (!viewport?.screenshot || viewport.inspectionStatus === "failed" || viewport.inspectionStatus === "skipped") {
      comparisons.push({
        width,
        viewportHeight: height,
        label,
        status: "missing-baseline",
        diffPixels: 0,
        diffPixelRatio: 0,
        totalPixels: 0,
        currentScreenshot: viewportScreenshotRelativePath(width, height),
      });
      continue;
    }
    const actualRelative = viewport.screenshot;
    const actualAbs = join(artifactsDirectory, actualRelative);
    const entry = findBaselineEntry(manifest, width, height);
    const baselineAbs = entry
      ? join(baselineDirectory, entry.relativePath)
      : join(baselineDirectory, baselineScreenshotPath(width, height));

    let baselineScreenshot: string | undefined;
    let diffScreenshot: string | undefined;

    try {
      await access(baselineAbs);
      await access(actualAbs);
    } catch {
      comparisons.push({
        width,
        viewportHeight: height,
        label,
        status: "missing-baseline",
        diffPixels: 0,
        diffPixelRatio: 0,
        totalPixels: 0,
        currentScreenshot: actualRelative,
      });
      continue;
    }
    if (!entry) {
      comparisons.push({
        width,
        viewportHeight: height,
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
        height,
      );
      if (compare.diffBuffer) {
        const baselinePng = await readPngBuffer(baselineAbs);
        diffScreenshot = await writeDiffPng(
          artifactsDirectory,
          width,
          height,
          compare.diffBuffer,
          Buffer.from(baselinePng.data),
          compare.widthPx,
          compare.heightPx,
        );
      }
    }

    comparisons.push({
      width,
      viewportHeight: height,
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
