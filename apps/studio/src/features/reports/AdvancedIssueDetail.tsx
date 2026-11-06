import {
  ADVANCED_CATEGORY_LABELS,
  advancedScreenshotEvidenceNote,
  diagnosticHintsAdvanced,
  explainAdvancedFinding,
  mapBoxToScreenshot,
  overlayBoxForAdvanced,
  type JsonReportAdvancedFinding,
  type JsonReportViewport,
  type OverlayMapping,
} from "@layoutlens/shared";
import { ClassificationBadge, Notice, SeverityBadge } from "../../ui/primitives";
import { CopyCommand } from "../overview/ScanUrlForm";

function px(n: number): string {
  return `${Math.round(n * 10) / 10}px`;
}

function boxText(b: { x: number; y: number; width: number; height: number }): string {
  return `x ${px(b.x)}, y ${px(b.y)}, ${px(b.width)} × ${px(b.height)}`;
}

export function AdvancedIssueDetail({
  finding,
  viewport,
  mapping,
}: {
  finding: JsonReportAdvancedFinding;
  viewport: JsonReportViewport;
  mapping: OverlayMapping | null;
}) {
  const rows: [string, string][] = [
    ["Category", ADVANCED_CATEGORY_LABELS[finding.category]],
    ["Viewport", `${viewport.width} × ${viewport.viewportHeight}px`],
    ["Bounding box", boxText(finding.boundingBox)],
  ];
  if (finding.visibleBox !== undefined) {
    rows.push(["Visible in viewport", finding.visibleBox ? boxText(finding.visibleBox) : "none"]);
  }
  if (finding.invisible) rows.push(["Visibility", "hidden / opacity 0 (not painted)"]);
  if (viewport.analysis) {
    rows.push([
      "Page horizontal scrolling",
      viewport.analysis.userScrollable ? "possible" : `not possible (root overflow-x: ${viewport.analysis.rootOverflowX})`,
    ]);
  }
  if (finding.clipping) {
    rows.push([
      "Clipping ancestor",
      `${finding.clipping.selector} (${finding.clipping.kind}, overflow-x: ${finding.clipping.overflowX}) · ${boxText(finding.clipping.boundingBox)}`,
    ]);
  }
  if (finding.offscreenControl?.notVisibleInViewport) {
    rows.push(["Painted in viewport", "no — nothing visible in the layout viewport"]);
  }
  if (finding.offscreenControl?.verticalIntersectsViewport !== undefined) {
    rows.push([
      "Intersects first screen (vertical)",
      finding.offscreenControl.verticalIntersectsViewport ? "yes" : "no — likely below-the-fold only",
    ]);
  }
  if (finding.offscreenControl?.belowTheFold) {
    rows.push(["Below first viewport height", "yes — reach by vertical scroll, not a horizontal offscreen issue"]);
  }

  const evidenceNote = advancedScreenshotEvidenceNote(finding, viewport);

  return (
    <section className="detail" aria-labelledby="detail-heading-advanced">
      <div className="detail-head">
        <h2 id="detail-heading-advanced" className="panel-title">Responsive detail</h2>
        <span className="detail-badges">
          <ClassificationBadge classification={finding.classification} />
          <SeverityBadge severity={finding.severity} />
        </span>
      </div>
      <p className="detail-kind" data-testid="detail-kind-advanced">
        {ADVANCED_CATEGORY_LABELS[finding.category]} · advisory
      </p>
      <CopyCommand command={finding.selector} />
      <p className="detail-text" data-testid="detail-reason">{explainAdvancedFinding(finding)}</p>

      {evidenceNote ? (
        <Notice
          tone={evidenceNote.shown === "none" ? "warning" : "info"}
          title={evidenceNote.shown === "none" ? "Not shown on screenshot" : "Screenshot shows part of it"}
        >
          <span data-testid="screenshot-evidence">{evidenceNote.text}</span>
        </Notice>
      ) : mapping && mapping.status !== "visible" ? (
        <Notice tone={mapping.status === "clipped" ? "info" : "warning"} title={mapping.status === "clipped" ? "Partially outside screenshot" : "Not shown on screenshot"}>
          {mapping.reason}
        </Notice>
      ) : null}

      <dl className="evidence">
        {rows.map(([k, v]) => (
          <div key={k} className="evidence-row">
            <dt>{k}</dt>
            <dd className="mono">{v}</dd>
          </div>
        ))}
      </dl>

      {finding.overlap ? (
        <p className="finding-meta" data-testid="overlap-blocker">
          Blocker: <code>{finding.overlap.blockerSelector}</code> · hit-test blocked: {finding.overlap.hitTestBlocked ? "yes" : "no"}
          {finding.overlap.likelyConsentOverlay ? " · looks like cookie/consent overlay" : ""}
        </p>
      ) : null}

      {finding.relatedCount !== undefined && finding.relatedCount > 1 ? (
        <>
          <h3 className="detail-subtitle">Grouped elements ({finding.relatedCount})</h3>
          <p className="finding-text">Same hidden or clipped container — samples:</p>
          <ul className="related-list" data-testid="advanced-related">
            {(finding.related ?? []).map((r, i) => (
              <li key={`${r.selector}:${i}`}>
                <code title={r.selector}>{r.selector}</code>
                <span className="mono">{boxText(r.boundingBox)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="detail-subtitle">Where to look</h3>
      <ul className="hints">
        {diagnosticHintsAdvanced(finding).map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
      <p className="detail-foot">Responsive findings do not change the horizontal-overflow exit code.</p>
    </section>
  );
}
