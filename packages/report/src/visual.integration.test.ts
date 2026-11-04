import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBaseline, scanUrl } from "@layoutlens/core";
import { describe, expect, it } from "vitest";
import { writeHtmlReportBundle } from "./index.js";

const exampleUrl = pathToFileURL(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../examples/broken-layout/index.html",
  ),
).href;

describe("visual regression e2e", () => {
  it(
    "passes compare after baseline create; html report includes slider UI",
    async () => {
      const baselineDir = await mkdtemp(join(tmpdir(), "layoutlens-base-"));
      const reportDir = await mkdtemp(join(tmpdir(), "layoutlens-vreport-"));

      await createBaseline({
        url: exampleUrl,
        baselineDirectory: baselineDir,
        headless: true,
      });

      const result = await scanUrl({
        url: exampleUrl,
        headless: true,
        baselineDirectory: baselineDir,
        artifacts: {
          directory: reportDir,
          baselineDirectory: baselineDir,
        },
      });

      expect(result.visual?.failedCount).toBe(0);
      expect(result.visual?.passedCount).toBe(3);

      const { indexPath } = await writeHtmlReportBundle(result, reportDir);
      const html = await readFile(indexPath, "utf8");
      expect(html).toContain("Visual regression");
      expect(html).toContain("Slider");
      expect(html).toContain("Side by Side");
      expect(html).toContain("Diff");
      expect(html).toContain("pixels changed");
    },
    120_000,
  );
});
