import { FolderOpen } from "lucide-react";
import type { JsonReport } from "@layoutlens/shared";
import { useReports } from "../../data/report-store";
import { isLoadedSiteScan, isSiteScanEnvelope } from "../../data/load-report";
import { displayUrl } from "../../lib/format";
import { Button, Card, EmptyState, Notice } from "../../ui/primitives";
import { ReportPicker } from "./ReportPicker";
import { ReportWorkspace } from "./ReportWorkspace";
import { SiteScanDashboard } from "./SiteScanDashboard";

export function ReportLoadError() {
  const { error, dismissError } = useReports();
  if (!error) return null;
  return (
    <Notice
      tone="danger"
      title="Report could not be opened"
      action={<Button size="sm" variant="ghost" onClick={dismissError}>Dismiss</Button>}
    >
      {error}
    </Notice>
  );
}

export function NoReportState({ title = "Open a LayoutLens report" }: { title?: string }) {
  return (
    <Card className="empty-card">
      <EmptyState icon={<FolderOpen size={22} />} title={title} actions={<ReportPicker primary goToReports={false} />}>
        <p>
          Select the folder produced by{" "}
          <code>pnpm cli scan &lt;url&gt; --format html --output ./layoutlens-report</code>. Files are
          read locally in your browser and never uploaded.
        </p>
      </EmptyState>
    </Card>
  );
}

export function ReportsPage() {
  const { reports, active, setActive, closeReport } = useReports();
  return (
    <div className="page">
      <ReportLoadError />
      {!active ? (
        <NoReportState />
      ) : (
        <>
          <div className="reports-bar">
            {reports.length > 1 ? (
              <label className="select-field">
                <span className="select-label">Open reports</span>
                <select value={active.id} onChange={(e) => setActive(e.target.value)} aria-label="Switch report">
                  {reports.map((r) => {
                    const url = isSiteScanEnvelope(r.report) ? r.report.rootUrl : (r.report as JsonReport).url;
                    const { host, rest } = displayUrl(url);
                    return (
                      <option key={r.id} value={r.id}>
                        {host}{rest} — {r.sourceName}
                      </option>
                    );
                  })}
                </select>
              </label>
            ) : (
              <span className="muted small">Folder{" "}<span className="mono">{active.sourceName}</span></span>
            )}
            <ReportPicker compact goToReports={false} />
          </div>
          {isLoadedSiteScan(active) ? (
            <SiteScanDashboard loaded={active} site={active.report} onClose={() => closeReport(active.id)} />
          ) : (
            <ReportWorkspace key={active.id} loaded={active} onClose={() => closeReport(active.id)} />
          )}
        </>
      )}
    </div>
  );
}
