import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  rebuildSiteScanArtifacts,
  scanResultFromJsonReport,
  scanSite,
  scanUrl,
  type SiteScanPageRecord,
} from "@layoutlens/core";
import { writeHtmlReportBundle } from "@layoutlens/report";
import {
  SCAN_API_SERVICE,
  DEFAULT_VIEWPORT_SPECS,
  VIEWPORT_WIDTHS,
  getViewportLabel,
  mergeSiteScanScope,
  mergeViewportSpecs,
  serializeJsonReport,
  type JsonReport,
  type JsonSiteScanReport,
  type RetryScanRequestBody,
  type ScanJobView,
  type ScanOptions,
  type ScanProgressEvent,
  type ScanResult,
  type ScanServiceInfo,
  type ScanServiceLimits,
  type SiteScanRetryTaskView,
  type SiteScanRetryView,
  type ViewportFailurePhase,
  type ViewportSpec,
} from "@layoutlens/shared";
import { assertScanTargetAllowed, parseScanTargetUrl } from "@layoutlens/shared/scan-url-policy";
import { readBaselineManifest, urlKeyForBaseline } from "@layoutlens/visual";
import { ApiError } from "./errors.js";
import { ScanStore, SCAN_ID_PATTERN, type StoredScan } from "./scan-store.js";
import { assertAllowedTarget, parseTargetUrl, type HostLookup } from "./url-policy.js";
import {
  isPageNavigationTrustedForRetry,
  isPageErrorRetryEligible as isPageErrorRetryEligibleServer,
  isViewportRetryEligible,
  listEligiblePageRetries,
  listEligibleViewportRetries,
} from "./retry-policy.js";

export const SERVER_VERSION = "0.6.1";
const DEFAULT_VIEWPORT_HEIGHT = 844;
const DEFAULT_MAX_RETRY_ATTEMPTS_PER_TASK = 3;
const MAX_SITE_RETRY_HISTORY = 80;

const RETRYABLE_PHASES_SERVER: ReadonlySet<ViewportFailurePhase> = new Set([
  "readiness",
  "viewport-resize",
  "measurement",
  "inspector",
  "screenshot",
  "navigation",
]);

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const r: unknown = signal.reason;
  if (r instanceof Error) throw r;
  throw new DOMException("Aborted", "AbortError");
}
const BASELINE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_BASELINE_DIRS = 200;

export interface ScanServiceOptions {
  /** Root for local data; reports go to `<dataDir>/scans`. */
  dataDir: string;
  /** Read-only baseline folders; defaults to `<dataDir>/baselines`. */
  baselinesDir?: string;
  maxConcurrentScans?: number;
  maxQueuedScans?: number;
  scanTimeoutMs?: number;
  maxStoredScans?: number;
  maxStorageBytes?: number;
  allowPrivateNetwork?: boolean;
  /** Loopback ports the scanner must not target (filled in by the HTTP host). */
  blockedLoopbackPorts?: () => readonly number[];
  lookup?: HostLookup;
  /** Scanner implementation; defaults to the real Playwright scanner. */
  scanner?: (options: ScanOptions) => Promise<ScanResult>;
  siteScanner?: typeof scanSite;
  /** Phase 10.3 — max user retries per page or viewport task. */
  maxRetryAttemptsPerTask?: number;
}

interface CompatibleBaseline {
  name: string;
  directory: string;
  createdAt: string;
}

interface Job {
  record: StoredScan;
  controller?: AbortController;
  cancelRequested?: boolean;
  saving?: Promise<void>;
  /** Phase 10.3 — in-flight viewport retry for a completed multi-page scan. */
  retryController?: AbortController;
  retryPromise?: Promise<void>;
  /** Set synchronously before any await in `retry()` so concurrent POSTs dedupe. */
  retryStarting?: boolean;
  retryMeta?: { current?: SiteScanRetryView["current"]; message?: string };
}

class ScanTimeoutError extends Error {
  override name = "ScanTimeoutError";
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** Short, single-line message safe to show in the UI. */
export function describeScanError(error: unknown, timeoutMs: number): string {
  if (error instanceof ScanTimeoutError) {
    return `The scan took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped.`;
  }
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = (raw.replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0] ?? "").trim();
  if (/Executable doesn't exist|browserType\.launch/i.test(raw)) {
    return "Chromium isn't installed for Playwright. Run `pnpm browser:install` and try again.";
  }
  const net = /net::(ERR_[A-Z_]+)/.exec(raw);
  if (net) return `The page couldn't be loaded (${net[1]}).`;
  if (/Timeout \d+ms exceeded/i.test(raw)) {
    const m = /page\.(goto|screenshot|waitForLoadState)/.exec(raw);
    const op = m?.[1];
    const opLabel =
      op === "screenshot"
        ? "taking a screenshot"
        : op === "waitForLoadState"
          ? "waiting for a load milestone"
          : "loading the page";
    const detail = firstLine.length > 0 ? ` (${firstLine.slice(0, 200)})` : "";
    return `The scanner timed out while ${opLabel}.${detail}`.slice(0, 400);
  }
  return (firstLine || "The scan failed.").slice(0, 300);
}

export class ScanService {
  readonly limits: ScanServiceLimits;
  readonly dataDir: string;
  readonly baselinesDir: string;
  private readonly store: ScanStore;
  private readonly jobs = new Map<string, Job>();
  private readonly queue: string[] = [];
  private running = 0;
  private readonly allowPrivateNetwork: boolean;
  private readonly blockedPorts: () => readonly number[];
  private readonly lookup: HostLookup | undefined;
  private readonly scanner: (options: ScanOptions) => Promise<ScanResult>;
  private readonly siteScanner: typeof scanSite;
  private readonly idle = new Set<() => void>();
  private closed = false;

  constructor(options: ScanServiceOptions) {
    this.dataDir = resolve(options.dataDir);
    this.baselinesDir = resolve(options.baselinesDir ?? join(this.dataDir, "baselines"));
    this.store = new ScanStore(join(this.dataDir, "scans"));
    this.limits = {
      maxConcurrentScans: clampInt(options.maxConcurrentScans, 1, 1, 4),
      maxQueuedScans: clampInt(options.maxQueuedScans, 5, 0, 50),
      scanTimeoutMs: clampInt(options.scanTimeoutMs, 180_000, 5_000, 900_000),
      maxStoredScans: clampInt(options.maxStoredScans, 50, 1, 1000),
      maxStorageBytes: clampInt(options.maxStorageBytes, 1024 * 1024 * 1024, 10 * 1024 * 1024, 50 * 1024 ** 3),
      maxRetryAttemptsPerTask: clampInt(options.maxRetryAttemptsPerTask, DEFAULT_MAX_RETRY_ATTEMPTS_PER_TASK, 1, 20),
    };
    this.allowPrivateNetwork = options.allowPrivateNetwork ?? true;
    this.blockedPorts = options.blockedLoopbackPorts ?? (() => []);
    this.lookup = options.lookup;
    this.scanner = options.scanner ?? scanUrl;
    this.siteScanner = options.siteScanner ?? scanSite;
  }

