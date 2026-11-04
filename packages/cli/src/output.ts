import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ScanResult } from "@layoutlens/shared";
import { serializeJsonReport } from "@layoutlens/shared";
import {
  resolveHtmlReportDirectory,
  writeHtmlReportBundle,
} from "@layoutlens/report";
import { exitCodeForResult, formatScanResult } from "./format.js";

export type OutputFormat = "text" | "json" | "html";

export interface EmitScanResultOptions {
  format: OutputFormat;
  outputPath?: string | undefined;
}

export function renderScanOutput(
  result: ScanResult,
  format: OutputFormat,
): string {
  if (format === "json") {
    return serializeJsonReport(result);
  }
  if (format === "html") {
    throw new Error("HTML reports must be written via emitScanResult to a directory");
  }
  return formatScanResult(result);
}

export async function emitScanResult(
  result: ScanResult,
  options: EmitScanResultOptions,
): Promise<number> {
  if (options.format === "html") {
    if (!options.outputPath) {
      throw new Error("HTML format requires --output <directory>");
    }
    const directory = resolveHtmlReportDirectory(options.outputPath);
    const { indexPath } = await writeHtmlReportBundle(result, directory);
    process.stderr.write(`HTML report: ${indexPath}\n`);
    return exitCodeForResult(result);
  }

  const body = renderScanOutput(result, options.format);

  if (options.outputPath) {
    await mkdir(dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, body, "utf8");
    if (options.format === "text") {
      process.stderr.write(`Report written to ${options.outputPath}\n`);
    }
  } else {
    process.stdout.write(body);
  }

  return exitCodeForResult(result);
}

export function resolveScanArtifactsDirectory(
  format: OutputFormat,
  outputPath: string | undefined,
): string | undefined {
  if (format !== "html" || !outputPath) {
    return undefined;
  }
  return resolveHtmlReportDirectory(outputPath);
}
