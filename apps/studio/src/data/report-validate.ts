import {
  FINDING_CLASSIFICATIONS,
  EXCLUSION_LABELS,
  INSPECTOR_COMPUTED_STYLE_KEYS,
  INSPECTOR_SNAPSHOT_VERSION,
  navigationQuality,
  REPORT_SCHEMA_VERSION,
  type ClippingContext,
  type ExcludedFinding,
  type ExclusionReason,
  type FindingClassification,
  type FindingSeverity,
  type JsonReport,
  type JsonReportBoundingBox,
  ADVANCED_FINDING_CATEGORIES,
  type AdvancedFindingCategory,
  type JsonReportAdvancedFinding,
  type JsonReportFinding,
  type JsonReportViewport,
  type JsonReportVisualCompare,
  type RelatedElement,
  type ViewportAnalysis,
  type AdvancedViewportAnalysis,
  type InspectorElementNode,
  type InspectorSnapshot,
  type NavigationQuality,
  type ScanNavigation,
  type ScanNavigationDiagnostics,
} from "@layoutlens/shared";

const EXCLUSION_REASONS = Object.keys(EXCLUSION_LABELS) as ExclusionReason[];

export class ReportValidationError extends Error {
  override name = "ReportValidationError";
}

const SEVERITIES: readonly FindingSeverity[] = ["high", "medium", "low"];
const VISUAL_STATUSES = ["pass", "fail", "missing-baseline"] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new ReportValidationError(`Expected a finite number for ${field}.`);
  }
  return v;
}

function str(v: unknown, field: string): string {
  if (typeof v !== "string") {
    throw new ReportValidationError(`Expected a string for ${field}.`);
  }
  return v;
}

function optionalStr(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

const VIEWPORT_INSPECTION_STATUSES = ["completed", "failed", "skipped"] as const;
const SCAN_COMPLETION_STATUSES = ["full", "partial", "failed"] as const;
const READINESS_MILESTONES = ["none", "commit", "domcontentloaded", "load"] as const;
const VIEWPORT_FAILURE_PHASES = ["navigation", "readiness", "viewport-resize", "measurement", "inspector", "screenshot"] as const;

function parseViewportInspectionDiagnostics(
  raw: unknown,
  path: string,
): import("@layoutlens/shared").ViewportInspectionDiagnostics | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) throw new ReportValidationError(`${path} must be an object.`);
  const out: import("@layoutlens/shared").ViewportInspectionDiagnostics = {};
  if (raw.gotoWaitUntil === "domcontentloaded") out.gotoWaitUntil = "domcontentloaded";
  if (raw.gotoDurationMs !== undefined) out.gotoDurationMs = num(raw.gotoDurationMs, `${path}.gotoDurationMs`);
  if (raw.readinessWaitDurationMs !== undefined) {
    out.readinessWaitDurationMs = num(raw.readinessWaitDurationMs, `${path}.readinessWaitDurationMs`);
  }
  if (typeof raw.domContentLoadedReached === "boolean") out.domContentLoadedReached = raw.domContentLoadedReached;
  if (typeof raw.loadEventReached === "boolean") out.loadEventReached = raw.loadEventReached;
  if (typeof raw.effectiveReadinessMilestone === "string" && (READINESS_MILESTONES as readonly string[]).includes(raw.effectiveReadinessMilestone)) {
    out.effectiveReadinessMilestone = raw.effectiveReadinessMilestone as import("@layoutlens/shared").ReadinessMilestone;
  }
  if (typeof raw.partialReadinessRecovery === "boolean") out.partialReadinessRecovery = raw.partialReadinessRecovery;
  const rr = optionalStr(raw.readinessRecoveryNote);
  if (rr !== undefined) out.readinessRecoveryNote = rr.slice(0, 200);
  if (raw.postLoadSettleMs !== undefined) out.postLoadSettleMs = num(raw.postLoadSettleMs, `${path}.postLoadSettleMs`);
  if (typeof raw.navigationCommitted === "boolean") out.navigationCommitted = raw.navigationCommitted;
  if (raw.screenshotCaptureMs !== undefined) out.screenshotCaptureMs = num(raw.screenshotCaptureMs, `${path}.screenshotCaptureMs`);
  if (typeof raw.screenshotTimedOut === "boolean") out.screenshotTimedOut = raw.screenshotTimedOut;
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseViewportInspectionError(raw: unknown, path: string): import("@layoutlens/shared").ViewportInspectionError | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) throw new ReportValidationError(`${path} must be an object.`);
  const phase = str(raw.phase, `${path}.phase`);
  if (!(VIEWPORT_FAILURE_PHASES as readonly string[]).includes(phase)) {
    throw new ReportValidationError(`${path}.phase is invalid.`);
  }
  const message = str(raw.message, `${path}.message`).slice(0, 500);
  return { phase: phase as import("@layoutlens/shared").ViewportFailurePhase, message };
}

