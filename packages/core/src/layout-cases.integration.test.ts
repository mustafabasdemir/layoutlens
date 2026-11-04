import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectHorizontalOverflow } from "./overflow.js";

const casesDir = join(dirname(fileURLToPath(import.meta.url)), "../../../examples/layout-cases");

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

async function detect(file: string, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(pathToFileURL(join(casesDir, file)).href);
  return detectHorizontalOverflow(page, width);
}

const summary = (r: Awaited<ReturnType<typeof detect>>) =>
  r.findings.map((f) => `${f.classification}:${f.selector}`);

describe("layout detection on realistic fixtures (Chromium)", () => {
  it("1. confirms genuine document overflow from a non-wrapping row, reported once at the row", async () => {
    const r = await detect("01-document-overflow.html");
    expect(r.analysis.userScrollable).toBe(true);
    expect(summary(r)).toEqual(["confirmed:body > main > div.promo-row"]);
    expect(r.findings[0]!.relatedCount).toBeGreaterThanOrEqual(2);
    expect(r.findings[0]!.severity).toBe("high");
    expect((await detect("01-document-overflow.html", 1440)).findings).toEqual([]);
  });

  it("2. confirms a fixed-width element only where it exceeds the viewport", async () => {
    const r = await detect("02-fixed-width.html");
    expect(summary(r)).toEqual(["confirmed:#pricing"]);
    expect(r.findings[0]!.scrollContributionPx).toBe(r.documentScrollWidth - 390);
    expect((await detect("02-fixed-width.html", 768)).findings).toEqual([]);
  });

  it("3. excludes a properly clipped carousel and names its container", async () => {
    for (const width of [390, 1440]) {
      const r = await detect("03-carousel-clipped.html", width);
      expect(r.findings).toEqual([]);
      expect(r.documentScrollWidth).toBe(width);
      expect(r.excluded).toHaveLength(1);
      expect(r.excluded[0]).toMatchObject({ reason: "clipped-by-ancestor", selector: "#hero-carousel" });
      expect(r.excluded[0]!.elementCount).toBeGreaterThanOrEqual(4);
    }
  });

  it("4. still reports a carousel that widens the document, as one grouped finding", async () => {
    const r = await detect("04-carousel-leaking.html");
    expect(summary(r)).toEqual(["confirmed:#leaky-carousel > div.carousel-track"]);
    expect(r.findings[0]).toMatchObject({ pattern: "horizontal-track", relatedCount: 3, severity: "high" });
  });

  it("5. excludes transformed slides inside a clipped slider and a closed fixed drawer", async () => {
    const r = await detect("05-transformed-offscreen.html");
    expect(r.findings).toEqual([]);
    const reasons = Object.fromEntries(r.excluded.map((e) => [e.selector, e.reason]));
    expect(reasons).toEqual({ "#drawer": "offscreen", "#fader": "clipped-by-ancestor" });
  });

  it("6. ignores hidden elements but confirms an invisible element that still widens the page", async () => {
    const r = await detect("06-hidden-elements.html");
    expect(summary(r)).toEqual(["confirmed:#ghost-panel"]);
    expect(r.findings[0]).toMatchObject({ invisible: true, visibleBox: null });
    expect(r.excluded.map((e) => e.reason).sort()).toEqual(["hidden", "offscreen"]);
    expect(r.findings.some((f) => f.selector.includes("gone"))).toBe(false);
  });

  it("7. treats nested scroll containers as intentional", async () => {
    const r = await detect("07-nested-scroll.html");
    expect(r.findings).toEqual([]);
    expect(r.documentScrollWidth).toBe(390);
    expect(r.excluded.every((e) => e.reason === "inside-scroll-container")).toBe(true);
    expect(r.excluded.map((e) => e.selector)).toContain("#table-wrap");
  });

  it("8. confirms long unbroken text and not the wrapped copy", async () => {
    const r = await detect("08-long-text.html");
    expect(summary(r)).toEqual(["confirmed:#long-url"]);
    expect(r.findings[0]!.reason).toContain("content is");
  });

  it("9. separates a leaking absolute decoration from clipped and offscreen ones", async () => {
    const r = await detect("09-offscreen-absolute.html");
    expect(summary(r)).toEqual(["confirmed:#blob-leak"]);
    expect(r.findings[0]!.visibleBox).toMatchObject({ x: 290, width: 100 });
    expect(r.excluded.map((e) => e.reason).sort()).toEqual(["clipped-by-ancestor", "offscreen"]);
  });

  it("10. groups findings with a shared root cause but keeps unrelated issues separate", async () => {
    const r = await detect("10-shared-root-cause.html");
    expect(summary(r)).toEqual(["confirmed:#product-grid", "confirmed:#newsletter"]);
    expect(r.findings[0]!.relatedCount).toBeGreaterThanOrEqual(6);
    expect(r.findings[1]!.relatedCount).toBe(0);
  });

  it("11. reports overflow masked by body { overflow-x: hidden } as potential, not confirmed", async () => {
    const r = await detect("11-masked-overflow.html");
    expect(r.analysis).toMatchObject({ userScrollable: false, rootOverflowX: "hidden" });
    expect(r.analysis.maskedOverflowPx).toBeGreaterThan(0);
    expect(summary(r)).toEqual(["potential:#announcement"]);
    expect(r.findings[0]!.severity).not.toBe("high");
    expect(r.excluded.map((e) => e.reason)).toEqual(["offscreen"]);
  });
}, 120_000);
