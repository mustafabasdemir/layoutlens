import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Layers, MousePointer2, X } from "lucide-react";
import type { LoadedReport } from "../../data/load-report";
import { navigate } from "../../app/router";
import { navigationBannerMessage, navigationRedirectNote } from "@layoutlens/shared";
import {
  DEFAULT_FILTERS,
  filterFindings,
  findingKey,
  findingsForViewport,
  isLegacyReport,
  reportHealth,
  type FindingFilters,
} from "../../lib/findings";
import {
  advancedRefsForViewport,
  overflowRefsForViewport,
  workspaceKey,
  type OverflowFindingRef,
  type WorkspaceFindingRef,
} from "../../lib/workspace-findings";
import { displayUrl, formatDateTime, plural } from "../../lib/format";
import { useImageSize } from "../../ui/hooks";
import { Badge, Button, Card, Notice } from "../../ui/primitives";
import { ZoomControls } from "../../ui/ZoomFrame";
import { DeviceTabs } from "./DeviceTabs";
import { FindingsPanel } from "./FindingsPanel";
import { IssueDetail } from "./IssueDetail";
import { AdvancedIssueDetail } from "./AdvancedIssueDetail";
import { ElementInspectorPanel } from "./ElementInspectorPanel";
import { overlayForWorkspace, ScreenshotViewer } from "./ScreenshotViewer";

