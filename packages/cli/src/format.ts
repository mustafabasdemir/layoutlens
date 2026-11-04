import {
  CLASSIFICATION_LABELS,
  EXCLUSION_LABELS,
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

  return lines;
}

export function formatScanResult(result: ScanResult): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`${BOLD}LayoutLens scan${RESET}`);
  lines.push(`${DIM}URL:${RESET} ${result.url}`);
  lines.push(`${DIM}Time:${RESET} ${result.scannedAt}`);
  const s = result.summary;
  lines.push(
    `${DIM}Findings:${RESET} ${s.findingCount} (${s.byClassification.confirmed} confirmed, ${s.byClassification.potential} potential, ${s.byClassification.insufficientEvidence} insufficient evidence; ${s.bySeverity.high} high, ${s.bySeverity.medium} med, ${s.bySeverity.low} low)`,
  );
  lines.push(`${DIM}Excluded as intentional:${RESET} ${s.excludedCount} group(s)`);
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

  for (const v of result.viewports) {
    lines.push(...formatViewportBlock(v));
  }

  lines.push("");
  const visualFailures = result.summary.visualFailures ?? 0;
  if (result.issueCount === 0 && visualFailures === 0) {
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
  }
  lines.push("");

  return lines.join("\n");
}

export function exitCodeForResult(result: ScanResult): number {
  const visualFailures = result.summary.visualFailures ?? 0;
  return result.issueCount > 0 || visualFailures > 0 ? 1 : 0;
}
