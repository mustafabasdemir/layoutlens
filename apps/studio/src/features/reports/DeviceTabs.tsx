import type { KeyboardEvent } from "react";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import type { JsonReportViewport } from "@layoutlens/shared";
import { deviceName } from "../../lib/findings";

function DeviceIcon({ name }: { name: string }) {
  if (name === "Mobile") return <Smartphone size={15} aria-hidden="true" />;
  if (name === "Tablet") return <Tablet size={15} aria-hidden="true" />;
  return <Monitor size={15} aria-hidden="true" />;
}

/** Tabs generated from the viewports actually present in the report. */
export function DeviceTabs({
  viewports,
  value,
  onChange,
  idPrefix,
  badge,
}: {
  viewports: readonly JsonReportViewport[];
  value: number;
  onChange(width: number): void;
  idPrefix: string;
  badge?: (vp: JsonReportViewport) => string | null;
}) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const idx = viewports.findIndex((v) => v.width === value);
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % viewports.length;
    if (e.key === "ArrowLeft") next = (idx - 1 + viewports.length) % viewports.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = viewports.length - 1;
    const vp = viewports[next];
    if (vp) {
      onChange(vp.width);
      e.currentTarget.querySelector<HTMLButtonElement>(`#${idPrefix}-tab-${vp.width}`)?.focus();
    }
  }

  return (
    <div className="device-tabs" role="tablist" aria-label="Viewport" onKeyDown={onKeyDown}>
      {viewports.map((vp) => {
        const name = deviceName(vp.width, vp.label);
        const selected = vp.width === value;
        const b = badge?.(vp);
        return (
          <button
            key={vp.width}
            id={`${idPrefix}-tab-${vp.width}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            className="device-tab"
            data-width={vp.width}
            onClick={() => onChange(vp.width)}
          >
            <DeviceIcon name={name} />
            <span className="device-name">{name}</span>
            <span className="device-width">{vp.width}px</span>
            {b ? <span className="device-badge">{b}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