function parseNavigationDiagnostics(raw: unknown, path: string): ScanNavigationDiagnostics | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) throw new ReportValidationError(`${path} must be an object.`);
  const milestone = str(raw.firstEffectiveMilestone, `${path}.firstEffectiveMilestone`);
  if (!(READINESS_MILESTONES as readonly string[]).includes(milestone)) {
    throw new ReportValidationError(`${path}.firstEffectiveMilestone is invalid.`);
  }
  const out: ScanNavigationDiagnostics = {
    firstViewportWidth: num(raw.firstViewportWidth, `${path}.firstViewportWidth`),
    firstGotoWaitUntil: "domcontentloaded",
    firstGotoDurationMs: num(raw.firstGotoDurationMs, `${path}.firstGotoDurationMs`),
    firstNavigationCommitted: raw.firstNavigationCommitted === true,
    firstReadinessDurationMs: num(raw.firstReadinessDurationMs, `${path}.firstReadinessDurationMs`),
    firstDomContentLoaded: raw.firstDomContentLoaded === true,
    firstLoadEvent: raw.firstLoadEvent === true,
    firstEffectiveMilestone: milestone as ScanNavigationDiagnostics["firstEffectiveMilestone"],
    firstPartialReadinessRecovery: raw.firstPartialReadinessRecovery === true,
  };
  const fr = optionalStr(raw.firstReadinessNote);
  if (fr !== undefined) out.firstReadinessNote = fr.slice(0, 200);
  return out;
}

function parseBox(raw: unknown, path: string): JsonReportBoundingBox {
  if (!isObject(raw)) throw new ReportValidationError(`${path} is missing.`);
  return {
    x: num(raw.x, `${path}.x`),
    y: num(raw.y, `${path}.y`),
    width: num(raw.width, `${path}.width`),
    height: num(raw.height, `${path}.height`),
  };
}

function optionalNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function parseClipping(raw: unknown, path: string): ClippingContext | undefined {
  if (!isObject(raw)) return undefined;
  const kind = raw.kind === "scroll" ? "scroll" : "clip";
  const out: ClippingContext = {
    selector: str(raw.selector, `${path}.selector`),
    tagName: str(raw.tagName, `${path}.tagName`),
    overflowX: str(raw.overflowX, `${path}.overflowX`),
    kind,
    boundingBox: parseBox(raw.boundingBox, `${path}.boundingBox`),
  };
  const matches = optionalNum(raw.selectorMatches);
  if (matches !== undefined) out.selectorMatches = matches;
  return out;
}

function parseRelated(raw: unknown, path: string): RelatedElement[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObject).map((r, i) => ({
    selector: str(r.selector, `${path}[${i}].selector`),
    tagName: str(r.tagName, `${path}[${i}].tagName`),
    boundingBox: parseBox(r.boundingBox, `${path}[${i}].boundingBox`),
    documentContributionPx: num(r.documentContributionPx, `${path}[${i}].documentContributionPx`),
  }));
}

function parseOverlap(raw: unknown, path: string): JsonReportAdvancedFinding["overlap"] {
  if (!isObject(raw)) throw new ReportValidationError(`${path} must be an object.`);
  const out: NonNullable<JsonReportAdvancedFinding["overlap"]> = {
    blockerSelector: str(raw.blockerSelector, `${path}.blockerSelector`),
    blockerTagName: str(raw.blockerTagName, `${path}.blockerTagName`),
    overlapAreaPx: num(raw.overlapAreaPx, `${path}.overlapAreaPx`),
    coverageRatio: num(raw.coverageRatio, `${path}.coverageRatio`),
    hitTestBlocked: raw.hitTestBlocked === true,
    targetPointerEvents: str(raw.targetPointerEvents, `${path}.targetPointerEvents`),
    blockerPointerEvents: str(raw.blockerPointerEvents, `${path}.blockerPointerEvents`),
    blockerPosition: str(raw.blockerPosition, `${path}.blockerPosition`),
    targetZIndex: str(raw.targetZIndex, `${path}.targetZIndex`),
    blockerZIndex: str(raw.blockerZIndex, `${path}.blockerZIndex`),
  };
  if (raw.likelyConsentOverlay === true) out.likelyConsentOverlay = true;
  return out;
}