  async init(): Promise<void> {
    await this.store.init();
    for (const record of await this.store.loadAll()) {
      if (record.state === "queued" || record.state === "running") {
        record.state = "failed";
        record.error = "The scan was interrupted because the LayoutLens server stopped.";
        record.finishedAt ??= new Date().toISOString();
        await this.store.save(record);
      }
      if (record.scanMode === "multi_page" && record.siteRetryAttempts === undefined) {
        record.siteRetryAttempts = { v: {}, p: {} };
        await this.store.save(record);
      }
      this.jobs.set(record.id, { record });
    }
  }

  info(): ScanServiceInfo {
    const defaultViewportHeights: Record<number, number> = {};
    for (const v of DEFAULT_VIEWPORT_SPECS) {
      defaultViewportHeights[v.width] = v.height;
    }
    return {
      service: SCAN_API_SERVICE,
      version: SERVER_VERSION,
      viewportWidths: VIEWPORT_WIDTHS,
      defaultViewportHeights,
      limits: this.limits,
      allowPrivateNetwork: this.allowPrivateNetwork,
      dataDirectory: this.dataDir,
      baselinesDirectory: this.baselinesDir,
    };
  }

  private async toJobView(job: Job): Promise<ScanJobView> {
    const view: ScanJobView = { ...job.record, progress: { ...job.record.progress } };
    if (job.record.state === "queued") {
      const pos = this.queue.indexOf(job.record.id);
      if (pos !== -1) view.queuePosition = pos + 1;
    }
    if (
      job.record.state === "running" &&
      job.record.scanMode === "multi_page" &&
      job.record.progress.site?.phase === "done" &&
      job.retryMeta
    ) {
      view.progress = {
        ...view.progress,
        site: {
          ...view.progress.site!,
          phase: "scanning",
        },
        message: job.retryMeta.message ?? "Retrying failed tasks",
        indeterminate: true,
      };
    }
    if (view.scanMode === "multi_page" && view.state === "completed") {
      const siteRetry = await this.buildSiteRetryView(job).catch(() => undefined);
      if (siteRetry) view.siteRetry = siteRetry;
    }
    delete view.siteRetryAttempts;
    return view;
  }

  async list(): Promise<ScanJobView[]> {
    const jobs = [...this.jobs.values()].sort((a, b) => b.record.createdAt.localeCompare(a.record.createdAt));
    return Promise.all(jobs.map((j) => this.toJobView(j)));
  }

  async get(id: string): Promise<ScanJobView> {
    return this.toJobView(this.requireJob(id));
  }

  private requireJob(id: string): Job {
    const job = SCAN_ID_PATTERN.test(id) ? this.jobs.get(id) : undefined;
    if (!job) throw new ApiError(404, "scan_not_found", "No scan with that id exists on this machine.");
    return job;
  }

  private ensureRetryMaps(record: StoredScan): { v: Record<string, number>; p: Record<string, number> } {
    if (!record.siteRetryAttempts) record.siteRetryAttempts = { v: {}, p: {} };
    return record.siteRetryAttempts;
  }

  private viewportAttemptKey(pageIndex: number, viewportIndex: number): string {
    return `${pageIndex}:${viewportIndex}`;
  }

  private async loadSiteScanReports(scanId: string): Promise<{ site: JsonSiteScanReport; reports: Map<number, JsonReport> }> {
    const root = this.store.dirFor(scanId);
    const site = JSON.parse(await readFile(join(root, "report.json"), "utf8")) as JsonSiteScanReport;
    if (site.tool !== "layoutlens-site") throw new ApiError(409, "retry_not_site", "Retry is only available for multi-page site scans.");
    const reports = new Map<number, JsonReport>();
    for (let i = 0; i < site.pages.length; i++) {
      const row = site.pages[i]!;
      if (row.status !== "completed") continue;
      try {
        const raw = await readFile(join(root, "pages", String(i), "report.json"), "utf8");
        reports.set(i, JSON.parse(raw) as JsonReport);
      } catch {
        /* missing report — whole-page retry may apply */
      }
    }
    return { site, reports };
  }

  private async buildSiteRetryView(job: Job): Promise<SiteScanRetryView | undefined> {
    if (job.record.scanMode !== "multi_page" || job.record.state !== "completed") return undefined;
    let site: JsonSiteScanReport;
    let reports: Map<number, JsonReport>;
    try {
      const loaded = await this.loadSiteScanReports(job.record.id);
      site = loaded.site;
      reports = loaded.reports;
    } catch {
      return undefined;
    }
    const max = this.limits.maxRetryAttemptsPerTask;
    const attempts = this.ensureRetryMaps(job.record);
    const tasks: SiteScanRetryTaskView[] = [];
    for (const t of listEligibleViewportRetries(site, reports)) {
      const k = this.viewportAttemptKey(t.pageIndex, t.viewportIndex);
      const n = attempts.v[k] ?? 0;
      const eligible = n < max;
      tasks.push({
        kind: "viewport",
        pageIndex: t.pageIndex,
        viewportIndex: t.viewportIndex,
        phase: t.phase,
        message: t.message,
        attemptCount: n,
        eligible,
        ...(!eligible ? { ineligibleReason: `Maximum retry attempts (${max}) reached for this viewport.` } : {}),
      });
    }
    for (const t of listEligiblePageRetries(site)) {
      const k = String(t.pageIndex);
      const n = attempts.p[k] ?? 0;
      const eligible = n < max;
      tasks.push({
        kind: "page",
        pageIndex: t.pageIndex,
        message: t.message,
        attemptCount: n,
        eligible,
        ...(!eligible ? { ineligibleReason: `Maximum retry attempts (${max}) reached for this page.` } : {}),
      });
    }
    const running = Boolean(job.retryPromise || job.retryStarting);
    return {
      state: running ? "running" : "idle",
      maxAttemptsPerTask: max,
      tasks,
      ...(job.retryMeta?.current !== undefined ? { current: job.retryMeta.current } : {}),
      ...(job.retryMeta?.message !== undefined ? { message: job.retryMeta.message } : {}),
      ...(job.record.siteRetryHistory ? { history: job.record.siteRetryHistory } : {}),
    };
  }

  private appendRetryHistory(
    record: StoredScan,
    entry: NonNullable<SiteScanRetryView["history"]>[number],
  ): void {
    const prev = record.siteRetryHistory ?? [];
    record.siteRetryHistory = [...prev, entry].slice(-MAX_SITE_RETRY_HISTORY);
  }

  private assertNoConcurrentWork(forScanId: string): void {
    const hasQueuedOrPrimary = [...this.jobs.values()].some(
      (j) => (j.record.state === "queued" || j.record.state === "running") && !j.retryPromise,
    );
    if (hasQueuedOrPrimary) {
      throw new ApiError(409, "scanner_busy", "Wait until active scans finish before retrying a site scan.");
    }
    if ([...this.jobs.values()].some((j) => (j.retryPromise || j.retryStarting) && j.record.id !== forScanId)) {
      throw new ApiError(409, "retry_busy", "Another scan has a retry in progress.");
    }
  }

