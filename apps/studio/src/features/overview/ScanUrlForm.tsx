import { useId, useState, type FormEvent } from "react";
import { ArrowRight, Copy, Globe } from "lucide-react";
import { cliCommandFor, ScanApiError, ScanServiceUnavailableError } from "../../api/scan-api";
import { useScanJobs } from "../../data/scan-jobs";
import { validateScanUrl } from "../../lib/url";
import type { StartScanOptions } from "../../api/scan-api";
import { Button, Notice } from "../../ui/primitives";
import { ScanProgress } from "../scan/ScanProgress";

export function CopyCommand({ command }: { command: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <div className="command">
      <code className="command-text">{command}</code>
      <Button
        size="sm"
        variant="ghost"
        icon={<Copy size={13} />}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
            setState("copied");
          } catch {
            setState("failed");
          }
        }}
      >
        {state === "copied" ? "Copied" : state === "failed" ? "Select to copy" : "Copy"}
      </Button>
    </div>
  );
}

/** Validate → submit to the local scanning service → show live status for this tab's scan. */
export function useScanSubmit() {
  const { startScan, busy, current } = useScanJobs();
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<{ message: string; command: string } | null>(null);

  async function submit(value: string, options?: StartScanOptions): Promise<void> {
    setUnavailable(null);
    const result = validateScanUrl(value);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    try {
      await startScan(result.url, options);
    } catch (err) {
      if (err instanceof ScanServiceUnavailableError) {
        setUnavailable({ message: err.message, command: cliCommandFor(result.url) });
      } else if (err instanceof ScanApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "The scan could not be started.");
      }
    }
  }

  return { submit, busy, current, error, unavailable };
}

export function ScanUnavailableNotice({ message, command }: { message: string; command: string }) {
  return (
    <Notice tone="info" title="The local scanning service isn't running">
      <p>{message}</p>
      <p>Or run the same scan from a terminal and open the folder under Reports:</p>
      <CopyCommand command={command} />
    </Notice>
  );
}

export function ScanUrlForm() {
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState("");
  const { submit, busy, current, error, unavailable } = useScanSubmit();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!busy) void submit(value);
  }

  return (
    <div className="scan-form-wrap">
      <form className="scan-form" onSubmit={onSubmit} noValidate aria-label="Scan a website">
        <div className={`scan-input-row${error ? " has-error" : ""}`}>
          <label htmlFor={inputId} className="visually-hidden">Website URL</label>
          <Globe size={17} className="scan-input-icon" aria-hidden="true" />
          <input
            id={inputId}
            name="url"
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="https://your-website.com"
            value={value}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => setValue(e.target.value)}
            className="scan-input"
          />
          <Button type="submit" variant="primary" size="lg" disabled={busy} icon={<ArrowRight size={16} />}>
            {busy ? "Scanning…" : "Scan Website"}
          </Button>
        </div>
        {error ? (
          <p id={errorId} className="field-error" role="alert">{error}</p>
        ) : null}
        {unavailable ? <ScanUnavailableNotice {...unavailable} /> : null}
      </form>
      {current ? <ScanProgress scan={current} onRetry={() => void submit(current.url)} /> : null}
    </div>
  );
}
