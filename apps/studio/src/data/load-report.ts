import {
  SCAN_API_PREFIX,
  SCAN_FILE_PATTERN,
  scanFileUrl,
  type JsonReport,
  type JsonSiteScanReport,
} from "@layoutlens/shared";
import {
  normalizeAssetPath,
  parseLayoutLensReport,
  parseStudioScanResult,
  ReportValidationError,
} from "./report-validate";

export interface LoadedReportBase {
  id: string;
  /** Folder name the user selected (from the browser file picker). */
  sourceName: string;
  /** Set when the report came from the local scanning service. */
  scanId?: string;
  /** Scan job id from the API (always set for service-backed reports). */
  scanJobId?: string;
  loadedAt: string;
  /** Resolve a report-relative asset (e.g. `screenshots/viewport-390.png`) to a local object URL. */
  resolveAsset(path: string | undefined): string | null;
  dispose(): void;
}

/** Per-page `JsonReport` (Inspector, findings, screenshots). */
export interface LoadedPageReport extends LoadedReportBase {
  report: JsonReport;
  /** One-shot selection when opening from a site-wide finding link. */
  initialFocus?: { viewportWidth: number; findingKey: string };
}

/** Site-wide envelope (`tool: layoutlens-site`). */
export interface LoadedSiteScanReport extends LoadedReportBase {
  report: JsonSiteScanReport;
}

export type LoadedReport = LoadedPageReport | LoadedSiteScanReport;

export interface LocalFileLike {
  name: string;
  /** Path relative to the selected folder root, including the folder name. */
  webkitRelativePath?: string;
  text(): Promise<string>;
}

export function isSiteScanEnvelope(r: JsonReport | JsonSiteScanReport): r is JsonSiteScanReport {
  return (r as JsonSiteScanReport).tool === "layoutlens-site";
}

export function isLoadedSiteScan(loaded: LoadedReport): loaded is LoadedSiteScanReport {
  return isSiteScanEnvelope(loaded.report);
}

export function reportIdFor(report: JsonReport): string {
  return `${report.url}::${report.scannedAt}`;
}

function relativeWithinFolder(file: LocalFileLike): string {
  const rel = (file.webkitRelativePath ?? "").replace(/\\/g, "/");
  if (!rel) return file.name;
  const slash = rel.indexOf("/");
  return slash === -1 ? rel : rel.slice(slash + 1);
}

/**
 * Index selected files by report-relative path. Falls back to the file name when
 * files were picked individually (no folder structure available).
 */
export function indexFiles<T extends LocalFileLike>(files: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const f of files) {
    const rel = normalizeAssetPath(relativeWithinFolder(f));
    if (rel) map.set(rel, f);
  }
  return map;
}

export function lookupAsset<T extends LocalFileLike>(
  index: Map<string, T>,
  path: string | undefined,
): T | null {
  if (!path) return null;
  const normalized = normalizeAssetPath(path);
  if (!normalized) return null;
  const exact = index.get(normalized);
  if (exact) return exact;
  // Individually picked files lose their folder: match on the unique file name.
  const base = normalized.split("/").pop();
  const candidates = [...index.entries()].filter(([key]) => !key.includes("/") && key === base);
  return candidates.length === 1 ? candidates[0]![1] : null;
}

export function folderNameOf(files: readonly LocalFileLike[]): string {
  const first = files.find((f) => f.webkitRelativePath)?.webkitRelativePath;
  if (first) return first.split(/[\\/]/)[0] ?? "Selected files";
  return "Selected files";
}

function makeResolveAssetFromScan(scanId: string, assetPathPrefix = ""): (path: string | undefined) => string | null {
  const prefix = assetPathPrefix.replace(/\/+$/, "");
  return (path) => {
    const normalized = path ? normalizeAssetPath(path) : null;
    if (!normalized || !SCAN_FILE_PATTERN.test(normalized)) return null;
    const relative = prefix ? `${prefix}/${normalized}` : normalized;
    return SCAN_FILE_PATTERN.test(relative) ? scanFileUrl(scanId, relative) : null;
  };
}

