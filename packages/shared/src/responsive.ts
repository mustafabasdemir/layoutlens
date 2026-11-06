import type { ClippingContext, FindingClassification } from "./classification.js";
import type { FindingSeverity } from "./severity.js";

export interface ElementBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Advanced responsive issue categories (Phase 8). Horizontal overflow stays in `findings[]`. */
export type AdvancedFindingCategory =
  | "overlap"
  | "text-clipping"
  | "offscreen-control"
  | "touch-target";

export const ADVANCED_FINDING_CATEGORIES: readonly AdvancedFindingCategory[] = [
  "overlap",
  "text-clipping",
  "offscreen-control",
  "touch-target",
] as const;

export const ADVANCED_CATEGORY_LABELS: Record<AdvancedFindingCategory, string> = {
  overlap: "Overlap",
  "text-clipping": "Text clipping",
  "offscreen-control": "Offscreen control",
  "touch-target": "Touch target",
};

export interface OverlapEvidence {
  blockerSelector: string;
  blockerTagName: string;
  overlapAreaPx: number;
  /** Share of the target's visible box covered by the blocker (0–1). */
  coverageRatio: number;
  hitTestBlocked: boolean;
  targetPointerEvents: string;
  blockerPointerEvents: string;
  blockerPosition: string;
  targetZIndex: string;
  blockerZIndex: string;
  /** Fixed CMP / cookie layer — overlap is real but often intentional UX. */
  likelyConsentOverlay?: boolean;
}

export interface TextClipEvidence {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  overflowX: string;
  overflowY: string;
  whiteSpace: string;
  textOverflow: string;
  lineClamp: number | null;
  /** True when ellipsis / line-clamp styling looks intentional. */
  intentional: boolean;
  /** Computed font metrics (Phase 8.2). */
  fontSizePx?: number;
  lineHeightPx?: number;
}

export interface OffscreenControlEvidence {
  role: string | null;
  disabled: boolean;
  tabIndex: number | null;
  horizontalOutside: boolean;
  /** No painted intersection with the layout viewport. */
  notVisibleInViewport: boolean;
  /** Intersects viewport vertically (Y range). */
  verticalIntersectsViewport?: boolean;
  /** Control is entirely below the first viewport height (scroll to reach). */
  belowTheFold?: boolean;
  /** Author-hiding: inert, hidden, closed details content, hidden popover, content-visibility. */
  intentionallyHidden?: boolean;
}

export interface TouchTargetEvidence {
  hitWidth: number;
  hitHeight: number;
  minSizePx: number;
  spacingToNearestPx: number | null;
  rule: string;
  disabled: boolean;
}

/** Sample element merged into a grouped responsive finding (Phase 8.1). */
export interface AdvancedRelatedSample {
  selector: string;
  tagName: string;
  boundingBox: ElementBoundingBox;
}

export interface AdvancedFinding {
  /** Stable id within the viewport report. */
  id: string;
  category: AdvancedFindingCategory;
  tagName: string;
  selector: string;
  selectorMatches: number;
  severity: FindingSeverity;
  classification: FindingClassification;
  reason: string;
  guidance: string;
  boundingBox: ElementBoundingBox;
  visibleBox: ElementBoundingBox | null;
  invisible?: boolean;
  clipping?: ClippingContext;
  overlap?: OverlapEvidence;
  textClip?: TextClipEvidence;
  offscreenControl?: OffscreenControlEvidence;
  touchTarget?: TouchTargetEvidence;
  /** Grouped offscreen controls sharing the same hidden container (samples). */
  related?: AdvancedRelatedSample[];
  relatedCount?: number;
  /** Evidence key for merged findings (optional, for transparency). */
  groupKey?: string;
}

export interface AdvancedViewportAnalysis {
  elementsInspected: number;
  candidateCount: number;
  candidateLimit: number;
  candidatesOmitted: number;
  findingLimit: number;
  findingsOmitted: number;
}

export interface AdvancedCategoryCounts {
  overlap: number;
  textClipping: number;
  offscreenControl: number;
  touchTarget: number;
}

export function emptyAdvancedCategoryCounts(): AdvancedCategoryCounts {
  return { overlap: 0, textClipping: 0, offscreenControl: 0, touchTarget: 0 };
}

export function countAdvancedCategories(
  items: readonly { category: AdvancedFindingCategory }[],
): AdvancedCategoryCounts {
  const c = emptyAdvancedCategoryCounts();
  for (const item of items) {
    if (item.category === "overlap") c.overlap += 1;
    else if (item.category === "text-clipping") c.textClipping += 1;
    else if (item.category === "offscreen-control") c.offscreenControl += 1;
    else if (item.category === "touch-target") c.touchTarget += 1;
  }
  return c;
}

/** Which Phase 8 detectors run during a scan. All default on with conservative thresholds. */
export interface DetectionConfig {
  overlap: boolean;
  textClipping: boolean;
  offscreenControls: boolean;
  touchTargets: boolean;
  /** Minimum interactive target size (px) for touch-target checks at mobile width. */
  touchTargetMinPx: number;
  /** Minimum gap (px) between independent touch targets. */
  touchTargetSpacingPx: number;
  /** Run touch-target analysis only at or below this viewport width. */
  touchTargetMaxViewport: number;
}

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  overlap: true,
  textClipping: true,
  offscreenControls: true,
  touchTargets: true,
  touchTargetMinPx: 44,
  touchTargetSpacingPx: 8,
  touchTargetMaxViewport: 390,
};

export function mergeDetectionConfig(
  partial?: Partial<DetectionConfig> | undefined,
): DetectionConfig {
  if (!partial) return { ...DEFAULT_DETECTION_CONFIG };
  return { ...DEFAULT_DETECTION_CONFIG, ...partial };
}
