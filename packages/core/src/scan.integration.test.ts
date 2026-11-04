import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { scanUrl, viewportScreenshotRelativePath } from "./scan.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const exampleIndex = join(repoRoot, "examples/broken-layout/index.html");
const exampleUrl = pathToFileURL(exampleIndex).href;

describe("scanUrl integration", () => {
  it(
    "detects horizontal overflow on the broken example at mobile width",
    async () => {
      const result = await scanUrl({ url: exampleUrl, headless: true });

      expect(result.url).toBe(exampleUrl);
      expect(result.viewports).toHaveLength(3);
      expect(result.summary.findingCount).toBeGreaterThan(0);

      const mobile = result.viewports.find((v) => v.width === 390);
      expect(mobile?.hasHorizontalOverflow).toBe(true);
      expect(mobile?.overflowPx).toBeGreaterThan(0);

      const banner = mobile?.findings.find((f) => f.selector === "#wide-banner");
      expect(banner).toBeDefined();
      expect(banner?.severity).toBe("high");
      expect(banner?.boundingBox.width).toBeGreaterThan(390);
      expect(banner?.documentContributionPx).toBeGreaterThan(100);

      expect(result.issueCount).toBeGreaterThanOrEqual(1);
      expect(result.summary.bySeverity.high).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    "writes viewport PNG screenshots when artifacts directory is set",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "layoutlens-shot-"));
      const result = await scanUrl({
        url: exampleUrl,
        headless: true,
        artifacts: { directory: dir },
      });

      for (const vp of result.viewports) {
        expect(vp.screenshot).toBe(viewportScreenshotRelativePath(vp.width));
        await access(join(dir, vp.screenshot!));
      }
    },
    60_000,
  );
});
