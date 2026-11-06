import {
  ADVANCED_CATEGORY_LABELS,
  CLASSIFICATION_LABELS,
  EXCLUSION_LABELS,
  navigationBannerMessage,
  type AdvancedFinding,
  type OverflowFinding,
  type ScanResult,
  type ViewportScanResult,
} from "@layoutlens/shared";

const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const DIM = "\u001b[2m";

function statusIcon(ok: boolean): string {
  return ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
}

function severityLabel(severity: OverflowFinding["severity"]): string {
  switch (severity) {
    case "high":
      return `${RED}HIGH${RESET}`;
    case "medium":
      return `${YELLOW}MED${RESET}`;
    case "low":
      return `${DIM}LOW${RESET}`;
  }
}

const MAX_LISTED = 5;

function formatFinding(el: OverflowFinding): string {
  const cls = CLASSIFICATION_LABELS[el.classification].toUpperCase();
  const impact =
    el.classification === "confirmed"
      ? `+${el.scrollContributionPx}px page width`
      : `${el.documentContributionPx}px past edge`;
  const related = el.relatedCount > 0 ? `, +${el.relatedCount} related element${el.relatedCount === 1 ? "" : "s"}` : "";
  return `      • [${severityLabel(el.severity)}] ${cls} ${el.selector} (${impact}, box ${el.boundingBox.width}×${el.boundingBox.height}${related})`;
}

function formatAdvancedFinding(f: AdvancedFinding): string {
  const cls = CLASSIFICATION_LABELS[f.classification].toUpperCase();
  const cat = ADVANCED_CATEGORY_LABELS[f.category];
  return `      • [${severityLabel(f.severity)}] ${cls} ${cat}: ${f.selector}`;
}

function formatViewportBlock(v: ViewportScanResult): string[] {
  const lines: string[] = [];
  const header = `${BOLD}${v.width}px (${v.label})${RESET}`;
  const a = v.analysis;
  if (!v.hasHorizontalOverflow) {
    lines.push(`  ${statusIcon(true)} ${header} — no horizontal overflow`);
  } else if (!a.userScrollable && a.maskedOverflowPx > 0) {
    lines.push(
      `  ${statusIcon(false)} ${header} — ${YELLOW}${v.overflowPx}px${RESET} overflow hidden by overflow-x: ${a.rootOverflowX} on html/body (users cannot scroll to it)`,
    );
  } else {
    lines.push(
      `  ${statusIcon(false)} ${header} — document overflow ${YELLOW}${v.overflowPx}px${RESET}`,
    );
    lines.push(
      `    ${DIM}scroll ${v.documentScrollWidth}px / client ${v.documentClientWidth}px${RESET}`,
    );
  }

  if (v.findings.length > 0) {
    lines.push(`    ${DIM}Findings (responsible elements):${RESET}`);
    for (const el of v.findings.slice(0, MAX_LISTED)) lines.push(formatFinding(el));
    if (v.findings.length > MAX_LISTED) {
      lines.push(`      ${DIM}… and ${v.findings.length - MAX_LISTED} more in the JSON/HTML report${RESET}`);
    }
  }
  if (a.findingsOmitted > 0) {
    lines.push(
      `    ${YELLOW}Truncated: ${a.findingsOmitted} more finding group(s) beyond the ${a.findingLimit}-group limit are not in the report.${RESET}`,
    );
  }
  if (a.candidatesOmitted > 0) {
    lines.push(
      `    ${YELLOW}Truncated: ${a.candidatesOmitted} edge-crossing element(s) beyond the ${a.candidateLimit}-element limit were not analysed.${RESET}`,
    );
  }
  if (a.unattributedOverflowPx > 0) {
    lines.push(
      `    ${YELLOW}${a.unattributedOverflowPx}px of document overflow could not be attributed to a measured element.${RESET}`,
    );
  }
  if (v.excluded.length > 0) {
    const elements = v.excluded.reduce((n, e) => n + e.elementCount, 0);
    lines.push(
      `    ${DIM}Excluded as intentional: ${elements} element(s) in ${v.excluded.length} group(s)${a.excludedOmitted > 0 ? ` (+${a.excludedOmitted} group(s) over the limit)` : ""}${RESET}`,
    );
    for (const e of v.excluded.slice(0, 3)) {
      const where = (e.clipping?.selectorMatches ?? 1) > 1 ? ` at y=${Math.round(e.boundingBox.y)}` : "";
      lines.push(`      ${DIM}◦ ${EXCLUSION_LABELS[e.reason]}: ${e.selector}${where} (${e.elementCount})${RESET}`);
    }
  }

  const adv = v.advancedFindings ?? [];
  const aa = v.advancedAnalysis;
  if (adv.length > 0) {
    lines.push(`    ${DIM}Responsive findings:${RESET}`);
    for (const f of adv.slice(0, MAX_LISTED)) lines.push(formatAdvancedFinding(f));
    if (adv.length > MAX_LISTED) {
      lines.push(`      ${DIM}… and ${adv.length - MAX_LISTED} more advanced finding(s) in the report${RESET}`);
    }
  }
  if (aa && aa.findingsOmitted > 0) {
    lines.push(
      `    ${YELLOW}Truncated: ${aa.findingsOmitted} responsive finding(s) beyond the ${aa.findingLimit}-finding limit.${RESET}`,
    );
  }

  return lines;
}

