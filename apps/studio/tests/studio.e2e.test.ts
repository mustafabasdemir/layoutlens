import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeTo, COLORS, FIXTURE_URL, sampleColor, writeFixtureReport } from "./fixture";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

let workDir: string;
let reportDir: string;
let server: Server;
let baseUrl: string;
let browser: Browser;

function serveStatic(root: string): Server {
  return createServer(async (req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    const target = normalize(join(root, urlPath === "/" ? "index.html" : urlPath));
    if (!target.startsWith(root + sep) && target !== root) {
      res.writeHead(403).end();
      return;
    }
    try {
      const s = await stat(target);
      if (!s.isFile()) throw new Error("not a file");
      res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" });
      createReadStream(target).pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "ll-studio-e2e-"));
  const outDir = join(workDir, "dist");
  await build({ root: appRoot, logLevel: "silent", build: { outDir, emptyOutDir: true } });
  reportDir = join(workDir, "fixture-report");
  await writeFixtureReport(reportDir);
  server = serveStatic(outDir);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

async function openPage(
  width = 1440,
  height = 900,
  extra: Parameters<Browser["newContext"]>[0] = {},
): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ...extra });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // This static fixture has no scan API, so the service probe's 404 is expected.
    if (m.type() === "error" && !new URL(m.location().url || baseUrl).pathname.startsWith("/api/")) errors.push(m.text());
  });
  await page.goto(baseUrl);
  await page.locator("h1.page-title").waitFor();
  return { context, page, errors };
}

async function loadFixture(page: Page): Promise<void> {
  await page.goto(`${baseUrl}#/reports`);
  await page.getByTestId("report-folder-input").first().setInputFiles(reportDir);
  await page.locator(".report-header").waitFor();
  await page.getByTestId("workspace-screenshot").waitFor();
}

async function expectWidthNear(page: Page, selector: string, target: number): Promise<void> {
  await expect
    .poll(async () => Math.abs((await page.locator(selector).boundingBox())!.width - target))
    .toBeLessThanOrEqual(2);
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

describe("Studio shell", () => {
  it("navigates between all sections with an active nav state", async () => {
    const { context, page, errors } = await openPage();
    const titles: [string, string][] = [
      ["scan", "New Scan"],
      ["history", "Scan History"],
      ["reports", "Reports"],
      ["visual", "Visual Regression"],
      ["settings", "Settings"],
      ["overview", "Overview"],
    ];
    for (const [id, title] of titles) {
      await page.locator(`.sidebar .nav-item[data-nav="${id}"]`).click();
      await expect.poll(() => page.locator("h1.page-title").textContent()).toBe(title);
      expect(page.url()).toContain(`#/${id}`);
      expect(await page.locator(`.sidebar .nav-item[data-nav="${id}"]`).getAttribute("aria-current")).toBe("page");
    }
    expect(errors).toEqual([]);
    await context.close();
  });

  it("collapses the sidebar to icons and remembers it", async () => {
    const { context, page } = await openPage();
    const sidebar = page.locator(".sidebar");
    expect((await sidebar.boundingBox())!.width).toBeGreaterThanOrEqual(240);
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThanOrEqual(72);
    expect(await page.locator(".sidebar .nav-label").count()).toBe(0);
    expect(await page.locator('.sidebar .nav-item[aria-label="Settings"]').count()).toBe(1);
    await page.reload();
    await page.locator("h1.page-title").waitFor();
    expect((await page.locator(".sidebar").boundingBox())!.width).toBeLessThanOrEqual(72);
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await context.close();
  });

  it("toggles and persists the light theme", async () => {
    const { context, page } = await openPage();
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await theme()).toBe("dark");
    expect(await bg()).toBe("rgb(9, 9, 11)");
    await page.getByTestId("theme-toggle").click();
    expect(await theme()).toBe("light");
    expect(await bg()).not.toBe("rgb(9, 9, 11)");
    await page.reload();
    await page.locator("h1.page-title").waitFor();
    expect(await theme()).toBe("light");
    await page.getByTestId("theme-toggle").click();
    expect(await theme()).toBe("dark");
    await context.close();
  });

  it("uses a modal drawer on mobile that closes with Escape", async () => {
    const { context, page } = await openPage(390, 844);
    expect(await page.locator(".sidebar").count()).toBe(0);
    const menu = page.getByRole("button", { name: "Open navigation" });
    await menu.click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await drawer.waitFor();
    expect(await page.evaluate(() => document.activeElement?.closest(".drawer") !== null)).toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(() => drawer.count()).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Open navigation");
    await menu.click();
    await drawer.locator('.nav-item[data-nav="settings"]').click();
    await expect.poll(() => page.locator("h1.page-title").textContent()).toBe("Settings");
    expect(await drawer.count()).toBe(0);
    await context.close();
  });

  it("has no horizontal page overflow at 390, 768, 1024 and 1440px", async () => {
    for (const [w, h] of [[390, 844], [768, 1024], [1024, 768], [1440, 900]] as const) {
      const { context, page } = await openPage(w, h);
      expect(await horizontalOverflow(page), `overview @${w}`).toBeLessThanOrEqual(0);
      await loadFixture(page);
      expect(await horizontalOverflow(page), `reports @${w}`).toBeLessThanOrEqual(0);
      for (const route of ["visual", "scan", "history", "settings"]) {
        await page.goto(`${baseUrl}#/${route}`);
        await page.locator("main .page").waitFor();
        expect(await horizontalOverflow(page), `${route} @${w}`).toBeLessThanOrEqual(0);
      }
      await context.close();
    }
  });
});

