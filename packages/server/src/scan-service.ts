import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { scanUrl } from "@layoutlens/core";
import { writeHtmlReportBundle } from "@layoutlens/report";
import {
  SCAN_API_SERVICE,
  VIEWPORT_WIDTHS,
  getViewportLabel,
  type ScanJobView,
  type ScanOptions,
  type ScanProgressEvent,
  type ScanResult,
  type ScanServiceInfo,
  type ScanServiceLimits,
} from "@layoutlens/shared";
import { readBaselineManifest, urlKeyForBaseline } from "@layoutlens/visual";
import { ApiError } from "./errors.js";
import { ScanStore, SCAN_ID_PATTERN, type StoredScan } from "./scan-store.js";
import { assertAllowedTarget, parseTargetUrl, type HostLookup } from "./url-policy.js";

export const SERVER_VERSION = "0.6.0";
const DEFAULT_VIEWPORT_HEIGHT = 844;
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
    };
    this.allowPrivateNetwork = options.allowPrivateNetwork ?? true;
    this.blockedPorts = options.blockedLoopbackPorts ?? (() => []);
    this.lookup = options.lookup;
    this.scanner = options.scanner ?? scanUrl;
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
      this.jobs.set(record.id, { record });
    }
  }

  info(): ScanServiceInfo {
    return {
      service: SCAN_API_SERVICE,
      version: SERVER_VERSION,
      viewportWidths: VIEWPORT_WIDTHS,
      limits: this.limits,
      allowPrivateNetwork: this.allowPrivateNetwork,
      dataDirectory: this.dataDir,
      baselinesDirectory: this.baselinesDir,
    };
  }

  private view(job: Job): ScanJobView {
    const view: ScanJobView = { ...job.record, progress: { ...job.record.progress } };
    if (job.record.state === "queued") {
      const pos = this.queue.indexOf(job.record.id);
      if (pos !== -1) view.queuePosition = pos + 1;
    }
    return view;
  }

  list(): ScanJobView[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.record.createdAt.localeCompare(a.record.createdAt))
      .map((j) => this.view(j));
  }

  get(id: string): ScanJobView {
    return this.view(this.requireJob(id));
  }

  private requireJob(id: string): Job {
    const job = SCAN_ID_PATTERN.test(id) ? this.jobs.get(id) : undefined;
    if (!job) throw new ApiError(404, "scan_not_found", "No scan with that id exists on this machine.");
    return job;
  }

  async create(body: unknown): Promise<ScanJobView> {
    if (this.closed) throw new ApiError(503, "shutting_down", "The LayoutLens server is shutting down.");
    const rawUrl = typeof body === "object" && body !== null ? (body as { url?: unknown }).url : undefined;
    const url = parseTargetUrl(rawUrl);
    await assertAllowedTarget(url, {
      allowPrivateNetwork: this.allowPrivateNetwork,
      blockedLoopbackPorts: this.blockedPorts,
      ...(this.lookup ? { lookup: this.lookup } : {}),
    });

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
    };
    const job: Job = { record };
    this.jobs.set(record.id, job);
    this.queue.push(record.id);
    await this.store.save(record);
    this.pump();
    return this.view(job);
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
    } else {
      throw new ApiError(409, "scan_finished", "This scan has already finished.");
    }
    return this.view(job);
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

  async file(id: string, relativePath: string): Promise<{ path: string; size: number }> {
    const job = this.requireJob(id);
    if (job.record.state !== "completed") throw new ApiError(404, "file_not_found", "File not found.");
    const file = await this.store.resolveFile(id, relativePath);
    if (!file) throw new ApiError(404, "file_not_found", "File not found.");
    return file;
  }

  /** Resolves when no scan is queued or running (used by tests and shutdown). */
  whenIdle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return Promise.resolve();
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
    }
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
        if (this.running === 0 && this.queue.length === 0) {
          for (const r of this.idle) r();
          this.idle.clear();
        }
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
      const baseline = await this.findCompatibleBaseline(record.url);
      if (baseline) record.baseline = { name: baseline.name, createdAt: baseline.createdAt };
      record.state = "running";
      record.startedAt = new Date().toISOString();
      record.progress = {
        completedSteps: 0,
        totalSteps: 1 + VIEWPORT_WIDTHS.length + (baseline ? 1 : 0) + 1,
        message: "Launching headless Chromium",
      };
      await save();

      const onProgress = (event: ScanProgressEvent) => {
        const p = record.progress;
        switch (event.type) {
          case "browser-launched":
            p.completedSteps += 1;
            break;
          case "viewport-started":
            p.message = `Loading and measuring the page at ${event.width}px (${getViewportLabel(event.width)})`;
            break;
          case "viewport-completed": {
            p.completedSteps += 1;
            const label = getViewportLabel(event.width);
            if (event.status === "failed" && event.message) {
              p.message = `${label} viewport: ${event.message}`;
            } else if (event.status === "skipped") {
              p.message = `${label} viewport skipped — ${event.message ?? "depends on an earlier step"}`;
            }
            break;
          }
          case "visual-compare-started":
            p.message = `Comparing screenshots with baseline “${baseline?.name ?? ""}”`;
            break;
          case "visual-compare-completed":
            p.completedSteps += 1;
            break;
        }
        void save();
      };

      const directory = this.store.dirFor(record.id);
      const navBudget = Math.max(5_000, Math.min(timeoutMs, Math.floor(timeoutMs / Math.max(1, VIEWPORT_WIDTHS.length + 2))));
      const result = await this.scanner({
        url: record.url,
        headless: true,
        viewportHeight: DEFAULT_VIEWPORT_HEIGHT,
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
      this.finish(job, "completed");
    } catch (error) {
      const reason: unknown = controller.signal.aborted ? controller.signal.reason : error;
      if (job.cancelRequested) {
        this.finish(job, "cancelled", "The scan was cancelled.");
        record.progress.message = "Cancelled";
      } else {
        this.finish(job, "failed", describeScanError(reason, timeoutMs));
        record.progress.message = "Failed";
      }
      await this.store.removeArtifacts(record.id).catch(() => undefined);
    } finally {
      clearTimeout(timer);
      await save();
      await this.prune();
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