  private notifyIdleIfQuiet(): void {
    if (
      this.running === 0 &&
      this.queue.length === 0 &&
      ![...this.jobs.values()].some((j) => j.retryPromise || j.retryStarting)
    ) {
      for (const r of this.idle) r();
      this.idle.clear();
    }
  }

  private async runViewportRetryTask(
    job: Job,
    site: JsonSiteScanReport,
    pageIndex: number,
    viewportIndex: number,
    signal: AbortSignal,
    save: () => Promise<void>,
  ): Promise<void> {
    const record = job.record;
    const directory = this.store.dirFor(record.id);
    const pageDir = join(directory, "pages", String(pageIndex));
    await mkdir(pageDir, { recursive: true });
    const rawReport = await readFile(join(pageDir, "report.json"), "utf8");
    const jsonReport = JSON.parse(rawReport) as JsonReport;
    const parsedPageUrl = parseScanTargetUrl(jsonReport.url);
    await assertScanTargetAllowed(parsedPageUrl, {
      allowPrivateNetwork: this.allowPrivateNetwork,
      blockedLoopbackPorts: this.blockedPorts,
      ...(this.lookup ? { lookup: this.lookup } : {}),
    });
    const mergeBaseline = scanResultFromJsonReport(jsonReport);
    const timeoutMs = this.limits.scanTimeoutMs;
    const navBudget = Math.max(5_000, Math.min(30_000, Math.floor(timeoutMs / 8)));
    const viewportSpecs: ViewportSpec[] | undefined =
      record.viewports && record.viewports.length > 0
        ? mergeViewportSpecs(record.viewports.map((v) => ({ width: v.width, height: v.height })))
        : undefined;
    const onProgress = (event: ScanProgressEvent) => {
      const p = record.progress;
      p.mode = "multi_page";
      if (event.type === "browser-launched") {
        p.completedSteps += 1;
      } else if (event.type === "viewport-started") {
        const h = event.height ?? DEFAULT_VIEWPORT_HEIGHT;
        const label = getViewportLabel(event.width, h);
        p.message = `[retry ${pageIndex + 1}/${site.pages.length}] ${label}`;
        p.site = {
          ...p.site,
          rootUrl: site.rootUrl,
          phase: "scanning",
          currentPageUrl: jsonReport.url,
          activePageIndex: pageIndex + 1,
          activePageTotal: site.pages.length,
          currentViewport: {
            width: event.width,
            height: h,
            label,
            index: event.index + 1,
            total: event.total,
          },
        };
        p.indeterminate = true;
      } else if (event.type === "viewport-completed") {
        const h = event.height ?? DEFAULT_VIEWPORT_HEIGHT;
        const label = getViewportLabel(event.width, h);
        if (event.status === "failed" && event.message) {
          p.message = `[retry] ${label}: ${event.message}`;
        }
      }
      void save();
    };
    const result = await this.scanner({
      url: jsonReport.url,
      headless: true,
      artifacts: { directory: pageDir },
      ...(viewportSpecs !== undefined ? { viewports: viewportSpecs } : { viewportHeight: DEFAULT_VIEWPORT_HEIGHT }),
      inspector: { enabled: true },
      signal,
      onProgress,
      mergePartialScan: mergeBaseline,
      retryViewportIndices: [viewportIndex],
      timeouts: {
        navigationMs: navBudget,
        readinessMs: Math.min(30_000, Math.max(5_000, navBudget)),
        screenshotMs: Math.min(45_000, Math.max(10_000, navBudget)),
        postLoadSettleMs: 2_500,
      },
    });
    if (signal.aborted) throw signal.reason;
    await writeFile(join(pageDir, "report.json"), serializeJsonReport(result), "utf8");
    await writeHtmlReportBundle(result, pageDir);
  }

  private async runFullPageRetry(
    job: Job,
    site: JsonSiteScanReport,
    pageIndex: number,
    pageUrl: string,
    signal: AbortSignal,
    save: () => Promise<void>,
  ): Promise<void> {
    const record = job.record;
    const directory = this.store.dirFor(record.id);
    const pageDir = join(directory, "pages", String(pageIndex));
    await mkdir(pageDir, { recursive: true });
    const parsedPageUrl = parseScanTargetUrl(pageUrl);
    await assertScanTargetAllowed(parsedPageUrl, {
      allowPrivateNetwork: this.allowPrivateNetwork,
      blockedLoopbackPorts: this.blockedPorts,
      ...(this.lookup ? { lookup: this.lookup } : {}),
    });
    const timeoutMs = this.limits.scanTimeoutMs;
    const navBudget = Math.max(5_000, Math.min(30_000, Math.floor(timeoutMs / 8)));
    const viewportSpecs: ViewportSpec[] | undefined =
      record.viewports && record.viewports.length > 0
        ? mergeViewportSpecs(record.viewports.map((v) => ({ width: v.width, height: v.height })))
        : undefined;
    const onProgress = (event: ScanProgressEvent) => {
      const p = record.progress;
      p.mode = "multi_page";
      if (event.type === "browser-launched") {
        p.completedSteps += 1;
      } else if (event.type === "viewport-started") {
        const h = event.height ?? DEFAULT_VIEWPORT_HEIGHT;
        const label = getViewportLabel(event.width, h);
        p.message = `[retry page ${pageIndex + 1}/${site.pages.length}] ${label}`;
        p.site = {
          ...p.site,
          rootUrl: site.rootUrl,
          phase: "scanning",
          currentPageUrl: pageUrl,
          activePageIndex: pageIndex + 1,
          activePageTotal: site.pages.length,
          currentViewport: {
            width: event.width,
            height: h,
            label,
            index: event.index + 1,
            total: event.total,
          },
        };
        p.indeterminate = true;
      } else if (event.type === "viewport-completed" && event.status === "failed" && event.message) {
        p.message = `[retry] ${event.message}`;
      }
      void save();
    };
    const result = await this.scanner({
      url: pageUrl,
      headless: true,
      artifacts: { directory: pageDir },
      ...(viewportSpecs !== undefined ? { viewports: viewportSpecs } : { viewportHeight: DEFAULT_VIEWPORT_HEIGHT }),
      inspector: { enabled: true },
      signal,
      onProgress,
      timeouts: {
        navigationMs: navBudget,
        readinessMs: Math.min(30_000, Math.max(5_000, navBudget)),
        screenshotMs: Math.min(45_000, Math.max(10_000, navBudget)),
        postLoadSettleMs: 2_500,
      },
    });
    if (signal.aborted) throw signal.reason;
    await writeFile(join(pageDir, "report.json"), serializeJsonReport(result), "utf8");
    await writeHtmlReportBundle(result, pageDir);
  }

