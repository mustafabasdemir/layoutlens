import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";

export type Rgb = readonly [number, number, number];

export const COLORS = {
  baseline390: [220, 40, 40],
  current390: [40, 80, 220],
  baseline1440: [30, 170, 70],
  current1440: [235, 200, 20],
  current1024: [120, 120, 120],
  diff: [255, 0, 180],
} as const satisfies Record<string, Rgb>;

function solidPng(width: number, height: number, rgb: Rgb): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgb[0];
    png.data[i + 1] = rgb[1];
    png.data[i + 2] = rgb[2];
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

export const FIXTURE_URL = "https://fixture.layoutlens.test/pricing";
export const FIXTURE_SCANNED_AT = "2026-10-30T09:15:00.000Z";

/**
 * Report bundle shaped like `layoutlens scan --format html --output <dir>`:
 * - 390px: three findings (clipped, visible, outside the capture) + failing visual compare
 * - 1024px: no findings, missing baseline
 * - 1440px: failing visual compare with different colors than 390px
 */
export async function writeFixtureReport(dir: string): Promise<void> {
  await mkdir(join(dir, "screenshots"), { recursive: true });
  await mkdir(join(dir, "visual"), { recursive: true });

  const files: [string, Buffer][] = [
    ["screenshots/viewport-390.png", solidPng(390, 844, COLORS.current390)],
    ["screenshots/viewport-1024.png", solidPng(1024, 768, COLORS.current1024)],
    ["screenshots/viewport-1440.png", solidPng(1440, 900, COLORS.current1440)],
    ["visual/baseline-390.png", solidPng(390, 844, COLORS.baseline390)],
    ["visual/diff-390.png", solidPng(390, 844, COLORS.diff)],
    ["visual/baseline-1440.png", solidPng(1440, 900, COLORS.baseline1440)],
    ["visual/diff-1440.png", solidPng(1440, 900, COLORS.diff)],
  ];
  for (const [rel, buf] of files) await writeFile(join(dir, rel), buf);

  const finding = (o: Record<string, unknown>) => ({
    tagName: "div",
    overflowPx: 0,
    documentContributionPx: 0,
    scrollWidth: 100,
    clientWidth: 100,
    ...o,
  });

  const report = {
    schemaVersion: "1.0",
    tool: "layoutlens",
    url: FIXTURE_URL,
    scannedAt: FIXTURE_SCANNED_AT,
    summary: {
      viewportIssueCount: 1,
      findingCount: 3,
      advancedFindingCount: 2,
      bySeverity: { high: 1, medium: 1, low: 1 },
      visualFailures: 2,
    },
    viewports: [
      {
        width: 390,
        label: "mobile",
        viewportHeight: 844,
        documentScrollWidth: 610,
        documentClientWidth: 390,
        hasHorizontalOverflow: true,
        overflowPx: 220,
        screenshot: "screenshots/viewport-390.png",
        findings: [
          finding({
            selector: ".pricing-table",
            severity: "high",
            documentContributionPx: 220,
            scrollWidth: 600,
            clientWidth: 600,
            boundingBox: { x: 10, y: 100, width: 600, height: 50 },
          }),
          finding({
            selector: ".code-sample <script>alert(1)</script>",
            severity: "medium",
            overflowPx: 30,
            scrollWidth: 130,
            boundingBox: { x: 20, y: 200, width: 100, height: 40 },
          }),
          finding({
            selector: "footer .badge",
            severity: "low",
            documentContributionPx: 5,
            boundingBox: { x: 0, y: 2000, width: 100, height: 20 },
          }),
        ],
        advancedFindings: [
          {
            id: "offscreen-control:nav:collapsed-link:-200:100",
            category: "offscreen-control",
            tagName: "a",
            selector: "nav.collapsed .menu-link",
            selectorMatches: 12,
            severity: "medium",
            classification: "potential",
            reason: "Interactive control has no painted overlap with the layout viewport (likely hidden navigation).",
            guidance: "Verify the control is reachable when the menu opens.",
            boundingBox: { x: -200, y: 100, width: 80, height: 24 },
            visibleBox: null,
            offscreenControl: {
              role: "link",
              disabled: false,
              tabIndex: null,
              horizontalOutside: true,
              notVisibleInViewport: true,
            },
          },
          {
            id: "touch-target:.tiny-tap:50:100",
            category: "touch-target",
            tagName: "button",
            selector: ".tiny-tap",
            selectorMatches: 1,
            severity: "medium",
            classification: "confirmed",
            reason: "Hit target is smaller than the recommended minimum.",
            guidance: "Increase padding or min width/height so the tap area meets the guideline.",
            boundingBox: { x: 50, y: 100, width: 40, height: 40 },
            visibleBox: { x: 50, y: 100, width: 40, height: 40 },
            touchTarget: {
              hitWidth: 18,
              hitHeight: 18,
              minSizePx: 44,
              spacingToNearestPx: 10,
              rule: "44px minimum",
              disabled: false,
            },
          },
        ],
        visualCompare: {
          status: "fail",
          diffPixels: 329160,
          diffPixelRatio: 1,
          baselineScreenshot: "visual/baseline-390.png",
          diffScreenshot: "visual/diff-390.png",
        },
      },
      {
        width: 1024,
        label: "tablet",
        viewportHeight: 768,
        documentScrollWidth: 1024,
        documentClientWidth: 1024,
        hasHorizontalOverflow: false,
        overflowPx: 0,
        screenshot: "screenshots/viewport-1024.png",
        findings: [],
        visualCompare: { status: "missing-baseline", diffPixels: 0, diffPixelRatio: 0 },
      },
      {
        width: 1440,
        label: "desktop",
        viewportHeight: 900,
        documentScrollWidth: 1440,
        documentClientWidth: 1440,
        hasHorizontalOverflow: false,
        overflowPx: 0,
        screenshot: "screenshots/viewport-1440.png",
        findings: [],
        visualCompare: {
          status: "fail",
          diffPixels: 1296000,
          diffPixelRatio: 1,
          baselineScreenshot: "visual/baseline-1440.png",
          diffScreenshot: "visual/diff-1440.png",
        },
      },
    ],
  };
  await writeFile(join(dir, "report.json"), JSON.stringify(report, null, 2));
}

/** Average color of a small square of a PNG screenshot. */
export function sampleColor(png: Buffer, xRatio: number, yRatio = 0.5): Rgb {
  const img = PNG.sync.read(png);
  const cx = Math.round((img.width - 1) * xRatio);
  const cy = Math.round((img.height - 1) * yRatio);
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = cy - 2; y <= cy + 2; y++) {
    for (let x = cx - 2; x <= cx + 2; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const i = (y * img.width + x) * 4;
      sum[0]! += img.data[i]!;
      sum[1]! += img.data[i + 1]!;
      sum[2]! += img.data[i + 2]!;
      n++;
    }
  }
  return [sum[0]! / n, sum[1]! / n, sum[2]! / n];
}

export function closeTo(a: Rgb, b: Rgb, tolerance = 12): boolean {
  return a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);
}
