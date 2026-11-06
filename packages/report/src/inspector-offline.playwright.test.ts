import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { buildHtmlReportDocument } from "./build-html.js";
import type { JsonReport } from "@layoutlens/shared";

function solidPngBuffer(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

function solidPngDataUrl(width: number, height: number, rgba: [number, number, number, number]): string {
  return `data:image/png;base64,${solidPngBuffer(width, height, rgba).toString("base64")}`;
}

function inspectorReport(screenshotPath: string): JsonReport {
  return {
    schemaVersion: "1.3",
    tool: "layoutlens",
    url: "https://inspector-offline.test/",
    scannedAt: "2026-06-01T00:00:00.000Z",
    summary: {
      viewportIssueCount: 1,
      findingCount: 1,
      bySeverity: { high: 1, medium: 0, low: 0 },
      byClassification: { confirmed: 1, potential: 0, insufficientEvidence: 0 },
      excludedCount: 0,
      truncated: false,
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
        screenshot: screenshotPath,
        findings: [
          {
            id: "overflow:390:0",
            tagName: "div",
            selector: "#wide",
            severity: "high",
            overflowPx: 0,
            documentContributionPx: 0,
            scrollWidth: 100,
            clientWidth: 100,
            boundingBox: { x: 0, y: 300, width: 100, height: 20 },
            classification: "confirmed",
            reason: "fixture",
            scrollContributionPx: 0,
            visibleBox: { x: 0, y: 300, width: 100, height: 20 },
            related: [],
            relatedCount: 0,
          },
        ],
        excluded: [],
        analysis: {
          elementsInspected: 1,
          candidateCount: 0,
          candidateLimit: 5000,
          candidatesOmitted: 0,
          rootOverflowX: "visible",
          userScrollable: true,
          maskedOverflowPx: 0,
          unattributedOverflowPx: 0,
          findingLimit: 50,
          findingsOmitted: 0,
          excludedLimit: 50,
          excludedOmitted: 0,
          relatedLimit: 20,
        },
        inspector: {
          meta: {
            version: 1,
            elementCount: 2,
            devicePixelRatio: 1,
            viewportWidth: 390,
            viewportHeight: 844,
            collectionDurationMs: 5,
            truncated: false,
            elementsOmitted: 0,
            maxDepth: 32,
            maxElements: 500,
            maxSelectorLength: 240,
          },
          elements: [
            {
              id: "el_wrap",
              tagName: "div",
              selector: "#fixture-wrap",
              selectorMatches: 1,
              parentId: null,
              depth: 1,
              boundingBox: { x: 10, y: 90, width: 200, height: 80 },
              visibleBox: { x: 10, y: 90, width: 200, height: 80 },
              scrollWidth: 200,
              scrollHeight: 80,
              clientWidth: 200,
              clientHeight: 80,
              computed: { display: "block", position: "static", boxSizing: "border-box", pointerEvents: "auto" },
              relatedFindingIds: ["overflow:390:0"],
            },
            {
              id: "el_btn",
              tagName: "button",
              selector: "#child-btn",
              selectorMatches: 1,
              parentId: "el_wrap",
              depth: 2,
              boundingBox: { x: 30, y: 110, width: 72, height: 36 },
              visibleBox: { x: 30, y: 110, width: 72, height: 36 },
              scrollWidth: 72,
              scrollHeight: 36,
              clientWidth: 72,
              clientHeight: 36,
              computed: { display: "inline-block", position: "static", boxSizing: "border-box", pointerEvents: "auto" },
              relatedFindingIds: [],
            },
          ],
          hitTest: {
            stepPx: 32,
            samples: [{ x: 66, y: 128, topIds: ["el_btn", "el_wrap"] }],
          },
        },
      },
    ],
  };
}

describe("offline HTML inspector (Chromium file://)", () => {
  it(
    "toggles inspector, selects child button, parent, related finding, and exits with Escape",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "layoutlens-offline-inspector-"));
      const shotDataUrl = solidPngDataUrl(390, 844, [20, 60, 100, 255]);

      const html = buildHtmlReportDocument(inspectorReport(shotDataUrl));
      await writeFile(join(dir, "index.html"), html, "utf8");

      const browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await page.goto(pathToFileURL(join(dir, "index.html")).href);
      const img = page.locator(".shot-shell img").first();
      await expect.poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(390);

      const toggle = page.locator(".ll-inspector-toggle").first();
      await toggle.click();
      expect(await toggle.textContent()).toBe("Inspector on");
      expect(
        await page.locator(".shot-shell").first().evaluate((el) => el.classList.contains("ll-inspector-on")),
      ).toBe(true);

      const natW = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
      const natH = await img.evaluate((el: HTMLImageElement) => el.naturalHeight);
      expect(natW).toBe(390);
      expect(natH).toBe(844);

      const imgBox = (await img.boundingBox())!;
      await img.click({ position: { x: (66 / 390) * imgBox.width, y: (128 / 844) * imgBox.height } });

      await expect
        .poll(async () => (await page.locator(".ll-inspector-pre").first().textContent()) ?? "", { timeout: 15_000 })
        .toContain("#child-btn");
      await page.locator(".ll-inspector-parent").first().click();
      await expect
        .poll(async () => (await page.locator(".ll-inspector-pre").first().textContent()) ?? "")
        .toContain("#fixture-wrap");

      await page.locator(".ll-inspector-related-btn").first().click();
      await expect.poll(async () => (await page.locator(".finding.active").first().textContent()) ?? "").toContain("#wide");

      await page.keyboard.press("Escape");
      expect(await toggle.textContent()).toBe("Inspector off");
      expect(errors).toEqual([]);

      await browser.close();
    },
    30_000,
  );

  it("shows Inspector unavailable when viewport has no snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "layoutlens-offline-no-inspector-"));
    const shotDataUrl = solidPngDataUrl(390, 844, [10, 10, 10, 255]);

    const base = inspectorReport(shotDataUrl);
    const report: JsonReport = {
      ...base,
      viewports: base.viewports.map((v) => {
        const { inspector: _omit, ...rest } = v;
        return rest;
      }),
    };

    const html = buildHtmlReportDocument(report);
    await writeFile(join(dir, "index.html"), html, "utf8");

    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(dir, "index.html")).href);

    const toggle = page.getByRole("button", { name: "Inspector unavailable" });
    expect(await toggle.isDisabled()).toBe(true);

    await browser.close();
  });
});
