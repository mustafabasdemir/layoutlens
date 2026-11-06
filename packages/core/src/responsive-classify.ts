import {
  capSeverity,
  type AdvancedFinding,
  type AdvancedRelatedSample,
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
  const consent = raw.likelyConsentOverlay;
  let classification: FindingClassification = "potential";
  if (raw.hitTestBlocked && raw.coverageRatio >= 0.25) {
    /** Real hit interception; CMP/cookie layers are usually intentional — do not mark "confirmed layout defect". */
    classification = consent ? "potential" : "confirmed";
  } else if (!raw.hitTestBlocked) {
    if (raw.coverageRatio < 0.45) return null;
    classification = "potential";
  } else if (raw.coverageRatio < 0.35) return null;

  const severity = capSeverity(
    classification,
    consent
      ? "low"
      : raw.hitTestBlocked && raw.coverageRatio >= 0.5
        ? "high"
        : raw.coverageRatio >= 0.35
          ? "medium"
          : "low",
  );

  const pct = Math.round(raw.coverageRatio * 100);
  const consentNote = consent
    ? " Blocker looks like a cookie/consent overlay (fixed, full-width) — interaction is blocked until the user acts; this is usually by design, not a layout bug."
    : "";
  const reason = raw.hitTestBlocked
    ? `${pct}% of this ${raw.targetTag} is covered by ${raw.blockerSelector} (${raw.blockerPosition}, z-index ${raw.blockerZIndex}), and pointer hit-tests hit the blocker instead.${consentNote}`
    : `${pct}% of this ${raw.targetTag} overlaps ${raw.blockerSelector} — verify whether clicks still reach the control.${consentNote}`;

  return {
    id: makeId("overlap", raw.targetSelector, raw.targetRect.x, raw.targetRect.y),
    category: "overlap",
    tagName: raw.targetTag,
    selector: raw.targetSelector,
    selectorMatches: raw.targetMatches,
    severity,
    classification,
    reason,
    guidance: consent
      ? "Cookie banners intentionally block the page until accepted; treat as advisory unless the banner cannot be dismissed."
      : "Check whether the overlapping layer is intentional (badge, sticky header) or blocks interaction.",
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
      ...(consent ? { likelyConsentOverlay: true } : {}),
    },
  };
}

