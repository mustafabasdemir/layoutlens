import { AlertOctagon, FileText, Layers, MonitorSmartphone, ScanSearch } from "lucide-react";
import { hrefFor, navigate } from "../../app/router";
import { useReports } from "../../data/report-store";
import type { ReportHistoryEntry } from "../../data/history";
import { displayUrl, formatCount, formatDateTime } from "../../lib/format";
import { Badge, Button, Card, EmptyState, Notice } from "../../ui/primitives";
import { ReportPicker } from "../reports/ReportPicker";
import { useScanJobs } from "../../data/scan-jobs";
import { RecentScans } from "../scan/RecentScans";
import { ScanUrlForm } from "./ScanUrlForm";

function SummaryCards() {
  const { active } = useReports();
  if (!active) {
    return (
      <Card className="summary-empty" aria-label="Report summary">
        <EmptyState
          icon={<ScanSearch size={22} />}
          title="No report loaded"
          actions={<ReportPicker primary />}
        >
          <p>
            Metrics appear here once a scan finishes or you open a report folder from the LayoutLens CLI.
            Nothing is estimated or sampled — every number comes from a real scan.
          </p>
        </EmptyState>
      </Card>
    );
  }
  const { report } = active;
  const s = report.summary;
  const hasVisual = report.viewports.some((v) => v.visualCompare);
  const items = [
    {
      label: "Total findings",
      value: formatCount(s.findingCount),
      hint: s.byClassification
        ? `${s.byClassification.confirmed} confirmed · ${s.byClassification.potential} potential · ${s.excludedCount ?? 0} excluded${s.truncated ? " · truncated" : ""}`
        : `${formatCount(s.viewportIssueCount)} viewport(s) overflow`,
      icon: FileText,
      tone: s.findingCount > 0 ? "warning" : "success",
    },
    { label: "High severity", value: formatCount(s.bySeverity.high), hint: `${s.bySeverity.medium} medium · ${s.bySeverity.low} low`, icon: AlertOctagon, tone: s.bySeverity.high > 0 ? "danger" : "success" },
    { label: "Viewports scanned", value: formatCount(report.viewports.length), hint: report.viewports.map((v) => `${v.width}px`).join(" · "), icon: MonitorSmartphone, tone: "neutral" },
    {
      label: "Visual regressions",
      value: hasVisual ? formatCount(s.visualFailures ?? 0) : "—",
      hint: hasVisual ? "Viewports differing from baseline" : "Scanned without a baseline",
      icon: Layers,
      tone: hasVisual && (s.visualFailures ?? 0) > 0 ? "danger" : "neutral",
    },
  ] as const;
  const { host, rest } = displayUrl(report.url);
  return (
    <section aria-labelledby="summary-heading" className="summary">
      <div className="section-head">
        <h2 id="summary-heading" className="section-title">Latest report</h2>
        <p className="section-meta">
          <span className="mono">{host}{rest}</span> · {formatDateTime(report.scannedAt)}
        </p>
      </div>
      <div className="stat-grid">
        {items.map(({ label, value, hint, icon: Icon, tone }) => (
          <Card key={label} className={`stat-card stat-${tone}`} as="div">
            <div className="stat-top">
              <span className="stat-label">{label}</span>
              <Icon size={15} aria-hidden="true" className="stat-icon" />
            </div>
            <span className="stat-value" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</span>
            <span className="stat-hint">{hint}</span>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function SeverityInline({ entry }: { entry: Pick<ReportHistoryEntry, "bySeverity"> }) {
  const { high, medium, low } = entry.bySeverity;
  if (high + medium + low === 0) return <Badge tone="success">No findings</Badge>;
  return (
    <span className="sev-inline">
      {high > 0 ? <Badge tone="danger">{high} high</Badge> : null}
      {medium > 0 ? <Badge tone="warning">{medium} med</Badge> : null}
      {low > 0 ? <Badge tone="info">{low} low</Badge> : null}
    </span>
  );
}

export function RecentReports({ limit }: { limit?: number }) {
  const { history, reports, setActive } = useReports();
  const rows = limit ? history.slice(0, limit) : history;
  if (rows.length === 0) {
    return (
      <EmptyState icon={<FileText size={20} />} title="No reports opened yet">
        <p>
          CLI report folders you open in Studio are listed here. Scans started from Studio appear under
          Recent scans.
        </p>
      </EmptyState>
    );
  }
  return (
    <ul className="report-list" aria-label="Recent reports">
      {rows.map((entry) => {
        const loaded = reports.some((r) => r.id === entry.id);
        const { host, rest } = displayUrl(entry.url);
        return (
          <li key={entry.id} className="report-row">
            <div className="report-row-main">
              <span className="report-row-url">
                <span className="report-host">{host}</span>
                <span className="report-path">{rest}</span>
              </span>
              <span className="report-row-meta">
                Scanned {formatDateTime(entry.scannedAt)} · {entry.viewportWidths.map((w) => `${w}px`).join(", ")} · folder <span className="mono">{entry.sourceName}</span>
              </span>
            </div>
            <div className="report-row-stats">
              <span className="report-count">{formatCount(entry.findingCount)} findings</span>
              <SeverityInline entry={entry} />
            </div>
            <div className="report-row-action">
              {loaded ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setActive(entry.id);
                    navigate("reports");
                  }}
                >
                  Open
                </Button>
              ) : (
                <span className="muted small" title="Screenshots stay on disk; select the folder again to view them.">
                  Reopen folder to view
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function OverviewPage() {
  const { error, dismissError } = useReports();
  const { service } = useScanJobs();
  return (
    <div className="page page-overview">
      <section className="hero" aria-labelledby="hero-title">
        <p className="eyebrow">LayoutLens Studio</p>
        <h2 id="hero-title" className="hero-title">Your websites. Under control.</h2>
        <p className="hero-sub">
          Detect responsive issues, visual regressions, and broken layouts before your users do.
        </p>
        <ScanUrlForm />
      </section>

      {error ? (
        <Notice tone="danger" title="Report could not be opened" action={<Button size="sm" variant="ghost" onClick={dismissError}>Dismiss</Button>}>
          {error}
        </Notice>
      ) : null}

      <SummaryCards />

      {service.status === "available" ? (
        <section aria-labelledby="recent-scans-heading" className="recent">
          <div className="section-head">
            <h2 id="recent-scans-heading" className="section-title">Recent scans</h2>
            <a className="link" href={hrefFor("history")}>All scans</a>
          </div>
          <Card className="list-card">
            <RecentScans limit={5} />
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="recent-heading" className="recent">
        <div className="section-head">
          <h2 id="recent-heading" className="section-title">Recent reports</h2>
          <a className="link" href={hrefFor("history")}>View history</a>
        </div>
        <Card className="list-card">
          <RecentReports limit={5} />
        </Card>
      </section>
    </div>
  );
}
