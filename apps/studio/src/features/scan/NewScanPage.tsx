import { useId, useRef, useState, type FormEvent } from "react";
import { Play, Plus, Trash2 } from "lucide-react";
import {
  DEFAULT_VIEWPORT_SPECS,
  SITE_SCAN_SCOPE_BOUNDS,
  mergeViewportSpecs,
  type ViewportSpec,
} from "@layoutlens/shared";
import type { StartScanOptions } from "../../api/scan-api";
import { useScanJobs } from "../../data/scan-jobs";
import { Badge, Button, Card, Notice, SegmentedControl } from "../../ui/primitives";
import { ScanUnavailableNotice, useScanSubmit } from "../overview/ScanUrlForm";
import { ScanProgress } from "./ScanProgress";

let viewportRowId = 0;
function nextRowId(): string {
  viewportRowId += 1;
  return `vp-${viewportRowId}`;
}

type VpRow = { id: string; width: number; height: number; label: string };

function defaultViewportRows(): VpRow[] {
  return DEFAULT_VIEWPORT_SPECS.map((v) => ({
    id: nextRowId(),
    width: v.width,
    height: v.height,
    label: v.label,
  }));
}

function rowsToSpecs(rows: VpRow[]): ViewportSpec[] {
  return mergeViewportSpecs(rows.map((r) => ({ width: r.width, height: r.height, label: r.label })));
}

