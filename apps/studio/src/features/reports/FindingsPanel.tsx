import type { KeyboardEvent } from "react";
import { CheckCircle2, SearchX } from "lucide-react";
import {
  EXCLUSION_LABELS,
  ADVANCED_CATEGORY_LABELS,
  FINDING_KIND_LABELS,
  explainAdvancedFinding,
  explainFinding,
  findingKinds,
  type FindingKind,
  type FindingSeverity,
  type JsonReportViewport,
} from "@layoutlens/shared";
import { evidenceOf, findingKey, type EvidenceFilter, type FindingFilters, type FindingRef } from "../../lib/findings";
import { workspaceKey, type AdvancedFindingRef } from "../../lib/workspace-findings";
import { Badge, ClassificationBadge, EmptyState, Notice, SegmentedControl, SeverityBadge } from "../../ui/primitives";

const EVIDENCE_OPTIONS: { id: EvidenceFilter; label: string }[] = [
  { id: "confirmed", label: "Confirmed" },
  { id: "potential", label: "Potential" },
  { id: "insufficient-evidence", label: "Needs evidence" },
];

export function ViewportNotices({ viewport }: { viewport: JsonReportViewport }) {
  const a = viewport.analysis;
  if (!a) return null;
  const notes: { key: string; title: string; text: string }[] = [];
  if (viewport.hasHorizontalOverflow && !a.userScrollable && a.maskedOverflowPx > 0) {
    notes.push({
      key: "masked",
      title: "Overflow hidden by the page",
      text: `The document is ${viewport.overflowPx}px wider than the viewport, but overflow-x: ${a.rootOverflowX} on html/body hides it. Users cannot scroll to that content; anything cut off at the edge is listed as a potential issue.`,
    });
  }
  if (a.findingsOmitted > 0) {
    notes.push({
      key: "findings",
      title: "Findings truncated",
      text: `${a.findingsOmitted} more finding group(s) beyond the ${a.findingLimit}-group limit are not in this report.`,
    });
  }
  if (a.candidatesOmitted > 0) {
    notes.push({
      key: "candidates",
      title: "Analysis truncated",
      text: `${a.candidatesOmitted} edge-crossing element(s) beyond the ${a.candidateLimit}-element limit were not analysed.`,
    });
  }
  if (a.unattributedOverflowPx > 0) {
    notes.push({
      key: "unattributed",
      title: "Unattributed overflow",
      text: `${a.unattributedOverflowPx}px of document overflow could not be traced to any measured element.`,
    });
  }
  const adv = viewport.advancedAnalysis;
  if (adv) {
    const det = [
      adv.findingsOmitted > 0 ? `${adv.findingsOmitted} responsive finding(s) omitted (reporting cap ${adv.findingLimit}/viewport)` : null,
      adv.candidatesOmitted > 0
        ? `${adv.candidatesOmitted} element(s) not evaluated (scan cap ${adv.candidateLimit})`
        : null,
    ].filter(Boolean);
    if (det.length > 0) {
      notes.push({
        key: "responsive-limits",
        title: "Responsive analysis limits",
        text: `Evaluated up to ${adv.candidateCount} detector candidate(s); reported ${viewport.advancedFindings?.length ?? 0} responsive finding(s). ${det.join(" ")}`,
      });
    }
  }
  if (notes.length === 0) return null;
  return (
    <div className="viewport-notices" data-testid="viewport-notices">
      {notes.map((n) => (
        <Notice key={n.key} tone="warning" title={n.title}>{n.text}</Notice>
      ))}
    </div>
  );
}

