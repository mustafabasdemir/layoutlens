import { CheckCircle2, CircleSlash, Layers, Loader2, OctagonAlert, Square } from "lucide-react";
import { progressPercent, type ScanJobView } from "@layoutlens/shared";
import { useScanJobs } from "../../data/scan-jobs";
import { displayUrl, formatCount, plural } from "../../lib/format";
import { Badge, Button, Card, Notice } from "../../ui/primitives";

function duration(view: ScanJobView): string | null {
  if (!view.startedAt || !view.finishedAt) return null;
  const ms = Date.parse(view.finishedAt) - Date.parse(view.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export function ScanStateBadge({ scan }: { scan: ScanJobView }) {
  switch (scan.state) {
    case "queued":
      return <Badge tone="info">Queued</Badge>;
    case "running":
      return <Badge tone="accent">Scanning</Badge>;
    case "completed":
      return <Badge tone="success">Completed</Badge>;
    case "failed":
      return <Badge tone="danger">Failed</Badge>;
    case "cancelled":
      return <Badge>Cancelled</Badge>;
  }
}

/** Live status of one scan. Percentages come only from completed scan stages. */
export function ScanProgress({ scan, onRetry }: { scan: ScanJobView; onRetry?: () => void }) {
  const { cancelScan, openResults, openingId, openError } = useScanJobs();
  const { host, rest } = displayUrl(scan.url);
  const pct = scan.state === "running" ? progressPercent(scan.progress) : null;

  return (
    <Card className="scan-progress" aria-label="Scan status" data-testid="scan-progress" data-state={scan.state}>
      <div className="scan-progress-head">
        <div className="scan-progress-title">
          {scan.state === "queued" || scan.state === "running" ? (
            <Loader2 size={18} className="spin" aria-hidden="true" />
          ) : scan.state === "completed" ? (
            <CheckCircle2 size={18} className="text-success" aria-hidden="true" />
          ) : scan.state === "failed" ? (
            <OctagonAlert size={18} className="text-danger" aria-hidden="true" />
          ) : (
            <CircleSlash size={18} className="muted" aria-hidden="true" />
          )}
          <span className="scan-progress-url">
            <span className="report-host">{host}</span>
            <span className="report-path">{rest}</span>
          </span>
        </div>
        <ScanStateBadge scan={scan} />
      </div>

      <div aria-live="polite" className="scan-progress-body">
        {scan.state === "queued" ? (
          <p className="scan-progress-message">
            Waiting for a free scanner{scan.queuePosition ? ` — position ${scan.queuePosition} in the queue` : ""}.
          </p>
        ) : null}

        {scan.state === "running" ? (
          <>
            <p className="scan-progress-message" data-testid="scan-progress-message">{scan.progress.message}</p>
            {pct !== null ? (
              <div className="progress">
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="Scan progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                  aria-valuetext={`Step ${scan.progress.completedSteps} of ${scan.progress.totalSteps} complete`}
                >
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="progress-label">
                  {scan.progress.completedSteps} of {scan.progress.totalSteps} stages · {pct}%
                </span>
              </div>
            ) : null}
          </>
        ) : null}

        {scan.state === "completed" && scan.summary ? (
          <div className="scan-result">
            <dl className="scan-result-stats">
              <div><dt>Findings</dt><dd data-testid="scan-result-findings">{formatCount(scan.summary.findingCount)}</dd></div>
              {scan.summary.byClassification ? (
                <>
                  <div><dt>Confirmed</dt><dd className="sev-text-high" data-testid="scan-result-confirmed">{scan.summary.byClassification.confirmed}</dd></div>
                  <div><dt>Potential</dt><dd className="sev-text-medium" data-testid="scan-result-potential">{scan.summary.byClassification.potential}</dd></div>
                  <div><dt>Excluded</dt><dd data-testid="scan-result-excluded">{scan.summary.excludedCount ?? 0}</dd></div>
                </>
              ) : (
                <>
                  <div><dt>High</dt><dd className="sev-text-high">{scan.summary.bySeverity.high}</dd></div>
                  <div><dt>Medium</dt><dd className="sev-text-medium">{scan.summary.bySeverity.medium}</dd></div>
                  <div><dt>Low</dt><dd className="sev-text-low">{scan.summary.bySeverity.low}</dd></div>
                </>
              )}
              <div>
                <dt>Viewports</dt>
                <dd className="mono small">{scan.summary.viewportWidths.map((w) => `${w}px`).join(" · ")}</dd>
              </div>
            </dl>
            <p className="field-hint">
              {plural(scan.summary.viewportIssueCount, "viewport")} with horizontal overflow
              {duration(scan) ? ` · finished in ${duration(scan)}` : ""}.{" "}
              {scan.summary.truncated ? "Some results were truncated by reporting limits — the report says where. " : ""}
              {scan.baseline
                ? `Compared with baseline “${scan.baseline.name}”: ${scan.summary.visualFailures ?? 0} viewport(s) differ.`
                : "No baseline exists for this URL, so visual comparison was skipped."}{" "}
              Accessibility checks aren't part of LayoutLens scans, so no accessibility findings are reported.
            </p>
            <div className="scan-progress-actions">
              <Button
                variant="primary"
                onClick={() => void openResults(scan.id)}
                disabled={openingId === scan.id}
              >
                {openingId === scan.id ? "Opening…" : "View results"}
              </Button>
              {scan.baseline ? (
                <Button icon={<Layers size={14} />} onClick={() => void openResults(scan.id, { navigateTo: "visual" })}>
                  Visual regression
                </Button>
              ) : null}
            </div>
            {openError ? <p className="field-error" role="alert">{openError}</p> : null}
          </div>
        ) : null}

        {scan.state === "failed" ? (
          <Notice tone="danger" title="The scan failed">
            <p data-testid="scan-error">{scan.error ?? "The scanner stopped without a reason."}</p>
          </Notice>
        ) : null}
        {scan.state === "cancelled" ? <p className="scan-progress-message">{scan.error ?? "The scan was cancelled."}</p> : null}
      </div>

      {scan.state === "queued" || scan.state === "running" ? (
        <div className="scan-progress-actions">
          <Button size="sm" variant="ghost" icon={<Square size={12} />} onClick={() => void cancelScan(scan.id).catch(() => undefined)}>
            Cancel scan
          </Button>
        </div>
      ) : null}
      {(scan.state === "failed" || scan.state === "cancelled") && onRetry ? (
        <div className="scan-progress-actions">
          <Button size="sm" onClick={onRetry}>Scan again</Button>
        </div>
      ) : null}
    </Card>
  );
}