export function NewScanPage() {
  const urlId = useId();
  const urlErrId = useId();
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"single_page" | "multi_page">("single_page");
  const [maxPages, setMaxPages] = useState<number>(SITE_SCAN_SCOPE_BOUNDS.maxPages.default);
  const [maxDepth, setMaxDepth] = useState<number>(SITE_SCAN_SCOPE_BOUNDS.maxDepth.default);
  const [customViewports, setCustomViewports] = useState(false);
  const [viewportRows, setViewportRows] = useState<VpRow[]>(() => defaultViewportRows());
  const lastOptions = useRef<StartScanOptions | undefined>(undefined);

  const { service } = useScanJobs();
  const { submit, busy, current, error, unavailable } = useScanSubmit();
  const info = service.status === "available" ? service.info : null;

  function buildOptions(): StartScanOptions | undefined {
    const opts: StartScanOptions = {
      ...(mode === "multi_page" ? { mode: "multi_page" as const, maxPages, maxDepth } : {}),
      ...(customViewports ? { viewports: rowsToSpecs(viewportRows) } : {}),
    };
    return Object.keys(opts).length > 0 ? opts : undefined;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const options = buildOptions();
    lastOptions.current = options;
    void submit(url, options);
  }

  return (
    <div className="page page-narrow">
      {service.status === "unavailable" ? (
        <Notice tone="warning" title="Scanning service not running">{service.message}</Notice>
      ) : null}

      <form className="scan-config" onSubmit={onSubmit} noValidate aria-label="Scan configuration">
        <Card className="form-card">
          <h2 className="card-title">Target</h2>
          <div className="field">
            <label htmlFor={urlId} className="field-label">Website URL</label>
            <input
              id={urlId}
              className="text-input"
              type="url"
              inputMode="url"
              placeholder="https://your-website.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? urlErrId : undefined}
            />
            {error ? <p id={urlErrId} className="field-error" role="alert">{error}</p> : null}
            <p className="field-hint">
              http and https only. Local dev servers (localhost) work; link-local and cloud-metadata addresses are refused
              {info && !info.allowPrivateNetwork ? ", and private-network addresses are disabled on this server" : ""}.
            </p>
          </div>
          <div className="field">
            <span className="field-label" id="scan-mode-label">Scan mode</span>
            <SegmentedControl<"single_page" | "multi_page">
              label="Scan mode"
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { id: "single_page", label: "Single page" },
                { id: "multi_page", label: "Multi-page site" },
              ]}
            />
            {mode === "multi_page" ? (
              <div className="scan-mp-grid" aria-labelledby="scan-mode-label">
                <label className="field-inline">
                  <span className="field-label">Max pages</span>
                  <input
                    className="text-input text-input-sm"
                    type="number"
                    min={SITE_SCAN_SCOPE_BOUNDS.maxPages.min}
                    max={SITE_SCAN_SCOPE_BOUNDS.maxPages.max}
                    value={maxPages}
                    onChange={(e) => setMaxPages(Number(e.target.value))}
                  />
                </label>
                <label className="field-inline">
                  <span className="field-label">Crawl depth</span>
                  <input
                    className="text-input text-input-sm"
                    type="number"
                    min={SITE_SCAN_SCOPE_BOUNDS.maxDepth.min}
                    max={SITE_SCAN_SCOPE_BOUNDS.maxDepth.max}
                    value={maxDepth}
                    onChange={(e) => setMaxDepth(Number(e.target.value))}
                  />
                </label>
              </div>
            ) : null}
          </div>
        </Card>

        <Card className="form-card">
          <h2 className="card-title">Viewports</h2>
          <label className="check-row">
            <input type="checkbox" checked={customViewports} onChange={(e) => setCustomViewports(e.target.checked)} />
            <span>Custom dimensions (default: Mobile 390×844 · Tablet 768×1024 · Desktop 1440×900)</span>
          </label>
          {customViewports ? (
            <div className="viewport-editor">
              {viewportRows.map((row, i) => (
                <div key={row.id} className="viewport-editor-row">
                  <label className="field-inline vp-num">
                    <span className="field-label">W</span>
                    <input
                      className="text-input text-input-sm"
                      type="number"
                      min={200}
                      max={4096}
                      value={row.width}
                      onChange={(e) => {
                        const w = Number(e.target.value);
                        setViewportRows((prev) => prev.map((r, j) => (j === i ? { ...r, width: w } : r)));
                      }}
                    />
                  </label>
                  <span className="muted vp-times">×</span>
                  <label className="field-inline vp-num">
                    <span className="field-label">H</span>
                    <input
                      className="text-input text-input-sm"
                      type="number"
                      min={200}
                      max={4096}
                      value={row.height}
                      onChange={(e) => {
                        const h = Number(e.target.value);
                        setViewportRows((prev) => prev.map((r, j) => (j === i ? { ...r, height: h } : r)));
                      }}
                    />
                  </label>
                  <label className="field-inline vp-label">
                    <span className="field-label">Label</span>
                    <input
                      className="text-input text-input-sm"
                      type="text"
                      value={row.label}
                      onChange={(e) => {
                        const lab = e.target.value;
                        setViewportRows((prev) => prev.map((r, j) => (j === i ? { ...r, label: lab } : r)));
                      }}
                    />
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 size={14} />}
                    onClick={() => setViewportRows((prev) => prev.filter((_, j) => j !== i))}
                    disabled={viewportRows.length <= 1}
                    aria-label="Remove viewport"
                  />
                </div>
              ))}
              <div className="viewport-editor-actions">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  icon={<Plus size={14} />}
                  onClick={() =>
                    setViewportRows((prev) => [...prev, { id: nextRowId(), width: 1280, height: 720, label: "custom" }])
                  }
                >
                  Add viewport
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setViewportRows(defaultViewportRows())}>
                  Reset presets
                </Button>
              </div>
            </div>
          ) : (
            <div className="check-grid">
              {DEFAULT_VIEWPORT_SPECS.map((v) => (
                <label key={v.width} className="check is-locked">
                  <input type="checkbox" checked readOnly disabled />
                  <span>
                    {v.label.charAt(0).toUpperCase() + v.label.slice(1)} · {v.width}×{v.height}
                  </span>
                </label>
              ))}
            </div>
          )}
        </Card>

        <Card className="form-card">
          <h2 className="card-title">Visual regression</h2>
          <p className="field-hint">
            If a baseline created for exactly this URL exists in{" "}
            <code>{info ? info.baselinesDirectory : "the baselines folder"}</code>, the scan compares against it automatically.
            Studio never creates or updates baselines; use{" "}
            <code>pnpm cli baseline create &lt;url&gt; --baseline-dir &lt;baselines folder&gt;/&lt;name&gt;</code>.
          </p>
          <div className="unsupported-list">
            <div className="unsupported">
              <span>Pixel threshold</span>
              <Badge>Set in the baseline's visual.config.json</Badge>
            </div>
            <div className="unsupported">
              <span>Per-stage timeouts</span>
              <Badge>Navigation, load readiness, and screenshots (bounded by total scan limit)</Badge>
            </div>
            <div className="unsupported">
              <span>Total scan timeout</span>
              <Badge>{info ? `${Math.round(info.limits.scanTimeoutMs / 1000)} s` : "Set by the server"}</Badge>
            </div>
          </div>
        </Card>

        <div className="form-actions">
          <Button type="submit" variant="primary" icon={<Play size={15} />} disabled={busy}>
            {busy ? "Scanning…" : "Start scan"}
          </Button>
        </div>

        {unavailable ? <ScanUnavailableNotice {...unavailable} /> : null}
      </form>
      {current ? (
        <ScanProgress
          scan={current}
          onRetry={() => {
            const opts = lastOptions.current ?? buildOptions();
            void submit(current.url, opts);
          }}
        />
      ) : null}
    </div>
  );
}
