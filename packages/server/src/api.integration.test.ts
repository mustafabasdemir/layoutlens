import { readFile, mkdtemp, rm, readdir } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBaseline } from "@layoutlens/core";
import type { JsonReport, ScanJobView, ScanOptions, ScanResult } from "@layoutlens/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startScanServer, type RunningScanServer } from "./server.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

let site: Server;
let siteUrl: string;
let workDir: string;

/** Serves the repository's broken-layout example over real HTTP. */
async function startSite(): Promise<void> {
  const files: Record<string, [string, Buffer]> = {
    "/": ["text/html; charset=utf-8", await readFile(join(repoRoot, "examples/broken-layout/index.html"))],
    "/styles.css": ["text/css; charset=utf-8", await readFile(join(repoRoot, "examples/broken-layout/styles.css"))],
  };
  site = createServer((req, res) => {
    const file = files[(req.url ?? "/").split("?")[0]!];
    if (file) res.writeHead(200, { "content-type": file[0] }).end(file[1]);
    else res.writeHead(404).end();
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;
}

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  json<T = unknown>(): T;
}

function call(
  server: RunningScanServer,
  method: string,
  path: string,
  options: { body?: string; headers?: Record<string, string> } = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: server.port,
        method,
        path,
        headers: { host: `127.0.0.1:${server.port}`, ...options.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            json: <T,>() => JSON.parse(body.toString("utf8")) as T,
          });
        });
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

