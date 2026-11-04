import { useEffect, useMemo, useState } from "react";
import { Columns2, Diff, Layers, SplitSquareHorizontal } from "lucide-react";
import type { JsonReportViewport } from "@layoutlens/shared";
import type { LoadedReport } from "../../data/load-report";
import { useReports } from "../../data/report-store";
import { displayUrl, formatCount, formatPercent } from "../../lib/format";
import { useImageSize, type ImageState } from "../../ui/hooks";
import { Badge, Card, EmptyState, Metric, Notice, SegmentedControl, Skeleton } from "../../ui/primitives";
import { ZoomControls, ZoomFrame } from "../../ui/ZoomFrame";
import { DeviceTabs } from "../reports/DeviceTabs";
import { NoReportState, ReportLoadError } from "../reports/ReportsPage";
import { BeforeAfterSlider } from "./BeforeAfterSlider";

type Mode = "slider" | "side" | "diff";

const STATUS = {
  pass: { tone: "success", label: "Pass" },
  fail: { tone: "danger", label: "Fail" },
  "missing-baseline": { tone: "warning", label: "No baseline" },
} as const;

function natural(img: ImageState): { width: number; height: number } | null {
  return img.status === "loaded" ? { width: img.naturalWidth, height: img.naturalHeight } : null;
}

function ImageFrame({
  src,
  state,
  alt,
  zoom,
  label,
  missing,
}: {
  src: string | null;
  state: ImageState;
  alt: string;
  zoom: number;
  label: string;
  missing: string;
}) {
  if (!src || state.status === "error") {
    return <div className="frame-missing" role="note">{missing}</div>;
  }
  const size = natural(state);
  if (!size) return <Skeleton className="skeleton-shot" />;
  return (
    <ZoomFrame natural={size} zoom={zoom} label={label}>
      <img className="shot-img" src={src} alt={alt} draggable={false} />
    </ZoomFrame>
  );
}

const MISSING_BASELINE =
  "No baseline screenshot exists for this viewport. Create one explicitly with `pnpm cli baseline create <url> --baseline-dir <dir>` — Studio never creates or updates baselines.";