describe("Overview and empty states", () => {
  it("shows honest empty states without any report", async () => {
    const { context, page } = await openPage();
    await page.getByText("Your websites. Under control.").waitFor();
    expect(await page.getByText("No report loaded").count()).toBe(1);
    expect(await page.getByText("No reports opened yet").count()).toBe(1);
    expect(await page.getByTestId("stat-total-findings").count()).toBe(0);
    for (const route of ["reports", "visual", "history"]) {
      await page.goto(`${baseUrl}#/${route}`);
      await page.locator("main .empty-state").first().waitFor();
    }
    await context.close();
  });

  it("validates the URL and explains when the local scanning service isn't running", async () => {
    const { context, page } = await openPage();
    const input = page.getByPlaceholder("https://your-website.com");
    await page.getByRole("button", { name: "Scan Website" }).click();
    await page.locator(".field-error").waitFor();
    await input.fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Scan Website" }).click();
    expect(await page.locator(".field-error").textContent()).toBeTruthy();
    expect(await input.getAttribute("aria-invalid")).toBe("true");

    await input.fill("example.com");
    await page.getByRole("button", { name: "Scan Website" }).click();
    const notice = page.getByText("The local scanning service isn't running");
    await notice.waitFor();
    expect(await page.locator(".field-error").count()).toBe(0);
    const command = await page.locator(".scan-form .command-text").textContent();
    expect(command).toContain("https://example.com");
    expect(await page.locator(".report-header").count()).toBe(0);
    await context.close();
  });

  it("fills summary cards and history from the opened report only", async () => {
    const { context, page } = await openPage();
    await loadFixture(page);
    await page.goto(`${baseUrl}#/overview`);
    expect(await page.getByTestId("stat-total-findings").textContent()).toBe("3");
    expect(await page.getByTestId("stat-high-severity").textContent()).toBe("1");
    expect(await page.getByTestId("stat-viewports-scanned").textContent()).toBe("3");
    expect(await page.getByTestId("stat-visual-regressions").textContent()).toBe("2");
    expect(await page.locator(".report-list .report-row").count()).toBe(1);
    expect(await page.locator(".report-list").textContent()).toContain("fixture-report");

    await page.goto(`${baseUrl}#/history`);
    expect(await page.locator(".report-row").count()).toBe(1);
    await context.close();
  });
});

