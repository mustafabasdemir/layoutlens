import {
  FINDING_CLASSIFICATIONS,
  EXCLUSION_LABELS,
  type ClippingContext,
  type ExcludedFinding,
  type ExclusionReason,
  type FindingClassification,
  type FindingSeverity,
  type JsonReport,
  type JsonReportBoundingBox,
  type JsonReportFinding,
  type JsonReportViewport,
  type JsonReportVisualCompare,
  type RelatedElement,
  type ViewportAnalysis,
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
  const excluded = parseExcluded(raw.excluded, `${path}.excluded`);
  if (excluded) vp.excluded = excluded;
  const analysis = parseAnalysis(raw.analysis, `${path}.analysis`);
  if (analysis) vp.analysis = analysis;
  const screenshot = optionalStr(raw.screenshot);
  if (screenshot) vp.screenshot = screenshot;
  const visual = parseVisual(raw.visualCompare, `${path}.visualCompare`);
  if (visual) vp.visualCompare = visual;
  return vp;
}

/** Validate an untrusted `report.json` payload produced by the LayoutLens CLI. */
export function parseLayoutLensReport(input: unknown): JsonReport {
  if (!isObject(input)) throw new ReportValidationError("Report must be a JSON object.");
  if (input.tool !== "layoutlens") {
    throw new ReportValidationError('Not a LayoutLens report (missing tool: "layoutlens").');
  }
  if (input.schemaVersion !== "1.0") {
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
  const report: JsonReport = {
    schemaVersion: "1.0",
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