const HEALTH = {
  clean: { tone: "success", label: "No overflow detected" },
  issues: { tone: "danger", label: "Layout issues found" },
  review: { tone: "warning", label: "Needs review" },
  "visual-changes": { tone: "warning", label: "Visual changes detected" },
  "http-response": { tone: "danger", label: "Page load error or block" },
  "challenge-page": { tone: "warning", label: "Page may be a security interstitial" },
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
  const nav = report.navigation ?? s.navigation;
  const navBanner = nav ? navigationBannerMessage(nav) : null;
  const redirectNote = nav && !navBanner ? navigationRedirectNote(nav) : null;
  const navNoticeTone =
    s.scanTrust === "challenge_uncertain"
      ? "warning"
      : s.scanTrust === "http_error" || s.scanTrust === "network_error"
        ? "danger"
        : "info";
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
        {navBanner ? (
          <Notice tone={navNoticeTone} title="Navigation" data-testid="report-navigation-notice">
            <p>{navBanner}</p>
            {nav ? (
              <p className="report-meta">
                Requested: <code>{nav.requestedUrl}</code>
                {nav.finalUrl !== nav.requestedUrl ? (
                  <>
                    {" "}
                    · Final: <code>{nav.finalUrl}</code>
                  </>
                ) : null}
                {nav.httpStatus !== null ? ` · HTTP ${nav.httpStatus}` : null}
              </p>
            ) : null}
            <p className="report-meta">
              The screenshot and findings below describe what the browser received — they may not match the site you intended to test.
            </p>
          </Notice>
        ) : null}
        {redirectNote ? (
          <p className="report-meta" data-testid="report-redirect-note">
            {redirectNote} Final URL: <code>{nav!.finalUrl}</code>
          </p>
        ) : null}
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
            {s.advancedFindingCount !== undefined ? (
              <div><dt>Responsive (advisory)</dt><dd data-testid="count-advanced">{s.advancedFindingCount}</dd></div>
            ) : null}
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
  const [inspectorMode, setInspectorMode] = useState(false);
  const [inspectorSelectedId, setInspectorSelectedId] = useState<string | null>(null);
  const [inspectorHoverId, setInspectorHoverId] = useState<string | null>(null);
  const [inspectorHitUncertain, setInspectorHitUncertain] = useState(false);
  const [inspectorCandidates, setInspectorCandidates] = useState<readonly string[]>([]);
  const [inspectorCandidateIndex, setInspectorCandidateIndex] = useState(0);

  useEffect(() => {
    setWidth(firstWidth);
    setSelectedKey(null);
    setInspectorMode(false);
    setInspectorSelectedId(null);
    setInspectorHoverId(null);
    setInspectorHitUncertain(false);
    setInspectorCandidates([]);
    setInspectorCandidateIndex(0);
  }, [loaded.id, firstWidth]);

  const viewport = report.viewports.find((v) => v.width === width) ?? report.viewports[0];
  const allOverflow = useMemo(
    () => (viewport ? findingsForViewport(report, viewport.width) : []),
    [report, viewport],
  );
  const visibleOverflow = useMemo(() => filterFindings(allOverflow, filters), [allOverflow, filters]);
  const advancedRefs = useMemo(
    () => (viewport ? advancedRefsForViewport(report, viewport.width) : []),
    [report, viewport],
  );
  const workspaceRefs = useMemo((): WorkspaceFindingRef[] => {
    if (!viewport) return [];
    const o = overflowRefsForViewport(report, viewport.width);
    return [...o, ...advancedRefs];
  }, [report, viewport, advancedRefs]);

  const src = viewport ? loaded.resolveAsset(viewport.screenshot) : null;
  const image = useImageSize(src);

  const firstVisibleKey = visibleOverflow[0] ? findingKey(visibleOverflow[0]) : advancedRefs[0] ? workspaceKey(advancedRefs[0]) : null;
  useEffect(() => {
    setSelectedKey(firstVisibleKey);
    setZoom(1);
    setInspectorMode(false);
    setInspectorSelectedId(null);
    setInspectorHoverId(null);
    setInspectorHitUncertain(false);
    setInspectorCandidates([]);
    setInspectorCandidateIndex(0);
  }, [width, filters, loaded.id, firstVisibleKey]);

  useEffect(() => {
    if (!inspectorMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setInspectorSelectedId(null);
        setInspectorHoverId(null);
        setInspectorHitUncertain(false);
        setInspectorCandidates([]);
        setInspectorCandidateIndex(0);
        setInspectorMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspectorMode]);

  if (!viewport) {
    return <ReportHeader loaded={loaded} onClose={onClose} />;
  }

  const selectedOverflowRef =
    workspaceRefs.find((r): r is OverflowFindingRef => r.kind === "overflow" && workspaceKey(r) === selectedKey) ?? null;
  const selectedAdvanced = advancedRefs.find((r) => workspaceKey(r) === selectedKey) ?? null;
  const selectedOverflowForDetail = selectedOverflowRef
    ? { viewportWidth: selectedOverflowRef.viewportWidth, index: selectedOverflowRef.index, finding: selectedOverflowRef.finding }
    : null;
  const mapping =
    (selectedOverflowRef || selectedAdvanced) && image.status === "loaded"
      ? overlayForWorkspace(selectedOverflowRef ?? selectedAdvanced!, viewport, image)
      : null;

  const navMeta = report.navigation ?? report.summary.navigation;
  const layoutNotMeasured = Boolean(navMeta && !navMeta.documentLoaded);

  const inspectorSnapshot = viewport.inspector;
  const selectedInspectorNode =
    inspectorSelectedId && inspectorSnapshot?.elements
      ? inspectorSnapshot.elements.find((n) => n.id === inspectorSelectedId) ?? null
      : null;

  return (
    <div className="workspace">
      <ReportHeader loaded={loaded} onClose={onClose} />
      <DeviceTabs
        idPrefix="ws"
        viewports={report.viewports}
        value={viewport.width}
        onChange={setWidth}
        badge={(vp) => {
          if (vp.inspectionStatus === "failed" || vp.inspectionStatus === "skipped") return "—";
          return vp.findings.length > 0 ? String(vp.findings.length) : null;
        }}
      />
      <div className="workspace-grid" id="ws-panel" role="tabpanel" aria-labelledby={`ws-tab-${viewport.width}`}>
        <Card className="viewer-card" aria-label="Screenshot inspector">
          <div className="viewer-toolbar">
          <div className="viewer-toolbar-left">
            <span className="viewer-title">{viewport.width} × {viewport.viewportHeight}</span>
              {viewport.inspectionStatus === "failed" || viewport.inspectionStatus === "skipped" ? (
                <Badge tone="danger">{viewport.inspectionStatus === "skipped" ? "Skipped" : "Failed"}</Badge>
              ) : layoutNotMeasured || report.summary.scanTrust === "network_error" ? (
                <Badge tone="danger">Not measured (navigation failed)</Badge>
              ) : report.summary.scanTrust === "http_error" ? (
                viewport.hasHorizontalOverflow && viewport.analysis && !viewport.analysis.userScrollable ? (
                  <Badge tone="warning">Hidden overflow +{viewport.overflowPx}px (error page)</Badge>
                ) : viewport.hasHorizontalOverflow ? (
                  <Badge tone="danger">Overflow +{viewport.overflowPx}px (error page)</Badge>
                ) : (
                  <Badge tone="warning">No overflow on returned page</Badge>
                )
              ) : report.summary.scanTrust === "challenge_uncertain" ? (
                viewport.hasHorizontalOverflow && viewport.analysis && !viewport.analysis.userScrollable ? (
                  <Badge tone="warning">Hidden overflow +{viewport.overflowPx}px (verify page)</Badge>
                ) : viewport.hasHorizontalOverflow ? (
                  <Badge tone="danger">Overflow +{viewport.overflowPx}px (verify page)</Badge>
                ) : (
                  <Badge tone="warning">No overflow (verify page)</Badge>
                )
              ) : viewport.hasHorizontalOverflow && viewport.analysis && !viewport.analysis.userScrollable ? (
                <Badge tone="warning">Hidden overflow +{viewport.overflowPx}px</Badge>
              ) : viewport.hasHorizontalOverflow ? (
                <Badge tone="danger">Overflow +{viewport.overflowPx}px</Badge>
              ) : (
                <Badge tone="success">No overflow</Badge>
              )}
            </div>
            <div className="viewer-toolbar-right">
              <Button
                size="sm"
                variant={inspectorMode ? "primary" : "secondary"}
                icon={<MousePointer2 size={14} />}
                aria-pressed={inspectorMode}
                disabled={!inspectorSnapshot}
                data-testid="workspace-inspector-toggle"
                title={!inspectorSnapshot ? "Run a new scan from Studio to capture inspector data." : undefined}
                onClick={() => {
                  if (!inspectorSnapshot) return;
                  setInspectorMode((v) => !v);
                  if (inspectorMode) {
                    setInspectorSelectedId(null);
                    setInspectorHoverId(null);
                    setInspectorHitUncertain(false);
                    setInspectorCandidates([]);
                    setInspectorCandidateIndex(0);
                  }
                }}
              >
                Select element
              </Button>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(e) => setShowAll(e.target.checked)}
                  disabled={inspectorMode}
                />
                <span>All outlines</span>
              </label>
              <ZoomControls zoom={zoom} onZoom={setZoom} />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setZoom(1);
                  setInspectorSelectedId(null);
                  setInspectorHoverId(null);
                  setInspectorCandidates([]);
                  setInspectorCandidateIndex(0);
                }}
              >
                Reset
              </Button>
              {inspectorMode && inspectorCandidates.length > 1 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const next = (inspectorCandidateIndex + 1) % inspectorCandidates.length;
                    setInspectorCandidateIndex(next);
                    setInspectorSelectedId(inspectorCandidates[next]!);
                  }}
                >
                  Next target
                </Button>
              ) : null}
            </div>
          </div>
          {!inspectorSnapshot ? (
            <Notice tone="info" title="Element inspection data is not available for this scan">
              Run a new scan from Studio (local service) with Inspector capture — older reports and CLI-only runs may omit this data.
            </Notice>
          ) : null}
          <ScreenshotViewer
            src={src}
            image={image}
            viewport={viewport}
            workspaceRefs={workspaceRefs}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            zoom={zoom}
            showAll={showAll}
            inspectorMode={inspectorMode}
            inspectorSelectedId={inspectorSelectedId}
            inspectorHoverId={inspectorHoverId}
            onInspectorHover={(id, meta) => {
              setInspectorHoverId(id);
              setInspectorHitUncertain(meta.uncertain);
            }}
            onInspectorPick={(pick) => {
              if (!pick) {
                setInspectorSelectedId(null);
                setInspectorCandidates([]);
                setInspectorCandidateIndex(0);
                setInspectorHitUncertain(false);
                return;
              }
              const list = pick.candidates.length > 0 ? pick.candidates : pick.primaryId ? [pick.primaryId] : [];
              setInspectorCandidates(list);
              setInspectorCandidateIndex(0);
              setInspectorSelectedId(pick.primaryId ?? list[0] ?? null);
              setInspectorHitUncertain(pick.uncertain);
            }}
          />
        </Card>
        <div className="side-col">
          <Card className="findings-card">
            <FindingsPanel
              all={allOverflow}
              visible={visibleOverflow}
              advancedRefs={advancedRefs}
              filters={filters}
              onFilters={setFilters}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              viewport={viewport}
            />
          </Card>
          <Card className="detail-card">
            {inspectorMode && inspectorSnapshot && selectedInspectorNode ? (
              <ElementInspectorPanel
                snapshot={inspectorSnapshot}
                node={selectedInspectorNode}
                report={report}
                viewport={viewport}
                screenshotNatural={image.status === "loaded" ? image : null}
                hitUncertain={inspectorHitUncertain}
                onSelectFinding={setSelectedKey}
                onPickParent={(pid) => {
                  if (pid) setInspectorSelectedId(pid);
                }}
              />
            ) : inspectorMode && inspectorSnapshot ? (
              <Notice tone="info" title="No element selected">
                Turn on Select element, then click a region on the screenshot. Press Escape to exit inspector mode.
              </Notice>
            ) : selectedOverflowForDetail ? (
              <IssueDetail selected={selectedOverflowForDetail} viewport={viewport} mapping={mapping} />
            ) : selectedAdvanced ? (
              <AdvancedIssueDetail finding={selectedAdvanced.finding} viewport={viewport} mapping={mapping} />
            ) : (
              <IssueDetail selected={null} viewport={viewport} mapping={null} />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
