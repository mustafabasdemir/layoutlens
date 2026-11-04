import { useEffect, useMemo, useRef } from "react";
import { ImageOff } from "lucide-react";
import { mapBoxToScreenshot, overlayBoxFor, type JsonReportViewport, type OverlayMapping } from "@layoutlens/shared";
import { findingKey, type FindingRef } from "../../lib/findings";
import type { ImageState } from "../../ui/hooks";
import { EmptyState, Notice, Skeleton } from "../../ui/primitives";
import { ZoomFrame } from "../../ui/ZoomFrame";

export function overlayFor(
  ref: FindingRef,
  viewport: JsonReportViewport,
  natural: { naturalWidth: number; naturalHeight: number },
): OverlayMapping {
  const box = overlayBoxFor(ref.finding);
  if (!box) {
    return {
      status: "outside",
      reason: `No part of this element is painted inside the ${viewport.width}px viewport, so the screenshot cannot show it.`,
    };
  }
  return mapBoxToScreenshot(box, viewport, natural);
}

export function ScreenshotViewer({
  src,
  image,
  viewport,
  findings,
  selectedKey,
  onSelect,
  zoom,
  showAll,
}: {
  src: string | null;
  image: ImageState;
  viewport: JsonReportViewport;
  findings: readonly FindingRef[];
  selectedKey: string | null;
  onSelect(key: string): void;
  zoom: number;
  showAll: boolean;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  const overlays = useMemo(() => {
    if (image.status !== "loaded") return [];
    return findings.map((ref) => ({ ref, key: findingKey(ref), mapping: overlayFor(ref, viewport, image) }));
  }, [findings, viewport, image]);

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
          const { leftPct, topPct, widthPct, heightPct } = mapping.rect;
          return (
            <button
              key={key}
              ref={selected ? selectedRef : undefined}
              type="button"
              className={`shot-box sev-${ref.finding.severity}${selected ? " is-selected" : ""}${mapping.status === "clipped" ? " is-clipped" : ""}`}
              style={{ left: `${leftPct}%`, top: `${topPct}%`, width: `${widthPct}%`, height: `${heightPct}%` }}
              data-finding={key}
              aria-label={`Select finding ${ref.finding.selector}`}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(key);
              }}
            >
              {selected ? <span className="shot-box-label">{ref.finding.selector}</span> : null}
            </button>
          );
        })}
      </div>
    </ZoomFrame>
  );
}
