import { useCallback, useEffect, useMemo, useRef } from "react";
import { ImageOff } from "lucide-react";
import type { JsonReportViewport } from "@layoutlens/shared";
import {
  hitTestInspectorAtPoint,
  mapBoxToScreenshot,
  pickInspectorTarget,
  screenshotPointerToLayoutViewportCss,
  type InspectorElementNode,
  type InspectorPickResult,
} from "@layoutlens/shared";
import { shortInspectorSelector } from "../../lib/inspector-related";
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
  inspectorMode,
  inspectorSelectedId,
  inspectorHoverId,
  onInspectorHover,
  onInspectorPick,
}: {
  src: string | null;
  image: ImageState;
  viewport: JsonReportViewport;
  workspaceRefs: readonly WorkspaceFindingRef[];
  selectedKey: string | null;
  onSelect(key: string): void;
  zoom: number;
  showAll: boolean;
  inspectorMode: boolean;
  inspectorSelectedId: string | null;
  inspectorHoverId: string | null;
  onInspectorHover(id: string | null, meta: { uncertain: boolean; tag?: string; selectorShort?: string }): void;
  onInspectorPick(result: InspectorPickResult | null): void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const rafRef = useRef<number>(0);
  const pendingRef = useRef<{ clientX: number; clientY: number } | null>(null);

  const snapshot = viewport.inspector;
  const elements = snapshot?.elements ?? [];
  const hitTest = snapshot?.hitTest;
  const byId = useMemo(() => new Map(elements.map((e) => [e.id, e] as const)), [elements]);

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

  const layoutFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      const el = imgRef.current;
      if (!el || image.status !== "loaded") return null;
      const rect = el.getBoundingClientRect();
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;
      return screenshotPointerToLayoutViewportCss(
        relX,
        relY,
        { width: rect.width, height: rect.height },
        { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight },
        viewport,
      );
    },
    [image, viewport],
  );

  const processInspectorPointer = useCallback(
    (clientX: number, clientY: number, kind: "hover" | "click") => {
      if (!inspectorMode || !snapshot || elements.length === 0) {
        if (kind === "hover") onInspectorHover(null, { uncertain: false });
        return;
      }
      const pt = layoutFromEvent(clientX, clientY);
      if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
        if (kind === "hover") onInspectorHover(null, { uncertain: false });
        return;
      }
      const hit = hitTestInspectorAtPoint(elements, hitTest, pt.x, pt.y);
      const pick = pickInspectorTarget(hit, byId, elements, pt.x, pt.y);
      const id = pick.primaryId;
      const node = id ? byId.get(id) : undefined;
      if (kind === "hover") {
        onInspectorHover(id, {
          uncertain: pick.uncertain,
          tag: node?.tagName,
          selectorShort: node ? shortInspectorSelector(node.selector, 56) : undefined,
        });
      } else {
        onInspectorPick(pick.primaryId != null || pick.candidates.length > 0 ? pick : null);
      }
    },
    [inspectorMode, snapshot, elements, hitTest, layoutFromEvent, byId, onInspectorHover, onInspectorPick],
  );

  const scheduleInspectorPointer = useCallback(
    (clientX: number, clientY: number) => {
      pendingRef.current = { clientX, clientY };
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const p = pendingRef.current;
        pendingRef.current = null;
        if (p) processInspectorPointer(p.clientX, p.clientY, "hover");
      });
    },
    [processInspectorPointer],
  );

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const inspectorOverlayRects = useMemo(() => {
    if (!inspectorMode || image.status !== "loaded" || !snapshot) return [];
    const ids = [inspectorHoverId, inspectorSelectedId].filter(Boolean) as string[];
    const uniq = [...new Set(ids)];
    return uniq
      .map((id) => {
        const node = byId.get(id);
        if (!node) return null;
        const box =
          node.visibleBox.width > 0 && node.visibleBox.height > 0 ? node.visibleBox : node.boundingBox;
        const m = mapBoxToScreenshot(box, viewport, image);
        if (m.status !== "visible" && m.status !== "clipped") return null;
        return { id, rect: m.rect, selected: id === inspectorSelectedId };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [inspectorMode, image, snapshot, inspectorHoverId, inspectorSelectedId, byId, viewport]);

  if (!viewport.screenshot) {
    return (
      <div className="viewer-empty">
        <EmptyState icon={<ImageOff size={20} />} title="No screenshot for this viewport">
          <p>
            This report was generated without screenshots. Run the scan with <code>--format html --output &lt;dir&gt;</code> to capture them.
          </p>
        </EmptyState>
      </div>
    );
  }
  if (!src || image.status === "error") {
    return (
      <div className="viewer-empty">
        <Notice tone="warning" title="Screenshot file unavailable">
          The report references <code>{viewport.screenshot}</code>, but that file is not in the selected folder. Open the complete report folder to inspect it.
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
      pannable
      canStartPan={(e) => !inspectorMode || e.shiftKey === true}
      label={`Screenshot at ${viewport.width}px`}
    >
      <div
        className={`shot-wrap${inspectorMode ? " shot-inspector-active" : ""}`}
        role={inspectorMode ? "application" : undefined}
        aria-label={inspectorMode ? "Inspector mode: move pointer over the screenshot" : undefined}
        onPointerMove={
          inspectorMode
            ? (e) => {
                if (e.pointerType === "touch") return;
                scheduleInspectorPointer(e.clientX, e.clientY);
              }
            : undefined
        }
        onPointerLeave={
          inspectorMode
            ? () => {
                onInspectorHover(null, { uncertain: false });
              }
            : undefined
        }
        onPointerDown={
          inspectorMode
            ? (e) => {
                if (e.button === 0) e.stopPropagation();
              }
            : undefined
        }
        onClick={
          inspectorMode
            ? (e) => {
                e.stopPropagation();
                processInspectorPointer(e.clientX, e.clientY, "click");
              }
            : undefined
        }
      >
        <img
          ref={imgRef}
          className="shot-img"
          src={src}
          alt={`Page screenshot at ${viewport.width}px viewport`}
          draggable={false}
          data-testid="workspace-screenshot"
        />
        <div className="shot-overlays" aria-hidden={inspectorMode ? "true" : undefined}>
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
        {inspectorMode ? (
          <div className="shot-inspector-layer" aria-hidden="true">
            {inspectorOverlayRects.map(({ id, rect, selected }) => (
              <div
                key={id}
                className={`shot-inspector-box${selected ? " is-selected" : " is-hover"}`}
                style={{
                  left: `${rect.leftPct}%`,
                  top: `${rect.topPct}%`,
                  width: `${rect.widthPct}%`,
                  height: `${rect.heightPct}%`,
                }}
              />
            ))}
          </div>
        ) : null}
        {inspectorMode ? (
          <div className="shot-inspector-legend" role="status" aria-live="polite">
            {inspectorHoverId && byId.has(inspectorHoverId) ? (
              <span>
                <code>{byId.get(inspectorHoverId)!.tagName}</code>{" "}
                <span className="inspector-legend-sel">{shortInspectorSelector(byId.get(inspectorHoverId)!.selector, 64)}</span>
              </span>
            ) : (
              <span className="inspector-muted">Hover to highlight · click to inspect</span>
            )}
          </div>
        ) : null}
      </div>
    </ZoomFrame>
  );
}
