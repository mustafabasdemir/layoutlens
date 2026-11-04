import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { compareScreenshotFiles } from "./manifest.js";

async function writeSolidPng(
  path: string,
  width: number,
  height: number,
  rgba: [number, number, number, number],
): Promise<void> {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
  await writeFile(path, PNG.sync.write(png));
}

describe("compareScreenshotFiles", () => {
  it("passes for identical screenshots", async () => {
    const dir = await mkdtemp(join(tmpdir(), "layoutlens-compare-"));
    const baseline = join(dir, "base.png");
    const actual = join(dir, "actual.png");
    await writeSolidPng(baseline, 40, 20, [10, 120, 200, 255]);
    await writeSolidPng(actual, 40, 20, [10, 120, 200, 255]);

    const result = await compareScreenshotFiles({
      baselinePath: baseline,
      actualPath: actual,
      viewportWidth: 390,
      config: { maxDiffPixels: 0, maxDiffPixelRatio: 0 },
    });
    expect(result.passed).toBe(true);
    expect(result.diffPixels).toBe(0);
  });

  it("fails when pixels differ beyond threshold", async () => {
    const dir = await mkdtemp(join(tmpdir(), "layoutlens-compare-"));
    const baseline = join(dir, "base.png");
    const actual = join(dir, "actual.png");
    await writeSolidPng(baseline, 10, 10, [0, 0, 0, 255]);
    await writeSolidPng(actual, 10, 10, [255, 255, 255, 255]);

    const result = await compareScreenshotFiles({
      baselinePath: baseline,
      actualPath: actual,
      viewportWidth: 390,
      config: { maxDiffPixels: 1, maxDiffPixelRatio: 0.001 },
    });
    expect(result.passed).toBe(false);
    expect(result.diffPixels).toBeGreaterThan(0);
  });
});
