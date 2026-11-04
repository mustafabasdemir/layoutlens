import { readFile, writeFile, mkdir, copyFile, access } from "node:fs/promises";
import { join } from "node:path";
import {
  BASELINE_MANIFEST_VERSION,
  VIEWPORT_WIDTHS,
  getViewportLabel,
  mergeVisualConfig,
  type BaselineManifest,
  type BaselineManifestEntry,
  type VisualRegressionConfig,
  type ViewportWidth,
} from "@layoutlens/shared";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { sha256FileHex, urlKeyForBaseline } from "./hash.js";
import { masksForViewport, applyMaskRegions } from "./masks.js";
import { buildHighlightDiffRgba } from "./diff-highlight.js";

export const BASELINE_MANIFEST_FILE = "manifest.json" as const;
export const BASELINE_CONFIG_FILE = "visual.config.json" as const;
export const BASELINE_SCREENSHOTS_DIR = "screenshots" as const;
export const VISUAL_DIFF_SUBDIR = "visual" as const;

export function baselineScreenshotPath(width: number): string {
  return `${BASELINE_SCREENSHOTS_DIR}/viewport-${width}.png`;
}

export function diffScreenshotRelativePath(width: number): string {
  return `${VISUAL_DIFF_SUBDIR}/diff-viewport-${width}.png`;
}

export function reportBaselineCopyRelativePath(width: number): string {
  return `${VISUAL_DIFF_SUBDIR}/baseline-viewport-${width}.png`;
}

export async function readBaselineManifest(
  baselineDirectory: string,
): Promise<BaselineManifest> {
  const raw = await readFile(
    join(baselineDirectory, BASELINE_MANIFEST_FILE),
    "utf8",
  );
  const parsed = JSON.parse(raw) as BaselineManifest;
  if (parsed.schemaVersion !== BASELINE_MANIFEST_VERSION) {
    throw new Error(
      `Unsupported baseline manifest version: ${parsed.schemaVersion}`,
    );
  }
  return parsed;
}

export async function loadVisualConfigFromBaseline(
  baselineDirectory: string,
): Promise<VisualRegressionConfig | undefined> {
  try {
    await access(join(baselineDirectory, BASELINE_CONFIG_FILE));
  } catch {
    return undefined;
  }
  const raw = await readFile(
    join(baselineDirectory, BASELINE_CONFIG_FILE),
    "utf8",
  );
  return JSON.parse(raw) as VisualRegressionConfig;
}

export async function readPngBuffer(path: string): Promise<PNG> {
  const buffer = await readFile(path);
  return PNG.sync.read(buffer);
}

export interface CompareViewportResult {
  diffPixels: number;
  diffPixelRatio: number;
  totalPixels: number;
  passed: boolean;
  diffBuffer?: Buffer;
  widthPx: number;
  heightPx: number;
}

export async function compareScreenshotFiles(options: {
  baselinePath: string;
  actualPath: string;
  viewportWidth: ViewportWidth;
  config?: VisualRegressionConfig;
}): Promise<CompareViewportResult> {
  const config = mergeVisualConfig(options.config);
  const baseline = await readPngBuffer(options.baselinePath);
  const actual = await readPngBuffer(options.actualPath);

  const width = Math.min(baseline.width, actual.width);
  const height = Math.min(baseline.height, actual.height);
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    throw new Error(
      `Screenshot size mismatch: baseline ${baseline.width}x${baseline.height} vs actual ${actual.width}x${actual.height}`,
    );
  }

  const baselineData = Buffer.from(baseline.data);
  const actualData = Buffer.from(actual.data);
  const regions = masksForViewport(config.masks, options.viewportWidth);
  applyMaskRegions(baselineData, actualData, width, height, regions);

  const diff = Buffer.alloc(width * height * 4);
  const diffPixels = pixelmatch(
    baselineData,
    actualData,
    diff,
    width,
    height,
    { threshold: config.pixelmatchThreshold },
  );

  const totalPixels = width * height;
  const diffPixelRatio = totalPixels === 0 ? 0 : diffPixels / totalPixels;
  const passed =
    diffPixels <= config.maxDiffPixels &&
    diffPixelRatio <= config.maxDiffPixelRatio;

  return {
    diffPixels,
    diffPixelRatio,
    totalPixels,
    passed,
    diffBuffer: diff,
    widthPx: width,
    heightPx: height,
  };
}