  async retry(scanId: string, body: unknown): Promise<ScanJobView> {
    const job = this.requireJob(scanId);
    const record = job.record;
    if (this.closed) throw new ApiError(503, "shutting_down", "The LayoutLens server is shutting down.");
    if (record.scanMode !== "multi_page") throw new ApiError(409, "retry_not_supported", "Retry is only for multi-page site scans.");
    if (record.state !== "completed") {
      throw new ApiError(409, "scan_not_completed", `Retry needs a completed scan; this job is ${record.state}.`);
    }
    if (job.retryPromise || job.retryStarting) {
      return this.toJobView(job);
    }
    job.retryStarting = true;
    try {
      this.assertNoConcurrentWork(scanId);

      const obj = typeof body === "object" && body !== null ? (body as RetryScanRequestBody) : {};
      const all = obj.all === true;
      const pageIndex = typeof obj.pageIndex === "number" && Number.isInteger(obj.pageIndex) ? obj.pageIndex : undefined;
      const viewportIndex =
        typeof obj.viewportIndex === "number" && Number.isInteger(obj.viewportIndex) ? obj.viewportIndex : undefined;

      const loadedSite = await this.loadSiteScanReports(scanId).catch((e: unknown) => {
        throw e instanceof ApiError ? e : new ApiError(410, "report_missing", "Site scan reports are missing on disk.");
      });
      let site = loadedSite.site;
      let reports = loadedSite.reports;

      const max = this.limits.maxRetryAttemptsPerTask;
      const attempts = this.ensureRetryMaps(record);

      type PlanEntry =
        | { kind: "viewport"; pageIndex: number; viewportIndex: number }
        | { kind: "page"; pageIndex: number };
      const plan: PlanEntry[] = [];

      if (all) {
        for (const t of listEligibleViewportRetries(site, reports)) {
          const k = this.viewportAttemptKey(t.pageIndex, t.viewportIndex);
          if ((attempts.v[k] ?? 0) < max) plan.push({ kind: "viewport", pageIndex: t.pageIndex, viewportIndex: t.viewportIndex });
        }
        for (const t of listEligiblePageRetries(site)) {
          const k = String(t.pageIndex);
          if ((attempts.p[k] ?? 0) < max) plan.push({ kind: "page", pageIndex: t.pageIndex });
        }
        if (plan.length === 0) throw new ApiError(409, "nothing_to_retry", "No eligible failed tasks remain to retry.");
      } else {
        if (pageIndex === undefined) throw new ApiError(400, "invalid_retry", "Specify pageIndex or set all: true.");
        if (pageIndex < 0 || pageIndex >= site.pages.length) throw new ApiError(400, "invalid_page_index", "Invalid page index.");

        if (viewportIndex !== undefined) {
          const rep = reports.get(pageIndex);
          if (!rep) throw new ApiError(409, "retry_needs_report", "This page has no saved report — use whole-page retry.");
          const vp = rep.viewports[viewportIndex];
          if (!vp) throw new ApiError(400, "invalid_viewport_index", "Invalid viewport index.");
          const st = vp.inspectionStatus ?? "completed";
          const phase = vp.inspectionError?.phase;
          const eligibleVp =
            isPageNavigationTrustedForRetry(rep.summary) &&
            isViewportRetryEligible(st, phase) &&
            phase !== undefined &&
            RETRYABLE_PHASES_SERVER.has(phase);
          if (!eligibleVp) throw new ApiError(409, "not_retryable", "This viewport failure is not eligible for retry.");
          const k = this.viewportAttemptKey(pageIndex, viewportIndex);
          if ((attempts.v[k] ?? 0) >= max) throw new ApiError(409, "retry_limit", "Maximum retry attempts reached for this viewport.");
          plan.push({ kind: "viewport", pageIndex, viewportIndex });
        } else {
          const row = site.pages[pageIndex]!;
          if (row.status === "failed") {
            const err = row.error ?? "";
            if (!isPageErrorRetryEligibleServer(err)) throw new ApiError(409, "not_retryable", "This page failure is not eligible for retry.");
            const k = String(pageIndex);
            if ((attempts.p[k] ?? 0) >= max) throw new ApiError(409, "retry_limit", "Maximum retry attempts reached for this page.");
            plan.push({ kind: "page", pageIndex });
          } else if (row.status === "completed") {
            const rep = reports.get(pageIndex);
            if (!rep) throw new ApiError(409, "retry_needs_report", "Missing page report.");
            const indices: number[] = [];
            rep.viewports.forEach((v, vi) => {
              const st = v.inspectionStatus ?? "completed";
              const phase = v.inspectionError?.phase;
              if (
                isPageNavigationTrustedForRetry(rep.summary) &&
                isViewportRetryEligible(st, phase) &&
                phase !== undefined &&
                RETRYABLE_PHASES_SERVER.has(phase) &&
                (attempts.v[this.viewportAttemptKey(pageIndex, vi)] ?? 0) < max
              ) {
                indices.push(vi);
              }
            });
            if (indices.length === 0) throw new ApiError(409, "nothing_to_retry", "No eligible viewport failures on this page.");
            for (const vi of indices) plan.push({ kind: "viewport", pageIndex, viewportIndex: vi });
          } else {
            throw new ApiError(409, "not_retryable", "This page is not in a failed or completed-retryable state.");
          }
        }
      }

      const save = (): Promise<void> => {
        const snapshot: StoredScan = { ...record, progress: { ...record.progress } };
        job.saving = (job.saving ?? Promise.resolve()).then(() => this.store.save(snapshot)).catch(() => undefined);
        return job.saving;
      };

      const run = async (): Promise<void> => {
      const controller = new AbortController();
      job.retryController = controller;
      job.cancelRequested = false;
      job.retryMeta = { message: "Retrying failed tasks" };

      taskLoop: for (const task of plan) {
        throwIfAborted(controller.signal);
        if (job.cancelRequested) {
          this.appendRetryHistory(record, {
            at: new Date().toISOString(),
            kind: task.kind,
            pageIndex: task.pageIndex,
            ...(task.kind === "viewport" ? { viewportIndex: task.viewportIndex } : {}),
            outcome: "cancelled",
            detail: "Cancelled before task",
          });
          break taskLoop;
        }
        const attemptNo =
          task.kind === "viewport"
            ? (attempts.v[this.viewportAttemptKey(task.pageIndex, task.viewportIndex)] ?? 0) + 1
            : (attempts.p[String(task.pageIndex)] ?? 0) + 1;
        job.retryMeta = {
          current:
            task.kind === "viewport"
              ? { kind: "viewport", pageIndex: task.pageIndex, viewportIndex: task.viewportIndex, attempt: attemptNo }
              : { kind: "page", pageIndex: task.pageIndex, attempt: attemptNo },
          message:
            task.kind === "viewport"
              ? `Retrying viewport ${task.viewportIndex + 1} on page ${task.pageIndex + 1} (attempt ${attemptNo})`
              : `Retrying page ${task.pageIndex + 1} (attempt ${attemptNo})`,
        };
        await save();

        try {
          if (task.kind === "viewport") {
            await this.runViewportRetryTask(job, site, task.pageIndex, task.viewportIndex, controller.signal, save);
            const k = this.viewportAttemptKey(task.pageIndex, task.viewportIndex);
            attempts.v[k] = (attempts.v[k] ?? 0) + 1;
            this.appendRetryHistory(record, {
              at: new Date().toISOString(),
              kind: "viewport",
              pageIndex: task.pageIndex,
              viewportIndex: task.viewportIndex,
              outcome: "success",
            });
          } else {
            const url = site.pages[task.pageIndex]!.url;
            await this.runFullPageRetry(job, site, task.pageIndex, url, controller.signal, save);
            const k = String(task.pageIndex);
            attempts.p[k] = (attempts.p[k] ?? 0) + 1;
            this.appendRetryHistory(record, {
              at: new Date().toISOString(),
              kind: "page",
              pageIndex: task.pageIndex,
              outcome: "success",
            });
          }
        } catch (e: unknown) {
          const cancelled =
            job.cancelRequested ||
            (e instanceof Error && (e.message === "cancelled" || e.name === "AbortError"));
          if (cancelled) {
            this.appendRetryHistory(record, {
              at: new Date().toISOString(),
              kind: task.kind,
              pageIndex: task.pageIndex,
              ...(task.kind === "viewport" ? { viewportIndex: task.viewportIndex } : {}),
              outcome: "cancelled",
              detail: describeScanError(e, this.limits.scanTimeoutMs),
            });
            break taskLoop;
          }
          if (task.kind === "viewport") {
            const k = this.viewportAttemptKey(task.pageIndex, task.viewportIndex);
            attempts.v[k] = (attempts.v[k] ?? 0) + 1;
            this.appendRetryHistory(record, {
              at: new Date().toISOString(),
              kind: "viewport",
              pageIndex: task.pageIndex,
              viewportIndex: task.viewportIndex,
              outcome: "failed",
              detail: describeScanError(e, this.limits.scanTimeoutMs),
            });
          } else {
            const k = String(task.pageIndex);
            attempts.p[k] = (attempts.p[k] ?? 0) + 1;
            this.appendRetryHistory(record, {
              at: new Date().toISOString(),
              kind: "page",
              pageIndex: task.pageIndex,
              outcome: "failed",
              detail: describeScanError(e, this.limits.scanTimeoutMs),
            });
          }
        }

        const rootDir = this.store.dirFor(record.id);
        const pages: SiteScanPageRecord[] = [];
        for (let i = 0; i < site.pages.length; i++) {
          const row = site.pages[i]!;
          const pageDir = join(rootDir, "pages", String(i));
          const reportPath = join(pageDir, "report.json");
          if (await fileExists(reportPath)) {
            const jr = JSON.parse(await readFile(reportPath, "utf8")) as JsonReport;
            pages.push({ url: row.url, pageDir, result: scanResultFromJsonReport(jr) });
          } else if (row.status === "failed") {
            pages.push({ url: row.url, pageDir, error: row.error ?? "Scan failed" });
          } else {
            pages.push({ url: row.url, pageDir });
          }
        }

        const priorRoot = site.rootUrl;
        const priorAt = site.scannedAt;

        try {
          await rebuildSiteScanArtifacts({
            artifactsRoot: rootDir,
            pages,
            rootUrl: priorRoot,
            scope: mergeSiteScanScope({
              ...(record.maxPages !== undefined ? { maxPages: record.maxPages } : {}),
              ...(record.maxDepth !== undefined ? { maxDepth: record.maxDepth } : {}),
            }),
            scannedAt: priorAt,
            signal: controller.signal,
          });
        } catch (e: unknown) {
          const cancelled =
            job.cancelRequested ||
            (e instanceof Error && (e.message === "cancelled" || e.name === "AbortError"));
          if (cancelled) {
            this.appendRetryHistory(record, {
              at: new Date().toISOString(),
              kind: task.kind,
              pageIndex: task.pageIndex,
              ...(task.kind === "viewport" ? { viewportIndex: task.viewportIndex } : {}),
              outcome: "cancelled",
              detail: "Cancelled during site report update",
            });
            break taskLoop;
          }
          throw e;
        }

        site = JSON.parse(await readFile(join(rootDir, "report.json"), "utf8")) as JsonSiteScanReport;
        reports.clear();
        for (let i = 0; i < site.pages.length; i++) {
          if (site.pages[i]!.status !== "completed") continue;
          try {
            reports.set(i, JSON.parse(await readFile(join(rootDir, "pages", String(i), "report.json"), "utf8")) as JsonReport);
          } catch {
            /* keep going */
          }
        }

        record.siteSummary = site.summary;
        const firstOk = pages.find((p) => p.result);
        if (firstOk?.result) {
          record.summary = {
            ...firstOk.result.summary,
            viewportWidths: firstOk.result.viewports.map((v) => v.width),
            ...(firstOk.result.navigationDiagnostics ? { navigationDiagnostics: firstOk.result.navigationDiagnostics } : {}),
          };
        }
        await save();
      }
    };

      job.retryPromise = run()
      .catch(async (e: unknown) => {
        const cancelled =
          job.cancelRequested ||
          (e instanceof Error && (e.message === "cancelled" || e.name === "AbortError"));
        if (cancelled) {
          record.progress.message = "Retry cancelled";
        } else {
          record.progress.message = `Retry finished with errors — ${describeScanError(e, this.limits.scanTimeoutMs)}`;
        }
        await save();
      })
      .finally(async () => {
        delete job.retryController;
        delete job.retryPromise;
        delete job.retryStarting;
        delete job.retryMeta;
        record.progress.indeterminate = false;
        if (record.progress.site) {
          record.progress.site = { ...record.progress.site, phase: "done" };
        }
        if (
          record.progress.message?.startsWith("[retry") ||
          record.progress.message?.startsWith("Retrying") ||
          record.progress.message?.startsWith("Retry ")
        ) {
          record.progress.message = "Site scan complete";
        }
        await save();
        this.notifyIdleIfQuiet();
      });
    } catch (e) {
      delete job.retryStarting;
      throw e;
    }

    return this.toJobView(job);
  }