/** Build a LoadedReport from per-page JSON (already fetched). */
export function loadSitePageReport(
  raw: unknown,
  scanId: string,
  pageIndex: number,
  initialFocus?: { viewportWidth: number; findingKey: string },
): LoadedPageReport {
  const report = parseLayoutLensReport(raw);
  return {
    id: `page:${scanId}:${pageIndex}:${report.scannedAt}`,
    sourceName: `Page ${pageIndex + 1} · scan ${scanId.slice(0, 8)}`,
    scanId,
    scanJobId: scanId,
    ...(initialFocus ? { initialFocus } : {}),
    loadedAt: new Date().toISOString(),
    report,
    resolveAsset: makeResolveAssetFromScan(scanId, `pages/${pageIndex}/`),
    dispose() {},
  };
}

/** Fetch a per-page `report.json` from a completed multi-page scan. */
export async function loadSitePageFromScan(
  scanId: string,
  pageIndex: number,
  fetchImpl: typeof fetch = fetch,
): Promise<LoadedPageReport> {
  const res = await fetchImpl(`${SCAN_API_PREFIX}/scans/${encodeURIComponent(scanId)}/pages/${pageIndex}/report`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  if (!res.ok || !isJson) {
    throw new ReportValidationError(
      res.status === 404
        ? "That page report is not available (index out of range or scan incomplete)."
        : "The page report could not be loaded.",
    );
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ReportValidationError("The page report response is not valid JSON.");
  }
  return loadSitePageReport(body, scanId, pageIndex);
}

/**
 * Wrap a report produced by the local scanning service. Assets resolve to the API's
 * whitelisted file endpoint; anything else resolves to nothing.
 */
export function loadReportFromScan(
  scanId: string,
  raw: unknown,
  loadedAt = new Date().toISOString(),
): LoadedPageReport | LoadedSiteScanReport {
  const parsed = parseStudioScanResult(raw);
  const resolveAsset = makeResolveAssetFromScan(scanId);

  if (!isSiteScanEnvelope(parsed)) {
    const report = parsed;
    return {
      id: reportIdFor(report),
      sourceName: `Studio scan ${scanId.slice(0, 8)}`,
      scanId,
      scanJobId: scanId,
      loadedAt,
      report,
      resolveAsset,
      dispose() {},
    };
  }

  const site = parsed;
  return {
    id: `site:${scanId}:${site.scannedAt}`,
    sourceName: `Site scan ${scanId.slice(0, 8)}`,
    scanId,
    scanJobId: scanId,
    loadedAt,
    report: site,
    resolveAsset,
    dispose() {},
  };
}

/** Load a CLI report bundle (index.html, report.json, screenshots/, visual/) from local files. */
export async function loadReportFromFiles(files: readonly File[]): Promise<LoadedPageReport> {
  const index = indexFiles(files);
  const jsonFile = index.get("report.json");
  if (!jsonFile) {
    throw new ReportValidationError(
      "No report.json found. Select the folder created by `layoutlens scan --format html --output <dir>`.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await jsonFile.text());
  } catch {
    throw new ReportValidationError("report.json is not valid JSON.");
  }
  const report = parseLayoutLensReport(parsed);
  const urls = new Map<string, string>();

  return {
    id: reportIdFor(report),
    sourceName: folderNameOf(files),
    loadedAt: new Date().toISOString(),
    report,
    resolveAsset(path) {
      const file = lookupAsset(index, path);
      if (!file) return null;
      const key = normalizeAssetPath(path ?? "") ?? file.name;
      let url = urls.get(key);
      if (!url) {
        url = URL.createObjectURL(file);
        urls.set(key, url);
      }
      return url;
    },
    dispose() {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
  };
}