function parseAdvancedRelated(raw: unknown, path: string): JsonReportAdvancedFinding["related"] {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((item, i) => {
    const p = `${path}[${i}]`;
    if (!isObject(item)) throw new ReportValidationError(`${p} must be an object.`);
    return {
      selector: str(item.selector, `${p}.selector`),
      tagName: str(item.tagName, `${p}.tagName`),
      boundingBox: parseBox(item.boundingBox, `${p}.boundingBox`),
    };
  });
}

function parseFinding(raw: unknown, path: string): JsonReportFinding {
  if (!isObject(raw)) throw new ReportValidationError(`${path} must be an object.`);
  const severity = raw.severity;
  if (typeof severity !== "string" || !SEVERITIES.includes(severity as FindingSeverity)) {
    throw new ReportValidationError(`${path}.severity is invalid.`);
  }
  const finding: JsonReportFinding = {
    selector: str(raw.selector, `${path}.selector`),
    tagName: str(raw.tagName, `${path}.tagName`),
    severity: severity as FindingSeverity,
    overflowPx: num(raw.overflowPx, `${path}.overflowPx`),
    documentContributionPx: num(raw.documentContributionPx, `${path}.documentContributionPx`),
    scrollWidth: num(raw.scrollWidth, `${path}.scrollWidth`),
    clientWidth: num(raw.clientWidth, `${path}.clientWidth`),
    boundingBox: parseBox(raw.boundingBox, `${path}.boundingBox`),
  };
  const fid = optionalStr(raw.id);
  if (fid) finding.id = fid.slice(0, 500);
  if (typeof raw.classification === "string" && (FINDING_CLASSIFICATIONS as readonly string[]).includes(raw.classification)) {
    finding.classification = raw.classification as FindingClassification;
  }
  const reason = optionalStr(raw.reason);
  if (reason) finding.reason = reason;
  const contribution = optionalNum(raw.scrollContributionPx);
  if (contribution !== undefined) finding.scrollContributionPx = contribution;
  if (raw.visibleBox === null) finding.visibleBox = null;
  else if (raw.visibleBox !== undefined) finding.visibleBox = parseBox(raw.visibleBox, `${path}.visibleBox`);
  const position = optionalStr(raw.position);
  if (position) finding.position = position;
  if (typeof raw.transformed === "boolean") finding.transformed = raw.transformed;
  if (typeof raw.invisible === "boolean") finding.invisible = raw.invisible;
  const matches = optionalNum(raw.selectorMatches);
  if (matches !== undefined) finding.selectorMatches = matches;
  const clipping = parseClipping(raw.clipping, `${path}.clipping`);
  if (clipping) finding.clipping = clipping;
  if (raw.pattern === "horizontal-track") finding.pattern = "horizontal-track";
  if (raw.related !== undefined) finding.related = parseRelated(raw.related, `${path}.related`);
  const relatedCount = optionalNum(raw.relatedCount);
  if (relatedCount !== undefined) finding.relatedCount = relatedCount;
  return finding;
}

function parseInspectorComputed(raw: unknown, path: string): InspectorElementNode["computed"] {
  if (!isObject(raw)) throw new ReportValidationError(`${path} must be an object.`);
  const out: InspectorElementNode["computed"] = {};
  for (const k of INSPECTOR_COMPUTED_STYLE_KEYS) {
    const v = raw[k];
    if (typeof v === "string" && v.length > 0) (out as Record<string, string>)[k] = v.slice(0, 2000);
  }
  return out;
}

function parseInspectorElement(raw: unknown, path: string): InspectorElementNode {
  if (!isObject(raw)) throw new ReportValidationError(`${path} must be an object.`);
  const ids = raw.relatedFindingIds;
  const relatedFindingIds = Array.isArray(ids)
    ? ids.filter((x): x is string => typeof x === "string").map((s) => s.slice(0, 500))
    : [];
  return {
    id: str(raw.id, `${path}.id`),
    tagName: str(raw.tagName, `${path}.tagName`).toLowerCase(),
    selector: str(raw.selector, `${path}.selector`).slice(0, 2000),
    selectorMatches: num(raw.selectorMatches, `${path}.selectorMatches`),
    parentId: raw.parentId === null ? null : typeof raw.parentId === "string" ? raw.parentId : null,
    depth: num(raw.depth, `${path}.depth`),
    boundingBox: parseBox(raw.boundingBox, `${path}.boundingBox`),
    visibleBox: parseBox(raw.visibleBox, `${path}.visibleBox`),
    scrollWidth: num(raw.scrollWidth, `${path}.scrollWidth`),
    scrollHeight: num(raw.scrollHeight, `${path}.scrollHeight`),
    clientWidth: num(raw.clientWidth, `${path}.clientWidth`),
    clientHeight: num(raw.clientHeight, `${path}.clientHeight`),
    computed: parseInspectorComputed(raw.computed, `${path}.computed`),
    relatedFindingIds,
  };
}

