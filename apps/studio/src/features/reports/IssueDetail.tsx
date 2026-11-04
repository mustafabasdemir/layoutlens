import { MousePointerClick } from "lucide-react";
import {
  FINDING_KIND_LABELS,
  diagnosticHints,
  explainFinding,
  findingKinds,
  screenshotEvidenceNote,
  type JsonReportBoundingBox,
  type JsonReportViewport,
  type OverlayMapping,
} from "@layoutlens/shared";
import type { FindingRef } from "../../lib/findings";
import { ClassificationBadge, EmptyState, Notice, SeverityBadge } from "../../ui/primitives";
import { CopyCommand } from "../overview/ScanUrlForm";

function px(n: number): string {
  return `${Math.round(n * 10) / 10}px`;
}

function boxText(b: JsonReportBoundingBox): string {
  return `x ${px(b.x)}, y ${px(b.y)}, ${px(b.width)} × ${px(b.height)}`;
}

export function IssueDetail({
  selected,
  viewport,
  mapping,
}: {
  selected: FindingRef | null;
  viewport: JsonReportViewport;
  mapping: OverlayMapping | null;
}) {
  if (!selected) {
    return (
      <section className="detail" aria-label="Issue details">
        <EmptyState icon={<MousePointerClick size={20} />} title="Select a finding">
          <p>Choose a finding to see its selector, measurements, and location on the screenshot.</p>
        </EmptyState>
      </section>
    );
  }
  const f = selected.finding;
  const rows: [string, string][] = [
    ["Viewport", `${viewport.width} × ${viewport.viewportHeight}px`],
    ["Bounding box", boxText(f.boundingBox)],
  ];
  if (f.visibleBox !== undefined) {
    rows.push(["Visible in viewport", f.visibleBox ? boxText(f.visibleBox) : "none"]);
  }
  rows.push(["Past viewport edge", px(f.documentContributionPx)]);
  if (f.scrollContributionPx !== undefined) rows.push(["Adds to page scroll width", px(f.scrollContributionPx)]);
  rows.push(
    ["Element scroll / client width", `${px(f.scrollWidth)} / ${px(f.clientWidth)}`],
    ["Internal overflow", px(f.overflowPx)],
    ["Document scroll / client width", `${px(viewport.documentScrollWidth)} / ${px(viewport.documentClientWidth)}`],
  );
  if (viewport.analysis) {
    rows.push([
      "Page horizontal scrolling",
      viewport.analysis.userScrollable ? "possible" : `not possible (root overflow-x: ${viewport.analysis.rootOverflowX})`,
    ]);
  }
  if (f.position) rows.push(["CSS position", `${f.position}${f.transformed ? " · transformed" : ""}${f.invisible ? " · invisible" : ""}`]);
  if (f.clipping) {
    rows.push([
      "Nearest clipping ancestor",
      `${f.clipping.selector} (overflow-x: ${f.clipping.overflowX}) · ${boxText(f.clipping.boundingBox)}`,
    ]);
  }
  if ((f.selectorMatches ?? 1) > 1) rows.push(["Selector matches", `${f.selectorMatches} elements`]);

  const evidenceNote = screenshotEvidenceNote(f, viewport);
  const related = f.related ?? [];
  const relatedCount = f.relatedCount ?? related.length;

  return (
    <section className="detail" aria-labelledby="detail-heading">
      <div className="detail-head">
        <h2 id="detail-heading" className="panel-title">Issue details</h2>
        <span className="detail-badges">
          {f.classification ? <ClassificationBadge classification={f.classification} /> : null}
          <SeverityBadge severity={f.severity} />
        </span>
      </div>
      <p className="detail-kind">{findingKinds(f).map((k) => FINDING_KIND_LABELS[k]).join(" · ")}</p>
      <CopyCommand command={f.selector} />
      <p className="detail-text" data-testid="detail-reason">{explainFinding(f, viewport.width)}</p>

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

      {relatedCount > 0 ? (
        <>
          <h3 className="detail-subtitle">Same root cause ({relatedCount} related element{relatedCount === 1 ? "" : "s"})</h3>
          <ul className="related-list" data-testid="related-elements">
            {related.map((r, i) => (
              <li key={`${r.selector}:${i}`}>
                <code title={r.selector}>{r.selector}</code>
                <span className="mono">{boxText(r.boundingBox)} · {px(r.documentContributionPx)} past edge</span>
              </li>
            ))}
          </ul>
          {relatedCount > related.length ? (
            <p className="finding-meta">{relatedCount - related.length} more not listed (limit {related.length}).</p>
          ) : null}
        </>
      ) : null}

      <h3 className="detail-subtitle">Where to look</h3>
      <ul className="hints">
        {diagnosticHints(f, viewport.width).map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
      <p className="detail-foot">LayoutLens reports measurements only — it never modifies your CSS.</p>
    </section>
  );
}
