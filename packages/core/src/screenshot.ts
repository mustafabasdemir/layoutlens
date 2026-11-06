import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import type { ScreenshotStabilityOptions } from "@layoutlens/shared";
import { stabilizePageForScreenshot, viewportScreenshotRelativePath } from "@layoutlens/visual";

export const SCREENSHOT_SUBDIR = "screenshots" as const;

export { viewportScreenshotRelativePath };

export async function captureViewportScreenshot(
  page: Page,
  artifactsDirectory: string,
  width: number,
  stability?: ScreenshotStabilityOptions,
  options?: { skipStabilize?: boolean; timeoutMs?: number },
): Promise<string> {
  if (!options?.skipStabilize) {
    await stabilizePageForScreenshot(page, stability);
  }
  const screenshotsDir = join(artifactsDirectory, SCREENSHOT_SUBDIR);
  await mkdir(screenshotsDir, { recursive: true });
  const relativePath = viewportScreenshotRelativePath(width);
  await page.screenshot({
    path: join(artifactsDirectory, relativePath),
    type: "png",
    fullPage: false,
    animations: "disabled",
    ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
  });
  return relativePath;
}