const NAVIGATION_QUALITIES = ["trusted", "http_error", "network_error", "challenge_uncertain"] as const;
const NAVIGATION_KINDS = ["ok", "redirect", "client_error", "server_error", "network_error"] as const;

function parseScanNavigation(raw: unknown, path: string): ScanNavigation {
  if (!isObject(raw)) throw new ReportValidationError(`${path} must be an object.`);
  const redirectChain = Array.isArray(raw.redirectChain)
    ? raw.redirectChain.filter((x): x is string => typeof x === "string").map((s) => s.slice(0, 2000))
    : [];
  const httpStatus = raw.httpStatus === null ? null : optionalNum(raw.httpStatus);
  const kind = str(raw.kind, `${path}.kind`);
  if (!(NAVIGATION_KINDS as readonly string[]).includes(kind)) {
    throw new ReportValidationError(`${path}.kind is invalid.`);
  }
  const out: ScanNavigation = {
    requestedUrl: str(raw.requestedUrl, `${path}.requestedUrl`).slice(0, 2000),
    finalUrl: str(raw.finalUrl, `${path}.finalUrl`).slice(0, 2000),
    httpStatus: httpStatus === undefined ? null : httpStatus,
    redirectChain,
    responseOk: raw.responseOk === true,
    documentLoaded: raw.documentLoaded === true,
    kind: kind as ScanNavigation["kind"],
  };
  const message = optionalStr(raw.message);
  if (message !== undefined) out.message = message.slice(0, 500);
  if (raw.challengePageLikely === true) {
    out.challengePageLikely = true;
    const sig = raw.challengeSignals;
    if (Array.isArray(sig)) {
      out.challengeSignals = sig.filter((x): x is string => typeof x === "string").map((s) => s.slice(0, 120));
    }
  }
  return out;
}

function parseInspectorSnapshot(raw: unknown, path: string): InspectorSnapshot {
  if (!isObject(raw)) throw new ReportValidationError(`${path} must be an object.`);
  const meta = raw.meta;
  if (!isObject(meta)) throw new ReportValidationError(`${path}.meta must be an object.`);
  if (!Array.isArray(raw.elements)) throw new ReportValidationError(`${path}.elements must be an array.`);
  const v = num(meta.version, `${path}.meta.version`);
  if (v !== INSPECTOR_SNAPSHOT_VERSION) {
    throw new ReportValidationError(`${path}.meta.version must be ${INSPECTOR_SNAPSHOT_VERSION}.`);
  }
  const snap: InspectorSnapshot = {
    meta: {
      version: INSPECTOR_SNAPSHOT_VERSION,
      elementCount: num(meta.elementCount, `${path}.meta.elementCount`),
      devicePixelRatio: num(meta.devicePixelRatio, `${path}.meta.devicePixelRatio`),
      viewportWidth: num(meta.viewportWidth, `${path}.meta.viewportWidth`),
      viewportHeight: num(meta.viewportHeight, `${path}.meta.viewportHeight`),
      collectionDurationMs: num(meta.collectionDurationMs, `${path}.meta.collectionDurationMs`),
      truncated: meta.truncated === true,
      elementsOmitted: num(meta.elementsOmitted, `${path}.meta.elementsOmitted`),
      maxDepth: num(meta.maxDepth, `${path}.meta.maxDepth`),
      maxElements: num(meta.maxElements, `${path}.meta.maxElements`),
      maxSelectorLength: num(meta.maxSelectorLength, `${path}.meta.maxSelectorLength`),
    },
    elements: raw.elements.map((e, i) => parseInspectorElement(e, `${path}.elements[${i}]`)),
  };
  if (raw.hitTest !== undefined && isObject(raw.hitTest)) {
    const ht = raw.hitTest;
    const samples = ht.samples;
    if (typeof ht.stepPx === "number" && Array.isArray(samples)) {
      snap.hitTest = {
        stepPx: num(ht.stepPx, `${path}.hitTest.stepPx`),
        samples: samples.map((s, i) => {
          if (!isObject(s)) throw new ReportValidationError(`${path}.hitTest.samples[${i}] must be an object.`);
          const topIds = Array.isArray(s.topIds)
            ? s.topIds.filter((x): x is string => typeof x === "string").map((t) => t.slice(0, 64))
            : [];
          return {
            x: num(s.x, `${path}.hitTest.samples[${i}].x`),
            y: num(s.y, `${path}.hitTest.samples[${i}].y`),
            topIds,
          };
        }),
      };
    }
  }
  return snap;
}