function classifyTextClip(raw: RawTextClipCandidate): AdvancedFinding | null {
  if (raw.horizontalTrack && raw.clipSelector) return null;
  const hOver = raw.scrollWidth - raw.clientWidth;
  const vOver = raw.scrollHeight - raw.clientHeight;
  if (hOver <= 1.5 && vOver <= 1.5) return null;

  const lh = raw.lineHeightPx > 0 ? raw.lineHeightPx : raw.fontSizePx * 1.2;
  const minHorizSig = 3;
  const minVertSig = Math.max(4, lh * 0.15);
  const horizSignificant = hOver > minHorizSig;
  const vertSignificant = vOver > minVertSig;
  if (!horizSignificant && !vertSignificant) return null;

  /** Sub-pixel / line-box slack: tiny vertical overflow with normal wrapping is usually not user-visible clipping. */
  if (
    !horizSignificant &&
    vertSignificant &&
    vOver <= lh * 0.4 &&
    raw.whiteSpace !== "nowrap" &&
    raw.overflowX === "visible" &&
    raw.overflowY === "visible"
  ) {
    return null;
  }

  if (raw.intentional && raw.textOverflow === "ellipsis") return null;
  if (raw.intentional && raw.lineClamp !== null && raw.lineClamp > 0 && hOver <= 40 && vOver <= 40) return null;
  /** Design-time ellipsis / line-clamp: ignore small residual overflow. */
  if (raw.intentional && hOver <= 12 && vOver <= 12) return null;
  let classification: FindingClassification = "potential";
  const strongClip = horizSignificant ? hOver > 8 : vOver > Math.max(8, lh * 0.55);
  if (strongClip) {
    classification = raw.inScrollContainer ? "insufficient-evidence" : "confirmed";
  } else if (!raw.intentional) {
    classification = "potential";
  }

  const severity = capSeverity(
    classification,
    hOver > 24 || vOver > Math.max(24, lh * 1.2) ? "medium" : "low",
  );

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
      fontSizePx: raw.fontSizePx,
      lineHeightPx: raw.lineHeightPx,
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

function classifyOffscreen(
  raw: RawInteractive,
  viewportWidth: number,
  rootClips: boolean,
): AdvancedFinding | null {
  if (raw.disabled || raw.invisible) return null;
  if (raw.intentionallyHidden) return null;
  /** Drawer / off-canvas shifted panel: touch noise only in evidence; do not list as offscreen finding. */
  if (raw.hiddenByUi) return null;
  if (isCarouselChrome(raw)) return null;
  if (!raw.horizontalInaccessible) return null;
  if (raw.inScrollContainer) return null;
  if (raw.clipSelector && raw.clipOverflowX === "hidden" && !raw.visible) return null;
  if (raw.rect.x + raw.rect.width <= 0) return null;
  /** Below-the-fold-only controls are reached by vertical scroll, not "horizontal offscreen" defects. */
  if (!raw.verticalIntersectsViewport || raw.belowTheFold) return null;
  const pastEdge = raw.rect.x + raw.rect.width > viewportWidth + 5 || raw.rect.x < -5;
  if (!pastEdge) return null;
  if (raw.visible && raw.visible.width >= 24) return null;
  const role = raw.role ?? raw.tagName;

  const strip = raw.visible && raw.visible.width >= 8 && raw.visible.width < 24;
  const tinyStrip = raw.visible && raw.visible.width > 0 && raw.visible.width < 8;
  const gone = raw.visible === null;

  /** No horizontal clipping at root — document may scroll horizontally to this control. */
  if (gone && !rootClips) return null;

  let classification: FindingClassification = "insufficient-evidence";
  if (strip) {
    classification = rootClips ? "potential" : "insufficient-evidence";
  } else if (gone) {
    classification = rootClips ? "confirmed" : "insufficient-evidence";
  } else if (tinyStrip) {
    classification = "insufficient-evidence";
  } else {
    return null;
  }

  let severity = capSeverity(classification, classification === "confirmed" ? "high" : classification === "potential" ? "medium" : "low");

  let reason: string;
  if (strip) {
    reason = rootClips
      ? `Only a ${Math.round(raw.visible!.width)}px strip of this ${role} shows at the horizontal edge while the page does not allow horizontal scrolling — it may be unreachable.`
      : `Only a ${Math.round(raw.visible!.width)}px strip shows at the edge — the page may allow horizontal scrolling; verify whether users can reach the full control.`;
  } else if (gone) {
    reason = rootClips
      ? `This ${role} lies past the ${viewportWidth}px viewport width and is not painted in view while horizontal scrolling is blocked (root overflow hidden) — likely unreachable.`
      : `This ${role} is not painted in the horizontal viewport; horizontal scrolling may still reach it — confirm in the live page.`;
  } else if (tinyStrip) {
    reason = `Only a ${Math.round(raw.visible!.width)}px sliver of this ${role} is visible at the edge — insufficient evidence of a usability issue without manual testing.`;
  } else {
    return null;
  }

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
      rootClips
        ? "Horizontal scrolling is disabled at the root — controls past the edge may be genuinely inaccessible."
        : "If the document scrolls horizontally, this may be reachable; if not, investigate clipping and positioning.",
    boundingBox: raw.rect,
    visibleBox: raw.visible,
    offscreenControl: {
      role: raw.role,
      disabled: raw.disabled,
      tabIndex: raw.tabIndex,
      horizontalOutside: true,
      notVisibleInViewport: raw.visible === null,
      verticalIntersectsViewport: raw.verticalIntersectsViewport,
      belowTheFold: raw.belowTheFold,
      intentionallyHidden: raw.intentionallyHidden,
    },
  };
  if (raw.clipSelector) {
    const c = clippingFrom(raw.clipSelector, raw.clipOverflowX ?? "hidden", raw.rect);
    if (c) finding.clipping = c;
  }
  return finding;
}

