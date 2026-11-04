import type { JsonReport, SeverityCounts } from "@layoutlens/shared";

/** Metadata for a report the user actually opened in Studio. Screenshots are never stored. */
export interface ReportHistoryEntry {
  id: string;
  url: string;
  scannedAt: string;
  openedAt: string;
  sourceName: string;
  viewportWidths: number[];
  findingCount: number;
  viewportIssueCount: number;
  bySeverity: SeverityCounts;
  visualFailures: number | null;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const HISTORY_STORAGE_KEY = "layoutlens.studio.history.v1";
export const HISTORY_LIMIT = 25;

export function historyEntryFromReport(
  id: string,
  report: JsonReport,
  sourceName: string,
  openedAt: string,
): ReportHistoryEntry {
  return {
    id,
    url: report.url,
    scannedAt: report.scannedAt,
    openedAt,
    sourceName,
    viewportWidths: report.viewports.map((v) => v.width),
    findingCount: report.summary.findingCount,
    viewportIssueCount: report.summary.viewportIssueCount,
    bySeverity: { ...report.summary.bySeverity },
    visualFailures:
      typeof report.summary.visualFailures === "number" ? report.summary.visualFailures : null,
  };
}

function isEntry(v: unknown): v is ReportHistoryEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.url === "string" &&
    typeof e.scannedAt === "string" &&
    Array.isArray(e.viewportWidths) &&
    typeof e.findingCount === "number"
  );
}

export function readHistory(storage: KeyValueStorage): ReportHistoryEntry[] {
  try {
    const raw = storage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

export function recordHistory(
  storage: KeyValueStorage,
  entry: ReportHistoryEntry,
): ReportHistoryEntry[] {
  const next = [entry, ...readHistory(storage).filter((e) => e.id !== entry.id)].slice(
    0,
    HISTORY_LIMIT,
  );
  storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearHistory(storage: KeyValueStorage): void {
  storage.removeItem(HISTORY_STORAGE_KEY);
}