function parseExcluded(raw: unknown, path: string): ExcludedFinding[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((e, i) => {
    const p = `${path}[${i}]`;
    if (!isObject(e)) throw new ReportValidationError(`${p} must be an object.`);
    if (typeof e.reason !== "string" || !(EXCLUSION_REASONS as readonly string[]).includes(e.reason)) {
      throw new ReportValidationError(`${p}.reason is invalid.`);
    }
    const out: ExcludedFinding = {
      reason: e.reason as ExclusionReason,
      explanation: str(e.explanation, `${p}.explanation`),
      selector: str(e.selector, `${p}.selector`),
      tagName: str(e.tagName, `${p}.tagName`),
      boundingBox: parseBox(e.boundingBox, `${p}.boundingBox`),
      elementCount: num(e.elementCount, `${p}.elementCount`),
      samples: parseRelated(e.samples, `${p}.samples`),
    };
    const clipping = parseClipping(e.clipping, `${p}.clipping`);
    if (clipping) out.clipping = clipping;
    return out;
  });
}

function parseAdvancedAnalysis(raw: unknown, path: string): AdvancedViewportAnalysis | undefined {
  if (!isObject(raw)) return undefined;
  const n = (k: keyof AdvancedViewportAnalysis) => num(raw[k], `${path}.${String(k)}`);
  return {
    elementsInspected: n("elementsInspected"),
    candidateCount: n("candidateCount"),
    candidateLimit: n("candidateLimit"),
    candidatesOmitted: n("candidatesOmitted"),
    findingLimit: n("findingLimit"),
    findingsOmitted: n("findingsOmitted"),
  };
}

function parseAnalysis(raw: unknown, path: string): ViewportAnalysis | undefined {
  if (!isObject(raw)) return undefined;
  const n = (k: keyof ViewportAnalysis) => num(raw[k], `${path}.${k}`);
  return {
    elementsInspected: n("elementsInspected"),
    candidateCount: n("candidateCount"),
    candidateLimit: n("candidateLimit"),
    candidatesOmitted: n("candidatesOmitted"),
    rootOverflowX: str(raw.rootOverflowX, `${path}.rootOverflowX`),
    userScrollable: raw.userScrollable === true,
    maskedOverflowPx: n("maskedOverflowPx"),
    unattributedOverflowPx: n("unattributedOverflowPx"),
    findingLimit: n("findingLimit"),
    findingsOmitted: n("findingsOmitted"),
    excludedLimit: n("excludedLimit"),
    excludedOmitted: n("excludedOmitted"),
    relatedLimit: n("relatedLimit"),
  };
}

function parseVisual(raw: unknown, path: string): JsonReportVisualCompare | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) throw new ReportValidationError(`${path} must be an object.`);
  const status = raw.status;
  if (typeof status !== "string" || !(VISUAL_STATUSES as readonly string[]).includes(status)) {
    throw new ReportValidationError(`${path}.status is invalid.`);
  }
  const out: JsonReportVisualCompare = {
    status: status as JsonReportVisualCompare["status"],
    diffPixels: num(raw.diffPixels, `${path}.diffPixels`),
    diffPixelRatio: num(raw.diffPixelRatio, `${path}.diffPixelRatio`),
  };
  const baseline = optionalStr(raw.baselineScreenshot);
  const diff = optionalStr(raw.diffScreenshot);
  if (baseline) out.baselineScreenshot = baseline;
  if (diff) out.diffScreenshot = diff;
  return out;
}

