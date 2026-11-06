#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { scanUrl } from "@layoutlens/core";
import { registerBaselineCommands } from "./baseline.js";
import {
  emitScanResult,
  resolveScanArtifactsDirectory,
  type OutputFormat,
} from "./output.js";

const program = new Command();

program
  .name("layoutlens")
  .description(
    "Local-first CLI for detecting responsive layout issues in websites",
  )
  .version("0.4.0");

registerBaselineCommands(program);

const FORMATS: OutputFormat[] = ["text", "json", "html"];

program
  .command("scan")
  .description("Scan a URL at standard viewports for horizontal overflow")
  .argument("<url>", "Page URL to scan (http/https or file://)")
  .option("--no-headless", "Show the browser window while scanning")
  .option(
    "--nav-timeout-ms <ms>",
    "Playwright page.goto timeout (waitUntil: domcontentloaded)",
    (value) => parseInt(value, 10),
  )
  .option(
    "--readiness-timeout-ms <ms>",
    "Timeout for waiting for the load event after DOMContentLoaded",
    (value) => parseInt(value, 10),
  )
  .option(
    "--screenshot-timeout-ms <ms>",
    "Timeout for each viewport screenshot capture",
    (value) => parseInt(value, 10),
  )
  .option(
    "--post-load-settle-ms <ms>",
    "Bounded wait after load (or partial recovery) before measurement",
    (value) => parseInt(value, 10),
  )
  .option(
    "-H, --height <pixels>",
    "Viewport height in pixels",
    (value) => parseInt(value, 10),
    844,
  )
  .option(
    "-f, --format <format>",
    "Output format: text (default), json, or html",
    "text",
  )
  .option(
    "-o, --output <path>",
    "Output path: file for text/json, directory for html (e.g. ./layoutlens-report)",
  )
  .option(
    "-b, --baseline-dir <path>",
    "Compare screenshots against a baseline directory",
  )
  .option(
    "-c, --visual-config <path>",
    "JSON file with visual thresholds, masks, and stability settings",
  )
  .action(
    async (
      url: string,
      options: {
        headless: boolean;
        height: number;
        format: string;
        output?: string;
        baselineDir?: string;
        visualConfig?: string;
        navTimeoutMs?: number;
        readinessTimeoutMs?: number;
        screenshotTimeoutMs?: number;
        postLoadSettleMs?: number;
      },
    ) => {
      const format = options.format as OutputFormat;
      if (!FORMATS.includes(format)) {
        process.stderr.write(
          `layoutlens: invalid --format "${options.format}" (use text, json, or html)\n`,
        );
        process.exit(2);
      }

      if (format === "html" && !options.output) {
        process.stderr.write(
          "layoutlens: --format html requires --output <directory>\n",
        );
        process.exit(2);
      }

      try {
        const visualConfig = options.visualConfig
          ? JSON.parse(await readFile(options.visualConfig, "utf8"))
          : undefined;
        const artifactsDir = resolveScanArtifactsDirectory(
          format,
          options.output,
        );
        const timeouts =
          options.navTimeoutMs !== undefined ||
          options.readinessTimeoutMs !== undefined ||
          options.screenshotTimeoutMs !== undefined ||
          options.postLoadSettleMs !== undefined
            ? {
                ...(options.navTimeoutMs !== undefined ? { navigationMs: options.navTimeoutMs } : {}),
                ...(options.readinessTimeoutMs !== undefined ? { readinessMs: options.readinessTimeoutMs } : {}),
                ...(options.screenshotTimeoutMs !== undefined ? { screenshotMs: options.screenshotTimeoutMs } : {}),
                ...(options.postLoadSettleMs !== undefined ? { postLoadSettleMs: options.postLoadSettleMs } : {}),
              }
            : undefined;
        const result = await scanUrl({
          url,
          viewportHeight: options.height,
          headless: options.headless,
          visualConfig,
          ...(options.baselineDir
            ? { baselineDirectory: options.baselineDir }
            : {}),
          ...(artifactsDir
            ? {
                artifacts: {
                  directory: artifactsDir,
                  ...(options.baselineDir
                    ? { baselineDirectory: options.baselineDir }
                    : {}),
                  visualConfig,
                },
              }
            : {}),
          ...(timeouts ? { timeouts } : {}),
        });
        const exitCode = await emitScanResult(result, {
          format,
          outputPath: options.output,
        });
        process.exit(exitCode);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`layoutlens: ${message}\n`);
        process.exit(2);
      }
    },
  );

program.parse();