export function ExcludedList({ viewport }: { viewport: JsonReportViewport }) {
  const excluded = viewport.excluded ?? [];
  if (excluded.length === 0) return null;
  const elements = excluded.reduce((n, e) => n + e.elementCount, 0);
  const omitted = viewport.analysis?.excludedOmitted ?? 0;
  return (
    <details className="excluded-list" data-testid="excluded-list">
      <summary>
        Excluded as intentional <span className="count-pill">{excluded.length}</span>
        <span className="excluded-sub">{elements} element{elements === 1 ? "" : "s"} past the edge that do not widen the page</span>
      </summary>
      <ul>
        {excluded.map((e, i) => (
          <li key={`${e.selector}:${i}`} className="excluded-item" data-reason={e.reason}>
            <span className="finding-top">
              <Badge>{EXCLUSION_LABELS[e.reason]}</Badge>
              <span className="excluded-count">{e.elementCount} element{e.elementCount === 1 ? "" : "s"}</span>
            </span>
            <code className="finding-selector" title={e.selector}>{e.selector}</code>
            <span className="finding-text">{e.explanation}</span>
            {e.samples.length > 0 ? (
              <span className="finding-meta">
                e.g. {e.samples.slice(0, 2).map((s) => `${s.selector} (x ${Math.round(s.boundingBox.x)})`).join(", ")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {omitted > 0 ? <p className="finding-meta">{omitted} more excluded group(s) are beyond the {viewport.analysis?.excludedLimit}-group limit.</p> : null}
    </details>
  );
}

function AdvancedFindingRows({
  advancedRefs,
  selectedKey,
  onSelect,
}: {
  advancedRefs: readonly AdvancedFindingRef[];
  selectedKey: string | null;
  onSelect(key: string): void;
}) {
  if (advancedRefs.length === 0) return null;
  return (
    <>
      <li className="findings-section-label" aria-hidden="true">
        <h3 className="panel-subtitle">Responsive analysis <span className="count-pill">{advancedRefs.length}</span></h3>
        <p className="field-hint">Advisory — does not change the overflow exit code.</p>
      </li>
      {advancedRefs.map((ref) => {
        const key = workspaceKey(ref);
        const f = ref.finding;
        const selected = key === selectedKey;
        return (
          <li key={key}>
            <button
              type="button"
              className="finding-card-advanced"
              aria-pressed={selected}
              data-finding={key}
              data-advanced-category={f.category}
              onClick={() => onSelect(key)}
            >
              <span className="finding-top">
                <Badge>{ADVANCED_CATEGORY_LABELS[f.category]}</Badge>
                {f.classification ? <ClassificationBadge classification={f.classification} /> : null}
                <SeverityBadge severity={f.severity} />
              </span>
              <code className="finding-selector" title={f.selector}>{f.selector}</code>
              <span className="finding-text">{explainAdvancedFinding(f)}</span>
              {f.overlap ? (
                <span className="finding-meta">Blocked by {f.overlap.blockerSelector}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </>
  );
}

export function FindingsPanel({
  all,
  visible,
  advancedRefs,
  filters,
  onFilters,
  selectedKey,
  onSelect,
  viewport,
}: {
  all: readonly FindingRef[];
  visible: readonly FindingRef[];
  advancedRefs: readonly AdvancedFindingRef[];
  filters: FindingFilters;
  onFilters(f: FindingFilters): void;
  selectedKey: string | null;
  onSelect(key: string): void;
  viewport: JsonReportViewport;
}) {
  const viewportWidth = viewport.width;
  const count = (s: FindingSeverity) => all.filter((r) => r.finding.severity === s).length;
  const evidenceCount = (e: EvidenceFilter) => all.filter((r) => evidenceOf(r.finding) === e).length;
  const classified = all.some((r) => r.finding.classification !== undefined);
  const kindsPresent = (Object.keys(FINDING_KIND_LABELS) as FindingKind[]).filter((k) =>
    all.some((r) => findingKinds(r.finding).includes(k)),
  );
  const hasAnyAdvanced = advancedRefs.length > 0;

  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [
      ...e.currentTarget.querySelectorAll<HTMLButtonElement>("button.finding-card-overflow, button.finding-card-advanced"),
    ];
    const idx = buttons.findIndex((b) => b === document.activeElement);
    const next = buttons[Math.min(buttons.length - 1, Math.max(0, idx + (e.key === "ArrowDown" ? 1 : -1)))];
    next?.focus();
  }

  return (
    <section className="findings" aria-labelledby="findings-heading">
      <div className="findings-head">
        <h2 id="findings-heading" className="panel-title">
          Layout overflow <span className="count-pill">{visible.length}{visible.length !== all.length ? ` / ${all.length}` : ""}</span>
        </h2>
      </div>
      <ViewportNotices viewport={viewport} />
      {all.length > 0 ? (
        <div className="findings-filters">
          {classified ? (
            <SegmentedControl
              size="sm"
              label="Filter by evidence"
              value={filters.evidence}
              onChange={(evidence) => onFilters({ ...filters, evidence })}
              options={[
                { id: "all", label: `All ${all.length}` },
                ...EVIDENCE_OPTIONS.map((o) => ({
                  id: o.id,
                  label: `${o.label} ${evidenceCount(o.id)}`,
                  disabled: evidenceCount(o.id) === 0,
                })),
              ]}
            />
          ) : null}
          <SegmentedControl
            size="sm"
            label="Filter by severity"
            value={filters.severity}
            onChange={(severity) => onFilters({ ...filters, severity })}
            options={[
              { id: "all", label: `All ${all.length}` },
              { id: "high", label: `High ${count("high")}`, disabled: count("high") === 0 },
              { id: "medium", label: `Medium ${count("medium")}`, disabled: count("medium") === 0 },
              { id: "low", label: `Low ${count("low")}`, disabled: count("low") === 0 },
            ]}
          />
          <label className="select-field">
            <span className="visually-hidden">Filter by issue type</span>
            <select
              value={filters.kind}
              onChange={(e) => onFilters({ ...filters, kind: e.target.value as FindingFilters["kind"] })}
              aria-label="Filter by issue type"
            >
              <option value="all">All issue types</option>
              {kindsPresent.map((k) => (
                <option key={k} value={k}>{FINDING_KIND_LABELS[k]}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {all.length === 0 && !hasAnyAdvanced ? (
        <EmptyState icon={<CheckCircle2 size={20} />} title="No overflow findings">
          <p>
            No element pushed content past the {viewportWidth}px viewport in this scan
            {(viewport.excluded?.length ?? 0) > 0 ? " — elements past the edge were all clipped, scrollable, offscreen, or hidden (see below)." : "."}
          </p>
        </EmptyState>
      ) : visible.length === 0 && all.length > 0 && advancedRefs.length === 0 ? (
        <EmptyState icon={<SearchX size={20} />} title="No findings match these filters" />
      ) : null}
      {(visible.length > 0 || advancedRefs.length > 0) &&
      !(all.length === 0 && !hasAnyAdvanced) &&
      !(visible.length === 0 && all.length > 0 && advancedRefs.length === 0) ? (
        <ul
          className="finding-list"
          onKeyDown={onListKey}
          aria-label="Layout and responsive findings"
          data-testid="advanced-findings-list"
        >
          {visible.map((ref) => {
            const key = findingKey(ref);
            const selected = key === selectedKey;
            const kinds = findingKinds(ref.finding);
            const f = ref.finding;
            return (
              <li key={key}>
                <button
                  type="button"
                  className="finding-card-overflow"
                  aria-pressed={selected}
                  data-finding={key}
                  data-classification={f.classification ?? "unclassified"}
                  onClick={() => onSelect(key)}
                >
                  <span className="finding-top">
                    <SeverityBadge severity={f.severity} />
                    {f.classification ? <ClassificationBadge classification={f.classification} /> : null}
                    {kinds.map((k) => (
                      <Badge key={k}>{FINDING_KIND_LABELS[k]}</Badge>
                    ))}
                  </span>
                  <code className="finding-selector" title={f.selector}>{f.selector}</code>
                  <span className="finding-text">{explainFinding(f, ref.viewportWidth)}</span>
                  <span className="finding-meta">
                    {ref.viewportWidth}px · &lt;{f.tagName}&gt; · {Math.round(f.boundingBox.width)}×{Math.round(f.boundingBox.height)}
                    {(f.relatedCount ?? 0) > 0 ? ` · +${f.relatedCount} related element${f.relatedCount === 1 ? "" : "s"}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
          <AdvancedFindingRows advancedRefs={advancedRefs} selectedKey={selectedKey} onSelect={onSelect} />
        </ul>
      ) : null}
      <ExcludedList viewport={viewport} />
    </section>
  );
}