function parseAdvancedFinding(raw: unknown, path: string): JsonReportAdvancedFinding {
  if (!isObject(raw)) throw new ReportValidationError(`${path} must be an object.`);
  const category = raw.category;
  if (
    typeof category !== "string" ||
    !(ADVANCED_FINDING_CATEGORIES as readonly string[]).includes(category)
  ) {
    throw new ReportValidationError(`${path}.category is invalid.`);
  }
  const classification = raw.classification;
  if (
    typeof classification !== "string" ||
    !(FINDING_CLASSIFICATIONS as readonly string[]).includes(classification)
  ) {
    throw new ReportValidationError(`${path}.classification is invalid.`);
  }
  const severity = raw.severity;
  if (typeof severity !== "string" || !SEVERITIES.includes(severity as FindingSeverity)) {
    throw new ReportValidationError(`${path}.severity is invalid.`);
  }
  const out: JsonReportAdvancedFinding = {
    id: str(raw.id, `${path}.id`),
    category: category as AdvancedFindingCategory,
    selector: str(raw.selector, `${path}.selector`),
    tagName: str(raw.tagName, `${path}.tagName`),
    severity: severity as FindingSeverity,
    classification: classification as FindingClassification,
    reason: str(raw.reason, `${path}.reason`),
    guidance: str(raw.guidance, `${path}.guidance`),
    boundingBox: parseBox(raw.boundingBox, `${path}.boundingBox`),
  };
  const sm = optionalNum(raw.selectorMatches);
  if (sm !== undefined) out.selectorMatches = sm;
  if (raw.visibleBox === null) out.visibleBox = null;
  else if (raw.visibleBox !== undefined) {
    out.visibleBox = parseBox(raw.visibleBox, `${path}.visibleBox`);
  }
  if (typeof raw.invisible === "boolean") out.invisible = raw.invisible;
  const clipping = parseClipping(raw.clipping, `${path}.clipping`);
  if (clipping) out.clipping = clipping;
  if (raw.overlap !== undefined) out.overlap = parseOverlap(raw.overlap, `${path}.overlap`);
  if (raw.textClip !== undefined && isObject(raw.textClip)) {
    const t = raw.textClip;
    out.textClip = {
      scrollWidth: num(t.scrollWidth, `${path}.textClip.scrollWidth`),
      clientWidth: num(t.clientWidth, `${path}.textClip.clientWidth`),
      scrollHeight: num(t.scrollHeight, `${path}.textClip.scrollHeight`),
      clientHeight: num(t.clientHeight, `${path}.textClip.clientHeight`),
      overflowX: str(t.overflowX, `${path}.textClip.overflowX`),
      overflowY: str(t.overflowY, `${path}.textClip.overflowY`),
      whiteSpace: str(t.whiteSpace, `${path}.textClip.whiteSpace`),
      textOverflow: str(t.textOverflow, `${path}.textClip.textOverflow`),
      lineClamp: typeof t.lineClamp === "number" && Number.isFinite(t.lineClamp) ? t.lineClamp : null,
      intentional: t.intentional === true,
    };
    const fs = optionalNum(t.fontSizePx);
    if (fs !== undefined) out.textClip.fontSizePx = fs;
    const lhp = optionalNum(t.lineHeightPx);
    if (lhp !== undefined) out.textClip.lineHeightPx = lhp;
  }
  if (raw.offscreenControl !== undefined && isObject(raw.offscreenControl)) {
    const o = raw.offscreenControl;
    out.offscreenControl = {
      role: typeof o.role === "string" ? o.role : null,
      disabled: o.disabled === true,
      tabIndex: typeof o.tabIndex === "number" && Number.isFinite(o.tabIndex) ? o.tabIndex : null,
      horizontalOutside: o.horizontalOutside === true,
      notVisibleInViewport: o.notVisibleInViewport === true,
    };
    if (typeof o.verticalIntersectsViewport === "boolean") out.offscreenControl.verticalIntersectsViewport = o.verticalIntersectsViewport;
    if (typeof o.belowTheFold === "boolean") out.offscreenControl.belowTheFold = o.belowTheFold;
    if (typeof o.intentionallyHidden === "boolean") out.offscreenControl.intentionallyHidden = o.intentionallyHidden;
  }
  if (raw.touchTarget !== undefined && isObject(raw.touchTarget)) {
    const t = raw.touchTarget;
    out.touchTarget = {
      hitWidth: num(t.hitWidth, `${path}.touchTarget.hitWidth`),
      hitHeight: num(t.hitHeight, `${path}.touchTarget.hitHeight`),
      minSizePx: num(t.minSizePx, `${path}.touchTarget.minSizePx`),
      spacingToNearestPx:
        t.spacingToNearestPx === null ? null : num(t.spacingToNearestPx, `${path}.touchTarget.spacingToNearestPx`),
      rule: str(t.rule, `${path}.touchTarget.rule`),
      disabled: t.disabled === true,
    };
  }
  const related = parseAdvancedRelated(raw.related, `${path}.related`);
  if (related) out.related = related;
  const rc = optionalNum(raw.relatedCount);
  if (rc !== undefined) out.relatedCount = rc;
  const gk = optionalStr(raw.groupKey);
  if (gk !== undefined) out.groupKey = gk;
  return out;
}

