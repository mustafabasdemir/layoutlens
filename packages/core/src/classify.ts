import {
  capSeverity,
  classifySeverity,
  type ClippingContext,
  type ElementBoundingBox,
  type ExcludedFinding,
  type ExclusionReason,
  type FindingClassification,
  type OverflowFinding,
  type RelatedElement,
  type ViewportAnalysis,
} from "@layoutlens/shared";
import type { RawCandidate, RawClipper, RawLayoutEvidence, RawRect } from "./layout-evidence.js";

export const FINDING_LIMIT = 50;
export const EXCLUDED_LIMIT = 50;
export const RELATED_LIMIT = 20;
export const CANDIDATE_LIMIT = 5000;
export const EDGE_TOLERANCE_PX = 1.5;

const SAMPLE_LIMIT = 5;

type Decision =
  | {
      kind: "issue";
      classification: FindingClassification;
      /** Pixels used for severity: scroll contribution (confirmed) or cut-off width (potential). */
      impactPx: number;
      scrollContributionPx: number;
      reason: string;
    }
  | { kind: "excluded"; reason: ExclusionReason; explanation: string };

interface Measured {
  c: RawCandidate;
  index: number;
  /** Horizontal extent in scroll-direction coordinates (mirrored for RTL), before / after clipping. */
  start: number;
  end: number;
  clippedStart: number;
  clippedEnd: number;
  fullyClipped: boolean;
  contentOnly: boolean;
  documentContributionPx: number;
  visibleBox: ElementBoundingBox | null;
  decision: Decision;
  /** A wrapper whose overflow is explained by an overflowing descendant. */
  dropped: boolean;
}

const round = (n: number) => Math.round(n * 10) / 10;

