import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Layers, X } from "lucide-react";
import type { LoadedReport } from "../../data/load-report";
import { navigate } from "../../app/router";
import {
  DEFAULT_FILTERS,
  filterFindings,
  findingKey,
  findingsForViewport,
  isLegacyReport,
  reportHealth,
  type FindingFilters,
} from "../../lib/findings";
import { displayUrl, formatDateTime, plural } from "../../lib/format";
import { useImageSize } from "../../ui/hooks";
import { Badge, Button, Card, Notice } from "../../ui/primitives";
import { ZoomControls } from "../../ui/ZoomFrame";
import { DeviceTabs } from "./DeviceTabs";
import { FindingsPanel } from "./FindingsPanel";
import { IssueDetail } from "./IssueDetail";
import { overlayFor, ScreenshotViewer } from "./ScreenshotViewer";

const HEALTH = {
  clean: { tone: "success", label: "No overflow detected" },
  issues: { tone: "danger", label: "Layout issues found" },
  review: { tone: "warning", label: "Needs review" },
  "visual-changes": { tone: "warning", label: "Visual changes detected" },
} as const;

function isSafeHttpUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

export function ReportHeader({ loaded, onClose }: { loaded: LoadedReport; onClose(): void }) {
  const { report } = loaded;
  const health = HEALTH[reportHealth(report)];
  const { host, rest } = displayUrl(report.url);
  const hasVisual = report.viewports.some((v) => v.visualCompare);
  const s = report.summary;
  return (
    <Card className="report-header" aria-label="Report summary">
      <div className="report-header-main">
        <div className="report-title-row">
          <h2 className="report-title">
            <span className="report-host">{host}</span>
            <span className="report-path">{rest}</span>
          </h2>
          <Badge tone={health.tone}>{health.label}</Badge>
        </div>
        <p className="report-meta">
          Scanned {formatDateTime(report.scannedAt)} · {plural(report.viewports.length, "viewport")} · {plural(s.findingCount, "finding")} ·{" "}
          <span className="sev-text sev-text-high">{s.bySeverity.high} high</span>,{" "}
          <span className="sev-text sev-text-medium">{s.bySeverity.medium} medium</span>,{" "}
          <span className="sev-text sev-text-low">{s.bySeverity.low} low</span>
        </p>
        {s.byClassification ? (
          <dl className="evidence-summary" data-testid="evidence-summary">
            <div><dt>Confirmed</dt><dd data-testid="count-confirmed">{s.byClassification.confirmed}</dd></div>
            <div><dt>Potential</dt><dd data-testid="count-potential">{s.byClassification.potential}</dd></div>
            <div><dt>Insufficient evidence</dt><dd data-testid="count-insufficient">{s.byClassification.insufficientEvidence}</dd></div>
            <div><dt>Excluded as intentional</dt><dd data-testid="count-excluded">{s.excludedCount ?? 0}</dd></div>
          </dl>
        ) : null}
        {s.truncated ? (
          <Notice tone="warning" title="Results are truncated">
            At least one viewport reached a reporting limit, so these counts cover only what was reported. Each viewport lists what was left out.
          </Notice>
        ) : null}
        {isLegacyReport(report) && s.findingCount > 0 ? (
          <Notice tone="info" title="Report from an older LayoutLens version">
            Findings are not classified by evidence, clipped and offscreen content is not separated out, and that version kept at most 25 findings per viewport without marking the list as truncated.
          </Notice>
        ) : null}
      </div>
      <div className="report-actions">
        {isSafeHttpUrl(report.url) ? (
          <a className="btn btn-ghost btn-sm" href={report.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} aria-hidden="true" /> Open site
          </a>
        ) : null}
        {hasVisual ? (
          <Button size="sm" icon={<Layers size={14} />} onClick={() => navigate("visual")}>
            Visual regression
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={onClose}>
          Close report
        </Button>
      </div>
    </Card>
  );
}

export function ReportWorkspace({ loaded, onClose }: { loaded: LoadedReport; onClose(): void }) {
  const { report } = loaded;
  const firstWidth = report.viewports[0]?.width ?? 0;
  const [width, setWidth] = useState(firstWidth);
  const [filters, setFilters] = useState<FindingFilters>(DEFAULT_FILTERS);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showAll, setShowAll] = useState(true);

  useEffect(() => {
    setWidth(firstWidth);
    setSelectedKey(null);
  }, [loaded.id, firstWidth]);

  const viewport = report.viewports.find((v) => v.width === width) ?? report.viewports[0];
  const all = useMemo(() => (viewport ? findingsForViewport(report, viewport.width) : []), [report, viewport]);
  const visible = useMemo(() => filterFindings(all, filters), [all, filters]);
  const src = viewport ? loaded.resolveAsset(viewport.screenshot) : null;
  const image = useImageSize(src);

  const firstVisibleKey = visible[0] ? findingKey(visible[0]) : null;
  useEffect(() => {
    setSelectedKey(firstVisibleKey);
    setZoom(1);
  }, [width, filters, loaded.id, firstVisibleKey]);

  if (!viewport) {
    return <ReportHeader loaded={loaded} onClose={onClose} />;
  }

  const selected = all.find((r) => findingKey(r) === selectedKey) ?? null;
  const mapping = selected && image.status === "loaded" ? overlayFor(selected, viewport, image) : null;

  return (
    <div className="workspace">
      <ReportHeader loaded={loaded} onClose={onClose} />
      <DeviceTabs
        idPrefix="ws"
        viewports={report.viewports}
        value={viewport.width}
        onChange={setWidth}
        badge={(vp) => (vp.findings.length > 0 ? String(vp.findings.length) : null)}
      />
      <div className="workspace-grid" id="ws-panel" role="tabpanel" aria-labelledby={`ws-tab-${viewport.width}`}>
        <Card className="viewer-card" aria-label="Screenshot inspector">
          <div className="viewer-toolbar">
            <div className="viewer-toolbar-left">
              <span className="viewer-title">{viewport.width} × {viewport.viewportHeight}</span>
              {viewport.hasHorizontalOverflow && viewport.analysis && !viewport.analysis.userScrollable ? (
                <Badge tone="warning">Hidden overflow +{viewport.overflowPx}px</Badge>
              ) : viewport.hasHorizontalOverflow ? (
                <Badge tone="danger">Overflow +{viewport.overflowPx}px</Badge>
              ) : (
                <Badge tone="success">No overflow</Badge>
              )}
            </div>
            <div className="viewer-toolbar-right">
              <label className="toggle">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
                <span>All outlines</span>
              </label>
              <ZoomControls zoom={zoom} onZoom={setZoom} />
            </div>
          </div>
          <ScreenshotViewer
            src={src}
            image={image}
            viewport={viewport}
            findings={visible}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            zoom={zoom}
            showAll={showAll}
          />
        </Card>
        <div className="side-col">
          <Card className="findings-card">
            <FindingsPanel
              all={all}
              visible={visible}
              filters={filters}
              onFilters={setFilters}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              viewport={viewport}
            />
          </Card>
          <Card className="detail-card">
            <IssueDetail selected={selected} viewport={viewport} mapping={mapping} />
          </Card>
        </div>
      </div>
    </div>
  );
}