  async create(body: unknown): Promise<ScanJobView> {
    if (this.closed) throw new ApiError(503, "shutting_down", "The LayoutLens server is shutting down.");
    const obj = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const rawUrl = obj.url;
    const url = parseTargetUrl(rawUrl);
    await assertAllowedTarget(url, {
      allowPrivateNetwork: this.allowPrivateNetwork,
      blockedLoopbackPorts: this.blockedPorts,
      ...(this.lookup ? { lookup: this.lookup } : {}),
    });

    const modeRaw = obj.mode;
    const scanMode: "single_page" | "multi_page" =
      modeRaw === "multi_page" ? "multi_page" : "single_page";
    const maxPages =
      typeof obj.maxPages === "number" && Number.isFinite(obj.maxPages) ? Math.floor(obj.maxPages) : undefined;
    const maxDepth =
      typeof obj.maxDepth === "number" && Number.isFinite(obj.maxDepth) ? Math.floor(obj.maxDepth) : undefined;
    const scope =
      scanMode === "multi_page"
        ? mergeSiteScanScope({
            ...(maxPages !== undefined ? { maxPages } : {}),
            ...(maxDepth !== undefined ? { maxDepth } : {}),
          })
        : undefined;

    const viewportsInput = Array.isArray(obj.viewports)
      ? (obj.viewports as unknown[])
          .map((row): { width: number; height: number; label?: string } | null => {
            if (!row || typeof row !== "object") return null;
            const w = (row as { width?: unknown }).width;
            const h = (row as { height?: unknown }).height;
            const lab = (row as { label?: unknown }).label;
            if (typeof w !== "number" || typeof h !== "number") return null;
            return typeof lab === "string" ? { width: w, height: h, label: lab } : { width: w, height: h };
          })
          .filter((v): v is { width: number; height: number; label?: string } => v !== null)
      : undefined;
    const viewports =
      viewportsInput !== undefined && viewportsInput.length > 0 ? mergeViewportSpecs(viewportsInput) : undefined;

    if ([...this.jobs.values()].some((j) => j.retryPromise || j.retryStarting)) {
      throw new ApiError(
        429,
        "retry_in_progress",
        "A site-scan retry is in progress. Wait for it to finish before starting a new scan.",
      );
    }

    const active = [...this.jobs.values()].filter((j) => j.record.state === "running").length;
    if (active >= this.limits.maxConcurrentScans && this.queue.length >= this.limits.maxQueuedScans) {
      throw new ApiError(
        429,
        "too_many_scans",
        `${active} scan(s) are running and ${this.queue.length} are waiting. Try again when one finishes.`,
      );
    }

    const record: StoredScan = {
      id: randomUUID(),
      url: url.href,
      state: "queued",
      createdAt: new Date().toISOString(),
      progress: { completedSteps: 0, totalSteps: 0, message: "Waiting for a free scanner" },
      ...(scanMode === "multi_page"
        ? {
            scanMode: "multi_page" as const,
            maxPages: scope!.maxPages,
            maxDepth: scope!.maxDepth,
            siteRetryAttempts: { v: {}, p: {} },
          }
        : { scanMode: "single_page" as const }),
      ...(viewports !== undefined ? { viewports: viewports.map((v) => ({ width: v.width, height: v.height })) } : {}),
    };
    const job: Job = { record };
    this.jobs.set(record.id, job);
    this.queue.push(record.id);
    await this.store.save(record);
    this.pump();
    return this.toJobView(job);
  }

