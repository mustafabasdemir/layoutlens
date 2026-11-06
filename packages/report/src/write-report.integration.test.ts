import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scanUrl, viewportScreenshotRelativePath } from "@layoutlens/core";
import { describe, expect, it } from "vitest";
import {
  assertOfflineHtml,
  writeHtmlReportBundle,
  HTML_REPORT_INDEX,
} from "./index.js";

const exampleUrl = pathToFileURL(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../examples/broken-layout/index.html",
  ),
).href;

describe("HTML report e2e", () => {
  it(
    "generates offline bundle with screenshots and report.json",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "layoutlens-report-"));
      const result = await scanUrl({
        url: exampleUrl,
        headless: true,
        artifacts: { directory: dir },
      });

      expect(result.viewports.every((v) => v.screenshot)).toBe(true);
      await access(join(dir, result.viewports[0]!.screenshot!));

      const { indexPath } = await writeHtmlReportBundle(result, dir);
      const html = await readFile(indexPath, "utf8");
      assertOfflineHtml(html);
      expect(html).toContain(viewportScreenshotRelativePath(390));
      await access(join(dir, HTML_REPORT_INDEX));
      await access(join(dir, "report.json"));

      const parsed = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as {
        schemaVersion: string;
        viewports: Array<{ screenshot?: string }>;
      };
      expect(parsed.schemaVersion).toBe("1.3");
      expect(parsed.viewports[0]?.screenshot).toBe(
        viewportScreenshotRelativePath(390),
      );
    },
    90_000,
  );
});
