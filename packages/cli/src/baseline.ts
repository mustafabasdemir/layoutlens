import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { createBaseline, updateBaseline } from "@layoutlens/core";

export function registerBaselineCommands(program: Command): void {
  const baseline = program
    .command("baseline")
    .description("Manage visual regression screenshot baselines");

  baseline
    .command("create")
    .description("Capture and write a new baseline manifest (explicit create)")
    .argument("<url>", "Page URL")
    .requiredOption(
      "-b, --baseline-dir <path>",
      "Directory to store manifest and screenshots",
    )
    .option("--no-headless", "Show browser window")
    .option("-H, --height <pixels>", "Viewport height", (v) => parseInt(v, 10), 844)
    .option(
      "-c, --visual-config <path>",
      "JSON file with thresholds, masks, and stability settings",
    )
    .option("--force", "Overwrite an existing baseline directory contents")
    .action(async (url: string, options) => {
      try {
        const visualConfig = options.visualConfig
          ? JSON.parse(await readFile(options.visualConfig, "utf8"))
          : undefined;
        const manifest = await createBaseline({
          url,
          baselineDirectory: options.baselineDir,
          viewportHeight: options.height,
          headless: options.headless,
          visualConfig,
          force: options.force,
        });
        process.stderr.write(
          `Baseline created (${manifest.entries.length} screenshots) at ${options.baselineDir}\n`,
        );
        process.exit(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`layoutlens: ${message}\n`);
        process.exit(2);
      }
    });

  baseline
    .command("update")
    .description("Safely refresh baselines when URL matches manifest (or --force)")
    .argument("<url>", "Page URL")
    .requiredOption("-b, --baseline-dir <path>", "Baseline directory")
    .option("--no-headless", "Show browser window")
    .option("-H, --height <pixels>", "Viewport height", (v) => parseInt(v, 10), 844)
    .option("-c, --visual-config <path>", "JSON visual config file")
    .option("--force", "Allow updating when URL key differs")
    .action(async (url: string, options) => {
      try {
        const visualConfig = options.visualConfig
          ? JSON.parse(await readFile(options.visualConfig, "utf8"))
          : undefined;
        const manifest = await updateBaseline({
          url,
          baselineDirectory: options.baselineDir,
          viewportHeight: options.height,
          headless: options.headless,
          visualConfig,
          force: options.force,
        });
        process.stderr.write(
          `Baseline updated at ${options.baselineDir} (${manifest.updatedAt})\n`,
        );
        process.exit(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`layoutlens: ${message}\n`);
        process.exit(2);
      }
    });
}
