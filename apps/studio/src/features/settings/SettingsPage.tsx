import { Moon, Sun } from "lucide-react";
import { useTheme, type Theme } from "../../app/theme";
import { useReports } from "../../data/report-store";
import { useScanJobs } from "../../data/scan-jobs";
import { Badge, Button, Card, SegmentedControl } from "../../ui/primitives";

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { history, clearHistory } = useReports();
  const { service, checkService } = useScanJobs();
  return (
    <div className="page page-narrow">
      <Card className="form-card">
        <h2 className="card-title">Appearance</h2>
        <div className="setting-row">
          <div>
            <p className="setting-label">Theme</p>
            <p className="field-hint">Dark is the default. Your choice is saved in this browser.</p>
          </div>
          <SegmentedControl<Theme>
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { id: "dark", label: "Dark", icon: <Moon size={14} /> },
              { id: "light", label: "Light", icon: <Sun size={14} /> },
            ]}
          />
        </div>
      </Card>

      <Card className="form-card">
        <h2 className="card-title">Local data</h2>
        <div className="setting-row">
          <div>
            <p className="setting-label">Report history</p>
            <p className="field-hint">{history.length} entr{history.length === 1 ? "y" : "ies"} stored in localStorage (metadata only).</p>
          </div>
          <Button size="sm" variant="ghost" onClick={clearHistory} disabled={history.length === 0}>Clear</Button>
        </div>
      </Card>

      <Card className="form-card">
        <h2 className="card-title">Scanning service</h2>
        <div className="setting-row">
          <div>
            <p className="setting-label">Local scan API</p>
            <p className="field-hint">
              {service.status === "available"
                ? `Version ${service.info.version}, listening on this machine only.`
                : service.status === "checking"
                  ? "Checking…"
                  : service.message}
            </p>
          </div>
          <span className="confirm">
            <Badge tone={service.status === "available" ? "success" : service.status === "checking" ? "info" : "warning"}>
              {service.status === "available" ? "Connected" : service.status === "checking" ? "Checking" : "Not running"}
            </Badge>
            {service.status === "unavailable" ? (
              <Button size="sm" variant="ghost" onClick={() => void checkService()}>Retry</Button>
            ) : null}
          </span>
        </div>
        {service.status === "available" ? (
          <dl className="evidence">
            {(
              [
                ["Reports folder", service.info.dataDirectory],
                ["Baselines folder (read-only)", service.info.baselinesDirectory],
                ["Concurrent scans", String(service.info.limits.maxConcurrentScans)],
                ["Queued scans", String(service.info.limits.maxQueuedScans)],
                ["Scan timeout", `${Math.round(service.info.limits.scanTimeoutMs / 1000)} s`],
                ["Stored reports", `${service.info.limits.maxStoredScans} newest, up to ${Math.round(service.info.limits.maxStorageBytes / 1024 ** 2)} MB`],
                ["Private-network targets", service.info.allowPrivateNetwork ? "Allowed" : "Refused"],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="evidence-row">
                <dt>{k}</dt>
                <dd className="mono">{v}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Card>

      <Card className="form-card">
        <h2 className="card-title">Privacy</h2>
        <ul className="hints">
          <li>No telemetry, analytics, or tracking scripts.</li>
          <li>Report folders are read by your browser and never uploaded.</li>
          <li>Scans run in a local headless Chromium; screenshots and reports stay on this machine.</li>
          <li>No accounts, API keys, or cloud services.</li>
        </ul>
      </Card>
    </div>
  );
}
