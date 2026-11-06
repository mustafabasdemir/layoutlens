import { useRef, type PointerEvent, type ReactNode } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useElementSize } from "./hooks";
import { IconButton } from "./primitives";

export const ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const;

export function nextZoom(current: number, dir: 1 | -1): number {
  const idx = ZOOM_STEPS.findIndex((z) => z >= current - 1e-6);
  const base = idx === -1 ? ZOOM_STEPS.length - 1 : idx;
  const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, base + dir))];
  return next ?? current;
}

/** Width that fits an image of the given aspect entirely inside the available box. */
export function fitWidth(
  container: { width: number; height: number },
  natural: { width: number; height: number },
): number {
  if (container.width <= 0 || natural.width <= 0 || natural.height <= 0) return 0;
  if (container.height <= 0) return container.width;
  return Math.min(container.width, (container.height * natural.width) / natural.height);
}

export function ZoomControls({
  zoom,
  onZoom,
  label = "Screenshot zoom",
  disabled,
}: {
  zoom: number;
  onZoom(z: number): void;
  label?: string;
  disabled?: boolean;
}) {
  const d = disabled === true;
  return (
    <div className="zoom-controls" role="group" aria-label={label}>
      <IconButton label="Zoom out" onClick={() => onZoom(nextZoom(zoom, -1))} disabled={d || zoom <= ZOOM_STEPS[0]}>
        <ZoomOut size={15} />
      </IconButton>
      <output className="zoom-level" aria-live="polite">{Math.round(zoom * 100)}%</output>
      <IconButton
        label="Zoom in"
        onClick={() => onZoom(nextZoom(zoom, 1))}
        disabled={d || zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]!}
      >
        <ZoomIn size={15} />
      </IconButton>
      <IconButton label="Fit to view" onClick={() => onZoom(1)} disabled={d || zoom === 1}>
        <Maximize2 size={14} />
      </IconButton>
    </div>
  );
}

/**
 * Scrollable viewport that renders children on a canvas with the image's exact
 * aspect ratio. Zoom 1 = fit entirely in view; higher zoom enlarges the canvas and
 * allows panning (drag when `pannable`, or scroll).
 */
export function ZoomFrame({
  natural,
  zoom,
  pannable = true,
  children,
  label,
  canStartPan,
}: {
  natural: { width: number; height: number };
  zoom: number;
  pannable?: boolean;
  children: ReactNode;
  label: string;
  /** When set, return false to block starting a pan drag (e.g. inspector clicks). Modifier+pan still works if implemented by caller returning true for shiftKey. */
  canStartPan?: (e: PointerEvent<HTMLDivElement>) => boolean;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(viewportRef);
  const drag = useRef<{ x: number; y: number; left: number; top: number; id: number } | null>(null);
  const base = fitWidth({ width: size.width, height: size.height }, natural);
  const width = Math.round(base * zoom);
  const canPan = pannable && zoom > 1;

  return (
    <div
      ref={viewportRef}
      className={`zoom-viewport${canPan ? " is-pannable" : ""}`}
      aria-label={label}
      role="region"
      tabIndex={zoom > 1 ? 0 : -1}
      onPointerDown={(e) => {
        if (!canPan || e.button !== 0) return;
        if (canStartPan && !canStartPan(e)) return;
        const el = viewportRef.current;
        if (!el) return;
        drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, id: e.pointerId };
        el.setPointerCapture(e.pointerId);
        el.classList.add("is-panning");
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        const el = viewportRef.current;
        if (!d || !el || d.id !== e.pointerId) return;
        el.scrollLeft = d.left - (e.clientX - d.x);
        el.scrollTop = d.top - (e.clientY - d.y);
      }}
      onPointerUp={(e) => {
        drag.current = null;
        viewportRef.current?.classList.remove("is-panning");
        try {
          viewportRef.current?.releasePointerCapture(e.pointerId);
        } catch {
          /* pointer already released */
        }
      }}
    >
      <div
        className="zoom-canvas"
        data-zoom={zoom}
        style={{
          width: width > 0 ? `${width}px` : "100%",
          aspectRatio: `${natural.width} / ${natural.height}`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
