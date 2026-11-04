import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import {
  MISSING_BASELINE_MESSAGE,
  clipWidthPx,
} from "./before-after-slider.js";
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

function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function distinctVisualReport(options: {
  baselinePath: string;
  currentPath: string;
  diffPath?: string;
}): JsonReport {
  return {
    schemaVersion: "1.0",
    tool: "layoutlens",
    url: "https://before-after.test/",
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
          diffPixels: 100_000,
          diffPixelRatio: 0.3,
          baselineScreenshot: options.baselinePath,
          ...(options.diffPath ? { diffScreenshot: options.diffPath } : {}),
        },
        findings: [],
      },
    ],
  };
}

async function openReportPage(
  report: JsonReport,
  pngSetup: (dir: string) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "layoutlens-ba-"));
  await mkdir(join(dir, "screenshots"), { recursive: true });
  await mkdir(join(dir, "visual"), { recursive: true });
  await pngSetup(dir);
  const html = buildHtmlReportDocument(report);
  await writeFile(join(dir, "index.html"), html, "utf8");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  await page.goto(pathToFileURL(join(dir, "index.html")).href);
  return { page, browser, dir };
}

describe("Before/After slider (Chromium)", () => {
  it(
    "updates clip width at 0%, 50%, and 100% and changes visible frame screenshot",
    async () => {
      const baselinePath = "visual/baseline-viewport-390.png";
      const currentPath = "screenshots/viewport-390.png";
      const report = distinctVisualReport({ baselinePath, currentPath });

      const { page, browser } = await openReportPage(report, async (dir) => {
        await writeSolidPng(join(dir, baselinePath), 390, 844, [200, 60, 40, 255]);
        await writeSolidPng(join(dir, currentPath), 390, 844, [40, 120, 220, 255]);
      });

      await page.locator('button[data-visual-mode="slider"]').click();
      await page.waitForSelector(".visual-view-slider.active .ba-slider-stage");

      const frame = page.locator(".visual-view-slider.active .compare-frame");
      await frame.waitFor({ state: "visible" });

      async function clipMetrics() {
        return page.evaluate(() => {
          const stage = document.querySelector(
            ".visual-view-slider.active .compare-frame",
          );
          const clip = document.querySelector(
            ".visual-view-slider.active .compare-before-clip",
          );
          const range = document.querySelector(
            ".visual-view-slider.active input.ba-range-sync",
          ) as HTMLInputElement | null;
          if (!stage || !clip || !range) return null;
          return {
            stageWidth: stage.clientWidth,
            clipWidth: clip.clientWidth,
            rangeValue: Number(range.value),
          };
        });
      }

      const hashes: string[] = [];
      for (const value of [0, 50, 100]) {
        await page.locator(".visual-view-slider.active input.ba-range-sync").evaluate(
          (el, v) => {
            const input = el as HTMLInputElement;
            input.value = String(v);
            input.dispatchEvent(new Event("input", { bubbles: true }));
          },
          value,
        );
        const metrics = await clipMetrics();
        expect(metrics).not.toBeNull();
        expect(metrics!.stageWidth).toBeGreaterThan(100);
        const expectedClip = clipWidthPx(metrics!.stageWidth, value);
        expect(Math.abs(metrics!.clipWidth - expectedClip)).toBeLessThanOrEqual(5);
        const png = await frame.screenshot();
        hashes.push(hashBuffer(png));
      }

      expect(hashes[0]).not.toBe(hashes[2]);
      expect(new Set(hashes).size).toBeGreaterThan(1);

      await browser.close();
    },
    60_000,
  );

  it(
    "keeps baseline and current layers aligned while dragging divider",
    async () => {
      const baselinePath = "visual/baseline-viewport-390.png";
      const currentPath = "screenshots/viewport-390.png";
      const report = distinctVisualReport({ baselinePath, currentPath });
      const { page, browser } = await openReportPage(report, async (dir) => {
        await writeSolidPng(join(dir, baselinePath), 390, 844, [180, 40, 40, 255]);
        await writeSolidPng(join(dir, currentPath), 390, 844, [40, 180, 40, 255]);
      });

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
            after: { left: ar.left, top: ar.top, width: ar.width, height: ar.height },
            before: { left: br.left, top: br.top, width: br.width, height: br.height },
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

  it("supports keyboard divider adjustment", async () => {
    const baselinePath = "visual/baseline-viewport-390.png";
    const currentPath = "screenshots/viewport-390.png";
    const report = distinctVisualReport({ baselinePath, currentPath });
    const { page, browser } = await openReportPage(report, async (dir) => {
      await writeSolidPng(join(dir, baselinePath), 390, 844, [10, 10, 10, 255]);
      await writeSolidPng(join(dir, currentPath), 390, 844, [240, 240, 240, 255]);
    });

    await page.locator('button[data-visual-mode="slider"]').click();
    await page.locator(".visual-view-slider.active .ba-slider-stage").focus();
    const before = await page.locator(".visual-view-slider.active input.ba-range-sync").inputValue();
    await page.keyboard.press("ArrowRight");
    const after = await page.locator(".visual-view-slider.active input.ba-range-sync").inputValue();
    expect(Number(after)).toBeGreaterThan(Number(before));

    await browser.close();
  });

  it("supports pointer drag on divider handle", async () => {
    const baselinePath = "visual/baseline-viewport-390.png";
    const currentPath = "screenshots/viewport-390.png";
    const report = distinctVisualReport({ baselinePath, currentPath });
    const { page, browser } = await openReportPage(report, async (dir) => {
      await writeSolidPng(join(dir, baselinePath), 390, 844, [255, 0, 0, 255]);
      await writeSolidPng(join(dir, currentPath), 390, 844, [0, 0, 255, 255]);
    });

    await page.locator('button[data-visual-mode="slider"]').click();
    await page.waitForSelector(".visual-view-slider.active .ba-slider-stage");
    const stage = page.locator(".visual-view-slider.active .ba-slider-stage");
    const stageBox = await stage.boundingBox();
    expect(stageBox).not.toBeNull();
    await stage.click({
      position: { x: stageBox!.width * 0.85, y: stageBox!.height / 2 },
    });

    const value = Number(
      await page.locator(".visual-view-slider.active input.ba-range-sync").inputValue(),
    );
    expect(value).toBeGreaterThan(70);

    await browser.close();
  });

  it("supports touch pointer on comparison stage", async () => {
    const baselinePath = "visual/baseline-viewport-390.png";
    const currentPath = "screenshots/viewport-390.png";
    const report = distinctVisualReport({ baselinePath, currentPath });
    const dir = await mkdtemp(join(tmpdir(), "layoutlens-ba-touch-"));
    await mkdir(join(dir, "screenshots"), { recursive: true });
    await mkdir(join(dir, "visual"), { recursive: true });
    await writeSolidPng(join(dir, baselinePath), 390, 844, [255, 0, 0, 255]);
    await writeSolidPng(join(dir, currentPath), 390, 844, [0, 0, 255, 255]);
    await writeFile(join(dir, "index.html"), buildHtmlReportDocument(report), "utf8");

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 900, height: 1200 } });
    const page = await context.newPage();
    await page.goto(pathToFileURL(join(dir, "index.html")).href);
    await page.locator('button[data-visual-mode="slider"]').click();
    await page.waitForSelector(".visual-view-slider.active .ba-slider-stage");
    const stage = page.locator(".visual-view-slider.active .ba-slider-stage");
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    await stage.tap({ position: { x: box!.width * 0.2, y: box!.height / 2 } });
    const value = Number(
      await page.locator(".visual-view-slider.active input.ba-range-sync").inputValue(),
    );
    expect(value).toBeLessThan(30);
    await browser.close();
  });

  it("shows side by side and diff modes with correct assets", async () => {
    const baselinePath = "visual/baseline-viewport-390.png";
    const currentPath = "screenshots/viewport-390.png";
    const diffPath = "visual/diff-viewport-390.png";
    const report = distinctVisualReport({ baselinePath, currentPath, diffPath });
    const { page, browser } = await openReportPage(report, async (dir) => {
      await writeSolidPng(join(dir, baselinePath), 390, 844, [1, 2, 3, 255]);
      await writeSolidPng(join(dir, currentPath), 390, 844, [4, 5, 6, 255]);
      await writeSolidPng(join(dir, diffPath), 390, 844, [255, 0, 180, 255]);
    });

    await page.waitForSelector(".visual-view-diff.active");
    await page.locator('button[data-visual-mode="sideBySide"]').click();
    await page.waitForSelector(".visual-view-side-by-side.active");
    const sideImages = await page.locator(".visual-view-side-by-side.active img").evaluateAll(
      (els) => els.map((e) => e.getAttribute("src")),
    );
    expect(sideImages).toContain(baselinePath);
    expect(sideImages).toContain(currentPath);

    await page.locator('button[data-visual-mode="diff"]').click();
    expect(
      await page.locator(".visual-view-diff.active img").getAttribute("src"),
    ).toBe(diffPath);

    await browser.close();
  });

  it("shows missing baseline message without substituting current screenshot", async () => {
    const currentPath = "screenshots/viewport-390.png";
    const report = distinctVisualReport({
      baselinePath: "visual/baseline-viewport-390.png",
      currentPath,
    });
    delete report.viewports[0]!.visualCompare!.baselineScreenshot;

    const { page, browser } = await openReportPage(report, async (dir) => {
      await writeSolidPng(join(dir, currentPath), 390, 844, [1, 1, 1, 255]);
    });

    await page.locator('button[data-visual-mode="slider"]').click();
    const text = await page.locator(".visual-view-slider.active .visual-missing").textContent();
    expect(text).toContain(MISSING_BASELINE_MESSAGE.slice(0, 30));

    await browser.close();
  });

  it(
    "shows incompatibility error for mismatched screenshot dimensions",
    async () => {
      const baselinePath = "visual/baseline-viewport-390.png";
      const currentPath = "screenshots/viewport-390.png";
      const report = distinctVisualReport({ baselinePath, currentPath });
      const { page, browser } = await openReportPage(report, async (dir) => {
        await writeSolidPng(join(dir, baselinePath), 390, 800, [1, 1, 1, 255]);
        await writeSolidPng(join(dir, currentPath), 390, 844, [2, 2, 2, 255]);
      });

      await page.waitForSelector(".visual-panel > .compare-error:not([hidden])");
      const message = await page.locator(".visual-panel > .compare-error").textContent();
      expect(message).toContain("Incompatible screenshot sizes");
      await browser.close();
    },
    60_000,
  );
});
