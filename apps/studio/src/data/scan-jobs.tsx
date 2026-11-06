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
import type { JsonSiteWideFinding, RetryScanRequestBody, ScanJobView, ScanServiceInfo } from "@layoutlens/shared";
import {
  scanApi as defaultApi,
  ScanApiError,
  ScanServiceUnavailableError,
  type ScanApi,
  type StartScanOptions,
} from "../api/scan-api";
import { navigate } from "../app/router";
import { workspaceKeyForSiteWideFinding } from "../lib/workspace-findings";
import { loadReportFromScan, loadSitePageReport } from "./load-report";
import { useReports } from "./report-store";

export type ServiceState =
  | { status: "checking" }
  | { status: "available"; info: ScanServiceInfo }
  | { status: "unavailable"; message: string };

interface ScanJobsValue {
  service: ServiceState;
  /** Scans stored by the local service, newest first. */
  scans: ScanJobView[];
  /** Scan started from this browser tab. */
  current: ScanJobView | null;
  /** A scan from this tab is being submitted, queued, or running. */
  busy: boolean;
  startScan(url: string, options?: StartScanOptions): Promise<ScanJobView>;
  cancelScan(id: string): Promise<void>;
  retrySiteScan(id: string, body?: RetryScanRequestBody): Promise<void>;
  openResults(id: string, options?: { navigateTo?: "reports" | "visual" | null }): Promise<boolean>;
  openSitePage(scanId: string, pageIndex: number): Promise<boolean>;
  openSiteFinding(scanId: string, pageIndex: number, finding: JsonSiteWideFinding): Promise<boolean>;
  openingId: string | null;
  openError: string | null;
  checkService(): Promise<ServiceState>;
}

const ScanJobsContext = createContext<ScanJobsValue | null>(null);
const POLL_MS = 1000;

export function isActive(scan: ScanJobView | null | undefined): boolean {
  return scan?.state === "queued" || scan?.state === "running";
}

export function ScanJobsProvider({ children, api = defaultApi }: { children: ReactNode; api?: ScanApi }) {
  const { addReport } = useReports();
  const [service, setService] = useState<ServiceState>({ status: "checking" });
  const [scans, setScans] = useState<ScanJobView[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const autoOpened = useRef(new Set<string>());

  const checkService = useCallback(async (): Promise<ServiceState> => {
    try {
      const info = await api.health();
      const next: ServiceState = { status: "available", info };
      setService(next);
      setScans(await api.listScans());
      return next;
    } catch (e) {
      const next: ServiceState = {
        status: "unavailable",
        message: e instanceof ScanApiError ? e.message : new ScanServiceUnavailableError().message,
      };
      setService(next);
      return next;
    }
  }, [api]);

  useEffect(() => {
    void checkService();
  }, [checkService]);

  const anyActive = scans.some(isActive);
  const retryActive = scans.some((s) => s.siteRetry?.state === "running");
  useEffect(() => {
    if (service.status !== "available" || (!anyActive && !retryActive)) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const next = await api.listScans();
        if (!cancelled) setScans(next);
      } catch (e) {
        if (!cancelled && e instanceof ScanServiceUnavailableError) {
          setService({ status: "unavailable", message: e.message });
        }
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, service.status, anyActive, retryActive]);

  const startScan = useCallback(
    async (url: string, options?: StartScanOptions) => {
      setSubmitting(true);
      try {
        if (service.status !== "available") {
          const state = await checkService();
          if (state.status !== "available") throw new ScanServiceUnavailableError();
        }
        const view = await api.startScan(url, options);
        setCurrentId(view.id);
        setScans((prev) => [view, ...prev.filter((s) => s.id !== view.id)]);
        return view;
      } finally {
        setSubmitting(false);
      }
    },
    [api, checkService, service.status],
  );

  const cancelScan = useCallback(
    async (id: string) => {
      const view = await api.cancelScan(id);
      setScans((prev) => prev.map((s) => (s.id === id ? view : s)));
    },
    [api],
  );

  const retrySiteScan = useCallback(
    async (id: string, body?: RetryScanRequestBody) => {
      const view = await api.retryScan(id, body);
      setScans((prev) => prev.map((s) => (s.id === id ? view : s)));
    },
    [api],
  );

  const openResults = useCallback(
    async (id: string, options: { navigateTo?: "reports" | "visual" | null } = {}) => {
      setOpeningId(id);
      setOpenError(null);
      try {
        const raw = await api.getResults(id);
        addReport(loadReportFromScan(id, raw));
        const target = options.navigateTo === undefined ? "reports" : options.navigateTo;
        if (target) navigate(target);
        return true;
      } catch (e) {
        setOpenError(e instanceof Error ? e.message : "The scan results could not be loaded.");
        return false;
      } finally {
        setOpeningId(null);
      }
    },
    [api, addReport],
  );

  const openSitePage = useCallback(
    async (scanId: string, pageIndex: number) => {
      setOpeningId(scanId);
      setOpenError(null);
      try {
        const raw = await api.getPageReport(scanId, pageIndex);
        addReport(loadSitePageReport(raw, scanId, pageIndex));
        navigate("reports");
        return true;
      } catch (e) {
        setOpenError(e instanceof Error ? e.message : "The page report could not be loaded.");
        return false;
      } finally {
        setOpeningId(null);
      }
    },
    [api, addReport],
  );

  const openSiteFinding = useCallback(
    async (scanId: string, pageIndex: number, finding: JsonSiteWideFinding) => {
      setOpeningId(scanId);
      setOpenError(null);
      try {
        const raw = await api.getPageReport(scanId, pageIndex);
        const base = loadSitePageReport(raw, scanId, pageIndex);
        const key = workspaceKeyForSiteWideFinding(base.report, finding);
        addReport(
          key ? { ...base, initialFocus: { viewportWidth: finding.viewportWidth, findingKey: key } } : base,
        );
        navigate("reports");
        return true;
      } catch (e) {
        setOpenError(e instanceof Error ? e.message : "The page report could not be loaded.");
        return false;
      } finally {
        setOpeningId(null);
      }
    },
    [api, addReport],
  );

  const current = scans.find((s) => s.id === currentId) ?? null;

  useEffect(() => {
    if (current?.state === "completed" && !autoOpened.current.has(current.id)) {
      autoOpened.current.add(current.id);
      const navigateTo = current.scanMode === "multi_page" ? "reports" : null;
      void openResults(current.id, { navigateTo });
    }
  }, [current, openResults]);

  const value = useMemo<ScanJobsValue>(
    () => ({
      service,
      scans,
      current,
      busy: submitting || isActive(current),
      startScan,
      cancelScan,
      retrySiteScan,
      openResults,
      openSitePage,
      openSiteFinding,
      openingId,
      openError,
      checkService,
    }),
    [
      service,
      scans,
      current,
      submitting,
      startScan,
      cancelScan,
      retrySiteScan,
      openResults,
      openSitePage,
      openSiteFinding,
      openingId,
      openError,
      checkService,
    ],
  );

  return <ScanJobsContext.Provider value={value}>{children}</ScanJobsContext.Provider>;
}

export function useScanJobs(): ScanJobsValue {
  const ctx = useContext(ScanJobsContext);
  if (!ctx) throw new Error("useScanJobs must be used inside ScanJobsProvider");
  return ctx;
}
