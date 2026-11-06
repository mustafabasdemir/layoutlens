import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildSiteScanArtifacts, scanResultFromJsonReport, type SiteScanRunOptions, type SiteScanRunResult } from "@layoutlens/core";
import type { JsonReport, JsonSiteScanReport, ScanJobView, ScanOptions, ScanResult, SiteScanPageRecord } from "@layoutlens/shared";
import { INSPECTOR_SNAPSHOT_VERSION, mergeSiteScanScope, serializeJsonReport, VIEWPORT_WIDTHS } from "@layoutlens/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startScanServer, type RunningScanServer } from "./server.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

let site: Server;
let siteUrl: string;
let workDir: string;

async function startSite(): Promise<void> {
  const indexHtml = await readFile(join(repoRoot, "examples/broken-layout/index.html"));
  const styles = await readFile(join(repoRoot, "examples/broken-layout/styles.css"));
  const files: Record<string, [string, Buffer]> = {
    "/": ["text/html; charset=utf-8", indexHtml],
    "/b.html": ["text/html; charset=utf-8", indexHtml],
    "/styles.css": ["text/css; charset=utf-8", styles],
  };
  site = createServer((req, res) => {
    const u = (req.url ?? "/").split("?")[0]!;
    const file = files[u];
    if (file) res.writeHead(200, { "content-type": file[0] }).end(file[1]);
    else res.writeHead(404).end();
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;
}

interface Res {
  status: number;
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

function baseScanResult(url: string, viewports: ScanResult["viewports"], completion: ScanResult["summary"]["scanCompletionStatus"]): ScanResult {
  const nav = {
    requestedUrl: url,
    finalUrl: url,
    httpStatus: 200 as const,
    redirectChain: [] as const,
    responseOk: true,
    documentLoaded: true,
    kind: "ok" as const,
  };
  return {
    url,
    scannedAt: new Date().toISOString(),
    viewports,
    issueCount: 0,
    summary: {
      viewportIssueCount: 0,
      findingCount: 0,
      bySeverity: { high: 0, medium: 0, low: 0 },
      byClassification: { confirmed: 0, potential: 0, insufficientEvidence: 0 },
      excludedCount: 0,
      truncated: false,
      scanCompletionStatus: completion,
      viewportInspectionCompleteCount: viewports.filter((v) => v.inspectionStatus === "completed" || v.inspectionStatus === undefined).length,
      viewportInspectionFailedCount: viewports.filter((v) => v.inspectionStatus === "failed").length,
      viewportInspectionSkippedCount: viewports.filter((v) => v.inspectionStatus === "skipped").length,
      navigation: nav,
      scanTrust: "trusted",
    },
    navigation: nav,
  };
}

function viewportRow(
  width: number,
  label: string,
  h: number,
  inspectionStatus: import("@layoutlens/shared").ViewportInspectionStatus | undefined,
  inspectionError?: import("@layoutlens/shared").ViewportInspectionError,
  inspector?: import("@layoutlens/shared").InspectorSnapshot,
): ScanResult["viewports"][number] {
  return {
    width: width as ScanResult["viewports"][number]["width"],
    label,
    viewportHeight: h,
    documentScrollWidth: 400,
    documentClientWidth: width,
    hasHorizontalOverflow: false,
    overflowPx: 0,
    findings: [],
    overflowingElements: [],
    excluded: [],
    analysis: {
      elementsInspected: 0,
      candidateCount: 0,
      candidateLimit: 0,
      candidatesOmitted: 0,
      rootOverflowX: "visible",
      userScrollable: false,
      maskedOverflowPx: 0,
      unattributedOverflowPx: 0,
      findingLimit: 0,
      findingsOmitted: 0,
      excludedLimit: 0,
      excludedOmitted: 0,
      relatedLimit: 0,
    },
    ...(inspectionStatus !== undefined ? { inspectionStatus } : {}),
    ...(inspectionError ? { inspectionError } : {}),
    ...(inspector !== undefined ? { inspector } : {}),
    screenshot: `screenshots/viewport-${width}.png`,
  };
}

const DETERMINISTIC_INSPECTOR: import("@layoutlens/shared").InspectorSnapshot = {
  meta: {
    version: INSPECTOR_SNAPSHOT_VERSION,
    elementCount: 1,
    devicePixelRatio: 1,
    viewportWidth: 390,
    viewportHeight: 844,
    collectionDurationMs: 1,
    truncated: false,
    elementsOmitted: 0,
    maxDepth: 8,
    maxElements: 100,
    maxSelectorLength: 80,
  },
  elements: [
    {
      id: "el_det",
      tagName: "div",
      selector: "body > div",
      selectorMatches: 1,
      parentId: null,
      depth: 1,
      boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      visibleBox: { x: 0, y: 0, width: 10, height: 10 },
      scrollWidth: 10,
      scrollHeight: 10,
      clientWidth: 10,
      clientHeight: 10,
      computed: { display: "block" },
      relatedFindingIds: [],
    },
  ],
};

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function vp1FailStill(jr: JsonReport): boolean {
  return jr.viewports[1]?.inspectionStatus === "failed";
}

async function writePageReport(root: string, index: number, result: ScanResult): Promise<void> {
  const dir = join(root, "pages", String(index));
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, "screenshots"), { recursive: true });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  for (const vp of result.viewports) {
    if (vp.screenshot) await writeFile(join(dir, vp.screenshot.replace(/^\.\//, "")), png);
  }
  await writeFile(join(dir, "report.json"), serializeJsonReport(result), "utf8");
}

type MockMode = "one_viewport_fail" | "one_page_fail";

async function mockSiteScan(opts: SiteScanRunOptions, mockMode: MockMode = "one_viewport_fail"): Promise<SiteScanRunResult> {
  const root = opts.scan.artifacts?.directory;
  if (!root) throw new Error("artifacts.directory required");
  const scope = mergeSiteScanScope(opts.scope);
  const scannedAt = new Date().toISOString();
  const mode: MockMode = mockMode;
  const p0Url = opts.rootUrl.endsWith("/") ? opts.rootUrl : `${opts.rootUrl}/`;
  const p1Url = `${p0Url.replace(/\/$/, "")}/b.html`;

  const heights = [844, 1024, 900];

  const makeAllOk = (url: string): ScanResult => {
    const vps = VIEWPORT_WIDTHS.map((w, i) => viewportRow(w, String(w), heights[i]!, "completed", undefined, DETERMINISTIC_INSPECTOR));
    return baseScanResult(url, vps, "full");
  };

  const makeMiddleVpFail = (url: string): ScanResult => {
    const vps = VIEWPORT_WIDTHS.map((w, i) =>
      i === 1
        ? viewportRow(w, String(w), heights[i]!, "failed", {
            phase: "screenshot",
            message: "page.screenshot: Timeout 2500ms exceeded.",
          })
        : viewportRow(w, String(w), heights[i]!, "completed", undefined, DETERMINISTIC_INSPECTOR),
    );
    return baseScanResult(url, vps, "partial");
  };

  const pages: SiteScanPageRecord[] = [];

  if (mode === "one_page_fail") {
    const r0 = makeAllOk(p0Url);
    await writePageReport(root, 0, r0);
    pages.push({ url: p0Url, pageDir: join(root, "pages", "0"), result: r0 });
    await mkdir(join(root, "pages", "1"), { recursive: true });
    pages.push({ url: p1Url, pageDir: join(root, "pages", "1"), error: "net::ERR_TIMED_OUT at page.goto" });
    return rebuildSiteScanArtifacts({
      artifactsRoot: root,
      pages,
      rootUrl: p0Url,
      scope,
      scannedAt,
      signal: opts.scan.signal,
    });
  }

  for (let i = 0; i < 2; i++) {
    const url = i === 0 ? p0Url : p1Url;
    const r = makeMiddleVpFail(url);
    await writePageReport(root, i, r);
    pages.push({ url, pageDir: join(root, "pages", String(i)), result: r });
  }
  return rebuildSiteScanArtifacts({
    artifactsRoot: root,
    pages,
    rootUrl: p0Url,
    scope,
    scannedAt,
    signal: opts.scan.signal,
  });
}

async function waitForJob(server: RunningScanServer, id: string, want: ScanJobView["state"]): Promise<ScanJobView> {
  for (let i = 0; i < 400; i++) {
    const v = (await call(server, "GET", `/api/scans/${id}`)).json<ScanJobView>();
    if (v.state === "failed" || v.state === "cancelled") {
      throw new Error(`scan ended as ${v.state}: ${v.error ?? "no message"}`);
    }
    if (v.state === want) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timeout waiting for ${want}`);
}

async function waitRetryIdle(server: RunningScanServer, id: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const v = (await call(server, "GET", `/api/scans/${id}`)).json<ScanJobView>();
    if (!v.siteRetry || v.siteRetry.state === "idle") return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "ll-retry-"));
  await startSite();
});

afterAll(async () => {
  await new Promise<void>((r) => site.close(() => r()));
  await rm(workDir, { recursive: true, force: true });
});

describe("site-scan retry API (mocked crawl)", () => {
  const dataDir = () => join(workDir, "data-retry");

  it("retries a failed viewport, preserves merge baseline, and updates site totals", async () => {
    const scanner = vi.fn(async (options: ScanOptions): Promise<ScanResult> => {
      const reportPath = join(options.artifacts!.directory, "report.json");
      const json = JSON.parse(await readFile(reportPath, "utf8"));
      const merge = scanResultFromJsonReport(json);
      const vps = merge.viewports.map((v, i) =>
        i === 1 ? { ...v, inspectionStatus: "completed" as const, inspectionError: undefined } : v,
      );
      return {
        ...merge,
        viewports: vps,
        summary: {
          ...merge.summary,
          scanCompletionStatus: "full",
          viewportInspectionCompleteCount: 3,
          viewportInspectionFailedCount: 0,
          viewportInspectionSkippedCount: 0,
        },
      };
    });

    const server = await startScanServer({
      port: 0,
      dataDir: dataDir(),
      scanner,
      siteScanner: (opts) => mockSiteScan(opts, "one_viewport_fail"),
    });
    try {
      const created = await call(server, "POST", "/api/scans", {
        body: JSON.stringify({ url: siteUrl, mode: "multi_page", maxPages: 2, maxDepth: 1 }),
        headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
      });
      expect(created.status).toBe(202);
      const id = created.json<ScanJobView>().id;
      await waitForJob(server, id, "completed");

      const before = (await call(server, "GET", `/api/scans/${id}/results`)).json<{ summary: { totalViewportsCompleted: number } }>();
      const n0 = before.summary.totalViewportsCompleted;

      expect(
        (await call(server, "POST", `/api/scans/${id}/retry`, {
          body: JSON.stringify({ pageIndex: 0, viewportIndex: 1 }),
          headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
        })).status,
      ).toBe(202);

      await waitRetryIdle(server, id);
      expect(scanner).toHaveBeenCalledTimes(1);
      const arg = scanner.mock.calls[0]![0]!;
      expect(arg.mergePartialScan).toBeDefined();
      expect(arg.retryViewportIndices).toEqual([1]);

      const after = (await call(server, "GET", `/api/scans/${id}/results`)).json<{ summary: { totalViewportsCompleted: number } }>();
      expect(after.summary.totalViewportsCompleted).toBeGreaterThanOrEqual(n0);
    } finally {
      await server.close();
    }
  });

  it("duplicate retry POST while retry runs is idempotent (no second scanner run)", async () => {
    const scanner = vi.fn(async (options: ScanOptions): Promise<ScanResult> => {
      const reportPath = join(options.artifacts!.directory, "report.json");
      const merge = scanResultFromJsonReport(JSON.parse(await readFile(reportPath, "utf8")));
      const vps = merge.viewports.map((v, i) =>
        i === 1 ? { ...v, inspectionStatus: "completed" as const, inspectionError: undefined } : v,
      );
      return {
        ...merge,
        viewports: vps,
        summary: {
          ...merge.summary,
          scanCompletionStatus: "full",
          viewportInspectionCompleteCount: 3,
          viewportInspectionFailedCount: 0,
          viewportInspectionSkippedCount: 0,
        },
      };
    });

    const server = await startScanServer({
      port: 0,
      dataDir: dataDir(),
      scanner,
      siteScanner: (opts) => mockSiteScan(opts, "one_viewport_fail"),
    });
    try {
      const id = (
        await call(server, "POST", "/api/scans", {
          body: JSON.stringify({ url: siteUrl, mode: "multi_page", maxPages: 2, maxDepth: 1 }),
          headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
        })
      ).json<ScanJobView>().id;
      await waitForJob(server, id, "completed");

      const a = call(server, "POST", `/api/scans/${id}/retry`, {
        body: JSON.stringify({ pageIndex: 0, viewportIndex: 1 }),
        headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
      });
      const b = call(server, "POST", `/api/scans/${id}/retry`, {
        body: JSON.stringify({ pageIndex: 0, viewportIndex: 1 }),
        headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
      });
      expect((await a).status).toBe(202);
      expect((await b).status).toBe(202);
      await waitRetryIdle(server, id);
      expect(scanner).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
  });

  it("does not list HTTP 403 page failures as retry-eligible", async () => {
    const server = await startScanServer({
      port: 0,
      dataDir: dataDir(),
      siteScanner: (opts) => mockSiteScan(opts, "one_page_fail"),
    });
    try {
      const id = (
        await call(server, "POST", "/api/scans", {
          body: JSON.stringify({ url: siteUrl, mode: "multi_page", maxPages: 2, maxDepth: 1 }),
          headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
        })
      ).json<ScanJobView>().id;
      await waitForJob(server, id, "completed");

      const scanRoot = join(dataDir(), "scans", id);
      const reportPath = join(scanRoot, "report.json");
      const site = JSON.parse(await readFile(reportPath, "utf8")) as JsonSiteScanReport;
      site.pages[1] = {
        ...site.pages[1]!,
        status: "failed",
        error: "HTTP 403 Forbidden — access denied",
      };
      await writeFile(reportPath, JSON.stringify(site, null, 2));

      const view = (await call(server, "GET", `/api/scans/${id}`)).json<ScanJobView>();
      const pageTasks = view.siteRetry?.tasks.filter((t) => t.kind === "page" && t.pageIndex === 1) ?? [];
      expect(pageTasks.length).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("returns retry_limit after repeated failures exhaust maxRetryAttemptsPerTask", async () => {
    const scanner = vi.fn(async (options: ScanOptions): Promise<ScanResult> => {
      void options;
      throw new Error("page.screenshot: still failing");
    });
    const server = await startScanServer({
      port: 0,
      dataDir: dataDir(),
      scanner,
      siteScanner: (opts) => mockSiteScan(opts, "one_viewport_fail"),
      maxRetryAttemptsPerTask: 1,
    });
    try {
      const id = (
        await call(server, "POST", "/api/scans", {
          body: JSON.stringify({ url: siteUrl, mode: "multi_page", maxPages: 2, maxDepth: 1 }),
          headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
        })
      ).json<ScanJobView>().id;
      await waitForJob(server, id, "completed");

      expect(
        (
          await call(server, "POST", `/api/scans/${id}/retry`, {
            body: JSON.stringify({ pageIndex: 0, viewportIndex: 1 }),
            headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
          })
        ).status,
      ).toBe(202);
      await waitRetryIdle(server, id);
      expect(scanner).toHaveBeenCalledTimes(1);

      const second = await call(server, "POST", `/api/scans/${id}/retry`, {
        body: JSON.stringify({ pageIndex: 0, viewportIndex: 1 }),
        headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
      });
      expect(second.status).toBe(409);
      expect(second.json<{ error: { code: string } }>().error.code).toBe("retry_limit");
      expect(scanner).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
  });

  it("cancels an in-flight viewport retry and records cancellation", async () => {
    const scanner = vi.fn(async (options: ScanOptions): Promise<ScanResult> => {
      await new Promise<never>((_, reject) => {
        const onAbort = (): void => {
          options.signal.removeEventListener("abort", onAbort);
          reject(options.signal.reason);
        };
        options.signal.addEventListener("abort", onAbort, { once: true });
      });
      throw new Error("unreachable");
    });
    const server = await startScanServer({
      port: 0,
      dataDir: dataDir(),
      scanner,
      siteScanner: (opts) => mockSiteScan(opts, "one_viewport_fail"),
    });
    try {
      const id = (
        await call(server, "POST", "/api/scans", {
          body: JSON.stringify({ url: siteUrl, mode: "multi_page", maxPages: 2, maxDepth: 1 }),
          headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
        })
      ).json<ScanJobView>().id;
      await waitForJob(server, id, "completed");

      void call(server, "POST", `/api/scans/${id}/retry`, {
        body: JSON.stringify({ pageIndex: 0, viewportIndex: 1 }),
        headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
      });
      await new Promise((r) => setTimeout(r, 80));
      await call(server, "POST", `/api/scans/${id}/cancel`, {
        headers: { origin: `http://127.0.0.1:${server.port}` },
      });
      await waitRetryIdle(server, id);
      expect(scanner).toHaveBeenCalledTimes(1);

      const disk = JSON.parse(
        await readFile(join(dataDir(), "scans", id, "scan.json"), "utf8"),
      ) as ScanJobView;
      const last = disk.siteRetryHistory?.at(-1);
      expect(last?.outcome).toBe("cancelled");
    } finally {
      await server.close();
    }
  });

  it("when cancel races a late scanner resolution, successful viewports keep prior screenshot and inspector bytes", async () => {
    const scanner = vi.fn(async (options: ScanOptions): Promise<ScanResult> => {
      const reportPath = join(options.artifacts!.directory, "report.json");
      const merge = scanResultFromJsonReport(JSON.parse(await readFile(reportPath, "utf8")));
      await new Promise((r) => setTimeout(r, 500));
      const vps = merge.viewports.map((v, i) =>
        i === 1 ? { ...v, inspectionStatus: "completed" as const, inspectionError: undefined, inspector: DETERMINISTIC_INSPECTOR } : v,
      );
      return {
        ...merge,
        viewports: vps,
        summary: {
          ...merge.summary,
          scanCompletionStatus: "full",
          viewportInspectionCompleteCount: 3,
          viewportInspectionFailedCount: 0,
          viewportInspectionSkippedCount: 0,
        },
      };
    });

    const server = await startScanServer({
      port: 0,
      dataDir: dataDir(),
      scanner,
      siteScanner: (opts) => mockSiteScan(opts, "one_viewport_fail"),
    });
    try {
      const id = (
        await call(server, "POST", "/api/scans", {
          body: JSON.stringify({ url: siteUrl, mode: "multi_page", maxPages: 2, maxDepth: 1 }),
          headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
        })
      ).json<ScanJobView>().id;
      await waitForJob(server, id, "completed");

      const page0 = join(dataDir(), "scans", id, "pages", "0");
      const before768 = await readFile(join(page0, "screenshots", "viewport-768.png"));
      const before768Hash = sha256Hex(before768);

      void call(server, "POST", `/api/scans/${id}/retry`, {
        body: JSON.stringify({ pageIndex: 0, viewportIndex: 1 }),
        headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
      });
      await new Promise((r) => setTimeout(r, 50));
      await call(server, "POST", `/api/scans/${id}/cancel`, {
        headers: { origin: `http://127.0.0.1:${server.port}` },
      });
      await waitRetryIdle(server, id);

      const after768 = await readFile(join(page0, "screenshots", "viewport-768.png"));
      expect(sha256Hex(after768)).toBe(before768Hash);

      const jr = JSON.parse(await readFile(join(page0, "report.json"), "utf8")) as JsonReport;
      const vp0 = jr.viewports[0]!;
      const vp2 = jr.viewports[2]!;
      expect(JSON.stringify(vp0.inspector)).toBe(JSON.stringify(DETERMINISTIC_INSPECTOR));
      expect(JSON.stringify(vp2.inspector)).toBe(JSON.stringify(DETERMINISTIC_INSPECTOR));
      expect(vp1FailStill(jr)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("persists retry completion across server restart", async () => {
    const scanner = vi.fn(async (options: ScanOptions): Promise<ScanResult> => {
      const reportPath = join(options.artifacts!.directory, "report.json");
      const merge = scanResultFromJsonReport(JSON.parse(await readFile(reportPath, "utf8")));
      const vps = merge.viewports.map((v, i) =>
        i === 1 ? { ...v, inspectionStatus: "completed" as const, inspectionError: undefined } : v,
      );
      return {
        ...merge,
        viewports: vps,
        summary: {
          ...merge.summary,
          scanCompletionStatus: "full",
          viewportInspectionCompleteCount: 3,
          viewportInspectionFailedCount: 0,
          viewportInspectionSkippedCount: 0,
        },
      };
    });
    const dir = dataDir();
    const server = await startScanServer({
      port: 0,
      dataDir: dir,
      scanner,
      siteScanner: (opts) => mockSiteScan(opts, "one_viewport_fail"),
    });
    let id: string;
    try {
      id = (
        await call(server, "POST", "/api/scans", {
          body: JSON.stringify({ url: siteUrl, mode: "multi_page", maxPages: 2, maxDepth: 1 }),
          headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
        })
      ).json<ScanJobView>().id;
      await waitForJob(server, id, "completed");
      expect(
        (
          await call(server, "POST", `/api/scans/${id}/retry`, {
            body: JSON.stringify({ pageIndex: 0, viewportIndex: 1 }),
            headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
          })
        ).status,
      ).toBe(202);
      await waitRetryIdle(server, id);
    } finally {
      await server.close();
    }

    const server2 = await startScanServer({
      port: 0,
      dataDir: dir,
      scanner: vi.fn(),
      siteScanner: (opts) => mockSiteScan(opts, "one_viewport_fail"),
    });
    try {
      const view = (await call(server2, "GET", `/api/scans/${id}`)).json<ScanJobView>();
      expect(view.siteRetry?.state).toBe("idle");
      const disk = JSON.parse(await readFile(join(dir, "scans", id, "scan.json"), "utf8")) as ScanJobView;
      expect(disk.siteRetryHistory?.some((h) => h.outcome === "success")).toBe(true);
    } finally {
      await server2.close();
    }
  });

  it("after restart during a hung retry, the job stays completed and idle", async () => {
    const scanner = vi.fn(async (options: ScanOptions): Promise<ScanResult> => {
      await new Promise<void>((resolve) => {
        const id = setInterval(() => {
          if (options.signal.aborted) {
            clearInterval(id);
            resolve();
          }
        }, 15);
      });
      throw options.signal.reason;
    });
    const dir = dataDir();
    const server = await startScanServer({
      port: 0,
      dataDir: dir,
      scanner,
      siteScanner: (opts) => mockSiteScan(opts, "one_viewport_fail"),
    });
    let id: string;
    try {
      id = (
        await call(server, "POST", "/api/scans", {
          body: JSON.stringify({ url: siteUrl, mode: "multi_page", maxPages: 2, maxDepth: 1 }),
          headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
        })
      ).json<ScanJobView>().id;
      await waitForJob(server, id, "completed");
      void call(server, "POST", `/api/scans/${id}/retry`, {
        body: JSON.stringify({ pageIndex: 0, viewportIndex: 1 }),
        headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
      });
      await new Promise((r) => setTimeout(r, 60));
    } finally {
      await server.close();
    }

    const server2 = await startScanServer({
      port: 0,
      dataDir: dir,
      scanner: vi.fn(),
      siteScanner: (opts) => mockSiteScan(opts, "one_viewport_fail"),
    });
    try {
      const view = (await call(server2, "GET", `/api/scans/${id}`)).json<ScanJobView>();
      expect(view.state).toBe("completed");
      expect(view.siteRetry?.state).toBe("idle");
    } finally {
      await server2.close();
    }
  });

  it("keeps screenshot bytes unchanged for viewports that were already completed after a targeted retry", async () => {
    const scanner = vi.fn(async (options: ScanOptions): Promise<ScanResult> => {
      const reportPath = join(options.artifacts!.directory, "report.json");
      const merge = scanResultFromJsonReport(JSON.parse(await readFile(reportPath, "utf8")));
      const vps = merge.viewports.map((v, i) =>
        i === 1 ? { ...v, inspectionStatus: "completed" as const, inspectionError: undefined } : v,
      );
      return {
        ...merge,
        viewports: vps,
        summary: {
          ...merge.summary,
          scanCompletionStatus: "full",
          viewportInspectionCompleteCount: 3,
          viewportInspectionFailedCount: 0,
          viewportInspectionSkippedCount: 0,
        },
      };
    });
    const server = await startScanServer({
      port: 0,
      dataDir: dataDir(),
      scanner,
      siteScanner: (opts) => mockSiteScan(opts, "one_viewport_fail"),
    });
    try {
      const id = (
        await call(server, "POST", "/api/scans", {
          body: JSON.stringify({ url: siteUrl, mode: "multi_page", maxPages: 2, maxDepth: 1 }),
          headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
        })
      ).json<ScanJobView>().id;
      await waitForJob(server, id, "completed");

      const page0 = join(dataDir(), "scans", id, "pages", "0");
      const hashesBefore = await Promise.all(
        VIEWPORT_WIDTHS.map(async (w) => sha256Hex(await readFile(join(page0, "screenshots", `viewport-${w}.png`)))),
      );

      expect(
        (
          await call(server, "POST", `/api/scans/${id}/retry`, {
            body: JSON.stringify({ pageIndex: 0, viewportIndex: 1 }),
            headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
          })
        ).status,
      ).toBe(202);
      await waitRetryIdle(server, id);

      const hashesAfter = await Promise.all(
        VIEWPORT_WIDTHS.map(async (w) => sha256Hex(await readFile(join(page0, "screenshots", `viewport-${w}.png`)))),
      );
      expect(hashesAfter[0]).toBe(hashesBefore[0]);
      expect(hashesAfter[2]).toBe(hashesBefore[2]);
      const jr = JSON.parse(await readFile(join(page0, "report.json"), "utf8")) as JsonReport;
      expect(JSON.stringify(jr.viewports[0]!.inspector)).toBe(JSON.stringify(DETERMINISTIC_INSPECTOR));
      expect(JSON.stringify(jr.viewports[2]!.inspector)).toBe(JSON.stringify(DETERMINISTIC_INSPECTOR));
    } finally {
      await server.close();
    }
  });

  it("reconciles per-page scanCompletionStatus after a successful viewport retry", async () => {
    const scanner = vi.fn(async (options: ScanOptions): Promise<ScanResult> => {
      const reportPath = join(options.artifacts!.directory, "report.json");
      const merge = scanResultFromJsonReport(JSON.parse(await readFile(reportPath, "utf8")));
      const vps = merge.viewports.map((v, i) =>
        i === 1 ? { ...v, inspectionStatus: "completed" as const, inspectionError: undefined } : v,
      );
      return {
        ...merge,
        viewports: vps,
        summary: {
          ...merge.summary,
          scanCompletionStatus: "full",
          viewportInspectionCompleteCount: 3,
          viewportInspectionFailedCount: 0,
          viewportInspectionSkippedCount: 0,
        },
      };
    });
    const server = await startScanServer({
      port: 0,
      dataDir: dataDir(),
      scanner,
      siteScanner: (opts) => mockSiteScan(opts, "one_viewport_fail"),
    });
    try {
      const id = (
        await call(server, "POST", "/api/scans", {
          body: JSON.stringify({ url: siteUrl, mode: "multi_page", maxPages: 2, maxDepth: 1 }),
          headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
        })
      ).json<ScanJobView>().id;
      await waitForJob(server, id, "completed");

      const before = (await call(server, "GET", `/api/scans/${id}/results`)).json<JsonSiteScanReport>();
      expect(before.pages[0]!.scanCompletionStatus).toBe("partial");

      expect(
        (
          await call(server, "POST", `/api/scans/${id}/retry`, {
            body: JSON.stringify({ pageIndex: 0, viewportIndex: 1 }),
            headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
          })
        ).status,
      ).toBe(202);
      await waitRetryIdle(server, id);

      const after = (await call(server, "GET", `/api/scans/${id}/results`)).json<JsonSiteScanReport>();
      expect(after.pages[0]!.scanCompletionStatus).toBe("full");
    } finally {
      await server.close();
    }
  });

  it("whole-page retry does not duplicate site.pages entries", async () => {
    const scanner = vi.fn(async (options: ScanOptions): Promise<ScanResult> => {
      const heights = [844, 1024, 900];
      const p0Url = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
      const vps = VIEWPORT_WIDTHS.map((w, i) => viewportRow(w, String(w), heights[i]!, "completed"));
      return baseScanResult(p0Url, vps, "full");
    });
    const server = await startScanServer({
      port: 0,
      dataDir: dataDir(),
      scanner,
      siteScanner: (opts) => mockSiteScan(opts, "one_page_fail"),
    });
    try {
      const id = (
        await call(server, "POST", "/api/scans", {
          body: JSON.stringify({ url: siteUrl, mode: "multi_page", maxPages: 2, maxDepth: 1 }),
          headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
        })
      ).json<ScanJobView>().id;
      await waitForJob(server, id, "completed");

      const nBefore = ((await call(server, "GET", `/api/scans/${id}/results`)).json() as JsonSiteScanReport).pages.length;

      expect(
        (
          await call(server, "POST", `/api/scans/${id}/retry`, {
            body: JSON.stringify({ pageIndex: 1 }),
            headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
          })
        ).status,
      ).toBe(202);
      await waitRetryIdle(server, id);

      const nAfter = ((await call(server, "GET", `/api/scans/${id}/results`)).json() as JsonSiteScanReport).pages.length;
      expect(nAfter).toBe(nBefore);
    } finally {
      await server.close();
    }
  });

  it("rejects retry with invalid scan id", async () => {
    const server = await startScanServer({ port: 0, dataDir: dataDir() });
    try {
      const res = await call(server, "POST", "/api/scans/not-a-uuid/retry", {
        body: JSON.stringify({ pageIndex: 0, viewportIndex: 1 }),
        headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
      });
      expect(res.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("rejects retry with invalid viewport index", async () => {
    const server = await startScanServer({
      port: 0,
      dataDir: dataDir(),
      siteScanner: (opts) => mockSiteScan(opts, "one_viewport_fail"),
    });
    try {
      const id = (
        await call(server, "POST", "/api/scans", {
          body: JSON.stringify({ url: siteUrl, mode: "multi_page", maxPages: 2, maxDepth: 1 }),
          headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
        })
      ).json<ScanJobView>().id;
      await waitForJob(server, id, "completed");

      const res = await call(server, "POST", `/api/scans/${id}/retry`, {
        body: JSON.stringify({ pageIndex: 0, viewportIndex: 99 }),
        headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
      });
      expect(res.status).toBe(400);
      expect(res.json<{ error: { code: string } }>().error.code).toBe("invalid_viewport_index");
    } finally {
      await server.close();
    }
  });

  it("blocks retry while another scan is running (scanner_busy)", async () => {
    const blockUntilAbort = vi.fn(async (options: ScanOptions): Promise<ScanResult> => {
      await new Promise<never>((_, reject) => {
        const onAbort = (): void => {
          options.signal.removeEventListener("abort", onAbort);
          reject(options.signal.reason);
        };
        options.signal.addEventListener("abort", onAbort, { once: true });
      });
      throw new Error("unreachable");
    });
    const server = await startScanServer({
      port: 0,
      dataDir: dataDir(),
      maxConcurrentScans: 1,
      maxQueuedScans: 2,
      scanner: blockUntilAbort,
      siteScanner: (opts) => mockSiteScan(opts, "one_viewport_fail"),
    });
    let runningId: string | undefined;
    let queuedId: string | undefined;
    try {
      const completedId = (
        await call(server, "POST", "/api/scans", {
          body: JSON.stringify({ url: siteUrl, mode: "multi_page", maxPages: 2, maxDepth: 1 }),
          headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
        })
      ).json<ScanJobView>().id;
      await waitForJob(server, completedId, "completed");

      const firstHang = await call(server, "POST", "/api/scans", {
        body: JSON.stringify({ url: siteUrl, mode: "single_page" }),
        headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
      });
      expect(firstHang.status).toBe(202);
      runningId = firstHang.json<ScanJobView>().id;

      const secondHang = await call(server, "POST", "/api/scans", {
        body: JSON.stringify({ url: siteUrl, mode: "single_page" }),
        headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
      });
      expect(secondHang.status).toBe(202);
      queuedId = secondHang.json<ScanJobView>().id;

      for (let i = 0; i < 200; i++) {
        const r = (await call(server, "GET", `/api/scans/${runningId}`)).json<ScanJobView>();
        const q = (await call(server, "GET", `/api/scans/${queuedId}`)).json<ScanJobView>();
        if (r.state === "running" && q.state === "queued") break;
        await new Promise((res) => setTimeout(res, 20));
      }
      expect((await call(server, "GET", `/api/scans/${runningId}`)).json<ScanJobView>().state).toBe("running");
      expect((await call(server, "GET", `/api/scans/${queuedId}`)).json<ScanJobView>().state).toBe("queued");

      const res = await call(server, "POST", `/api/scans/${completedId}/retry`, {
        body: JSON.stringify({ pageIndex: 0, viewportIndex: 1 }),
        headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
      });
      expect(res.status).toBe(409);
      expect(res.json<{ error: { code: string } }>().error.code).toBe("scanner_busy");
    } finally {
      for (const id of [runningId, queuedId]) {
        if (id === undefined) continue;
        await call(server, "POST", `/api/scans/${id}/cancel`, {
          headers: { origin: `http://127.0.0.1:${server.port}` },
        });
      }
      await server.close();
    }
  });

  it("initializes siteRetryAttempts for persisted multi-page jobs that omit retry metadata", async () => {
    const dir = dataDir();
    const server = await startScanServer({
      port: 0,
      dataDir: dir,
      siteScanner: (opts) => mockSiteScan(opts, "one_viewport_fail"),
    });
    let id: string;
    try {
      id = (
        await call(server, "POST", "/api/scans", {
          body: JSON.stringify({ url: siteUrl, mode: "multi_page", maxPages: 2, maxDepth: 1 }),
          headers: { "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
        })
      ).json<ScanJobView>().id;
      await waitForJob(server, id, "completed");
    } finally {
      await server.close();
    }

    const scanPath = join(dir, "scans", id, "scan.json");
    const raw = JSON.parse(await readFile(scanPath, "utf8")) as Record<string, unknown>;
    delete raw.siteRetryAttempts;
    await writeFile(scanPath, JSON.stringify(raw, null, 2));

    const server2 = await startScanServer({ port: 0, dataDir: dir });
    await server2.close();

    const fixed = JSON.parse(await readFile(scanPath, "utf8")) as Record<string, unknown>;
    expect(fixed.siteRetryAttempts).toEqual({ v: {}, p: {} });
  });
});
