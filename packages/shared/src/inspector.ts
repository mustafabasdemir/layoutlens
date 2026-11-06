/**
 * Phase 9 — Interactive Visual Inspector: bounded DOM snapshot attached to a viewport scan.
 * Collected in Chromium at scan time; consumed offline by Studio and HTML reports.
 */

/** Snapshot format inside `JsonReportViewport.inspector.version`. */
export const INSPECTOR_SNAPSHOT_VERSION = 1 as const;

/** Allowlisted computed CSS property names (values come from getComputedStyle during capture). */
export const INSPECTOR_COMPUTED_STYLE_KEYS = [
  "display",
  "position",
  "boxSizing",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "overflowX",
  "overflowY",
  "top",
  "right",
  "bottom",
  "left",
  "zIndex",
  "transform",
  "flexDirection",
  "flexWrap",
  "justifyContent",
  "alignItems",
  "gridTemplateColumns",
  "fontSize",
  "lineHeight",
  "whiteSpace",
  "textOverflow",
  "overflowWrap",
  "visibility",
  "opacity",
  "pointerEvents",
] as const;

export type InspectorComputedStyleKey = (typeof INSPECTOR_COMPUTED_STYLE_KEYS)[number];

export type InspectorComputedStyles = Partial<Record<InspectorComputedStyleKey, string>>;

export interface InspectorElementNode {
  /** Stable id within this viewport snapshot (e.g. el_0). */
  id: string;
  tagName: string;
  /** Sanitized selector; may be ambiguous if selectorMatches > 1. */
  selector: string;
  /** How many nodes match `selector` in the document (captured for diagnostics). */
  selectorMatches: number;
  parentId: string | null;
  /** Depth from `document.documentElement` (html = 0). */
  depth: number;
  boundingBox: import("./report.js").JsonReportBoundingBox;
  /** Intersection of layout box with the layout viewport, clamped to viewport bounds. */
  visibleBox: import("./report.js").JsonReportBoundingBox;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  computed: InspectorComputedStyles;
  /** Finding `id` strings (Phase 7 overflow / Phase 8 advanced) matched to this node at capture time. */
  relatedFindingIds: string[];
}

export interface InspectorSnapshotMeta {
  version: typeof INSPECTOR_SNAPSHOT_VERSION;
  /** Monotonic element id counter at end of capture. */
  elementCount: number;
  /** `window.devicePixelRatio` when the snapshot ran. */
  devicePixelRatio: number;
  /** Layout viewport width/height in CSS px (matches scan viewport). */
  viewportWidth: number;
  viewportHeight: number;
  /** Time spent collecting this snapshot (milliseconds). */
  collectionDurationMs: number;
  /** True when traversal stopped early due to limits. */
  truncated: boolean;
  /** Elements not visited because of `maxElements`. */
  elementsOmitted: number;
  /** Max depth setting used for this capture. */
  maxDepth: number;
  /** Max elements setting used for this capture. */
  maxElements: number;
  /** Max selector length setting used for this capture. */
  maxSelectorLength: number;
}

/** Sparse grid of `elementsFromPoint` stacks for offline hit-testing (coarse; not pixel-perfect). */
export interface InspectorHitTestSample {
  x: number;
  y: number;
  /** Top-first element ids present in `elements`, capped per sample. */
  topIds: string[];
}

export interface InspectorHitTestGrid {
  stepPx: number;
  samples: InspectorHitTestSample[];
}

export interface InspectorSnapshot {
  meta: InspectorSnapshotMeta;
  elements: InspectorElementNode[];
  /** Optional capture-time hit-test grid (CSS px, layout viewport). */
  hitTest?: InspectorHitTestGrid;
}

/** Options for scan-time inspector capture (all optional; defaults are conservative). */
export interface InspectorCaptureOptions {
  /** When false (default), no snapshot is collected. */
  enabled?: boolean;
  maxElements?: number;
  maxDepth?: number;
  maxSelectorLength?: number;
  /** Upper bound on coarse grid cells for `hitTest` sampling (step grows to stay under this). */
  maxHitTestSamples?: number;
}

export const DEFAULT_INSPECTOR_CAPTURE: Required<InspectorCaptureOptions> = {
  enabled: false,
  maxElements: 4000,
  maxDepth: 48,
  maxSelectorLength: 480,
  maxHitTestSamples: 900,
};

export function mergeInspectorConfig(
  partial?: InspectorCaptureOptions | null,
): Required<InspectorCaptureOptions> {
  return {
    enabled: partial?.enabled ?? DEFAULT_INSPECTOR_CAPTURE.enabled,
    maxElements: partial?.maxElements ?? DEFAULT_INSPECTOR_CAPTURE.maxElements,
    maxDepth: partial?.maxDepth ?? DEFAULT_INSPECTOR_CAPTURE.maxDepth,
    maxSelectorLength: partial?.maxSelectorLength ?? DEFAULT_INSPECTOR_CAPTURE.maxSelectorLength,
    maxHitTestSamples: partial?.maxHitTestSamples ?? DEFAULT_INSPECTOR_CAPTURE.maxHitTestSamples,
  };
}