  async cancel(id: string): Promise<ScanJobView> {
    const job = this.requireJob(id);
    if (job.record.state === "queued") {
      this.queue.splice(this.queue.indexOf(id), 1);
      this.finish(job, "cancelled", "The scan was cancelled before it started.");
      await this.store.save(job.record);
    } else if (job.record.state === "running") {
      job.cancelRequested = true;
      job.controller?.abort(new Error("cancelled"));
      job.retryController?.abort(new Error("cancelled"));
    } else if (
      job.record.state === "completed" &&
      job.record.scanMode === "multi_page" &&
      (job.retryPromise || job.retryStarting)
    ) {
      job.cancelRequested = true;
      job.retryController?.abort(new Error("cancelled"));
    } else {
      throw new ApiError(409, "scan_finished", "This scan has already finished.");
    }
    return this.toJobView(job);
  }

  async results(id: string): Promise<unknown> {
    const job = this.requireJob(id);
    if (job.record.state !== "completed") {
      throw new ApiError(409, "scan_not_completed", `This scan is ${job.record.state}; results are only available once it completes.`);
    }
    try {
      return await this.store.readReport(id);
    } catch {
      throw new ApiError(410, "report_missing", "The report files for this scan are no longer on disk.");
    }
  }

  /** Per-page `report.json` for multi-page site scans (`pages/<n>/report.json`). */
  async pageReport(scanId: string, pageIndex: number): Promise<unknown> {
    const job = this.requireJob(scanId);
    if (job.record.state !== "completed") {
      throw new ApiError(409, "scan_not_completed", `This scan is ${job.record.state}; page reports are only available once it completes.`);
    }
    if (job.record.scanMode !== "multi_page") {
      throw new ApiError(404, "page_report_unavailable", "This scan is single-page; use the main results endpoint.");
    }
    if (!Number.isInteger(pageIndex) || pageIndex < 0) {
      throw new ApiError(400, "invalid_page_index", "Page index must be a non-negative integer.");
    }
    const path = join(this.store.dirFor(scanId), "pages", String(pageIndex), "report.json");
    try {
      const raw = await readFile(path, "utf8");
      return JSON.parse(raw) as unknown;
    } catch {
      throw new ApiError(404, "page_report_not_found", "No report for that page index.");
    }
  }

  async file(id: string, relativePath: string): Promise<{ path: string; size: number }> {
    const job = this.requireJob(id);
    if (job.record.state !== "completed") throw new ApiError(404, "file_not_found", "File not found.");
    const file = await this.store.resolveFile(id, relativePath);
    if (!file) throw new ApiError(404, "file_not_found", "File not found.");
    return file;
  }

