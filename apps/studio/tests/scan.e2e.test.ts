import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBaseline } from "@layoutlens/core";
import { startScanServer, type RunningScanServer } from "@layoutlens/server";
import { chromium, type Browser, type Page } from "playwright";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(appRoot, "../..");

let workDir: string;
let studio: RunningScanServer;
let site: Server;
let siteUrl: string;
let browser: Browser;

async function startExampleSite(): Promise<void> {
  const files: Record<string, [string, Buffer]> = {
    "/": ["text/html; charset=utf-8", await readFile(join(repoRoot, "examples/broken-layout/index.html"))],
    "/styles.css": ["text/css; charset=utf-8", await readFile(join(repoRoot, "examples/broken-layout/styles.css"))],
  };
  for (const name of ["03-carousel-clipped.html", "09-offscreen-absolute.html"]) {
    files[`/cases/${name}`] = ["text/html; charset=utf-8", await readFile(join(repoRoot, "examples/layout-cases", name))];
  }
  site = createServer((req, res) => {
    const file = files[(req.url ?? "/").split("?")[0]!];
    if (file) res.writeHead(200, { "content-type": file[0] }).end(file[1]);
    else res.writeHead(404).end();
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "ll-studio-scan-"));
  const outDir = join(workDir, "dist");
  await build({ root: appRoot, logLevel: "silent", build: { outDir, emptyOutDir: true } });
  await startExampleSite();
  const dataDir = join(workDir, "data");
  await createBaseline({ url: siteUrl, baselineDirectory: join(dataDir, "baselines", "example-home") });
  studio = await startScanServer({ port: 0, dataDir, staticDir: outDir });
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await studio?.close();
  await new Promise<void>((r) => (site ? site.close(() => r()) : r()));
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

async function openStudio(width = 1440, height = 900): Promise<{ page: Page; errors: string[]; close(): Promise<void> }> {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(studio.url);
  await page.locator("h1.page-title").waitFor();
  return { page, errors, close: () => context.close() };
}

async function submitScan(page: Page, url: string): Promise<void> {
  await page.getByPlaceholder("https://your-website.com").first().fill(url);
  await page.getByRole("button", { name: /Scan Website|Start scan/ }).first().click();
}

const progressCard = (page: Page) => page.getByTestId("scan-progress");

describe("Scan Website runs a real local scan", () => {
  it("shows real progress, blocks double submits, then opens real results", async () => {
    const { page, errors, close } = await openStudio();
    await submitScan(page, siteUrl);

    const button = page.getByRole("button", { name: /Scanning…|Scan Website/ }).first();
    await expect.poll(() => button.isDisabled()).toBe(true);
    expect(await button.textContent()).toContain("Scanning…");

    const states = new Set<string>();
    const percents = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const state = (await progressCard(page).getAttribute("data-state")) ?? "";
      states.add(state);
      const bar = page.getByRole("progressbar", { name: "Scan progress" });
      if (await bar.count()) percents.add((await bar.getAttribute("aria-valuenow")) ?? "");
      if (state === "completed" || state === "failed") break;
      await page.waitForTimeout(100);
    }
    expect(await progressCard(page).getAttribute("data-state")).toBe("completed");
    expect(states.has("running") || states.has("queued")).toBe(true);
    for (const p of percents) expect(Number(p)).toBeLessThan(100);
    expect(await button.isDisabled()).toBe(false);

    const findings = Number(await page.getByTestId("scan-result-findings").textContent());
    expect(findings).toBeGreaterThan(0);
    expect(await progressCard(page).textContent()).toContain("example-home");
    expect(await progressCard(page).textContent()).toContain("no accessibility findings are reported");

    // Completed scans feed the Overview summary from the real report.
    await expect.poll(async () => page.getByTestId("stat-total-findings").textContent()).toBe(String(findings));
    expect(await page.getByTestId("recent-scans").locator(".report-row").count()).toBe(1);

    await page.getByRole("button", { name: "View results" }).click();
    await expect.poll(() => page.locator("h1.page-title").textContent()).toBe("Reports");
    const img = page.getByTestId("workspace-screenshot");
    await img.waitFor();
    expect(await img.getAttribute("src")).toMatch(/^\/api\/scans\/[0-9a-f-]{36}\/files\/screenshots\/viewport-390\.png$/);
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(390);
    expect(await page.locator('[role="tab"][id^="ws-tab-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-width")))).toEqual([
      "390",
      "768",
      "1440",
    ]);
    expect(await page.locator(".finding-card").filter({ hasText: "#wide-banner" }).count()).toBe(1);
    expect(await page.getByTestId("count-confirmed").textContent()).toBe(String(findings));
    expect(await page.locator('.finding-card[data-classification="confirmed"]').count()).toBe(
      await page.locator(".finding-card").count(),
    );
    const tabBadge = await page.locator('#ws-tab-390 .device-badge').textContent();
    expect(tabBadge).toBe(String(await page.locator(".finding-card").count()));
    await page.locator(".finding-card").filter({ hasText: "#wide-banner" }).click();
    expect(await page.getByTestId("detail-reason").textContent()).toContain("no ancestor clips it");
    expect(await page.locator('.shot-box.is-selected').count()).toBe(1);

    await page.goto(`${studio.url}#/visual`);
    const stage = page.getByTestId("ba-stage");
    await stage.waitFor();
    for (const sel of [".ba-baseline", ".ba-current"]) {
      const src = await page.locator(sel).getAttribute("src");
      expect(src).toMatch(/^\/api\/scans\/.+\.png$/);
      expect(await page.locator(sel).evaluate((el: HTMLImageElement) => el.decode().then(() => el.naturalWidth))).toBe(390);
    }
    expect(errors).toEqual([]);
    await close();
  });

  it("lists stored scans after a reload and reopens them", async () => {
    const { page, close } = await openStudio();
    const rows = page.getByTestId("recent-scans").locator('.report-row[data-state="completed"]');
    await rows.first().waitFor();
    await page.goto(`${studio.url}#/history`);
    const row = page.getByTestId("recent-scans").locator('.report-row[data-state="completed"]').first();
    await row.getByRole("button", { name: "Open" }).click();
    await expect.poll(() => page.locator("h1.page-title").textContent()).toBe("Reports");
    await page.getByTestId("workspace-screenshot").waitFor();
    expect(await page.locator(".report-header").textContent()).toContain("127.0.0.1");
    await close();
  });

  it("shows real failures and server-side URL rejections", async () => {
    const { page, close } = await openStudio();
    const dead = createServer();
    await new Promise<void>((r) => dead.listen(0, "127.0.0.1", r));
    const deadUrl = `http://127.0.0.1:${(dead.address() as AddressInfo).port}/`;
    await new Promise<void>((r) => dead.close(() => r()));

    await submitScan(page, deadUrl);
    await expect.poll(() => progressCard(page).getAttribute("data-state"), { timeout: 60_000 }).toBe("failed");
    expect(await page.getByTestId("scan-error").textContent()).toContain("ERR_CONNECTION_REFUSED");
    expect(await page.getByRole("button", { name: "Scan again" }).count()).toBe(1);

    await submitScan(page, "http://169.254.169.254/latest/meta-data/");
    await expect.poll(() => page.locator(".field-error").textContent()).toMatch(/link-local/);

    await submitScan(page, studio.url);
    await expect.poll(() => page.locator(".field-error").textContent()).toMatch(/can't scan its own/);

    await submitScan(page, "file:///C:/Windows/win.ini");
    await expect.poll(() => page.locator(".field-error").textContent()).toMatch(/Only http and https/);
    await close();
  });

  it("refuses scan requests from other websites open in the same browser", async () => {
    const before = (await (await fetch(`${studio.url}api/scans`)).json()) as { scans: unknown[] };
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(siteUrl);
    const outcome = await page.evaluate(async (api) => {
      const results: string[] = [];
      try {
        const r = await fetch(`${api}api/scans`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: "https://example.com/" }),
        });
        results.push(`cors:${r.status}`);
      } catch {
        results.push("cors:blocked");
      }
      try {
        await fetch(`${api}api/scans`, { method: "POST", mode: "no-cors", body: JSON.stringify({ url: "https://example.com/" }) });
        results.push("no-cors:sent");
      } catch {
        results.push("no-cors:blocked");
      }
      try {
        const r = await fetch(`${api}api/scans`);
        results.push(`read:${r.status}`);
      } catch {
        results.push("read:blocked");
      }
      return results;
    }, studio.url);
    expect(outcome).toContain("cors:blocked");
    expect(outcome).toContain("read:blocked");
    const after = (await (await fetch(`${studio.url}api/scans`)).json()) as { scans: unknown[] };
    expect(after.scans.length).toBe(before.scans.length);
    await context.close();
  });

  it("reports a clipped carousel as excluded content, not as findings", async () => {
    const { page, errors, close } = await openStudio();
    await submitScan(page, `${siteUrl}cases/03-carousel-clipped.html`);
    await expect.poll(() => progressCard(page).getAttribute("data-state"), { timeout: 90_000 }).toBe("completed");
    expect(await page.getByTestId("scan-result-findings").textContent()).toBe("0");
    expect(await page.getByTestId("scan-result-confirmed").textContent()).toBe("0");
    expect(Number(await page.getByTestId("scan-result-excluded").textContent())).toBe(3);

    await page.getByRole("button", { name: "View results" }).click();
    await page.getByTestId("workspace-screenshot").waitFor();
    expect(await page.locator(".finding-card").count()).toBe(0);
    expect(await page.locator("#ws-tab-390 .device-badge").count()).toBe(0);
    expect(await page.locator(".report-header .badge").first().textContent()).toBe("No overflow detected");
    const excluded = page.getByTestId("excluded-list");
    await excluded.locator("summary").click();
    const item = excluded.locator(".excluded-item").first();
    expect(await item.getAttribute("data-reason")).toBe("clipped-by-ancestor");
    expect(await item.locator("code").textContent()).toBe("#hero-carousel");
    expect(await item.textContent()).toContain("do not widen the page");
    expect(errors).toEqual([]);
    await close();
  });

  it("outlines only the visible part of a partly offscreen element and explains the rest", async () => {
    const { page, close } = await openStudio();
    await submitScan(page, `${siteUrl}cases/09-offscreen-absolute.html`);
    await expect.poll(() => progressCard(page).getAttribute("data-state"), { timeout: 90_000 }).toBe("completed");
    await page.getByRole("button", { name: "View results" }).click();
    await page.getByTestId("workspace-screenshot").waitFor();
    const card = page.locator(".finding-card").filter({ hasText: "#blob-leak" });
    await card.click();
    expect(await page.getByTestId("screenshot-evidence").textContent()).toContain("only the visible part (100px of 260px)");
    const box = page.locator(".shot-box.is-selected");
    await box.waitFor();
    const rel = await box.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const img = document.querySelector("[data-testid=workspace-screenshot]")!.getBoundingClientRect();
      return { left: (r.left - img.left) / img.width, width: r.width / img.width };
    });
    expect(rel.left).toBeCloseTo(290 / 390, 2);
    expect(rel.width).toBeCloseTo(100 / 390, 2);
    await close();
  });

  it("keeps the scan flow usable without horizontal overflow on mobile", async () => {
    const { page, close } = await openStudio(390, 844);
    await submitScan(page, siteUrl);
    await expect.poll(() => progressCard(page).getAttribute("data-state"), { timeout: 90_000 }).toBe("completed");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await close();
  });
});