export async function writeBaselineFromScreenshots(options: {
  baselineDirectory: string;
  url: string;
  viewportHeight: number;
  screenshotDirectory: string;
  config?: VisualRegressionConfig;
  existingManifest?: BaselineManifest;
}): Promise<BaselineManifest> {
  const now = new Date().toISOString();
  const entries: BaselineManifestEntry[] = [];

  await mkdir(join(options.baselineDirectory, BASELINE_SCREENSHOTS_DIR), {
    recursive: true,
  });

  for (const width of VIEWPORT_WIDTHS) {
    const relativePath = baselineScreenshotPath(width);
    const source = join(options.screenshotDirectory, relativePath);
    const target = join(options.baselineDirectory, relativePath);
    if (source !== target) {
      await copyFile(source, target);
    }
    const buffer = await readFile(target);
    const png = PNG.sync.read(buffer);
    entries.push({
      width,
      relativePath,
      sha256: await sha256FileHex(buffer),
      widthPx: png.width,
      heightPx: png.height,
    });
  }

  if (options.config) {
    await writeFile(
      join(options.baselineDirectory, BASELINE_CONFIG_FILE),
      `${JSON.stringify(options.config, null, 2)}\n`,
      "utf8",
    );
  }

  const manifest: BaselineManifest = {
    schemaVersion: BASELINE_MANIFEST_VERSION,
    url: options.url,
    urlKey: urlKeyForBaseline(options.url),
    viewportHeight: options.viewportHeight,
    createdAt: options.existingManifest?.createdAt ?? now,
    updatedAt: now,
    entries,
  };

  await writeFile(
    join(options.baselineDirectory, BASELINE_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return manifest;
}

export function assertSafeBaselineUpdate(
  manifest: BaselineManifest,
  url: string,
  force: boolean,
): void {
  if (force) {
    return;
  }
  const key = urlKeyForBaseline(url);
  if (manifest.urlKey !== key) {
    throw new Error(
      `Baseline URL mismatch (expected key ${manifest.urlKey}, got ${key}). Use --force to overwrite.`,
    );
  }
}

export async function writeDiffPng(
  directory: string,
  width: ViewportWidth,
  diffBuffer: Buffer,
  baselineRgba: Buffer,
  widthPx: number,
  heightPx: number,
): Promise<string> {
  await mkdir(join(directory, VISUAL_DIFF_SUBDIR), { recursive: true });
  const relativePath = diffScreenshotRelativePath(width);
  const highlight = buildHighlightDiffRgba(
    baselineRgba,
    diffBuffer,
    widthPx,
    heightPx,
  );
  const png = new PNG({ width: widthPx, height: heightPx });
  highlight.copy(png.data);
  await writeFile(join(directory, relativePath), PNG.sync.write(png));
  return relativePath;
}

export async function copyBaselineIntoReport(
  reportDirectory: string,
  baselineDirectory: string,
  width: ViewportWidth,
): Promise<string> {
  await mkdir(join(reportDirectory, VISUAL_DIFF_SUBDIR), { recursive: true });
  const relativePath = reportBaselineCopyRelativePath(width);
  await copyFile(
    join(baselineDirectory, baselineScreenshotPath(width)),
    join(reportDirectory, relativePath),
  );
  return relativePath;
}

export function viewportLabel(width: ViewportWidth): string {
  return getViewportLabel(width);
}
