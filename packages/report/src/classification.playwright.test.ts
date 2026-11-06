import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scanUrl } from "@layoutlens/core";
import type { JsonReport } from "@layoutlens/shared";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHtmlReportDocument, writeHtmlReportBundle } from "./index.js";

const casesDir = join(dirname(fileURLToPath(import.meta.url)), "../../../examples/layout-cases");

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

describe("offline HTML report — evidence classification", () => {
  it(
    "shows confirmed findings with reasons, outlines only the visible part, and lists exclusions",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "layoutlens-cls-"));
      const result = await scanUrl({
        url: pathToFileURL(join(casesDir, "09-offscreen-absolute.html")).href,
        artifacts: { directory: dir },
      });
      const { indexPath } = await writeHtmlReportBundle(result, dir);

      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(pathToFileURL(indexPath).href);
      const mobile = page.locator('.viewport-card[data-viewport="390"]');
      await mobile.locator(".shot-shell img").evaluate((img: HTMLImageElement) => img.decode());

      const finding = mobile.locator(".finding").first();
      expect(await finding.locator(".badge.cls").textContent()).toBe("Confirmed");
      expect(await finding.locator("code").textContent()).toBe("#blob-leak");
      expect(await finding.locator(".finding-reason").textContent()).toContain("no ancestor clips it");
      expect(await finding.locator(".finding-meta").textContent()).toContain("+160px page width");
      expect(await finding.locator(".finding-note").textContent()).toContain("only the visible part (100px of 260px)");

      const box = mobile.locator(".box");
      expect(await box.count()).toBe(1);
      const left = await box.evaluate((el) => parseFloat((el as HTMLElement).style.left));
      expect(left).toBeCloseTo((290 / 390) * 100, 1);

      const excluded = mobile.locator("details.excluded");
      expect(await excluded.locator("summary").textContent()).toBe("Excluded as intentional: 2 element(s) in 2 group(s)");
      await excluded.locator("summary").click();
      expect(await excluded.locator("li").allTextContents()).toEqual([
        expect.stringContaining("Clipped by an ancestor"),
        expect.stringContaining("Positioned offscreen"),
      ]);

      await page.getByRole("button", { name: "Potential" }).click();
      expect(await mobile.locator(".finding:not(.hidden)").count()).toBe(0);
      expect(await box.evaluate((el) => (el as HTMLElement).style.display)).toBe("none");
      await page.close();
    },
    90_000,
  );

  it("states truncation and never draws an outline for an element with no visible part", async () => {
    const dir = await mkdtemp(join(tmpdir(), "layoutlens-trunc-"));
    const report: JsonReport = {
      schemaVersion: "1.3",
      tool: "layoutlens",
      url: "https://example.com/",
      scannedAt: "2026-01-01T00:00:00.000Z",
      summary: {
        viewportIssueCount: 1,
        findingCount: 1,
        bySeverity: { high: 0, medium: 0, low: 1 },
        byClassification: { confirmed: 0, potential: 0, insufficientEvidence: 1 },
        excludedCount: 0,
        truncated: true,
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
          findings: [
            {
              selector: "#far",
              tagName: "div",
              severity: "low",
              overflowPx: 0,
              documentContributionPx: 9600,
              scrollWidth: 300,
              clientWidth: 300,
              boundingBox: { x: 9690, y: 10, width: 300, height: 40 },
              classification: "insufficient-evidence",
              reason: "measured past the edge",
              visibleBox: null,
              relatedCount: 0,
            },
          ],
          excluded: [],
          analysis: {
            elementsInspected: 10,
            candidateCount: 80,
            candidateLimit: 5000,
            candidatesOmitted: 0,
            rootOverflowX: "visible",
            userScrollable: false,
            maskedOverflowPx: 0,
            unattributedOverflowPx: 0,
            findingLimit: 50,
            findingsOmitted: 29,
            excludedLimit: 50,
            excludedOmitted: 0,
            relatedLimit: 20,
          },
        },
      ],
    };
    const file = join(dir, "index.html");
    await writeFile(file, buildHtmlReportDocument(report));
    expect(await readFile(file, "utf8")).toContain("layoutlens-data");
    const page = await browser.newPage();
    await page.goto(pathToFileURL(file).href);
    expect(await page.locator("[data-testid=truncated-notice]").textContent()).toContain("Results are truncated");
    expect(await page.locator(".viewport-card .notice").first().textContent()).toContain(
      "Truncated: 29 more finding group(s) beyond the 50-group limit",
    );
    expect(await page.locator(".finding-note").textContent()).toContain("no part of it is painted inside the 390px viewport");
    expect(await page.locator(".box").count()).toBe(0);
    await page.close();
  });
});