function VisualStudio({ loaded }: { loaded: LoadedReport }) {
  const { report } = loaded;
  const compared = useMemo(() => report.viewports.filter((v) => v.visualCompare), [report]);
  const [width, setWidth] = useState(compared[0]?.width ?? 0);
  const [mode, setMode] = useState<Mode>("slider");
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    setWidth(compared[0]?.width ?? 0);
  }, [loaded.id, compared]);
  useEffect(() => setZoom(1), [width, mode]);

  const vp: JsonReportViewport | undefined = compared.find((v) => v.width === width) ?? compared[0];
  const vc = vp?.visualCompare;
  const baselineSrc = vc?.baselineScreenshot ? loaded.resolveAsset(vc.baselineScreenshot) : null;
  const currentSrc = vp?.screenshot ? loaded.resolveAsset(vp.screenshot) : null;
  const diffSrc = vc?.diffScreenshot ? loaded.resolveAsset(vc.diffScreenshot) : null;
  const baselineImg = useImageSize(baselineSrc);
  const currentImg = useImageSize(currentSrc);
  const diffImg = useImageSize(diffSrc);

  if (!vp || !vc) {
    return (
      <Card className="empty-card">
        <EmptyState icon={<Layers size={22} />} title="No visual comparison in this report">
          <p>
            This report was scanned without a baseline. Create a baseline once with{" "}
            <code>pnpm cli baseline create &lt;url&gt; --baseline-dir ./baselines/site</code>, then scan with{" "}
            <code>--baseline-dir ./baselines/site --format html --output &lt;dir&gt;</code>.
          </p>
        </EmptyState>
      </Card>
    );
  }

  const status = STATUS[vc.status];
  const baselineMissing = vc.status === "missing-baseline" || !vc.baselineScreenshot;
  const b = natural(baselineImg);
  const c = natural(currentImg);
  const sizeMismatch = b && c && (b.width !== c.width || b.height !== c.height);
  const { host, rest } = displayUrl(report.url);

  return (
    <div className="visual">
      <Card className="visual-head" aria-label="Comparison summary">
        <div className="visual-head-top">
          <div>
            <h2 className="report-title">
              <span className="report-host">{host}</span>
              <span className="report-path">{rest}</span>
            </h2>
            <p className="report-meta">Baseline vs current screenshot for each scanned viewport.</p>
          </div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <div className="metric-row">
          <Metric label="Changed pixels" value={formatCount(vc.diffPixels)} />
          <Metric label="Difference" value={formatPercent(vc.diffPixelRatio)} hint="of all pixels" />
          <Metric label="Status" value={status.label} tone={status.tone} />
          <Metric label="Threshold" value="—" hint="Not recorded in this report" />
        </div>
        <p className="visual-note">
          Pixel counts measure how much of the screenshot changed. They are not a count of layout bugs.
        </p>
      </Card>

      <div className="visual-controls">
        <DeviceTabs
          idPrefix="vr"
          viewports={compared}
          value={vp.width}
          onChange={setWidth}
          badge={(v) => (v.visualCompare?.status === "fail" ? "Δ" : null)}
        />
        <div className="visual-controls-right">
          <SegmentedControl<Mode>
            label="Comparison mode"
            value={mode}
            onChange={setMode}
            options={[
              { id: "slider", label: "Slider", icon: <SplitSquareHorizontal size={14} /> },
              { id: "side", label: "Side by side", icon: <Columns2 size={14} /> },
              { id: "diff", label: "Difference", icon: <Diff size={14} /> },
            ]}
          />
          <ZoomControls zoom={zoom} onZoom={setZoom} label="Comparison zoom" />
        </div>
      </div>

      <Card className="compare-card" aria-label="Screenshot comparison">
        <div id="vr-panel" role="tabpanel" aria-labelledby={`vr-tab-${vp.width}`} data-mode={mode}>
          {mode === "slider" ? (
            baselineMissing ? (
              <Notice tone="warning" title="Baseline unavailable">{MISSING_BASELINE}</Notice>
            ) : !baselineSrc || baselineImg.status === "error" ? (
              <Notice tone="warning" title="Baseline file not found">
                The report references <code>{vc.baselineScreenshot}</code>, but it isn't in the selected folder.
              </Notice>
            ) : !currentSrc || currentImg.status === "error" ? (
              <Notice tone="warning" title="Current screenshot not found">
                The current screenshot for {vp.width}px isn't in the selected folder.
              </Notice>
            ) : sizeMismatch ? (
              <Notice tone="danger" title="Screenshots have different dimensions">
                Baseline is {b.width}×{b.height}px and current is {c.width}×{c.height}px. They cannot be overlaid
                without distortion. Recreate the baseline with the same viewport settings.
              </Notice>
            ) : b && c ? (
              <>
                <p className="compare-help">Drag across the image, or focus the handle and use the arrow keys.</p>
                <ZoomFrame natural={b} zoom={zoom} pannable={false} label="Before and after comparison">
                  <BeforeAfterSlider key={`${loaded.id}-${vp.width}`} baselineSrc={baselineSrc} currentSrc={currentSrc} />
                </ZoomFrame>
              </>
            ) : (
              <Skeleton className="skeleton-shot" />
            )
          ) : null}

          {mode === "side" ? (
            <div className="side-by-side">
              <figure className="side-panel">
                <figcaption>Before · Baseline</figcaption>
                <ImageFrame
                  src={baselineMissing ? null : baselineSrc}
                  state={baselineImg}
                  alt="Baseline screenshot"
                  zoom={zoom}
                  label="Baseline screenshot"
                  missing={baselineMissing ? "No baseline exists for this viewport." : "Baseline file not found in the selected folder."}
                />
              </figure>
              <figure className="side-panel">
                <figcaption>After · Current</figcaption>
                <ImageFrame
                  src={currentSrc}
                  state={currentImg}
                  alt="Current screenshot"
                  zoom={zoom}
                  label="Current screenshot"
                  missing="Current screenshot not found in the selected folder."
                />
              </figure>
            </div>
          ) : null}

          {mode === "diff" ? (
            <div className="diff-view">
              <div className="legend" role="group" aria-label="Difference legend">
                <span className="legend-item"><span className="swatch swatch-changed" aria-hidden="true" />Changed pixels (highlighted)</span>
                <span className="legend-item"><span className="swatch swatch-unchanged" aria-hidden="true" />Unchanged context (dimmed)</span>
              </div>
              <ImageFrame
                src={diffSrc}
                state={diffImg}
                alt="Pixel difference image generated by Pixelmatch"
                zoom={zoom}
                label="Difference image"
                missing={
                  vc.diffScreenshot
                    ? "The difference image isn't in the selected folder."
                    : "No difference image was produced for this viewport (no baseline, or diffs disabled)."
                }
              />
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

export function VisualRegressionPage() {
  const { active } = useReports();
  return (
    <div className="page">
      <ReportLoadError />
      {active ? <VisualStudio loaded={active} /> : <NoReportState title="Open a report to compare screenshots" />}
    </div>
  );
}
