import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import type { JsonReport } from "@layoutlens/shared";
import { buildHtmlReportDocument } from "./build-html.js";

const report: JsonReport = {
  schemaVersion: "1.3",
  tool: "layoutlens",
  url: "https://theme.test/",
  scannedAt: "2026-01-01T00:00:00.000Z",
  summary: { viewportIssueCount: 0, findingCount: 0, bySeverity: { high: 0, medium: 0, low: 0 } },
  viewports: [
    {
      width: 390,
      label: "mobile",
      viewportHeight: 844,
      documentScrollWidth: 390,
      documentClientWidth: 390,
      hasHorizontalOverflow: false,
      overflowPx: 0,
      findings: [],
    },
  ],
};

describe("standalone report theme (Chromium, file://)", () => {
  it("uses the Studio design tokens offline and toggles light/dark", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ll-report-theme-"));
    const file = join(dir, "index.html");
    await writeFile(file, buildHtmlReportDocument(report), "utf8");
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ colorScheme: "dark" });
      const page = await context.newPage();
      const external: string[] = [];
      page.on("request", (r) => {
        if (!/^(file|data|blob):/.test(r.url())) external.push(r.url());
      });
      await page.goto(pathToFileURL(file).href);

      const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
      expect(await bg()).toBe("rgb(9, 9, 11)");

      await page.getByTestId("theme-toggle").click();
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
      expect(await bg()).not.toBe("rgb(9, 9, 11)");
      expect(await page.getByTestId("theme-toggle").getAttribute("aria-label")).toBe("Switch to dark theme");

      expect(external).toEqual([]);
      await context.close();

      const lightContext = await browser.newContext({ colorScheme: "light" });
      const lightPage = await lightContext.newPage();
      await lightPage.goto(pathToFileURL(file).href);
      expect(await lightPage.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
      await lightContext.close();
    } finally {
      await browser.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