describe("Report workspace", () => {
  it("renders the real report with dynamic device tabs and safe text", async () => {
    const { context, page, errors } = await openPage();
    await loadFixture(page);
    const header = page.locator(".report-header");
    expect(await header.textContent()).toContain("fixture.layoutlens.test");
    const tabs = page.locator('[role="tab"][id^="ws-tab-"]');
    expect(await tabs.evaluateAll((els) => els.map((e) => e.getAttribute("data-width")))).toEqual(["390", "1024", "1440"]);
    expect(await page.locator(".finding-card").count()).toBe(3);
    // Selector text containing markup must be shown as text, never parsed as HTML.
    expect(await page.locator(".finding-list script").count()).toBe(0);
    expect(await page.getByText(".code-sample <script>alert(1)</script>").first().count()).toBe(1);
    expect(errors).toEqual([]);
    await context.close();
  });

  it("switches viewports and loads the matching screenshot", async () => {
    const { context, page } = await openPage();
    await loadFixture(page);
    const img = page.getByTestId("workspace-screenshot");
    expect(await img.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([390, 844]);
    await page.locator("#ws-tab-1440").click();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1440);
    expect(await page.locator("#ws-tab-1440").getAttribute("aria-selected")).toBe("true");
    expect(await page.getByText("No overflow findings").count()).toBe(1);
    await page.locator("#ws-tab-1440").focus();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1024);
    await context.close();
  });

  it("positions overlays on the screenshot and explains unmappable findings", async () => {
    const { context, page } = await openPage();
    await loadFixture(page);
    const img = page.getByTestId("workspace-screenshot");

    // Clicking a card may scroll the page, so measure the image afterwards.
    await page.locator('.finding-card[data-finding="390:1"]').click();
    const imgBox = (await img.boundingBox())!;
    const box = (await page.locator('.shot-box[data-finding="390:1"]').boundingBox())!;
    const scale = imgBox.width / 390;
    expect(Math.abs(box.x - imgBox.x - 20 * scale)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y - imgBox.y - 200 * scale)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.width - 100 * scale)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.height - 40 * scale)).toBeLessThanOrEqual(2);

    const clipped = page.locator('.shot-box[data-finding="390:0"]');
    expect(await clipped.getAttribute("class")).toContain("is-clipped");
    const clippedBox = (await clipped.boundingBox())!;
    expect(clippedBox.x + clippedBox.width).toBeLessThanOrEqual(imgBox.x + imgBox.width + 1);

    expect(await page.locator('.shot-box[data-finding="390:2"]').count()).toBe(0);
    await page.locator('.finding-card[data-finding="390:2"]').click();
    const detail = page.locator(".detail");
    expect(await detail.getByText("Not shown on screenshot").count()).toBe(1);
    expect(await detail.textContent()).toContain("outside the captured screenshot area");
    expect(await detail.textContent()).toContain("never modifies your CSS");
    await context.close();
  });

  it("filters findings by severity and type", async () => {
    const { context, page } = await openPage();
    await loadFixture(page);
    await page.getByRole("button", { name: "High 1" }).click();
    expect(await page.locator(".finding-card").count()).toBe(1);
    expect(await page.locator('.finding-card[data-finding="390:0"]').getAttribute("aria-pressed")).toBe("true");
    await page.getByRole("button", { name: "All 3" }).click();
    await page.getByLabel("Filter by issue type").selectOption("internal-overflow");
    expect(await page.locator(".finding-card").count()).toBe(1);
    expect(await page.locator(".finding-card").getAttribute("data-finding")).toBe("390:1");
    expect(await page.locator(".shot-box").count()).toBe(1);
    await page.getByLabel("Filter by issue type").selectOption("all");
    expect(await page.locator(".finding-card").count()).toBe(3);
    await context.close();
  });

  it("supports keyboard navigation through findings", async () => {
    const { context, page } = await openPage();
    await loadFixture(page);
    await page.locator('.finding-card[data-finding="390:0"]').focus();
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-finding"))).toBe("390:1");
    await page.keyboard.press("Enter");
    expect(await page.locator('.finding-card[data-finding="390:1"]').getAttribute("aria-pressed")).toBe("true");
    expect(await page.locator('.shot-box.is-selected').getAttribute("data-finding")).toBe("390:1");
    await page.keyboard.press("ArrowUp");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-finding"))).toBe("390:0");
    await context.close();
  });

  it("zooms in, pans, and fits back", async () => {
    const { context, page } = await openPage();
    await loadFixture(page);
    const canvas = page.locator(".viewer-card .zoom-canvas");
    const fitWidth = (await canvas.boundingBox())!.width;
    await page.locator(".viewer-card").getByRole("button", { name: "Zoom in" }).click();
    await page.locator(".viewer-card").getByRole("button", { name: "Zoom in" }).click();
    expect(await page.locator(".viewer-card .zoom-level").textContent()).toBe("200%");
    await expectWidthNear(page, ".viewer-card .zoom-canvas", fitWidth * 2);
    const viewport = page.locator(".viewer-card .zoom-viewport");
    expect(await viewport.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await page.locator(".viewer-card").getByRole("button", { name: "Fit to view" }).click();
    await expectWidthNear(page, ".viewer-card .zoom-canvas", fitWidth);
    await context.close();
  });
});

