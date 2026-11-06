import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { formatVisualDiffStats } from "./compare-slider.js";
import { buildHtmlReportDocument } from "./build-html.js";
import type { JsonReport } from "@layoutlens/shared";

async function writeSolidPng(
  path: string,
  width: number,
  height: number,
  rgba: [number, number, number, number],
): Promise<void> {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
  await writeFile(path, PNG.sync.write(png));
}

function reportWithVisual(options: {
  baselinePath: string;
  currentPath: string;
  diffPath: string;
  diffPixels: number;
  diffPixelRatio: number;
}): JsonReport {
  return {
      schemaVersion: "1.3",
    tool: "layoutlens",
    url: "https://visual-views.test/",
    scannedAt: "2026-01-01T00:00:00.000Z",
    summary: {
      viewportIssueCount: 0,
      findingCount: 0,
      bySeverity: { high: 0, medium: 0, low: 0 },
      visualFailures: 1,
    },
    viewports: [
      {
        width: 390,
        label: "mobile",
        viewportHeight: 844,
        documentScrollWidth: 390,
        documentClientWidth: 390,
        hasHorizontalOverflow: false,
        overflowPx: 0,
        screenshot: options.currentPath,
        visualCompare: {
          status: "fail",
          diffPixels: options.diffPixels,
          diffPixelRatio: options.diffPixelRatio,
          baselineScreenshot: options.baselinePath,
          diffScreenshot: options.diffPath,
        },
        findings: [],
      },
    ],
  };
}

describe("visual comparison modes (Chromium)", () => {
  it(
    "switches slider, side by side, and diff modes with correct image sources",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "layoutlens-views-"));
      await mkdir(join(dir, "screenshots"), { recursive: true });
      await mkdir(join(dir, "visual"), { recursive: true });
      const currentPath = "screenshots/viewport-390.png";
      const baselinePath = "visual/baseline-viewport-390.png";
      const diffPath = "visual/diff-viewport-390.png";
      await writeSolidPng(join(dir, currentPath), 390, 844, [40, 120, 200, 255]);
      await writeSolidPng(join(dir, baselinePath), 390, 844, [200, 80, 40, 255]);
      await writeSolidPng(join(dir, diffPath), 390, 844, [255, 0, 180, 255]);

      const diffPixels = 500;
      const diffPixelRatio = 500 / (390 * 844);
      const html = buildHtmlReportDocument(
        reportWithVisual({
          baselinePath,
          currentPath,
          diffPath,
          diffPixels,
          diffPixelRatio,
        }),
      );
      await writeFile(join(dir, "index.html"), html, "utf8");

      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
      await page.goto(pathToFileURL(join(dir, "index.html")).href);

      await page.waitForSelector(".visual-view-diff.active");
      const stats = await page.locator(".visual-stats").textContent();
      expect(stats).toContain(formatVisualDiffStats(diffPixels, diffPixelRatio));

      await page.locator('button[data-visual-mode="slider"]').click();
      await page.waitForSelector(".visual-view-slider.active");
      expect(
        await page.locator(".visual-view-slider.active .compare-after").getAttribute("src"),
      ).toBe(currentPath);
      expect(
        await page.locator(".visual-view-slider.active .compare-before").getAttribute("src"),
      ).toBe(baselinePath);

      await page.locator('button[data-visual-mode="sideBySide"]').click();
      await page.waitForSelector(".visual-view-side-by-side.active");
      const sideSrcs = await page
        .locator(".visual-view-side-by-side.active img")
        .evaluateAll((els) => els.map((e) => e.getAttribute("src")));
      expect(sideSrcs).toEqual(expect.arrayContaining([baselinePath, currentPath]));

      await page.locator('button[data-visual-mode="diff"]').click();
      await page.waitForSelector(".visual-view-diff.active");
      expect(await page.locator(".visual-view-diff.active img").getAttribute("src")).toBe(
        diffPath,
      );

      await browser.close();
    },
    60_000,
  );
});