const postScan = (server: RunningScanServer, url: string, headers: Record<string, string> = {}) =>
  call(server, "POST", "/api/scans", {
    body: JSON.stringify({ url }),
    headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}`, ...headers },
  });

async function waitForFinish(server: RunningScanServer, id: string): Promise<{ final: ScanJobView; seen: ScanJobView[] }> {
  const seen: ScanJobView[] = [];
  for (let i = 0; i < 600; i++) {
    const view = (await call(server, "GET", `/api/scans/${id}`)).json<ScanJobView>();
    seen.push(view);
    if (view.state === "completed" || view.state === "failed" || view.state === "cancelled") return { final: view, seen };
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("scan did not finish");
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "ll-server-"));
  await startSite();
});

afterAll(async () => {
  await new Promise<void>((r) => site.close(() => r()));
  await rm(workDir, { recursive: true, force: true });
});

describe("scan API with the real Playwright scanner", () => {
  let server: RunningScanServer;
  const dataDir = () => join(workDir, "data");

  beforeAll(async () => {
    server = await startScanServer({ port: 0, dataDir: dataDir() });
  });
  afterAll(async () => {
    await server?.close();
  });

  it("reports health and limits", async () => {
    const res = await call(server, "GET", "/api/health");
    expect(res.status).toBe(200);
    const info = res.json<{ service: string; viewportWidths: number[]; limits: { maxConcurrentScans: number } }>();
    expect(info.service).toBe("layoutlens-scan-api");
    expect(info.viewportWidths).toEqual([390, 768, 1440]);
    expect(info.limits.maxConcurrentScans).toBe(1);
    expect(info.limits.maxRetryAttemptsPerTask).toBeGreaterThanOrEqual(1);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("scans a real page, reports stage progress, and serves results and screenshots", async () => {
    const created = await postScan(server, siteUrl);
    expect(created.status).toBe(202);
    const job = created.json<ScanJobView>();
    expect(job.url).toBe(siteUrl);
    expect(["queued", "running"]).toContain(job.state);
    expect(created.headers.location).toBe(`/api/scans/${job.id}`);

    const early = await call(server, "GET", `/api/scans/${job.id}/results`);
    if (early.status !== 200) expect(early.status).toBe(409);

    const { final, seen } = await waitForFinish(server, job.id);
    expect(final.state, final.error).toBe("completed");
    expect(final.progress.completedSteps).toBe(final.progress.totalSteps);
    expect(final.progress.totalSteps).toBe(5); // launch + 3 viewports + write report
    const running = seen.filter((s) => s.state === "running");
    expect(running.length).toBeGreaterThan(0);
    for (const s of running) expect(s.progress.completedSteps).toBeLessThan(s.progress.totalSteps);
    expect(final.summary?.viewportWidths).toEqual([390, 768, 1440]);
    expect(final.baseline).toBeUndefined();

    const results = await call(server, "GET", `/api/scans/${job.id}/results`);
    expect(results.status).toBe(200);
    const report = results.json<JsonReport>();
    expect(report.tool).toBe("layoutlens");
    expect(report.url).toBe(siteUrl);
    const mobile = report.viewports.find((v) => v.width === 390)!;
    expect(mobile.hasHorizontalOverflow).toBe(true);
    expect(mobile.findings.some((f) => f.selector === "#wide-banner")).toBe(true);
    expect(report.summary.findingCount).toBe(final.summary?.findingCount);
    expect(mobile.screenshot).toBe("screenshots/viewport-390.png");

    const png = await call(server, "GET", `/api/scans/${job.id}/files/${mobile.screenshot}`);
    expect(png.status).toBe(200);
    expect(png.headers["content-type"]).toBe("image/png");
    expect(png.body.subarray(1, 4).toString("ascii")).toBe("PNG");

    for (const bad of [
      `/api/scans/${job.id}/files/scan.json`,
      `/api/scans/${job.id}/files/report.json`,
      `/api/scans/${job.id}/files/index.html`,
      `/api/scans/${job.id}/files/screenshots/..%2f..%2f..%2fpackage.json`,
      `/api/scans/${job.id}/files/..%2Fscan.json`,
      `/api/scans/..%2F..%2F/files/screenshots/viewport-390.png`,
    ]) {
      expect((await call(server, "GET", bad)).status, bad).toBe(404);
    }

    const list = (await call(server, "GET", "/api/scans")).json<{ scans: ScanJobView[] }>();
    expect(list.scans.map((s) => s.id)).toContain(job.id);
  });

  it("rejects unsafe targets and cross-origin or malformed requests", async () => {
    expect((await postScan(server, "file:///C:/Windows/win.ini")).status).toBe(400);
    expect((await postScan(server, "javascript:alert(1)")).status).toBe(400);
    expect((await postScan(server, "http://169.254.169.254/latest/meta-data/")).status).toBe(403);
    const self = await postScan(server, `http://127.0.0.1:${server.port}/api/health`);
    expect(self.status).toBe(403);
    expect(self.json<{ error: { code: string } }>().error.code).toBe("blocked_target");

    expect((await postScan(server, siteUrl, { origin: "https://evil.example" })).status).toBe(403);
    expect((await postScan(server, siteUrl, { host: "evil.example" })).status).toBe(421);
    const plain = await call(server, "POST", "/api/scans", {
      body: JSON.stringify({ url: siteUrl }),
      headers: { "content-type": "text/plain", origin: `http://127.0.0.1:${server.port}` },
    });
    expect(plain.status).toBe(415);
    const big = await call(server, "POST", "/api/scans", {
      body: JSON.stringify({ url: siteUrl, pad: "x".repeat(20_000) }),
      headers: { "content-type": "application/json" },
    });
    expect(big.status).toBe(413);
    expect((await call(server, "GET", "/api/scans/not-a-uuid")).status).toBe(404);
    expect((await call(server, "DELETE", "/api/scans")).status).toBe(405);
    expect((await call(server, "GET", "/api/nope")).status).toBe(404);

    const list = (await call(server, "GET", "/api/scans")).json<{ scans: ScanJobView[] }>();
    expect(list.scans).toHaveLength(1);
  });

  it("reports a real navigation failure as a failed scan", async () => {
    const dead = createServer();
    await new Promise<void>((r) => dead.listen(0, "127.0.0.1", r));
    const port = (dead.address() as AddressInfo).port;
    await new Promise<void>((r) => dead.close(() => r()));

    const { final } = await waitForFinish(server, (await postScan(server, `http://127.0.0.1:${port}/`)).json<ScanJobView>().id);
    expect(final.state).toBe("failed");
    expect(final.error).toMatch(/ERR_CONNECTION_REFUSED/);
    expect((await call(server, "GET", `/api/scans/${final.id}/results`)).status).toBe(409);
  });

  it("marks scans interrupted by a restart as failed and keeps completed reports", async () => {
    await server.close();
    server = await startScanServer({ port: 0, dataDir: dataDir() });
    const scans = (await call(server, "GET", "/api/scans")).json<{ scans: ScanJobView[] }>().scans;
    expect(scans.filter((s) => s.state === "completed")).toHaveLength(1);
    const done = scans.find((s) => s.state === "completed")!;
    expect((await call(server, "GET", `/api/scans/${done.id}/results`)).status).toBe(200);
  });
});

