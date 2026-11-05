import {
  capSeverity,
  type AdvancedFinding,
  type AdvancedViewportAnalysis,
  type ClippingContext,
  type DetectionConfig,
  type FindingClassification,
} from "@layoutlens/shared";
import type {
  RawInteractive,
  RawOverlapCandidate,
  RawResponsiveEvidence,
  RawTextClipCandidate,
  RawTouchCandidate,
} from "./responsive-evidence.js";

export const ADVANCED_FINDING_LIMIT = 40;
export const ADVANCED_ELEMENT_LIMIT = 2500;

const round = (n: number) => Math.round(n * 10) / 10;

function makeId(category: string, selector: string, x: number, y: number): string {
  return `${category}:${selector}:${round(x)}:${round(y)}`;
}

function clippingFrom(
  selector: string | null,
  overflowX: string | null,
  rect: { x: number; y: number; width: number; height: number },
): ClippingContext | undefined {
  if (!selector || !overflowX) return undefined;
  return {
    selector,
    tagName: "div",
    overflowX,
    kind: overflowX === "auto" || overflowX === "scroll" ? "scroll" : "clip",
    boundingBox: { ...rect },
  };
}

function classifyOverlap(raw: RawOverlapCandidate): AdvancedFinding | null {
  let classification: FindingClassification = "potential";
  if (raw.hitTestBlocked && raw.coverageRatio >= 0.25) classification = "confirmed";
  else if (!raw.hitTestBlocked) {
    if (raw.coverageRatio < 0.45) return null;
    classification = "potential";
  } else if (raw.coverageRatio < 0.35) return null;

  const severity = capSeverity(
    classification,
    raw.hitTestBlocked && raw.coverageRatio >= 0.5 ? "high" : raw.coverageRatio >= 0.35 ? "medium" : "low",
  );

  const pct = Math.round(raw.coverageRatio * 100);
  const reason = raw.hitTestBlocked
    ? `${pct}% of this ${raw.targetTag} is covered by ${raw.blockerSelector} (${raw.blockerPosition}, z-index ${raw.blockerZIndex}), and pointer hit-tests hit the blocker instead.`
    : `${pct}% of this ${raw.targetTag} overlaps ${raw.blockerSelector} — verify whether clicks still reach the control.`;

  return {
    id: makeId("overlap", raw.targetSelector, raw.targetRect.x, raw.targetRect.y),
    category: "overlap",
    tagName: raw.targetTag,
    selector: raw.targetSelector,
    selectorMatches: raw.targetMatches,
    severity,
    classification,
    reason,
    guidance: "Check whether the overlapping layer is intentional (badge, sticky header) or blocks interaction.",
    boundingBox: raw.targetRect,
    visibleBox: raw.targetVisible,
    overlap: {
      blockerSelector: raw.blockerSelector,
      blockerTagName: raw.blockerTag,
      overlapAreaPx: raw.overlapAreaPx,
      coverageRatio: raw.coverageRatio,
      hitTestBlocked: raw.hitTestBlocked,
      targetPointerEvents: raw.targetPointerEvents,
      blockerPointerEvents: raw.blockerPointerEvents,
      blockerPosition: raw.blockerPosition,
      targetZIndex: String(raw.targetZIndex),
      blockerZIndex: String(raw.blockerZIndex),
    },
  };
}

