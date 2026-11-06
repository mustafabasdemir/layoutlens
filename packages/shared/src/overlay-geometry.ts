import type { JsonReportBoundingBox } from "./report.js";

export interface OverlayRectPercent {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
}

export type OverlayMapping =
  | { status: "visible"; rect: OverlayRectPercent }
  | { status: "clipped"; rect: OverlayRectPercent; reason: string }
  | { status: "outside"; reason: string }
  | { status: "unmappable"; reason: string };

export interface ViewportGeometry {
  /** CSS viewport width the scan used. */
  width: number;
  viewportHeight: number;
}

export interface ImageGeometry {
  naturalWidth: number;
  naturalHeight: number;
}

function positive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

/**
 * Map a CSS-pixel bounding box (page coordinates at scroll 0) onto a viewport screenshot.
 * The screenshot is assumed to start at the document origin; scale is derived from
 * image width ÷ viewport width (covers device pixel ratio). Boxes are clipped to the
 * captured area rather than drawn where no pixels exist.
 */
export function mapBoxToScreenshot(
  box: JsonReportBoundingBox,
  viewport: ViewportGeometry,
  image: ImageGeometry,
): OverlayMapping {
  if (!positive(viewport.width) || !positive(image.naturalWidth) || !positive(image.naturalHeight)) {
    return {
      status: "unmappable",
      reason: "Screenshot or viewport dimensions are unavailable, so the element cannot be located on the image.",
    };
  }
  if (
    ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
    box.width <= 0 ||
    box.height <= 0
  ) {
    return {
      status: "unmappable",
      reason: "The recorded bounding box is empty or invalid.",
    };
  }

  const scale = image.naturalWidth / viewport.width;
  const capturedWidth = viewport.width;
  const capturedHeight = image.naturalHeight / scale;

  const left = Math.max(0, box.x);
  const top = Math.max(0, box.y);
  const right = Math.min(capturedWidth, box.x + box.width);
  const bottom = Math.min(capturedHeight, box.y + box.height);

  if (right <= left || bottom <= top) {
    return {
      status: "outside",
      reason:
        `The element lies outside the captured screenshot area (${Math.round(capturedWidth)}×${Math.round(capturedHeight)} CSS px). ` +
        "The screenshot shows the initial viewport only.",
    };
  }

  const rect: OverlayRectPercent = {
    leftPct: (left / capturedWidth) * 100,
    topPct: (top / capturedHeight) * 100,
    widthPct: ((right - left) / capturedWidth) * 100,
    heightPct: ((bottom - top) / capturedHeight) * 100,
  };

  const clipped =
    left !== box.x ||
    top !== box.y ||
    right !== box.x + box.width ||
    bottom !== box.y + box.height;

  if (clipped) {
    return {
      status: "clipped",
      rect,
      reason:
        "Part of the element extends beyond the captured screenshot; only the visible portion is outlined.",
    };
  }
  return { status: "visible", rect };
}

/**
 * Map pointer coordinates relative to the displayed `<img>` (CSS px) to layout-viewport CSS coordinates
 * matching `getBoundingClientRect()` / scan bounding boxes. Uses the same scale model as `mapBoxToScreenshot`.
 */
export function screenshotPointerToLayoutViewportCss(
  pointerRelX: number,
  pointerRelY: number,
  imageDisplayCss: { width: number; height: number },
  image: ImageGeometry,
  viewport: ViewportGeometry,
): { x: number; y: number } {
  const { width: dw, height: dh } = imageDisplayCss;
  if (!positive(dw) || !positive(dh) || !positive(image.naturalWidth) || !positive(image.naturalHeight)) {
    return { x: NaN, y: NaN };
  }
  const fx = pointerRelX / dw;
  const fy = pointerRelY / dh;
  const capturedWidth = viewport.width;
  const scale = image.naturalWidth / capturedWidth;
  const capturedHeight = image.naturalHeight / scale;
  return {
    x: fx * capturedWidth,
    y: fy * capturedHeight,
  };
}
