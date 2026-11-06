import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  clearHistory as clearStoredHistory,
  historyEntryFromReport,
  readHistory,
  recordHistory,
  type KeyValueStorage,
  type ReportHistoryEntry,
} from "./history";
import { isSiteScanEnvelope, loadReportFromFiles, type LoadedReport } from "./load-report";

interface ReportStoreValue {
  /** Reports opened in this browser session (screenshots available). */
  reports: LoadedReport[];
  active: LoadedReport | null;
  history: ReportHistoryEntry[];
  loading: boolean;
  error: string | null;
  openFiles(files: readonly File[]): Promise<LoadedReport | null>;
  /** Show an already-loaded report (e.g. one fetched from the scanning service). */
  addReport(loaded: LoadedReport): void;
  setActive(id: string): void;
  closeReport(id: string): void;
  clearHistory(): void;
  dismissError(): void;
}

const ReportStoreContext = createContext<ReportStoreValue | null>(null);

function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function ReportStoreProvider({ children }: { children: ReactNode }) {
  const storage = useRef(browserStorage());
  const [reports, setReports] = useState<LoadedReport[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [history, setHistory] = useState<ReportHistoryEntry[]>(() =>
    storage.current ? readHistory(storage.current) : [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reportsRef = useRef(reports);
  reportsRef.current = reports;

  useEffect(() => () => reportsRef.current.forEach((r) => r.dispose()), []);

  const addReport = useCallback((loaded: LoadedReport) => {
    setReports((prev) => {
      prev.filter((r) => r.id === loaded.id && r !== loaded).forEach((r) => r.dispose());
      return [loaded, ...prev.filter((r) => r.id !== loaded.id)];
    });
    setActiveId(loaded.id);
    setError(null);
    if (storage.current && !loaded.scanId && !isSiteScanEnvelope(loaded.report)) {
      setHistory(
        recordHistory(
          storage.current,
          historyEntryFromReport(loaded.id, loaded.report, loaded.sourceName, loaded.loadedAt),
        ),
      );
    }
  }, []);

  const openFiles = useCallback(async (files: readonly File[]) => {
    if (files.length === 0) return null;
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadReportFromFiles(files);
      addReport(loaded);
      return loaded;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The report could not be opened.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [addReport]);

  const closeReport = useCallback((id: string) => {
    setReports((prev) => {
      prev.filter((r) => r.id === id).forEach((r) => r.dispose());
      return prev.filter((r) => r.id !== id);
    });
    setActiveId((cur) => (cur === id ? null : cur));
  }, []);

  const clearHistory = useCallback(() => {
    if (storage.current) clearStoredHistory(storage.current);
    setHistory([]);
  }, []);

  const active = useMemo(
    () => reports.find((r) => r.id === activeId) ?? reports[0] ?? null,
    [reports, activeId],
  );

  const value = useMemo<ReportStoreValue>(
    () => ({
      reports,
      active,
      history,
      loading,
      error,
      openFiles,
      addReport,
      setActive: setActiveId,
      closeReport,
      clearHistory,
      dismissError: () => setError(null),
    }),
    [reports, active, history, loading, error, openFiles, addReport, closeReport, clearHistory],
  );

  return <ReportStoreContext.Provider value={value}>{children}</ReportStoreContext.Provider>;
}

export function useReports(): ReportStoreValue {
  const ctx = useContext(ReportStoreContext);
  if (!ctx) throw new Error("useReports must be used inside ReportStoreProvider");
  return ctx;
}