function parseViewport(raw: unknown, index: number): JsonReportViewport {
  const path = `viewports[${index}]`;
  if (!isObject(raw)) throw new ReportValidationError(`${path} must be an object.`);
  if (!Array.isArray(raw.findings)) {
    throw new ReportValidationError(`${path}.findings must be an array.`);
  }
  const vp: JsonReportViewport = {
    width: num(raw.width, `${path}.width`),
    label: str(raw.label, `${path}.label`),
    viewportHeight: num(raw.viewportHeight, `${path}.viewportHeight`),
    documentScrollWidth: num(raw.documentScrollWidth, `${path}.documentScrollWidth`),
    documentClientWidth: num(raw.documentClientWidth, `${path}.documentClientWidth`),
    hasHorizontalOverflow: raw.hasHorizontalOverflow === true,
    overflowPx: num(raw.overflowPx, `${path}.overflowPx`),
    findings: raw.findings.map((f, i) => parseFinding(f, `${path}.findings[${i}]`)),
  };
  if (typeof raw.inspectionStatus === "string" && (VIEWPORT_INSPECTION_STATUSES as readonly string[]).includes(raw.inspectionStatus)) {
    vp.inspectionStatus = raw.inspectionStatus as JsonReportViewport["inspectionStatus"];
  }
  const ins = parseViewportInspectionDiagnostics(raw.inspection, `${path}.inspection`);
  if (ins) vp.inspection = ins;
  const ierr = parseViewportInspectionError(raw.inspectionError, `${path}.inspectionError`);
  if (ierr) vp.inspectionError = ierr;
  const excluded = parseExcluded(raw.excluded, `${path}.excluded`);
  if (excluded) vp.excluded = excluded;
  if (Array.isArray(raw.advancedFindings)) {
    vp.advancedFindings = raw.advancedFindings.map((f, i) =>
      parseAdvancedFinding(f, `${path}.advancedFindings[${i}]`),
    );
  }
  const advA = parseAdvancedAnalysis(raw.advancedAnalysis, `${path}.advancedAnalysis`);
  if (advA) vp.advancedAnalysis = advA;
  const analysis = parseAnalysis(raw.analysis, `${path}.analysis`);
  if (analysis) vp.analysis = analysis;
  const screenshot = optionalStr(raw.screenshot);
  if (screenshot) vp.screenshot = screenshot;
  const visual = parseVisual(raw.visualCompare, `${path}.visualCompare`);
  if (visual) vp.visualCompare = visual;
  if (raw.inspector !== undefined) vp.inspector = parseInspectorSnapshot(raw.inspector, `${path}.inspector`);
  return vp;
}

