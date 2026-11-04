import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ScanOptions, VisualRegressionConfig } from "@layoutlens/shared";
import {
  assertSafeBaselineUpdate,
  readBaselineManifest,
  writeBaselineFromScreenshots,
  BASELINE_MANIFEST_FILE,
} from "@layoutlens/visual";
import type { BaselineManifest } from "@layoutlens/shared";
import { scanUrl } from "./scan.js";

export interface BaselineCommandOptions {
  url: string;
  baselineDirectory: string;
  viewportHeight?: number;
  headless?: boolean;
  visualConfig?: VisualRegressionConfig;
  force?: boolean;
}

export async function createBaseline(
  options: BaselineCommandOptions,
): Promise<BaselineManifest> {
  await mkdir(options.baselineDirectory, { recursive: true });
  await scanUrl(buildScanOptions(options));
  return writeBaselineFromScreenshots({
    baselineDirectory: options.baselineDirectory,
    url: options.url,
    viewportHeight: options.viewportHeight ?? 844,
    screenshotDirectory: options.baselineDirectory,
    ...(options.visualConfig !== undefined
      ? { config: options.visualConfig }
      : {}),
  });
}

export async function updateBaseline(
  options: BaselineCommandOptions,
): Promise<BaselineManifest> {
  await mkdir(options.baselineDirectory, { recursive: true });
  const manifestPath = join(
    options.baselineDirectory,
    BASELINE_MANIFEST_FILE,
  );
  let existing: BaselineManifest | undefined;
  try {
    await access(manifestPath);
    existing = await readBaselineManifest(options.baselineDirectory);
    assertSafeBaselineUpdate(existing, options.url, options.force ?? false);
  } catch (error) {
    if (!options.force) {
      const message =
        error instanceof Error ? error.message : "Baseline manifest missing";
      throw new Error(
        `${message}. Use \`baseline create\` first or pass --force.`,
      );
    }
  }

  await scanUrl(buildScanOptions(options));
  return writeBaselineFromScreenshots({
    baselineDirectory: options.baselineDirectory,
    url: options.url,
    viewportHeight: options.viewportHeight ?? 844,
    screenshotDirectory: options.baselineDirectory,
    ...(options.visualConfig !== undefined
      ? { config: options.visualConfig }
      : {}),
    ...(existing !== undefined ? { existingManifest: existing } : {}),
  });
}

function buildScanOptions(options: BaselineCommandOptions): ScanOptions {
  const scan: ScanOptions = {
    url: options.url,
    artifacts: { directory: options.baselineDirectory },
  };
  if (options.viewportHeight !== undefined) {
    scan.viewportHeight = options.viewportHeight;
  }
  if (options.headless !== undefined) {
    scan.headless = options.headless;
  }
  if (options.visualConfig !== undefined) {
    scan.visualConfig = options.visualConfig;
  }
  return scan;
}

export type { BaselineManifest };