function groupOffscreenByClipper(findings: AdvancedFinding[]): AdvancedFinding[] {
  const rest: AdvancedFinding[] = [];
  const byClip = new Map<string, AdvancedFinding[]>();
  for (const f of findings) {
    if (
      f.category === "offscreen-control" &&
      f.visibleBox === null &&
      f.clipping?.selector &&
      (f.offscreenControl?.notVisibleInViewport ?? false)
    ) {
      const k = `${f.clipping.selector}:${f.clipping.overflowX}`;
      const arr = byClip.get(k) ?? [];
      arr.push(f);
      byClip.set(k, arr);
    } else {
      rest.push(f);
    }
  }
  const merged: AdvancedFinding[] = [];
  for (const [, items] of byClip) {
    if (items.length < 3) {
      merged.push(...items);
      continue;
    }
    items.sort((a, b) => a.boundingBox.y - b.boundingBox.y || a.boundingBox.x - b.boundingBox.x);
    const primary = items[0]!;
    const samples: AdvancedRelatedSample[] = items.slice(1, 11).map((s) => ({
      selector: s.selector,
      tagName: s.tagName,
      boundingBox: s.boundingBox,
    }));
    merged.push({
      ...primary,
      id: `${makeId("offscreen-control", primary.clipping!.selector, primary.boundingBox.x, primary.boundingBox.y)}:grp`,
      reason: `${items.length} controls in the same clipped container (${primary.clipping!.selector}) are not visible until that panel is opened — not separate defects.`,
      classification: "insufficient-evidence",
      severity: capSeverity("insufficient-evidence", "low"),
      related: samples,
      relatedCount: items.length,
    });
  }
  return [...rest, ...merged];
}

function touchGroupKey(f: AdvancedFinding): string | null {
  if (f.category !== "touch-target" || !f.touchTarget) return null;
  const tt = f.touchTarget;
  const clip = f.clipping?.selector ?? "none";
  const tooSmall = tt.hitWidth < tt.minSizePx - 0.5 || tt.hitHeight < tt.minSizePx - 0.5;
  if (tooSmall) {
    /** Same container + below minimum: one advisory for many sibling chips. */
    return `touch-small:${clip}`;
  }
  /** Crowded but large enough: bin geometry so similar toolbars group. */
  const w = Math.round(tt.hitWidth / 16) * 16;
  const h = Math.round(tt.hitHeight / 16) * 16;
  return `touch-crowded:${clip}:${w}x${h}`;
}

function groupSimilarTouchTargets(findings: AdvancedFinding[]): AdvancedFinding[] {
  const rest: AdvancedFinding[] = [];
  const buckets = new Map<string, AdvancedFinding[]>();
  for (const f of findings) {
    const k = touchGroupKey(f);
    if (!k) {
      rest.push(f);
      continue;
    }
    const arr = buckets.get(k) ?? [];
    arr.push(f);
    buckets.set(k, arr);
  }
  const merged: AdvancedFinding[] = [];
  for (const [, items] of buckets) {
    if (items.length < 3) {
      merged.push(...items);
      continue;
    }
    items.sort((a, b) => a.boundingBox.y - b.boundingBox.y || a.boundingBox.x - b.boundingBox.x);
    const primary = items[0]!;
    const tt = primary.touchTarget!;
    const samples: AdvancedRelatedSample[] = items.slice(1, 11).map((s) => ({
      selector: s.selector,
      tagName: s.tagName,
      boundingBox: s.boundingBox,
    }));
    const clipLabel = primary.clipping?.selector ?? "this viewport";
    const gk = touchGroupKey(primary);
    merged.push({
      ...primary,
      id: `${primary.id}:grp-touch`,
      ...(gk ? { groupKey: gk } : {}),
      reason: `${items.length} controls under ${clipLabel} share a similar ${Math.round(tt.hitWidth)}×${Math.round(tt.hitHeight)}px tap area (advisory minimum ${tt.minSizePx}px) — one responsive check, not separate defects.`,
      classification: "potential",
      severity: capSeverity("potential", "low"),
      related: samples,
      relatedCount: items.length,
    });
  }
  return [...rest, ...merged];
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

  const finding: AdvancedFinding = {
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
  };
  if (raw.clipSelector) {
    const c = clippingFrom(raw.clipSelector, raw.clipOverflowX ?? "hidden", raw.rect);
    if (c) finding.clipping = c;
  }
  out.push(finding);
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
      const f = classifyOffscreen(i, V, evidence.rootClips);
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

  const groupedOff = groupOffscreenByClipper(deduped);
  const grouped = groupSimilarTouchTargets(groupedOff);

  grouped.sort((a, b) => {
    const rank = (c: FindingClassification) =>
      c === "confirmed" ? 0 : c === "potential" ? 1 : 2;
    return rank(a.classification) - rank(b.classification);
  });

  const findingLimit = ADVANCED_FINDING_LIMIT;
  const findings = grouped.slice(0, findingLimit);
  const findingsOmitted = Math.max(0, grouped.length - findings.length);

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
