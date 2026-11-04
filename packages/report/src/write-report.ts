import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  scanResultToJsonReport,
  serializeJsonReport,
  type ScanResult,
} from "@layoutlens/shared";
import { buildHtmlReportDocument } from "./build-html.js";

export const HTML_REPORT_INDEX = "index.html" as const;
export const HTML_REPORT_JSON = "report.json" as const;

/** Resolve CLI --output to a directory for HTML bundles. */
export function resolveHtmlReportDirectory(outputPath: string): string {
  const normalized = outputPath.replace(/[\\/]+$/, "");
  if (normalized.toLowerCase().endsWith(".html")) {
    const idx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
    return idx >= 0 ? normalized.slice(0, idx) : ".";
  }
  return normalized;
}

export async function writeHtmlReportBundle(
  result: ScanResult,
  outputDirectory: string,
): Promise<{ indexPath: string; jsonPath: string }> {
  await mkdir(outputDirectory, { recursive: true });
  const report = scanResultToJsonReport(result);
  const jsonPath = join(outputDirectory, HTML_REPORT_JSON);
  await writeFile(jsonPath, serializeJsonReport(result), "utf8");

  const html = buildHtmlReportDocument(report);
  const indexPath = join(outputDirectory, HTML_REPORT_INDEX);
  await writeFile(indexPath, html, "utf8");

  return { indexPath, jsonPath };
}

export function assertOfflineHtml(html: string): void {
  const external = html.match(/\b(?:src|href)\s*=\s*["']https?:/i);
  if (external) {
    throw new Error("HTML report must not reference external URLs for offline use");
  }
}
