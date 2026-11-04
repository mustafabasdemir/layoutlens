import { SCAN_FILE_PATTERN, scanFileUrl, type JsonReport } from "@layoutlens/shared";
import { normalizeAssetPath, parseLayoutLensReport, ReportValidationError } from "./report-validate";

export interface LoadedReport {
  id: string;
  /** Folder name the user selected (from the browser file picker). */
  sourceName: string;
  /** Set when the report came from the local scanning service. */
  scanId?: string;
  loadedAt: string;
  report: JsonReport;
  /** Resolve a report-relative asset (e.g. `screenshots/viewport-390.png`) to a local object URL. */
  resolveAsset(path: string | undefined): string | null;
  dispose(): void;
}

export interface LocalFileLike {
  name: string;
  /** Path relative to the selected folder root, including the folder name. */
  webkitRelativePath?: string;
  text(): Promise<string>;
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

/**
 * Wrap a report produced by the local scanning service. Assets resolve to the API's
 * whitelisted file endpoint; anything else resolves to nothing.
 */
export function loadReportFromScan(scanId: string, raw: unknown, loadedAt = new Date().toISOString()): LoadedReport {
  const report = parseLayoutLensReport(raw);
  return {
    id: reportIdFor(report),
    sourceName: `Studio scan ${scanId.slice(0, 8)}`,
    scanId,
    loadedAt,
    report,
    resolveAsset(path) {
      const normalized = path ? normalizeAssetPath(path) : null;
      return normalized && SCAN_FILE_PATTERN.test(normalized) ? scanFileUrl(scanId, normalized) : null;
    },
    dispose() {},
  };
}

/** Load a CLI report bundle (index.html, report.json, screenshots/, visual/) from local files. */
export async function loadReportFromFiles(files: readonly File[]): Promise<LoadedReport> {
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