  /** Resolves when no scan is queued or running (used by tests and shutdown). */
  whenIdle(): Promise<void> {
    if (
      this.running === 0 &&
      this.queue.length === 0 &&
      ![...this.jobs.values()].some((j) => j.retryPromise || j.retryStarting)
    ) {
      return Promise.resolve();
    }
    return new Promise((r) => this.idle.add(r));
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const id of this.queue.splice(0)) {
      const job = this.jobs.get(id);
      if (job) {
        this.finish(job, "cancelled", "The LayoutLens server stopped before this scan started.");
        await this.store.save(job.record);
      }
    }
    for (const job of this.jobs.values()) {
      if (job.record.state === "running") job.controller?.abort(new Error("The LayoutLens server stopped during the scan."));
      if (job.retryPromise || job.retryStarting) job.retryController?.abort(new Error("The LayoutLens server stopped during the scan."));
      if (job.retryStarting && !job.retryPromise) delete job.retryStarting;
    }
    const waitRetries = Promise.all(
      [...this.jobs.values()].map((j) => j.retryPromise ?? Promise.resolve()),
    );
    await waitRetries;
    await this.whenIdle();
  }

  private finish(job: Job, state: "completed" | "failed" | "cancelled", error?: string): void {
    job.record.state = state;
    job.record.finishedAt = new Date().toISOString();
    if (error !== undefined) job.record.error = error;
    delete job.controller;
  }

  private pump(): void {
    while (!this.closed && this.running < this.limits.maxConcurrentScans && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const job = this.jobs.get(id);
      if (!job) continue;
      this.running++;
      void this.run(job).finally(() => {
        this.running--;
        this.pump();
        this.notifyIdleIfQuiet();
      });
    }
  }

  async findCompatibleBaseline(url: string): Promise<CompatibleBaseline | null> {
    const key = urlKeyForBaseline(url);
    const entries = await readdir(this.baselinesDir, { withFileTypes: true }).catch(() => []);
    let best: CompatibleBaseline & { updatedAt: string } | null = null;
    for (const entry of entries.slice(0, MAX_BASELINE_DIRS)) {
      if (!entry.isDirectory() || !BASELINE_NAME_PATTERN.test(entry.name)) continue;
      const directory = join(this.baselinesDir, entry.name);
      try {
        const manifest = await readBaselineManifest(directory);
        if (manifest.urlKey !== key || manifest.viewportHeight !== DEFAULT_VIEWPORT_HEIGHT) continue;
        if (!best || manifest.updatedAt > best.updatedAt) {
          best = { name: entry.name, directory, createdAt: manifest.createdAt, updatedAt: manifest.updatedAt };
        }
      } catch {
        /* not a baseline folder */
      }
    }
    return best ? { name: best.name, directory: best.directory, createdAt: best.createdAt } : null;
  }

  private async run(job: Job): Promise<void> {
    const record = job.record;
    const controller = new AbortController();
    job.controller = controller;
    const timeoutMs = this.limits.scanTimeoutMs;
    const timer = setTimeout(() => controller.abort(new ScanTimeoutError("timeout")), timeoutMs);
    const save = (): Promise<void> => {
      const snapshot: StoredScan = { ...record, progress: { ...record.progress } };
      job.saving = (job.saving ?? Promise.resolve()).then(() => this.store.save(snapshot)).catch(() => undefined);
      return job.saving;
    };

    try {
      record.state = "running";
      record.startedAt = new Date().toISOString();
      if (record.scanMode === "multi_page") {
        record.progress = {
          completedSteps: 0,
          totalSteps: 0,
          message: "Discovering pages",
          mode: "multi_page",
          indeterminate: true,
        };
        await save();
        await this.runSiteScanJob(job, controller, save, timeoutMs);
      } else {
        const baseline = await this.findCompatibleBaseline(record.url);
        if (baseline) record.baseline = { name: baseline.name, createdAt: baseline.createdAt };
        record.progress = {
          completedSteps: 0,
          totalSteps: 1 + VIEWPORT_WIDTHS.length + (baseline ? 1 : 0) + 1,
          message: "Launching headless Chromium",
          mode: "single_page",
        };
        await save();
        await this.runSinglePageScan(job, controller, save, timeoutMs, baseline);
      }
      this.finish(job, "completed");
    } catch (error) {
      if (record.state === "completed") {
        clearTimeout(timer);
        await save();
        await this.prune();
        return;
      }
      const reason: unknown = controller.signal.aborted ? controller.signal.reason : error;
      if (job.cancelRequested) {
        this.finish(job, "cancelled", "The scan was cancelled.");
        record.progress.message = "Cancelled";
        record.progress.indeterminate = false;
      } else {
        this.finish(job, "failed", describeScanError(reason, timeoutMs));
        record.progress.message = "Failed";
        record.progress.indeterminate = false;
      }
      if (record.scanMode !== "multi_page" || record.state !== "cancelled") {
        await this.store.removeArtifacts(record.id).catch(() => undefined);
      }
    } finally {
      clearTimeout(timer);
      await save();
      await this.prune();
    }
  }

  private async runSinglePageScan(
    job: Job,
    controller: AbortController,
    save: () => Promise<void>,
    timeoutMs: number,
    baseline: CompatibleBaseline | null,
  ): Promise<void> {
    const record = job.record;
    const onProgress = (event: ScanProgressEvent) => {
      const p = record.progress;
      switch (event.type) {
        case "browser-launched":
          p.completedSteps += 1;
          break;
        case "viewport-started": {
          const h = event.height ?? DEFAULT_VIEWPORT_HEIGHT;
          p.message = `Loading and measuring the page at ${event.width}×${h} (${getViewportLabel(event.width, h)})`;
          break;
        }
        case "viewport-completed": {
          p.completedSteps += 1;
          const h = event.height ?? DEFAULT_VIEWPORT_HEIGHT;
          const label = getViewportLabel(event.width, h);
          if (event.status === "failed" && event.message) {
            p.message = `${label} viewport: ${event.message}`;
          } else if (event.status === "skipped") {
            p.message = `${label} viewport skipped — ${event.message ?? "depends on an earlier step"}`;
          }
          break;
        }
        case "visual-compare-started":
          p.message = `Comparing screenshots with baseline “${record.baseline?.name ?? ""}”`;
          break;
        case "visual-compare-completed":
          p.completedSteps += 1;
          break;
      }
      void save();
    };

    const directory = this.store.dirFor(record.id);
    const navBudget = Math.max(5_000, Math.min(timeoutMs, Math.floor(timeoutMs / Math.max(1, VIEWPORT_WIDTHS.length + 2))));
    const viewportSpecs: ViewportSpec[] | undefined =
      record.viewports && record.viewports.length > 0
        ? mergeViewportSpecs(record.viewports.map((v) => ({ width: v.width, height: v.height })))
        : undefined;
    const result = await this.scanner({
      url: record.url,
      headless: true,
      ...(viewportSpecs !== undefined ? { viewports: viewportSpecs } : { viewportHeight: DEFAULT_VIEWPORT_HEIGHT }),
      artifacts: { directory, ...(baseline ? { baselineDirectory: baseline.directory } : {}) },
      ...(baseline ? { baselineDirectory: baseline.directory } : {}),
      inspector: { enabled: true },
      onProgress,
      signal: controller.signal,
      timeouts: {
        navigationMs: navBudget,
        readinessMs: Math.min(30_000, Math.max(5_000, navBudget)),
        screenshotMs: Math.min(45_000, Math.max(10_000, navBudget)),
        postLoadSettleMs: 2_500,
      },
    });
    if (controller.signal.aborted) throw controller.signal.reason;
    const noViewportSucceeded =
      result.viewports.length > 0 &&
      result.viewports.every((v) => v.inspectionStatus === "failed" || v.inspectionStatus === "skipped");
    if (noViewportSucceeded) {
      const hint =
        result.navigation?.message ??
        (result.summary.viewportOutcomes?.find((o) => o.message)?.message ?? "No viewport finished inspection.");
      throw new Error(hint);
    }

    record.progress.message = "Writing the report";
    await save();
    await writeHtmlReportBundle(result, directory);
    record.progress.completedSteps = record.progress.totalSteps;
    const status = result.summary.scanCompletionStatus;
    record.progress.message =
      status === "partial"
        ? "Scan finished with some viewport failures — see the report"
        : "Scan complete";
    record.summary = {
      ...result.summary,
      viewportWidths: result.viewports.map((v) => v.width),
      ...(result.navigationDiagnostics ? { navigationDiagnostics: result.navigationDiagnostics } : {}),
    };
  }

  private async runSiteScanJob(job: Job, controller: AbortController, save: () => Promise<void>, timeoutMs: number): Promise<void> {
    const record = job.record;
    const directory = this.store.dirFor(record.id);
    const navBudget = Math.max(5_000, Math.min(30_000, Math.floor(timeoutMs / 8)));
    const parsedRoot = parseScanTargetUrl(record.url);
    await assertScanTargetAllowed(parsedRoot, {
      allowPrivateNetwork: this.allowPrivateNetwork,
      blockedLoopbackPorts: this.blockedPorts,
      ...(this.lookup ? { lookup: this.lookup } : {}),
    });

    const scope = mergeSiteScanScope({
      ...(record.maxPages !== undefined ? { maxPages: record.maxPages } : {}),
      ...(record.maxDepth !== undefined ? { maxDepth: record.maxDepth } : {}),
    });

    const viewportSpecs: ViewportSpec[] | undefined =
      record.viewports && record.viewports.length > 0
        ? mergeViewportSpecs(record.viewports.map((v) => ({ width: v.width, height: v.height })))
        : undefined;

    const onProgress = (event: ScanProgressEvent) => {
      const p = record.progress;
      p.mode = "multi_page";
      switch (event.type) {
        case "browser-launched":
          p.completedSteps += 1;
          break;
        case "site-scan-progress": {
          const vpTotal = event.viewportTasksTotal;
          const hasVpPlan = vpTotal !== undefined && vpTotal > 0;
          p.indeterminate = event.phase !== "done" && !hasVpPlan;
          if (hasVpPlan && event.viewportTasksCompleted !== undefined) {
            p.completedSteps = event.viewportTasksCompleted;
            p.totalSteps = vpTotal;
          }
          p.site = {
            rootUrl: event.rootUrl,
            phase: event.phase,
            ...(event.discoveredPages !== undefined ? { discoveredPages: event.discoveredPages } : {}),
            ...(event.scheduledPages !== undefined ? { scheduledPages: event.scheduledPages } : {}),
            ...(event.completedPages !== undefined ? { completedPages: event.completedPages } : {}),
            ...(event.failedPages !== undefined ? { failedPages: event.failedPages } : {}),
            ...(event.viewportTasksCompleted !== undefined ? { viewportTasksCompleted: event.viewportTasksCompleted } : {}),
            ...(event.viewportTasksTotal !== undefined ? { viewportTasksTotal: event.viewportTasksTotal } : {}),
            ...(event.currentUrl !== undefined ? { currentPageUrl: event.currentUrl } : {}),
            ...(event.currentViewport !== undefined ? { currentViewport: event.currentViewport } : {}),
          };
          if (event.phase === "discovering") {
            p.message = `Discovering pages (${event.discoveredPages ?? 0} found)`;
          } else if (event.phase === "scanning") {
            const cur = event.currentUrl ? ` — ${event.currentUrl}` : "";
            p.message = `Scanning (${event.completedPages ?? 0}/${event.scheduledPages ?? "?"} pages)${cur}`;
          } else if (event.phase === "writing") {
            p.message = "Writing reports";
          } else {
            p.message = "Finalizing";
            p.indeterminate = false;
          }
          break;
        }
        case "page-scan-started":
          p.message = `Starting page ${event.index}/${event.total}`;
          p.site = {
            ...p.site,
            rootUrl: parsedRoot.href,
            phase: "scanning",
            activePageIndex: event.index,
            activePageTotal: event.total,
          };
          break;
        case "page-scan-completed":
          if (!event.success && event.error) {
            p.message = `Page failed: ${event.error}`;
          }
          break;
        case "viewport-started": {
          const h = event.height ?? DEFAULT_VIEWPORT_HEIGHT;
          const pageHint =
            event.pageIndex !== undefined && event.pageTotal !== undefined
              ? `[${event.pageIndex}/${event.pageTotal}] `
              : "";
          p.message = `${pageHint}${event.width}×${h} (${getViewportLabel(event.width, h)})`;
          if (event.url) {
            p.site = {
              ...p.site,
              rootUrl: parsedRoot.href,
              phase: "scanning",
              currentPageUrl: event.url,
              ...(event.pageIndex !== undefined && event.pageTotal !== undefined
                ? { activePageIndex: event.pageIndex, activePageTotal: event.pageTotal }
                : {}),
              currentViewport: {
                width: event.width,
                height: h,
                label: getViewportLabel(event.width, h),
                index: event.index + 1,
                total: event.total,
              },
            };
          }
          break;
        }
        case "viewport-completed": {
          const h = event.height ?? DEFAULT_VIEWPORT_HEIGHT;
          const label = getViewportLabel(event.width, h);
          if (event.status === "failed" && event.message) {
            p.message = `${label}: ${event.message}`;
          } else if (event.status === "skipped") {
            p.message = `${label} skipped — ${event.message ?? "depends on an earlier step"}`;
          }
          break;
        }
        case "visual-compare-started":
        case "visual-compare-completed":
          break;
      }
      void save();
    };

    const scanBase: ScanOptions = {
      url: parsedRoot.href,
      headless: true,
      artifacts: { directory },
      inspector: { enabled: true },
      signal: controller.signal,
      timeouts: {
        navigationMs: navBudget,
        readinessMs: Math.min(30_000, Math.max(5_000, navBudget)),
        screenshotMs: Math.min(45_000, Math.max(10_000, navBudget)),
        postLoadSettleMs: 2_500,
      },
      onProgress,
    };
    if (viewportSpecs !== undefined) scanBase.viewports = viewportSpecs;

    const siteRun = await this.siteScanner({
      rootUrl: record.url,
      scope,
      scan: scanBase,
      targetPolicy: {
        allowPrivateNetwork: this.allowPrivateNetwork,
        blockedLoopbackPorts: this.blockedPorts,
        ...(this.lookup ? { lookup: this.lookup } : {}),
      },
      discoveryNavigationMs: navBudget,
    });

    if (job.cancelRequested) {
      throw new Error("cancelled");
    }
    if (controller.signal.aborted) throw controller.signal.reason;

    const jsonReport = siteRun.siteReport as JsonSiteScanReport;
    for (const [i, page] of siteRun.pages.entries()) {
      if (page.result) {
        await writeHtmlReportBundle(page.result, join(directory, "pages", String(i)));
      }
    }

    record.siteSummary = jsonReport.summary;
    record.progress.totalSteps = 1;
    record.progress.completedSteps = 1;
    record.progress.indeterminate = false;
    record.progress.message =
      jsonReport.state === "cancelled"
        ? "Scan cancelled"
        : jsonReport.summary.completedPages === 0
          ? "No pages completed successfully"
          : jsonReport.state === "partial"
            ? "Site scan finished with some failures — see the report"
            : "Site scan complete";

    const firstOk = siteRun.pages.find((p) => p.result);
    if (firstOk?.result) {
      record.summary = {
        ...firstOk.result.summary,
        viewportWidths: firstOk.result.viewports.map((v) => v.width),
        ...(firstOk.result.navigationDiagnostics ? { navigationDiagnostics: firstOk.result.navigationDiagnostics } : {}),
      };
    }
  }

  private async prune(): Promise<void> {
    const protect = new Set(
      [...this.jobs.values()]
        .filter((j) => j.record.state === "queued" || j.record.state === "running")
        .map((j) => j.record.id),
    );
    const removed = await this.store
      .prune(
        [...this.jobs.values()].map((j) => j.record),
        this.limits.maxStoredScans,
        this.limits.maxStorageBytes,
        protect,
      )
      .catch(() => []);
    for (const id of removed) this.jobs.delete(id);
  }
}
