import { FileStack, RefreshCw, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  type FindingClassification,
  type FindingSeverity,
  type JsonSiteScanReport,
  type JsonSiteWideFinding,
} from "@layoutlens/shared";
import type { LoadedSiteScanReport } from "../../data/load-report";
import { useScanJobs } from "../../data/scan-jobs";
import { displayUrl, formatCount } from "../../lib/format";
import { Badge, Button, Card, EmptyState, Notice } from "../../ui/primitives";
import { navigationQualitySiteSummary } from "./site-scan-dashboard-copy";
import { pageDisplayPath } from "./site-scan-dashboard-utils";

const SEVERITIES: readonly FindingSeverity[] = ["high", "medium", "low"];
const CLASSIFICATIONS: readonly FindingClassification[] = ["confirmed", "potential", "insufficient-evidence"];
const KINDS = ["overflow", "advanced"] as const;

function formatDash(n: number | undefined): string {
  return n === undefined ? "—" : formatCount(n);
}

function noticeToneForNav(tone: import("./site-scan-dashboard-copy").SiteNavSummaryTone): "info" | "success" | "warning" | "danger" {
  if (tone === "neutral") return "info";
  return tone;
}

export function SiteScanDashboard({
  loaded,
  site,
  onClose,
}: {
  loaded: LoadedSiteScanReport;
  site: JsonSiteScanReport;
  onClose(): void;
}) {
  const { openSitePage, openSiteFinding, openingId, openError, scans, retrySiteScan, cancelScan } = useScanJobs();
  const scanJobId = loaded.scanJobId;
  const jobView = useMemo(() => scans.find((s) => s.id === scanJobId), [scans, scanJobId]);
  const siteRetry = jobView?.siteRetry;
  const retryRunning = siteRetry?.state === "running";
  const eligibleTasks = siteRetry?.tasks.filter((t) => t.eligible) ?? [];
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const { host, rest } = displayUrl(site.rootUrl);
  const [pageFilter, setPageFilter] = useState<string>("");
  const [viewportW, setViewportW] = useState<string>("");
  const [severity, setSeverity] = useState<string>("");
  const [classification, setClassification] = useState<string>("");
  const [kind, setKind] = useState<string>("");

  const pagePaths = useMemo(() => {
    const set = new Set<string>();
    for (const p of site.pages) set.add(pageDisplayPath(p.url));
    return [...set];
  }, [site.pages]);

  const filteredFindings = useMemo(() => {
    return site.siteWideFindings.filter((f) => {
      if (pageFilter) {
        const path = pageDisplayPath(f.pageUrl);
        if (path !== pageFilter) return false;
      }
      if (viewportW.trim()) {
        const w = Number(viewportW);
        if (!Number.isFinite(w) || f.viewportWidth !== w) return false;
      }
      if (severity && f.severity !== severity) return false;
      if (classification) {
        if (!f.classification || f.classification !== classification) return false;
      }
      if (kind && f.kind !== kind) return false;
      return true;
    });
  }, [site.siteWideFindings, pageFilter, viewportW, severity, classification, kind]);

  return (
    <div className="site-scan-dash" data-testid="site-scan-dashboard">
      <Card className="report-header" aria-label="Site scan summary">
        <div className="report-header-main">
          <div className="report-title-row">
            <h2 className="report-title">
              <span className="report-host">{host}</span>
              <span className="report-path">{rest}</span>
            </h2>
            <Badge tone={site.state === "cancelled" ? "neutral" : site.state === "partial" ? "warning" : "success"}>
              {site.state === "cancelled" ? "Cancelled" : site.state === "partial" ? "Partial" : "Completed"}
            </Badge>
            <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={onClose} className="site-scan-close">
              Close
            </Button>
          </div>
          <p className="report-meta mono small">
            Multi-page · up to {site.scope.maxPages} pages · crawl depth {site.scope.maxDepth} · viewports{" "}
            {site.viewports.map((v) => `${v.width}×${v.height}`).join(" · ")}
          </p>
          <dl className="evidence-summary" data-testid="site-overview-stats">
            <div>
              <dt>Pages completed</dt>
              <dd>
                {site.summary.completedPages}/{site.summary.totalPages}
              </dd>
            </div>
            <div>
              <dt>Viewport tasks done</dt>
              <dd>{formatCount(site.summary.totalViewportsCompleted)}</dd>
            </div>
            <div>
              <dt>Confirmed layout (overflow)</dt>
              <dd>{formatCount(site.summary.confirmedLayoutIssues)}</dd>
            </div>
            <div>
              <dt>Potential layout (overflow)</dt>
              <dd>{formatCount(site.summary.potentialFindings)}</dd>
            </div>
            <div>
              <dt>Responsive advisory</dt>
              <dd>{formatCount(site.summary.responsiveAdvisories)}</dd>
            </div>
            <div>
              <dt>Failed pages</dt>
              <dd>{formatCount(site.summary.failedPages)}</dd>
            </div>
          </dl>
          {(() => {
            const nav = navigationQualitySiteSummary(site);
            return nav ? (
              <Notice tone={noticeToneForNav(nav.tone)} title={nav.title}>
                <p>{nav.body}</p>
              </Notice>
            ) : null;
          })()}
          {scanJobId && jobView?.scanMode === "multi_page" ? (
            <div className="site-retry-panel" data-testid="site-retry-panel">
              <div className="site-retry-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RefreshCw size={14} />}
                  disabled={
                    retryBusy || retryRunning || eligibleTasks.length === 0 || site.state === "cancelled"
                  }
                  onClick={() => {
                    if (!scanJobId) return;
                    setRetryError(null);
                    setRetryBusy(true);
                    void retrySiteScan(scanJobId, { all: true })
                      .catch((e: unknown) => setRetryError(e instanceof Error ? e.message : "Retry failed."))
                      .finally(() => setRetryBusy(false));
                  }}
                >
                  Retry failed tasks
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!retryRunning || retryBusy}
                  onClick={() => {
                    if (!scanJobId) return;
                    setRetryBusy(true);
                    void cancelScan(scanJobId).finally(() => setRetryBusy(false));
                  }}
                >
                  Cancel retry
                </Button>
              </div>
              {retryRunning && siteRetry?.current ? (
                <p className="muted small" data-testid="site-retry-progress">
                  {siteRetry.message ??
                    `Retrying ${siteRetry.current.kind === "viewport" ? "viewport" : "page"} ${
                      siteRetry.current.kind === "viewport"
                        ? `${(siteRetry.current.viewportIndex ?? 0) + 1} · `
                        : ""
                    }page ${siteRetry.current.pageIndex + 1} · attempt ${siteRetry.current.attempt}`}
                </p>
              ) : null}
              {siteRetry && siteRetry.tasks.length > 0 ? (
                <details className="site-retry-details">
                  <summary className="muted small">Failed tasks and eligibility</summary>
                  <ul className="site-retry-task-list">
                    {siteRetry.tasks.map((t, idx) => (
                      <li key={`${t.kind}-${t.pageIndex}-${t.viewportIndex ?? "p"}-${idx}`} className="small">
                        {t.kind === "viewport" ? (
                          <span>
                            Page {t.pageIndex + 1} · viewport {(t.viewportIndex ?? 0) + 1} · {t.phase ?? "—"} · attempts{" "}
                            {t.attemptCount}/{siteRetry.maxAttemptsPerTask}
                          </span>
                        ) : (
                          <span>
                            Page {t.pageIndex + 1} (whole page) · attempts {t.attemptCount}/{siteRetry.maxAttemptsPerTask}
                          </span>
                        )}
                        <span className={t.eligible ? "text-success" : "muted"}>
                          {" "}
                          — {t.eligible ? "eligible" : t.ineligibleReason ?? "not eligible"}
                        </span>
                        <span className="muted"> · {t.message}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : !retryRunning ? (
                <p className="muted small">No retry tasks to show for this scan.</p>
              ) : null}
              {retryError ? (
                <p className="field-error" role="alert">
                  {retryError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      <section className="site-scan-section" aria-labelledby="page-explorer-heading">
        <h3 id="page-explorer-heading" className="section-title">
          Page explorer
        </h3>
        <div className="table-wrap">
          <table className="data-table" data-testid="site-page-explorer-table">
            <thead>
              <tr>
                <th>Page</th>
                <th>Status</th>
                <th>Confirmed</th>
                <th>Potential</th>
                <th>Responsive</th>
                <th>Affected viewports</th>
                <th>Preview</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {site.pages.map((p, i) => {
                const canOpen = p.status === "completed" && scanJobId;
                const preview =
                  p.previewScreenshot && scanJobId ? loaded.resolveAsset(p.previewScreenshot) : null;
                const layoutAffected =
                  p.viewportsWithLayoutIssues !== undefined ? p.viewportsWithLayoutIssues : p.issueCount;
                return (
                  <tr key={`${p.url}-${i}`}>
                    <td className="mono small">{pageDisplayPath(p.url)}</td>
                    <td>
                      <Badge tone={p.status === "completed" ? "success" : p.status === "failed" ? "danger" : "neutral"}>
                        {p.status}
                      </Badge>
                    </td>
                    <td>{formatDash(p.confirmedLayoutFindings)}</td>
                    <td>{formatDash(p.potentialLayoutFindings)}</td>
                    <td>{formatDash(p.advancedFindingCount)}</td>
                    <td>{formatDash(layoutAffected)}</td>
                    <td className="site-scan-thumb-cell">
                      {preview ? (
                        <img src={preview} alt="" className="site-scan-thumb" width={72} height={40} />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <div className="site-page-actions">
                        <Button
                          size="sm"
                          disabled={!canOpen || openingId === scanJobId}
                          onClick={() => scanJobId && void openSitePage(scanJobId, i)}
                        >
                          Open report
                        </Button>
                        {scanJobId && jobView?.scanMode === "multi_page" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={
                              retryBusy ||
                              retryRunning ||
                              !eligibleTasks.some((t) => t.pageIndex === i && t.eligible)
                            }
                            onClick={() => {
                              setRetryError(null);
                              setRetryBusy(true);
                              void retrySiteScan(scanJobId, { pageIndex: i })
                                .catch((e: unknown) =>
                                  setRetryError(e instanceof Error ? e.message : "Retry failed."),
                                )
                                .finally(() => setRetryBusy(false));
                            }}
                          >
                            Retry page
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="site-scan-section" aria-labelledby="site-findings-heading">
        <h3 id="site-findings-heading" className="section-title">
          Site-wide findings
        </h3>
        <div className="site-scan-filters">
          <label className="select-field">
            <span className="select-label">Page</span>
            <select value={pageFilter} onChange={(e) => setPageFilter(e.target.value)} aria-label="Filter by page">
              <option value="">All pages</option>
              {pagePaths.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          </label>
          <label className="select-field">
            <span className="select-label">Viewport</span>
            <select value={viewportW} onChange={(e) => setViewportW(e.target.value)} aria-label="Filter by viewport width">
              <option value="">All</option>
              {site.viewports.map((v) => (
                <option key={`${v.width}-${v.height}`} value={String(v.width)}>
                  {v.width}×{v.height} ({v.label})
                </option>
              ))}
            </select>
          </label>
          <label className="select-field">
            <span className="select-label">Severity</span>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">All</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="select-field">
            <span className="select-label">Classification</span>
            <select value={classification} onChange={(e) => setClassification(e.target.value)}>
              <option value="">All</option>
              {CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/-/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="select-field">
            <span className="select-label">Type</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        </div>

        {filteredFindings.length === 0 ? (
          <EmptyState icon={<FileStack size={20} />} title="No findings match these filters">
            <p>Clear filters or pick a page in the table and open its report.</p>
          </EmptyState>
        ) : (
          <ul className="site-finding-list">
            {filteredFindings.map((f: JsonSiteWideFinding) => (
              <li key={f.id} className="site-finding-row">
                <div className="site-finding-main">
                  <span className="mono small">{pageDisplayPath(f.pageUrl)}</span>
                  <span className="muted small">
                    {f.viewportLabel} · {f.kind} · {f.issueType} · {f.severity}
                    {f.classification ? ` · ${f.classification}` : ""}
                  </span>
                  <p className="site-finding-title">{f.title}</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!scanJobId || openingId === scanJobId}
                  onClick={() => scanJobId && void openSiteFinding(scanJobId, f.pageIndex, f)}
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {openError ? (
        <p className="field-error" role="alert">
          {openError}
        </p>
      ) : null}
    </div>
  );
}
