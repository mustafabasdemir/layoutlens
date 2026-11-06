import { useEffect, useMemo, useRef } from "react";
import { ImageOff } from "lucide-react";
import type { JsonReportViewport } from "@layoutlens/shared";
import { workspaceKey, type WorkspaceFindingRef } from "../../lib/workspace-findings";
import type { ImageState } from "../../ui/hooks";
import { EmptyState, Notice, Skeleton } from "../../ui/primitives";
import { ZoomFrame } from "../../ui/ZoomFrame";
import { overlayForWorkspace } from "./workspace-overlay";

export { overlayForWorkspace };

export function ScreenshotViewer({
  src,
  image,
  viewport,
  workspaceRefs,
  selectedKey,
  onSelect,
  zoom,
  showAll,
}: {
  src: string | null;
  image: ImageState;
  viewport: JsonReportViewport;
  workspaceRefs: readonly WorkspaceFindingRef[];
  selectedKey: string | null;
  onSelect(key: string): void;
  zoom: number;
  showAll: boolean;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  const overlays = useMemo(() => {
    if (image.status !== "loaded") return [];
    return workspaceRefs.map((ref) => ({
      ref,
      key: workspaceKey(ref),
      mapping: overlayForWorkspace(ref, viewport, image),
    }));
  }, [workspaceRefs, viewport, image]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedKey, zoom]);

  if (!viewport.screenshot) {
    return (
      <div className="viewer-empty">
        <EmptyState icon={<ImageOff size={20} />} title="No screenshot for this viewport">
          <p>This report was generated without screenshots. Run the scan with <code>--format html --output &lt;dir&gt;</code> to capture them.</p>
        </EmptyState>
      </div>
    );
  }
  if (!src || image.status === "error") {
    return (
      <div className="viewer-empty">
        <Notice tone="warning" title="Screenshot file unavailable">
          The report references <code>{viewport.screenshot}</code>, but that file is not in the selected folder.
          Open the complete report folder to inspect it.
        </Notice>
      </div>
    );
  }
  if (image.status !== "loaded") {
    return (
      <div className="viewer-loading" aria-busy="true" aria-label="Loading screenshot">
        <Skeleton className="skeleton-shot" />
      </div>
    );
  }

  return (
    <ZoomFrame
      natural={{ width: image.naturalWidth, height: image.naturalHeight }}
      zoom={zoom}
      label={`Screenshot at ${viewport.width}px`}
    >
      <img
        className="shot-img"
        src={src}
        alt={`Page screenshot at ${viewport.width}px viewport`}
        draggable={false}
        data-testid="workspace-screenshot"
      />
      <div className="shot-overlays">
        {overlays.map(({ ref, key, mapping }) => {
          if (mapping.status !== "visible" && mapping.status !== "clipped") return null;
          const selected = key === selectedKey;
          if (!selected && !showAll) return null;
          const sev = ref.kind === "overflow" ? ref.finding.severity : ref.finding.severity;
          const { leftPct, topPct, widthPct, heightPct } = mapping.rect;
          const label =
            ref.kind === "overflow" ? ref.finding.selector : `${ref.finding.category}: ${ref.finding.selector}`;
          return (
            <button
              key={key}
              ref={selected ? selectedRef : undefined}
              type="button"
              className={`shot-box shot-box-${ref.kind} sev-${sev}${selected ? " is-selected" : ""}${mapping.status === "clipped" ? " is-clipped" : ""}`}
              style={{ left: `${leftPct}%`, top: `${topPct}%`, width: `${widthPct}%`, height: `${heightPct}%` }}
              data-finding={key}
              aria-label={`Select finding ${label}`}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(key);
              }}
            >
              {selected ? <span className="shot-box-label">{label}</span> : null}
            </button>
          );
        })}
      </div>
    </ZoomFrame>
  );
}