export function formatScanResult(result: ScanResult): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`${BOLD}LayoutLens scan${RESET}`);
  lines.push(`${DIM}URL:${RESET} ${result.url}`);
  lines.push(`${DIM}Time:${RESET} ${result.scannedAt}`);
  const nav = result.navigation ?? result.summary.navigation;
  if (nav) {
    lines.push(`${DIM}Navigation:${RESET} final ${nav.finalUrl}`);
    if (nav.httpStatus !== null) lines.push(`${DIM}HTTP status:${RESET} ${nav.httpStatus}`);
    if (nav.redirectChain.length > 0) {
      lines.push(`${DIM}Redirects:${RESET} ${nav.redirectChain.length} hop(s)`);
    }
    const banner = navigationBannerMessage(nav);
    if (banner) lines.push(`${YELLOW}${banner}${RESET}`);
  }
  const s = result.summary;
  if (s.scanCompletionStatus === "partial" || s.scanCompletionStatus === "failed") {
    lines.push(
      `${YELLOW}Scan ${s.scanCompletionStatus}: ${s.viewportInspectionCompleteCount ?? 0}/${result.viewports.length} viewport(s) inspected successfully.${RESET}`,
    );
    if (s.viewportOutcomes?.length) {
      for (const o of s.viewportOutcomes) {
        const extra = o.message ? ` — ${o.message}` : "";
        lines.push(`  ${DIM}${o.label} (${o.width}px):${RESET} ${o.status}${extra}`);
      }
    }
  }
  lines.push(
    `${DIM}Findings:${RESET} ${s.findingCount} (${s.byClassification.confirmed} confirmed, ${s.byClassification.potential} potential, ${s.byClassification.insufficientEvidence} insufficient evidence; ${s.bySeverity.high} high, ${s.bySeverity.medium} med, ${s.bySeverity.low} low)`,
  );
  lines.push(`${DIM}Excluded as intentional:${RESET} ${s.excludedCount} group(s)`);
  if (s.advancedFindingCount !== undefined && s.advancedFindingCount > 0) {
    const c = s.byAdvancedCategory;
    lines.push(
      `${DIM}Responsive (advisory):${RESET} ${s.advancedFindingCount} (${c?.overlap ?? 0} overlap, ${c?.textClipping ?? 0} text, ${c?.offscreenControl ?? 0} offscreen, ${c?.touchTarget ?? 0} touch) — does not change exit code`,
    );
  }
  if (s.truncated) {
    lines.push(`${YELLOW}Results are truncated — see the per-viewport notes below.${RESET}`);
  }
  if (result.visual) {
    lines.push(
      `${DIM}Visual regression:${RESET} ${result.visual.passedCount} passed, ${RED}${result.visual.failedCount} failed${RESET}`,
    );
    for (const cmp of result.visual.comparisons) {
      const icon = cmp.status === "pass" ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
      lines.push(
        `  ${icon} ${cmp.width}px — ${cmp.status}${cmp.status === "fail" ? ` (${cmp.diffPixels} px diff)` : ""}`,
      );
    }
  }
  lines.push("");

  const navForCli = result.navigation ?? result.summary.navigation;
  const navFailedNoMeasure =
    navForCli &&
    !navForCli.documentLoaded &&
    result.viewports.length > 0 &&
    result.viewports.every((v) => v.analysis.elementsInspected === 0);
  if (navFailedNoMeasure) {
    lines.push(`${YELLOW}First navigation failed — layout was not measured; viewport rows below are placeholders only.${RESET}`);
  }

  for (const v of result.viewports) {
    lines.push(...formatViewportBlock(v));
  }

  lines.push("");
  const visualFailures = result.summary.visualFailures ?? 0;
  const navBlocksClean =
    navForCli && (!navForCli.documentLoaded || (navForCli.httpStatus !== null && navForCli.httpStatus >= 400));
  if (result.issueCount === 0 && visualFailures === 0 && !navBlocksClean) {
    lines.push(`${GREEN}${BOLD}No layout or visual issues detected.${RESET}`);
  } else {
    if (result.issueCount > 0) {
      lines.push(
        `${RED}${BOLD}${result.issueCount} viewport(s) with horizontal overflow.${RESET}`,
      );
    }
    if (visualFailures > 0) {
      lines.push(
        `${RED}${BOLD}${visualFailures} visual regression comparison(s) failed.${RESET}`,
      );
    }
    if (
      navBlocksClean &&
      result.issueCount === 0 &&
      visualFailures === 0 &&
      !navFailedNoMeasure
    ) {
      lines.push(
        `${YELLOW}Layout checks were skipped or unreliable because of the HTTP/navigation result above; the scan did not verify a clean layout.${RESET}`,
      );
    }
  }
  lines.push("");

  return lines.join("\n");
}

function navigationExitIssue(nav: NonNullable<ScanResult["navigation"]>): boolean {
  if (!nav.documentLoaded) return true;
  const st = nav.httpStatus;
  if (st === null) return false;
  return st === 403 || st === 404 || st === 429 || st >= 500;
}

export function exitCodeForResult(result: ScanResult): number {
  const visualFailures = result.summary.visualFailures ?? 0;
  const nav = result.navigation ?? result.summary.navigation;
  const navIssue = nav ? navigationExitIssue(nav) : false;
  const incomplete =
    result.summary.scanCompletionStatus === "partial" ||
    result.summary.scanCompletionStatus === "failed" ||
    (result.summary.viewportInspectionFailedCount ?? 0) > 0 ||
    (result.summary.viewportInspectionSkippedCount ?? 0) > 0;
  return result.issueCount > 0 || visualFailures > 0 || navIssue || incomplete ? 1 : 0;
}