function box(r: RawRect): ElementBoundingBox {
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function clippingContext(clipper: RawClipper | undefined): ClippingContext | undefined {
  if (!clipper) return undefined;
  return {
    selector: clipper.selector,
    selectorMatches: clipper.selectorMatches,
    tagName: clipper.tagName,
    overflowX: clipper.overflowX,
    kind: clipper.kind,
    boundingBox: box(clipper.rect),
  };
}

function describeClipper(clipper: RawClipper | undefined): string {
  if (!clipper) return "an ancestor";
  const r = clipper.rect;
  const ambiguous = clipper.selectorMatches > 1 ? `, one of ${clipper.selectorMatches} elements matching this selector` : "";
  return `${clipper.selector} (overflow-x: ${clipper.overflowX}; box x ${round(r.x)}–${round(r.x + r.width)}, y ${round(r.y)}${ambiguous})`;
}

/** Interpret raw layout evidence for one viewport. Pure — no browser access. */
export function classifyLayoutEvidence(
  evidence: RawLayoutEvidence,
  limits: { findings?: number; excluded?: number; related?: number; candidateLimit?: number } = {},
): { findings: OverflowFinding[]; excluded: ExcludedFinding[]; analysis: ViewportAnalysis } {
  const tol = EDGE_TOLERANCE_PX;
  const V = evidence.documentClientWidth;
  const findingLimit = limits.findings ?? FINDING_LIMIT;
  const excludedLimit = limits.excluded ?? EXCLUDED_LIMIT;
  const relatedLimit = limits.related ?? RELATED_LIMIT;
  const docOverflowPx = Math.max(0, round(evidence.documentScrollWidth - V));
  const userScrollable = !evidence.rootClips && docOverflowPx > tol;
  const endSide = evidence.rtl ? "left" : "right";
  const startSide = evidence.rtl ? "right" : "left";

  // Mirror RTL geometry so "end" is always the side the page can scroll towards.
  const toStart = (x: number, w: number) => (evidence.rtl ? V - (x + w) : x);
  const toEnd = (x: number, w: number) => (evidence.rtl ? V - x : x + w);

  const measured: Measured[] = evidence.candidates.map((c, index) => {
    const start = toStart(c.rect.x, c.rect.width);
    let end = toEnd(c.rect.x, c.rect.width);
    let contentOnly = false;
    if (c.contentRight !== null) {
      const contentEnd = evidence.rtl ? V - c.contentRight : c.contentRight;
      if (contentEnd > end) {
        contentOnly = end <= V + tol && start >= -tol;
        end = contentEnd;
      }
    }
    let clippedStart = start;
    let clippedEnd = end;
    let fullyClipped = false;
    if (c.clip) {
      clippedStart = Math.max(start, toStart(c.clip.x, c.clip.width));
      clippedEnd = Math.min(end, toEnd(c.clip.x, c.clip.width));
      fullyClipped = clippedEnd - clippedStart <= 0.5 || c.clip.height <= 0;
    }

    const visStart = Math.max(clippedStart, 0);
    const visEnd = Math.min(clippedEnd, V);
    let visibleBox: ElementBoundingBox | null = null;
    if (!fullyClipped && !c.invisible && visEnd - visStart > 0.5) {
      const top = c.clip ? Math.max(c.rect.y, c.clip.y) : c.rect.y;
      const bottom = c.clip ? Math.min(c.rect.y + c.rect.height, c.clip.y + c.clip.height) : c.rect.y + c.rect.height;
      if (bottom - top > 0.5) {
        const x = evidence.rtl ? V - visEnd : visStart;
        visibleBox = { x: round(x), y: round(top), width: round(visEnd - visStart), height: round(bottom - top) };
      }
    }

    return {
      c,
      index,
      start,
      end,
      clippedStart,
      clippedEnd,
      fullyClipped,
      contentOnly,
      documentContributionPx: round(Math.max(0, end - V, -start)),
      visibleBox,
      decision: { kind: "excluded", reason: "offscreen", explanation: "" },
      dropped: false,
    };
  });

  for (const m of measured) m.decision = decide(m);

  function decide(m: Measured): Decision {
    const { c } = m;
    const inner = evidence.clippers[c.innerClipper];
    const outer = evidence.clippers[c.outerClipper];
    if (m.fullyClipped) {
      const clipper = outer ?? inner;
      if (clipper?.kind === "scroll") {
        return {
          kind: "excluded",
          reason: "inside-scroll-container",
          explanation: `Inside the scroll container ${describeClipper(clipper)}. Users reach it by scrolling that container; it does not widen the page.`,
        };
      }
      return {
        kind: "excluded",
        reason: "clipped-by-ancestor",
        explanation: `Fully clipped by ${describeClipper(clipper)}, so none of it is painted and it does not widen the page.`,
      };
    }

    const endOver = round(m.clippedEnd - V);
    const startOver = round(-m.clippedStart);
    const visibleWidth = Math.max(0, Math.min(m.clippedEnd, V) - Math.max(m.clippedStart, 0));
    const extras: string[] = [];
    if (m.contentOnly) extras.push(`Its content is ${c.scrollWidth}px wide inside a ${c.clientWidth}px box (for example long unbroken text or a nowrap row).`);
    if (c.invisible) extras.push("The element is invisible (visibility or opacity) but still takes up layout space.");
    if (c.transformed) extras.push("Its position includes a CSS transform.");
    const extra = extras.length > 0 ? ` ${extras.join(" ")}` : "";

    if (c.fixedToViewport) {
      if (visibleWidth <= 0.5) {
        return {
          kind: "excluded",
          reason: "offscreen",
          explanation: `A position: fixed element placed entirely outside the viewport (typical for closed off-canvas panels). Fixed elements never widen the page.`,
        };
      }
      const cut = round(Math.max(0, endOver) + Math.max(0, startOver));
      if (cut > tol) {
        return {
          kind: "issue",
          classification: "potential",
          impactPx: cut,
          scrollContributionPx: 0,
          reason: `This position: fixed element is partly visible, but ${cut}px of it falls outside the ${V}px viewport. Fixed elements cannot be scrolled into view, so that part is unreachable.${extra}`,
        };
      }
    }

    if (!c.fixedToViewport && endOver > tol) {
      if (userScrollable) {
        const contribution = round(Math.min(endOver, docOverflowPx));
        return {
          kind: "issue",
          classification: "confirmed",
          impactPx: contribution,
          scrollContributionPx: contribution,
          reason: `Its ${endSide} edge is ${endOver}px past the ${V}px viewport and no ancestor clips it, so the page scrolls horizontally (document ${evidence.documentScrollWidth}px wide).${extra}`,
        };
      }
      if (evidence.rootClips) {
        if (c.invisible) {
          return { kind: "excluded", reason: "hidden", explanation: `Invisible, and the overflow it causes is hidden by overflow-x: ${evidence.rootOverflowX} on html/body.` };
        }
        if (visibleWidth > 0.5) {
          return {
            kind: "issue",
            classification: "potential",
            impactPx: endOver,
            scrollContributionPx: 0,
            reason: `${endOver}px of it is cut off at the ${endSide} edge of the ${V}px viewport. The page hides horizontal overflow with overflow-x: ${evidence.rootOverflowX} on html/body, so users cannot scroll to the hidden part.${extra}`,
          };
        }
        return {
          kind: "excluded",
          reason: "offscreen",
          explanation: `Positioned entirely beyond the ${endSide} edge of the viewport; overflow-x: ${evidence.rootOverflowX} on html/body hides it and prevents horizontal scrolling.`,
        };
      }
      return {
        kind: "issue",
        classification: "insufficient-evidence",
        impactPx: endOver,
        scrollContributionPx: 0,
        reason: `Its measured box ends ${endOver}px past the ${V}px viewport with no clipping ancestor found, yet the document is not wider than the viewport (${evidence.documentScrollWidth}px). Something LayoutLens does not model may be clipping it — verify in DevTools.${extra}`,
      };
    }

    if (startOver > tol) {
      if (c.invisible) {
        return { kind: "excluded", reason: "hidden", explanation: `Invisible and placed past the ${startSide} edge of the viewport.` };
      }
      if (visibleWidth > 0.5) {
        return {
          kind: "issue",
          classification: "potential",
          impactPx: startOver,
          scrollContributionPx: 0,
          reason: `It starts ${startOver}px past the ${startSide} edge of the viewport. Content beyond that edge cannot be scrolled to, so it is cut off.${extra}`,
        };
      }
      return {
        kind: "excluded",
        reason: "offscreen",
        explanation: `Positioned entirely past the ${startSide} edge of the viewport (a common hiding or off-canvas technique). Content there never widens the page.`,
      };
    }

    // Past the edge before clipping, but an ancestor clips it back inside the viewport.
    const clipper = inner ?? outer;
    if (clipper?.kind === "scroll") {
      return {
        kind: "excluded",
        reason: "inside-scroll-container",
        explanation: `Partly visible inside the scroll container ${describeClipper(clipper)}. The overflow is scrollable within that container and does not widen the page.`,
      };
    }
    return {
      kind: "excluded",
      reason: "clipped-by-ancestor",
      explanation: `Extends past the viewport before clipping, but ${describeClipper(clipper)} cuts it off inside the viewport, so it does not widen the page.`,
    };
  }

  // Wrappers whose only overflow is content explained by an overflowing descendant are not root causes.
  const hasIssueDescendant = new Set<number>();
  for (const m of measured) {
    if (m.decision.kind !== "issue") continue;
    for (let p = m.c.parent; p >= 0; p = evidence.candidates[p]!.parent) hasIssueDescendant.add(p);
  }
  // Exception: a row whose children only overflow because of where the row places them
  // (each child fits on its own) is the shared root cause, e.g. a flex row that doesn't wrap.
  const pushedChildren = new Map<number, number>();
  for (const m of measured) {
    if (m.decision.kind !== "issue" || m.c.parent < 0) continue;
    const parent = measured[m.c.parent]!;
    if (m.c.rect.width <= parent.c.clientWidth + tol) {
      pushedChildren.set(parent.index, (pushedChildren.get(parent.index) ?? 0) + 1);
    }
  }
  for (const m of measured) {
    if (
      m.decision.kind === "issue" &&
      m.contentOnly &&
      hasIssueDescendant.has(m.index) &&
      (pushedChildren.get(m.index) ?? 0) < 2
    ) {
      m.dropped = true;
    }
  }
  const isDropped = (m: Measured) => m.dropped;

  // Group issues under the outermost ancestor with the same classification (the responsible container).
  const issueRoot = (m: Measured): Measured => {
    let current = m;
    for (let p = current.c.parent; p >= 0; p = evidence.candidates[p]!.parent) {
      const parent = measured[p]!;
      if (isDropped(parent)) continue;
      if (
        parent.decision.kind === "issue" &&
        current.decision.kind === "issue" &&
        parent.decision.classification === current.decision.classification
      ) {
        current = parent;
      } else {
        break;
      }
    }
    return current;
  };

  const issueGroups = new Map<number, Measured[]>();
  for (const m of measured) {
    if (m.decision.kind !== "issue" || isDropped(m)) continue;
    const root = issueRoot(m);
    const list = issueGroups.get(root.index) ?? [];
    list.push(m);
    issueGroups.set(root.index, list);
  }

  const related = (m: Measured): RelatedElement => ({
    selector: m.c.selector,
    tagName: m.c.tagName,
    boundingBox: box(m.c.rect),
    documentContributionPx: m.documentContributionPx,
  });

  const classOrder: Record<FindingClassification, number> = { confirmed: 0, potential: 1, "insufficient-evidence": 2 };
  const sevOrder = { high: 0, medium: 1, low: 2 } as const;

  const allFindings: OverflowFinding[] = [];
  for (const [rootIndex, members] of issueGroups) {
    const root = measured[rootIndex]!;
    if (root.decision.kind !== "issue") continue;
    const decision = root.decision;
    const impact = Math.max(...members.map((m) => (m.decision.kind === "issue" ? m.decision.impactPx : 0)));
    const scrollContribution = Math.max(
      ...members.map((m) => (m.decision.kind === "issue" ? m.decision.scrollContributionPx : 0)),
    );
    const others = members
      .filter((m) => m !== root)
      .sort((a, b) => b.documentContributionPx - a.documentContributionPx);
    const clipping = clippingContext(evidence.clippers[root.c.innerClipper]);
    const internal = root.c.scrollWidth - root.c.clientWidth;
    let reason = decision.reason;
    if (root.c.pattern === "horizontal-track") {
      reason += " Its children sit in a single row, like a carousel track. If that is intended, an ancestor should clip or scroll the overflow (for example overflow: hidden on the carousel viewport); otherwise let the row wrap.";
    }
    allFindings.push({
      id: "",
      tagName: root.c.tagName,
      selector: root.c.selector,
      selectorMatches: root.c.selectorMatches,
      severity: capSeverity(decision.classification, classifySeverity(impact, V)),
      overflowPx: internal > tol ? round(internal) : 0,
      documentContributionPx: root.documentContributionPx,
      scrollWidth: root.c.scrollWidth,
      clientWidth: root.c.clientWidth,
      boundingBox: box(root.c.rect),
      depth: root.c.depth,
      classification: decision.classification,
      reason,
      scrollContributionPx: scrollContribution,
      visibleBox: root.visibleBox,
      position: root.c.position,
      transformed: root.c.transformed,
      invisible: root.c.invisible,
      ...(clipping ? { clipping } : {}),
      ...(root.c.pattern ? { pattern: root.c.pattern } : {}),
      related: others.slice(0, relatedLimit).map(related),
      relatedCount: others.length,
    });
  }
  allFindings.sort(
    (a, b) =>
      classOrder[a.classification] - classOrder[b.classification] ||
      sevOrder[a.severity] - sevOrder[b.severity] ||
      b.scrollContributionPx - a.scrollContributionPx ||
      b.documentContributionPx - a.documentContributionPx,
  );

  for (let i = 0; i < allFindings.length; i++) {
    allFindings[i]!.id = `overflow:${evidence.viewportWidth}:${i}`;
  }

  // Group exclusions by the clipping container, or by the outermost element sharing the same reason.
  const excludedGroups = new Map<string, Measured[]>();
  for (const m of measured) {
    if (m.decision.kind !== "excluded" || isDropped(m)) continue;
    const reason = m.decision.reason;
    let key: string;
    if ((reason === "clipped-by-ancestor" || reason === "inside-scroll-container") && (m.c.outerClipper >= 0 || m.c.innerClipper >= 0)) {
      key = `clip:${m.c.outerClipper >= 0 ? m.c.outerClipper : m.c.innerClipper}:${reason}`;
    } else {
      let top = m;
      for (let p = m.c.parent; p >= 0; p = evidence.candidates[p]!.parent) {
        const parent = measured[p]!;
        if (parent.decision.kind === "excluded" && parent.decision.reason === reason && !isDropped(parent)) top = parent;
        else break;
      }
      key = `el:${top.index}:${reason}`;
    }
    const list = excludedGroups.get(key) ?? [];
    list.push(m);
    excludedGroups.set(key, list);
  }

  const allExcluded: ExcludedFinding[] = [];
  for (const [key, members] of excludedGroups) {
    const first = members[0]!;
    if (first.decision.kind !== "excluded") continue;
    const reason = first.decision.reason;
    const sorted = [...members].sort((a, b) => a.c.depth - b.c.depth || b.documentContributionPx - a.documentContributionPx);
    if (key.startsWith("clip:")) {
      const clipper = evidence.clippers[Number(key.split(":")[1])]!;
      const n = members.length;
      const subject = n === 1 ? "1 element past the viewport edge" : `${n} elements past the viewport edge`;
      const they = n === 1 ? "it does" : "they do";
      const explanation =
        reason === "inside-scroll-container"
          ? `${subject} ${n === 1 ? "sits" : "sit"} inside the scroll container ${describeClipper(clipper)}. Users reach ${n === 1 ? "it" : "them"} by scrolling that container; ${they} not widen the page.`
          : `${subject} ${n === 1 ? "is" : "are"} clipped by ${describeClipper(clipper)}, so ${they} not widen the page.${members.some((m) => m.c.transformed) ? " Some are moved there with CSS transforms." : ""}`;
      allExcluded.push({
        reason,
        explanation,
        selector: clipper.selector,
        tagName: clipper.tagName,
        boundingBox: box(clipper.rect),
        clipping: clippingContext(clipper)!,
        elementCount: n,
        samples: sorted.slice(0, SAMPLE_LIMIT).map(related),
      });
    } else {
      const top = sorted[0]!;
      const n = members.length;
      allExcluded.push({
        reason,
        explanation: n > 1 ? `${first.decision.explanation} (${n} elements, grouped under their outermost container.)` : first.decision.explanation,
        selector: top.c.selector,
        tagName: top.c.tagName,
        boundingBox: box(top.c.rect),
        elementCount: n,
        samples: sorted.slice(0, SAMPLE_LIMIT).map(related),
      });
    }
  }
  allExcluded.sort((a, b) => b.elementCount - a.elementCount);

  // Overflow is attributed when some measured element ends past the edge after ancestor clipping.
  const attributes = measured.some((m) => !m.fullyClipped && !m.c.fixedToViewport && m.clippedEnd > V + tol);
  const analysis: ViewportAnalysis = {
    elementsInspected: evidence.elementsInspected,
    candidateCount: evidence.candidates.length + evidence.candidatesOmitted,
    candidateLimit: limits.candidateLimit ?? CANDIDATE_LIMIT,
    candidatesOmitted: evidence.candidatesOmitted,
    rootOverflowX: evidence.rootOverflowX,
    userScrollable,
    maskedOverflowPx: evidence.rootClips ? docOverflowPx : 0,
    unattributedOverflowPx: docOverflowPx > tol && !attributes ? docOverflowPx : 0,
    findingLimit,
    findingsOmitted: Math.max(0, allFindings.length - findingLimit),
    excludedLimit,
    excludedOmitted: Math.max(0, allExcluded.length - excludedLimit),
    relatedLimit,
  };

  return {
    findings: allFindings.slice(0, findingLimit),
    excluded: allExcluded.slice(0, excludedLimit),
    analysis,
  };
}
