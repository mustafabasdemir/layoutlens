import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { layersAlignedWithinTolerance } from "./compare-slider.js";
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

function minimalReport(options: {
  baselinePath: string;
  currentPath: string;
}): JsonReport {
  return {
      schemaVersion: "1.3",
    tool: "layoutlens",
    url: "https://compare.test/",
    scannedAt: "2026-01-01T00:00:00.000Z",
    summary: {
      viewportIssueCount: 0,
      findingCount: 0,
      bySeverity: { high: 0, medium: 0, low: 0 },
      visualFailures: 0,
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
          status: "pass",
          diffPixels: 0,
          diffPixelRatio: 0,
          baselineScreenshot: options.baselinePath,
        },
        findings: [],
      },
    ],
  };
}

describe("compare slider UI (Chromium)", () => {
  it(
    "keeps baseline and current layers aligned at 0/25/50/75/100% clip",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "layoutlens-compare-ui-"));
      await mkdir(join(dir, "screenshots"), { recursive: true });
      await mkdir(join(dir, "visual"), { recursive: true });
      const currentPath = "screenshots/viewport-390.png";
      const baselinePath = "visual/baseline-viewport-390.png";
      await writeSolidPng(join(dir, currentPath), 390, 844, [40, 120, 200, 255]);
      await writeSolidPng(join(dir, baselinePath), 390, 844, [200, 80, 40, 255]);

      const html = buildHtmlReportDocument(
        minimalReport({ baselinePath, currentPath }),
      );
      await writeFile(join(dir, "index.html"), html, "utf8");

      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 800, height: 1200 } });
      await page.goto(pathToFileURL(join(dir, "index.html")).href);
      await page.locator('button[data-visual-mode="slider"]').click();
      await page.waitForSelector(".visual-view-slider.active .compare-frame");

      for (const value of [0, 25, 50, 75, 100]) {
        await page.locator(".visual-view-slider.active input.ba-range-sync").evaluate(
          (el, v) => {
            const input = el as HTMLInputElement;
            input.value = String(v);
            input.dispatchEvent(new Event("input", { bubbles: true }));
          },
          value,
        );
        const rects = await page.evaluate(() => {
          const after = document.querySelector(
            ".visual-view-slider.active .compare-after",
          );
          const before = document.querySelector(
            ".visual-view-slider.active .compare-before",
          );
          if (!after || !before) return null;
          const ar = after.getBoundingClientRect();
          const br = before.getBoundingClientRect();
          return {
            after: {
              left: ar.left,
              top: ar.top,
              width: ar.width,
              height: ar.height,
            },
            before: {
              left: br.left,
              top: br.top,
              width: br.width,
              height: br.height,
            },
          };
        });
        expect(rects).not.toBeNull();
        expect(
          layersAlignedWithinTolerance(rects!.after, rects!.before, 1),
        ).toBe(true);
      }

      await browser.close();
    },
    60_000,
  );

  it(
    "shows incompatibility error for mismatched screenshot dimensions",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "layoutlens-compare-ui-"));
      await mkdir(join(dir, "screenshots"), { recursive: true });
      await mkdir(join(dir, "visual"), { recursive: true });
      const currentPath = "screenshots/viewport-390.png";
      const baselinePath = "visual/baseline-viewport-390.png";
      await writeSolidPng(join(dir, currentPath), 390, 844, [10, 10, 10, 255]);
      await writeSolidPng(join(dir, baselinePath), 390, 800, [20, 20, 20, 255]);

      const html = buildHtmlReportDocument(
        minimalReport({ baselinePath, currentPath }),
      );
      await writeFile(join(dir, "index.html"), html, "utf8");

      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(pathToFileURL(join(dir, "index.html")).href);
      await page.waitForSelector(".visual-panel > .compare-error:not([hidden])");
      const message = await page.locator(".visual-panel > .compare-error").textContent();
      expect(message).toContain("Incompatible screenshot sizes");
      await browser.close();
    },
    60_000,
  );
});