function classifyTextClip(raw: RawTextClipCandidate): AdvancedFinding | null {
  if (raw.horizontalTrack && raw.clipSelector) return null;
  const hOver = raw.scrollWidth - raw.clientWidth;
  const vOver = raw.scrollHeight - raw.clientHeight;
  if (hOver <= 1.5 && vOver <= 1.5) return null;

  if (raw.intentional && raw.textOverflow === "ellipsis") return null;
  if (raw.intentional && raw.lineClamp !== null && raw.lineClamp > 0 && hOver <= 40 && vOver <= 40) return null;
  let classification: FindingClassification = "potential";
  if (hOver > 8 || vOver > 8) {
    classification = raw.inScrollContainer ? "insufficient-evidence" : "confirmed";
  }

  const severity = capSeverity(classification, hOver > 24 || vOver > 24 ? "medium" : "low");

  const reason = raw.intentional
    ? `Text may be intentionally truncated (${raw.textOverflow || "line-clamp"}), but ${Math.max(hOver, vOver).toFixed(0)}px of content is still clipped inside the box.`
    : `Text is clipped (${raw.scrollWidth}×${raw.scrollHeight}px content in ${raw.clientWidth}×${raw.clientHeight}px box) with overflow ${raw.overflowX}/${raw.overflowY}.`;

  const finding: AdvancedFinding = {
    id: makeId("text-clipping", raw.selector, raw.rect.x, raw.rect.y),
    category: "text-clipping",
    tagName: raw.tagName,
    selector: raw.selector,
    selectorMatches: raw.selectorMatches,
    severity,
    classification,
    reason,
    guidance: raw.intentional
      ? "Confirm with design whether ellipsis/line-clamp is intended before changing styles."
      : "Inspect overflow, white-space, and container width at this viewport.",
    boundingBox: raw.rect,
    visibleBox: raw.visible,
    textClip: {
      scrollWidth: raw.scrollWidth,
      clientWidth: raw.clientWidth,
      scrollHeight: raw.scrollHeight,
      clientHeight: raw.clientHeight,
      overflowX: raw.overflowX,
      overflowY: raw.overflowY,
      whiteSpace: raw.whiteSpace,
      textOverflow: raw.textOverflow,
      lineClamp: raw.lineClamp,
      intentional: raw.intentional,
    },
  };
  if (raw.clipSelector) {
    const c = clippingFrom(raw.clipSelector, "hidden", raw.rect);
    if (c) finding.clipping = c;
  }
  return finding;
}

function isCarouselChrome(raw: RawInteractive): boolean {
  if (/swiper|carousel|pagination-bullet|slick|glide|rail/i.test(raw.selector)) return true;
  if (raw.clipSelector && /swiper|carousel|slick|glide/i.test(raw.clipSelector)) return true;
  return false;
}

function classifyOffscreen(raw: RawInteractive, viewportWidth: number): AdvancedFinding | null {
  if (raw.disabled || raw.invisible) return null;
  if (isCarouselChrome(raw)) return null;
  if (!raw.horizontalInaccessible) return null;
  if (raw.inScrollContainer) return null;
  if (raw.clipSelector && raw.clipOverflowX === "hidden" && !raw.visible) return null;
  if (raw.rect.x + raw.rect.width <= 0) return null;
  const pastEdge = raw.rect.x + raw.rect.width > viewportWidth + 5 || raw.rect.x < -5;
  if (!pastEdge) return null;
  if (raw.visible && raw.visible.width >= 20) return null;
  const role = raw.role ?? raw.tagName;

  let classification: FindingClassification = raw.visible ? "potential" : "confirmed";
  if (raw.clipSelector && raw.clipOverflowX === "hidden") classification = "potential";

  const severity = capSeverity(classification, "medium");

  const reason = raw.visible
    ? `This ${role} is partly clipped horizontally and may be hard to reach at ${viewportWidth}px.`
    : `This ${role} is not painted inside the ${viewportWidth}px viewport (clipped or positioned offscreen).`;

  const finding: AdvancedFinding = {
    id: makeId("offscreen-control", raw.selector, raw.rect.x, raw.rect.y),
    category: "offscreen-control",
    tagName: raw.tagName,
    selector: raw.selector,
    selectorMatches: raw.selectorMatches,
    severity,
    classification,
    reason,
    guidance:
      "Horizontal inaccessibility matters for controls users must tap without sideways page scroll — not for content below the fold.",
    boundingBox: raw.rect,
    visibleBox: raw.visible,
    offscreenControl: {
      role: raw.role,
      disabled: raw.disabled,
      tabIndex: raw.tabIndex,
      horizontalOutside: true,
      notVisibleInViewport: raw.visible === null,
    },
  };
  if (raw.clipSelector) {
    const c = clippingFrom(raw.clipSelector, raw.clipOverflowX ?? "hidden", raw.rect);
    if (c) finding.clipping = c;
  }
  return finding;
}

