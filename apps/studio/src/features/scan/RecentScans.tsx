import { Radar } from "lucide-react";
import { useScanJobs, isActive } from "../../data/scan-jobs";
import { displayUrl, formatCount, formatDateTime } from "../../lib/format";
import { Button, EmptyState, Notice } from "../../ui/primitives";
import { SeverityInline } from "../overview/OverviewPage";
import { ScanStateBadge } from "./ScanProgress";

/** Scans stored by the local scanning service (real persisted data only). */
export function RecentScans({ limit }: { limit?: number }) {
  const { service, scans, openResults, openingId, openError, cancelScan } = useScanJobs();

  if (service.status === "unavailable") {
    return (
      <div className="list-notice">
        <Notice tone="info" title="Scanning service not running">{service.message}</Notice>
      </div>
    );
  }
  const rows = limit ? scans.slice(0, limit) : scans;
  if (service.status === "checking") return <p className="list-loading muted small">Checking the local scanning service…</p>;
  if (rows.length === 0) {
    return (
      <EmptyState icon={<Radar size={20} />} title="No scans yet">
        <p>Scans you start from Studio are stored on this machine and listed here.</p>
      </EmptyState>
    );
  }
  return (
    <>
      {openError ? <div className="list-notice"><Notice tone="danger" title="Couldn't open results">{openError}</Notice></div> : null}
      <ul className="report-list" aria-label="Recent scans" data-testid="recent-scans">
        {rows.map((scan) => {
          const { host, rest } = displayUrl(scan.url);
          return (
            <li key={scan.id} className="report-row" data-scan={scan.id} data-state={scan.state}>
              <div className="report-row-main">
                <span className="report-row-url">
                  <span className="report-host">{host}</span>
                  <span className="report-path">{rest}</span>
                </span>
                <span className="report-row-meta">
                  {formatDateTime(scan.createdAt)}
                  {scan.state === "running" ? ` · ${scan.progress.message}` : ""}
                  {scan.state === "failed" && scan.error ? ` · ${scan.error}` : ""}
                  {scan.baseline ? ` · baseline “${scan.baseline.name}”` : ""}
                </span>
              </div>
              <div className="report-row-stats">
                {scan.summary ? (
                  <>
                    <span className="report-count">{formatCount(scan.summary.findingCount)} findings</span>
                    <SeverityInline entry={scan.summary} />
                  </>
                ) : null}
                <ScanStateBadge scan={scan} />
              </div>
              <div className="report-row-action">
                {scan.state === "completed" ? (
                  <Button size="sm" onClick={() => void openResults(scan.id)} disabled={openingId === scan.id}>
                    {openingId === scan.id ? "Opening…" : "Open"}
                  </Button>
                ) : isActive(scan) ? (
                  <Button size="sm" variant="ghost" onClick={() => void cancelScan(scan.id).catch(() => undefined)}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