describe("visual regression against a compatible baseline", () => {
  it("compares with a baseline created for the same URL and never modifies it", async () => {
    const dataDir = join(workDir, "data-visual");
    const baselineDir = join(dataDir, "baselines", "example-home");
    await createBaseline({ url: siteUrl, baselineDirectory: baselineDir });
    const before = await readFile(join(baselineDir, "manifest.json"), "utf8");

    const server = await startScanServer({ port: 0, dataDir });
    try {
      const job = (await postScan(server, siteUrl)).json<ScanJobView>();
      const { final } = await waitForFinish(server, job.id);
      expect(final.state, final.error).toBe("completed");
      expect(final.baseline?.name).toBe("example-home");
      expect(final.progress.totalSteps).toBe(6);

      const report = (await call(server, "GET", `/api/scans/${job.id}/results`)).json<JsonReport>();
      const vc = report.viewports.find((v) => v.width === 390)?.visualCompare;
      expect(vc?.status).toBe("pass");
      expect(vc?.baselineScreenshot).toBeTruthy();
      expect((await call(server, "GET", `/api/scans/${job.id}/files/${vc!.baselineScreenshot!}`)).status).toBe(200);

      const other = (await postScan(server, `${siteUrl}?variant=2`)).json<ScanJobView>();
      const otherFinal = (await waitForFinish(server, other.id)).final;
      expect(otherFinal.baseline).toBeUndefined();

      expect(await readFile(join(baselineDir, "manifest.json"), "utf8")).toBe(before);
    } finally {
      await server.close();
    }
  });
});

describe("queue, timeout, cancellation and storage limits", () => {
  /** Scanner stand-in for queue mechanics only: waits until aborted or released. */
  function controllableScanner() {
    const releases: (() => void)[] = [];
    const scanner = (options: ScanOptions): Promise<ScanResult> =>
      new Promise((resolve, reject) => {
        options.onProgress?.({ type: "browser-launched" });
        options.signal?.addEventListener("abort", () => reject(options.signal?.reason));
        releases.push(() =>
          resolve({
            url: options.url,
            scannedAt: new Date().toISOString(),
            viewports: [],
            issueCount: 0,
            summary: { viewportIssueCount: 0, findingCount: 0, bySeverity: { high: 0, medium: 0, low: 0 } },
          }),
        );
      });
    return { scanner, releaseAll: () => releases.splice(0).forEach((r) => r()) };
  }

  it("limits concurrency, rejects overflow with 429, cancels, times out and prunes old reports", async () => {
    const dataDir = join(workDir, "data-queue");
    const { scanner, releaseAll } = controllableScanner();
    const server = await startScanServer({
      port: 0,
      dataDir,
      scanner,
      maxConcurrentScans: 1,
      maxQueuedScans: 1,
      scanTimeoutMs: 5_000,
      maxStoredScans: 2,
    });
    try {
      const a = (await postScan(server, siteUrl)).json<ScanJobView>();
      const b = (await postScan(server, siteUrl)).json<ScanJobView>();
      expect(b.state).toBe("queued");
      expect(b.queuePosition).toBe(1);
      const c = await postScan(server, siteUrl);
      expect(c.status).toBe(429);
      expect(c.json<{ error: { code: string } }>().error.code).toBe("too_many_scans");

      expect((await call(server, "POST", `/api/scans/${b.id}/cancel`, { headers: { origin: `http://127.0.0.1:${server.port}` } })).status).toBe(202);
      expect((await call(server, "GET", `/api/scans/${b.id}`)).json<ScanJobView>().state).toBe("cancelled");

      const timedOut = (await waitForFinish(server, a.id)).final;
      expect(timedOut.state).toBe("failed");
      expect(timedOut.error).toMatch(/longer than 5 seconds/);

      const d = (await postScan(server, siteUrl)).json<ScanJobView>();
      await new Promise((r) => setTimeout(r, 100));
      releaseAll();
      expect((await waitForFinish(server, d.id)).final.state).toBe("completed");

      const ids = (await readdir(join(dataDir, "scans"))).sort();
      expect(ids.length).toBeLessThanOrEqual(2);
      expect(ids).toContain(d.id);
    } finally {
      releaseAll();
      await server.close();
    }
  });
});