/** Validate an untrusted `report.json` payload produced by the LayoutLens CLI. */
export function parseLayoutLensReport(input: unknown): JsonReport {
  if (!isObject(input)) throw new ReportValidationError("Report must be a JSON object.");
  if (input.tool !== "layoutlens") {
    throw new ReportValidationError('Not a LayoutLens report (missing tool: "layoutlens").');
  }
  const sv = input.schemaVersion;
  if (sv !== "1.0" && sv !== "1.1" && sv !== "1.2" && sv !== "1.3" && sv !== REPORT_SCHEMA_VERSION) {
    throw new ReportValidationError(
      `Unsupported report schema version: ${String(input.schemaVersion)}.`,
    );
  }
  if (!Array.isArray(input.viewports)) {
    throw new ReportValidationError("Report has no viewports array.");
  }
  const summary = input.summary;
  if (!isObject(summary) || !isObject(summary.bySeverity)) {
    throw new ReportValidationError("Report summary is missing.");
  }
  const schemaVersion =
    input.schemaVersion === "1.0"
      ? "1.0"
      : input.schemaVersion === "1.1"
        ? "1.1"
        : input.schemaVersion === "1.2"
          ? "1.2"
          : input.schemaVersion === "1.3"
            ? "1.3"
            : REPORT_SCHEMA_VERSION;
  const report: JsonReport = {
    schemaVersion,
    tool: "layoutlens",
    url: str(input.url, "url"),
    scannedAt: str(input.scannedAt, "scannedAt"),
    summary: {
      viewportIssueCount: num(summary.viewportIssueCount, "summary.viewportIssueCount"),
      findingCount: num(summary.findingCount, "summary.findingCount"),
      bySeverity: {
        high: num(summary.bySeverity.high, "summary.bySeverity.high"),
        medium: num(summary.bySeverity.medium, "summary.bySeverity.medium"),
        low: num(summary.bySeverity.low, "summary.bySeverity.low"),
      },
    },
    viewports: input.viewports.map(parseViewport),
  };
  if (typeof summary.visualFailures === "number") {
    report.summary.visualFailures = summary.visualFailures;
  }
  const cls = summary.byClassification;
  if (isObject(cls)) {
    report.summary.byClassification = {
      confirmed: num(cls.confirmed, "summary.byClassification.confirmed"),
      potential: num(cls.potential, "summary.byClassification.potential"),
      insufficientEvidence: num(cls.insufficientEvidence, "summary.byClassification.insufficientEvidence"),
    };
  }
  const excludedCount = optionalNum(summary.excludedCount);
  if (excludedCount !== undefined) report.summary.excludedCount = excludedCount;
  if (typeof summary.truncated === "boolean") report.summary.truncated = summary.truncated;
  const advCount = optionalNum(summary.advancedFindingCount);
  if (advCount !== undefined) report.summary.advancedFindingCount = advCount;
  if (typeof summary.advancedTruncated === "boolean") report.summary.advancedTruncated = summary.advancedTruncated;
  const byAdv = summary.byAdvancedCategory;
  if (isObject(byAdv)) {
    report.summary.byAdvancedCategory = {
      overlap: num(byAdv.overlap, "summary.byAdvancedCategory.overlap"),
      textClipping: num(byAdv.textClipping, "summary.byAdvancedCategory.textClipping"),
      offscreenControl: num(byAdv.offscreenControl, "summary.byAdvancedCategory.offscreenControl"),
      touchTarget: num(byAdv.touchTarget, "summary.byAdvancedCategory.touchTarget"),
    };
  }
  const vic = optionalNum(summary.viewportInspectionCompleteCount);
  if (vic !== undefined) report.summary.viewportInspectionCompleteCount = vic;
  const vif = optionalNum(summary.viewportInspectionFailedCount);
  if (vif !== undefined) report.summary.viewportInspectionFailedCount = vif;
  const visk = optionalNum(summary.viewportInspectionSkippedCount);
  if (visk !== undefined) report.summary.viewportInspectionSkippedCount = visk;
  if (typeof summary.scanCompletionStatus === "string" && (SCAN_COMPLETION_STATUSES as readonly string[]).includes(summary.scanCompletionStatus)) {
    report.summary.scanCompletionStatus = summary.scanCompletionStatus as NonNullable<JsonReport["summary"]["scanCompletionStatus"]>;
  }
  if (Array.isArray(summary.viewportOutcomes)) {
    report.summary.viewportOutcomes = summary.viewportOutcomes.map((vo, i) => {
      const p = `summary.viewportOutcomes[${i}]`;
      if (!isObject(vo)) throw new ReportValidationError(`${p} must be an object.`);
      const st = str(vo.status, `${p}.status`);
      if (!(VIEWPORT_INSPECTION_STATUSES as readonly string[]).includes(st)) {
        throw new ReportValidationError(`${p}.status is invalid.`);
      }
      const row: NonNullable<JsonReport["summary"]["viewportOutcomes"]>[number] = {
        width: num(vo.width, `${p}.width`),
        label: str(vo.label, `${p}.label`),
        status: st as NonNullable<JsonReport["summary"]["viewportOutcomes"]>[number]["status"],
      };
      const om = optionalStr(vo.message);
      if (om !== undefined) row.message = om.slice(0, 500);
      return row;
    });
  }
  const topNav = input.navigation !== undefined ? parseScanNavigation(input.navigation, "navigation") : undefined;
  const summaryNav =
    isObject(summary) && summary.navigation !== undefined
      ? parseScanNavigation(summary.navigation, "summary.navigation")
      : undefined;
  const nav = topNav ?? summaryNav;
  if (nav) {
    report.navigation = nav;
    report.summary.navigation = nav;
  }
  const st = summary.scanTrust;
  if (typeof st === "string" && (NAVIGATION_QUALITIES as readonly string[]).includes(st)) {
    report.summary.scanTrust = st as NavigationQuality;
  } else if (nav) {
    report.summary.scanTrust = navigationQuality(nav);
  }
  const navDiag = parseNavigationDiagnostics(input.navigationDiagnostics, "navigationDiagnostics");
  if (navDiag) {
    report.navigationDiagnostics = navDiag;
  }
  return report;
}

/** Only bundle-relative paths are resolvable; anything else is rejected. */
export function normalizeAssetPath(path: string): string | null {
  const trimmed = path.trim().replace(/\\/g, "/");
  if (trimmed.length === 0) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }
  const segments = trimmed.split("/").filter((s) => s.length > 0 && s !== ".");
  if (segments.some((s) => s === "..")) return null;
  return segments.join("/");
}