describe("Visual regression studio", () => {
  async function openVisual(page: Page): Promise<void> {
    await loadFixture(page);
    await page.goto(`${baseUrl}#/visual`);
    await page.getByTestId("ba-stage").waitFor();
    await page.locator(".ba-baseline").evaluate((el: HTMLImageElement) => el.decode());
    await page.locator(".ba-current").evaluate((el: HTMLImageElement) => el.decode());
  }

  async function stageColors(page: Page): Promise<{ left: readonly number[]; right: readonly number[] }> {
    const png = await page.getByTestId("ba-stage").screenshot();
    return { left: sampleColor(png, 0.25, 0.6), right: sampleColor(png, 0.75, 0.6) };
  }

  async function expectSliderAt(
    page: Page,
    percent: number,
    baseline: readonly [number, number, number],
    current: readonly [number, number, number],
  ): Promise<void> {
    const stage = page.getByTestId("ba-stage");
    await expect.poll(() => stage.getAttribute("data-position")).toBe(String(percent));
    expect(await page.locator(".ba-handle").getAttribute("aria-valuenow")).toBe(String(percent));
    expect(await page.locator(".ba-baseline").evaluate((el) => (el as HTMLElement).style.clipPath)).toBe(
      `inset(0px ${100 - percent}% 0px 0px)`,
    );
    const { left, right } = await stageColors(page);
    const expected = (x: number) => (x * 100 < percent ? baseline : current);
    expect(closeTo(left as [number, number, number], expected(0.25)), `left @${percent}%: ${left}`).toBe(true);
    expect(closeTo(right as [number, number, number], expected(0.75)), `right @${percent}%: ${right}`).toBe(true);
  }

  it("clips the baseline at 50%, 0% and 100% for two different viewports", async () => {
    const { context, page } = await openPage();
    await openVisual(page);
    const stage = page.getByTestId("ba-stage");
    const handle = page.locator(".ba-handle");

    for (const [tab, baseline, current] of [
      ["#vr-tab-390", COLORS.baseline390, COLORS.current390],
      ["#vr-tab-1440", COLORS.baseline1440, COLORS.current1440],
    ] as const) {
      await page.locator(tab).click();
      await page.getByTestId("ba-stage").waitFor();
      await page.locator(".ba-current").evaluate((el: HTMLImageElement) => el.decode());
      await expectSliderAt(page, 50, baseline, current);

      const box = (await stage.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 1, box.y + box.height / 2, { steps: 6 });
      await page.mouse.move(box.x - 40, box.y + box.height / 2, { steps: 2 });
      await page.mouse.up();
      await expectSliderAt(page, 0, baseline, current);

      await handle.focus();
      await page.keyboard.press("End");
      await expectSliderAt(page, 100, baseline, current);
      await page.keyboard.press("Home");
      await expectSliderAt(page, 0, baseline, current);
      await page.keyboard.press("Shift+ArrowRight");
      await expect.poll(() => stage.getAttribute("data-position")).toBe("10");
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => stage.getAttribute("data-position")).toBe("11");
    }
    await context.close();
  });

  it("moves the divider with touch", async () => {
    const { context, page } = await openPage(390, 844, { hasTouch: true, isMobile: true });
    await openVisual(page);
    const stage = page.getByTestId("ba-stage");
    const box = (await stage.boundingBox())!;
    await stage.tap({ position: { x: box.width * 0.2, y: box.height / 2 } });
    await expect.poll(async () => Number(await stage.getAttribute("data-position"))).toBeGreaterThanOrEqual(18);
    expect(Number(await stage.getAttribute("data-position"))).toBeLessThanOrEqual(22);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await context.close();
  });

  it("shows side-by-side panels and the real diff image with metrics", async () => {
    const { context, page } = await openPage();
    await openVisual(page);
    expect(await page.locator(".metric").first().textContent()).toContain("329,160");
    expect(await page.locator(".visual-head").textContent()).toContain("Not recorded in this report");

    await page.getByRole("button", { name: "Side by side" }).click();
    const panels = page.locator(".side-by-side .side-panel");
    expect(await panels.count()).toBe(2);
    const [a, b] = [(await panels.nth(0).boundingBox())!, (await panels.nth(1).boundingBox())!];
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
    expect(b.x).toBeGreaterThan(a.x + a.width - 1);
    const left = await panels.nth(0).locator("img").screenshot();
    const right = await panels.nth(1).locator("img").screenshot();
    expect(closeTo(sampleColor(left, 0.5), COLORS.baseline390)).toBe(true);
    expect(closeTo(sampleColor(right, 0.5), COLORS.current390)).toBe(true);

    await page.getByRole("button", { name: "Difference" }).click();
    const diff = page.getByAltText("Pixel difference image generated by Pixelmatch");
    await diff.waitFor();
    await diff.evaluate((el: HTMLImageElement) => el.decode());
    expect(closeTo(sampleColor(await diff.screenshot(), 0.5), COLORS.diff)).toBe(true);
    expect(await page.getByRole("group", { name: "Difference legend" }).count()).toBe(1);
    await context.close();
  });

  it("never substitutes the current screenshot for a missing baseline", async () => {
    const { context, page } = await openPage();
    await openVisual(page);
    await page.locator("#vr-tab-1024").click();
    await page.getByText("Baseline unavailable").waitFor();
    expect(await page.getByTestId("ba-stage").count()).toBe(0);
    await page.getByRole("button", { name: "Side by side" }).click();
    expect(await page.getByText("No baseline exists for this viewport.").count()).toBe(1);
    expect(await page.locator(".side-panel img").count()).toBe(1);
    await page.getByRole("button", { name: "Difference" }).click();
    expect(await page.getByText(/No difference image was produced/).count()).toBe(1);
    await context.close();
  });

  it("zooms the comparison and resets to fit", async () => {
    const { context, page } = await openPage();
    await openVisual(page);
    const canvas = page.locator(".compare-card .zoom-canvas");
    const fit = (await canvas.boundingBox())!.width;
    await page.locator(".visual-controls").getByRole("button", { name: "Zoom in" }).click();
    await expectWidthNear(page, ".compare-card .zoom-canvas", fit * 1.5);
    await page.locator(".visual-controls").getByRole("button", { name: "Fit to view" }).click();
    await expectWidthNear(page, ".compare-card .zoom-canvas", fit);
    await context.close();
  });
});

describe("Report loading safety", () => {
  it("rejects folders without a LayoutLens report", async () => {
    const { context, page } = await openPage();
    await page.goto(`${baseUrl}#/reports`);
    await page.getByTestId("report-files-input").first().setInputFiles({
      name: "report.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ tool: "other", url: FIXTURE_URL })),
    });
    await page.getByText(/Not a LayoutLens report/).waitFor();
    expect(await page.locator(".report-header").count()).toBe(0);
    await context.close();
  });
});
