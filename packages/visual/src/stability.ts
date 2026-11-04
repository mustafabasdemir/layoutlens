import type { ScreenshotStabilityOptions } from "@layoutlens/shared";
import { DEFAULT_STABILITY } from "@layoutlens/shared";

export interface StableScreenshotPage {
  addStyleTag(options: { content: string }): Promise<unknown>;
  emulateMedia(options: { reducedMotion: "reduce" }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
}

export async function stabilizePageForScreenshot(
  page: StableScreenshotPage,
  options?: ScreenshotStabilityOptions,
): Promise<void> {
  const stability = {
    waitAfterLoadMs:
      options?.waitAfterLoadMs ?? DEFAULT_STABILITY.waitAfterLoadMs,
    disableAnimations:
      options?.disableAnimations ?? DEFAULT_STABILITY.disableAnimations,
    reducedMotion: options?.reducedMotion ?? DEFAULT_STABILITY.reducedMotion,
  };

  if (stability.disableAnimations || stability.reducedMotion) {
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation: none !important;
          transition: none !important;
          caret-color: transparent !important;
        }
        html { scroll-behavior: auto !important; }
      `,
    });
  }

  if (stability.reducedMotion) {
    await page.emulateMedia({ reducedMotion: "reduce" });
  }

  if (stability.waitAfterLoadMs > 0) {
    await page.waitForTimeout(stability.waitAfterLoadMs);
  }
}
