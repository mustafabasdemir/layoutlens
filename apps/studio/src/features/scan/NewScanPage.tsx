import { useId, useState, type FormEvent } from "react";
import { Play } from "lucide-react";
import { VIEWPORT_LABELS } from "@layoutlens/shared";
import { useScanJobs } from "../../data/scan-jobs";
import { Badge, Button, Card, Notice } from "../../ui/primitives";
import { ScanUnavailableNotice, useScanSubmit } from "../overview/ScanUrlForm";
import { ScanProgress } from "./ScanProgress";

export function NewScanPage() {
  const urlId = useId();
  const urlErrId = useId();
  const [url, setUrl] = useState("");
  const { service } = useScanJobs();
  const { submit, busy, current, error, unavailable } = useScanSubmit();
  const info = service.status === "available" ? service.info : null;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!busy) void submit(url);
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
        </Card>

        <Card className="form-card">
          <h2 className="card-title">Viewports</h2>
          <p className="field-hint">The scanner checks these standard widths on every run. Custom widths aren't configurable yet.</p>
          <div className="check-grid">
            {VIEWPORT_LABELS.map((v) => (
              <label key={v.width} className="check is-locked">
                <input type="checkbox" checked readOnly disabled />
                <span>{v.label.charAt(0).toUpperCase() + v.label.slice(1)} · {v.width}px</span>
              </label>
            ))}
          </div>
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
      {current ? <ScanProgress scan={current} onRetry={() => void submit(current.url)} /> : null}
    </div>
  );
}
