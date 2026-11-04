export const SCREENSHOT_SUBDIR = "screenshots" as const;

export function viewportScreenshotRelativePath(width: number): string {
  return `${SCREENSHOT_SUBDIR}/viewport-${width}.png`;
}