function classifyTouch(raw: RawTouchCandidate, config: DetectionConfig): AdvancedFinding[] {
  const out: AdvancedFinding[] = [];
  const min = config.touchTargetMinPx;
  const gap = config.touchTargetSpacingPx;
  const tooSmall = raw.hitWidth < min - 0.5 || raw.hitHeight < min - 0.5;
  const crowded = raw.spacingToNearestPx !== null && raw.spacingToNearestPx < gap;
  if (!tooSmall && !crowded) return out;
  if (raw.disabled || raw.invisible) return out;

  const rule = tooSmall
    ? `Rendered hit area ${raw.hitWidth}×${raw.hitHeight}px is below the ${min}×${min}px advisory minimum.`
    : `Nearest independent control is only ${raw.spacingToNearestPx}px away (advisory minimum gap ${gap}px).`;

  out.push({
    id: makeId("touch-target", raw.selector, raw.rect.x, raw.rect.y),
    category: "touch-target",
    tagName: raw.tagName,
    selector: raw.selector,
    selectorMatches: raw.selectorMatches,
    severity: "low",
    classification: "potential",
    reason: rule,
    guidance:
      "Touch targets are advisory at mobile width — inline text links and dense toolbars may be acceptable by design.",
    boundingBox: raw.rect,
    visibleBox: raw.visible,
    touchTarget: {
      hitWidth: raw.hitWidth,
      hitHeight: raw.hitHeight,
      minSizePx: min,
      spacingToNearestPx: raw.spacingToNearestPx,
      rule,
      disabled: raw.disabled,
    },
  });
  return out;
}

function dedupeKey(f: AdvancedFinding): string {
  return `${f.category}:${f.selector}:${f.boundingBox.x}:${f.boundingBox.y}`;
}

export function classifyResponsiveEvidence(
  evidence: RawResponsiveEvidence,
  config: DetectionConfig,
): { findings: AdvancedFinding[]; analysis: AdvancedViewportAnalysis } {
  const V = evidence.viewportWidth;
  const candidates: AdvancedFinding[] = [];

  if (config.overlap) {
    const seenOverlap = new Set<string>();
    for (const o of evidence.overlaps) {
      const key = `${o.targetSelector}:${o.blockerSelector}`;
      if (seenOverlap.has(key)) continue;
      seenOverlap.add(key);
      const f = classifyOverlap(o);
      if (f) candidates.push(f);
    }
  }

  if (config.textClipping) {
    for (const t of evidence.textClips) {
      const f = classifyTextClip(t);
      if (f) candidates.push(f);
    }
  }

  if (config.offscreenControls) {
    for (const i of evidence.interactives) {
      const f = classifyOffscreen(i, V);
      if (f) candidates.push(f);
    }
  }

  if (config.touchTargets && V <= config.touchTargetMaxViewport) {
    for (const t of evidence.touchTargets) {
      candidates.push(...classifyTouch(t, config));
    }
  }

  const deduped: AdvancedFinding[] = [];
  const seen = new Set<string>();
  for (const f of candidates) {
    const k = dedupeKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(f);
  }

  deduped.sort((a, b) => {
    const rank = (c: FindingClassification) =>
      c === "confirmed" ? 0 : c === "potential" ? 1 : 2;
    return rank(a.classification) - rank(b.classification);
  });

  const findingLimit = ADVANCED_FINDING_LIMIT;
  const findings = deduped.slice(0, findingLimit);
  const findingsOmitted = Math.max(0, deduped.length - findings.length);

  const candidateCount =
    evidence.overlaps.length +
    evidence.textClips.length +
    evidence.interactives.length +
    evidence.touchTargets.length;

  return {
    findings,
    analysis: {
      elementsInspected: evidence.elementsInspected,
      candidateCount,
      candidateLimit: ADVANCED_ELEMENT_LIMIT,
      candidatesOmitted: evidence.candidatesOmitted,
      findingLimit,
      findingsOmitted,
    },
  };
}
