import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectHorizontalOverflow } from "./overflow.js";
import { detectResponsiveIssues } from "./detect-responsive.js";

const casesDir = join(dirname(fileURLToPath(import.meta.url)), "../../../examples/responsive-cases");
const layoutDir = join(dirname(fileURLToPath(import.meta.url)), "../../../examples/layout-cases");

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

async function responsive(file: string, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(pathToFileURL(join(casesDir, file)).href);
  return detectResponsiveIssues(page, width, 844);
}

describe("Phase 8 responsive fixtures (Chromium)", () => {
  it("overlap: reports a fixed overlay blocking a button with hit-test evidence", async () => {
    const r = await responsive("overlap-blocked-button.html");
    const hits = r.findings.filter((f) => f.category === "overlap");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((f) => f.selector.includes("target") && f.overlap?.hitTestBlocked)).toBe(true);
  });

  it("overlap: does not flag an icon nested inside its button", async () => {
    const r = await responsive("overlap-icon-in-button.html");
    expect(r.findings.filter((f) => f.category === "overlap")).toEqual([]);
  });

  it("text clipping: flags unintentionally clipped text", async () => {
    const r = await responsive("text-clip-unintentional.html");
    expect(r.findings.some((f) => f.category === "text-clipping" && f.selector.includes("bad"))).toBe(true);
  });

  it("text clipping: skips a short intentional ellipsis", async () => {
    const r = await responsive("text-clip-ellipsis.html");
    expect(r.findings.filter((f) => f.category === "text-clipping")).toEqual([]);
  });

  it("offscreen control: flags a horizontally unreachable button", async () => {
    const r = await responsive("offscreen-horizontal-button.html");
    expect(r.findings.some((f) => f.category === "offscreen-control")).toBe(true);
  });

  it("offscreen control: ignores links in a closed off-canvas nav", async () => {
    const r = await responsive("offscreen-closed-nav.html");
    expect(r.findings.filter((f) => f.category === "offscreen-control")).toEqual([]);
  });

  it("touch target: flags an undersized control at 390px", async () => {
    const r = await responsive("touch-small-button.html", 390);
    expect(r.findings.some((f) => f.category === "touch-target" && f.selector.includes("tiny"))).toBe(true);
  });

  it("touch target: does not flag an adequately sized button", async () => {
    const r = await responsive("touch-adequate.html", 390);
    expect(r.findings.filter((f) => f.category === "touch-target")).toEqual([]);
  });

  it("regression: clipped carousel still produces no advanced spam", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(pathToFileURL(join(layoutDir, "03-carousel-clipped.html")).href);
    const overflow = await detectHorizontalOverflow(page, 390);
    const adv = await detectResponsiveIssues(page, 390, 844);
    expect(overflow.findings).toEqual([]);
    expect(adv.findings.filter((f) => f.category === "offscreen-control")).toEqual([]);
    expect(adv.findings.filter((f) => f.classification === "confirmed" && f.category === "overlap")).toEqual([]);
  });
});
