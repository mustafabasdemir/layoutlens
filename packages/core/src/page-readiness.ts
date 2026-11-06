import type { Page } from "playwright";
import type { EffectiveReadinessMilestone } from "@layoutlens/shared";

export interface LifecycleWaitResult {
  domContentLoadedFired: boolean;
  loadFired: boolean;
  effectiveMilestone: EffectiveReadinessMilestone;
  recoveredPartialReadiness: boolean;
  readinessNote?: string;
  durationWaitMs: number;
}

function documentLooksUsable(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      try {
        const body = document.body;
        if (!body) return false;
        const text = (body.innerText || "").trim();
        if (text.length >= 20) return true;
        if (text.length > 0) return true;
        // Ignore script-only bodies: children alone are not evidence of readable content.
        return false;
      } catch {
        return false;
      }
    })
    .catch(() => false);
}

async function getReadyState(page: Page): Promise<string> {
  return page.evaluate(() => document.readyState).catch(() => "unknown");
}

/**
 * After navigation commits (typically `waitUntil: "domcontentloaded"`), wait for `load` with a dedicated timeout.
 * If `load` does not fire in time but the DOM has visible content, proceed with partial-readiness recovery.
 */
export async function waitForLoadOrRecover(
  page: Page,
  options: { readinessTimeoutMs: number; signal?: AbortSignal },
): Promise<LifecycleWaitResult> {
  const started = Date.now();
  const rs0 = await getReadyState(page);
  const domContentLoadedFired = rs0 === "interactive" || rs0 === "complete";
  if (rs0 === "complete") {
    return {
      domContentLoadedFired: true,
      loadFired: true,
      effectiveMilestone: "load",
      recoveredPartialReadiness: false,
      durationWaitMs: Date.now() - started,
    };
  }

  try {
    await page.waitForLoadState("load", {
      timeout: options.readinessTimeoutMs,
    });
    const loadFired = (await getReadyState(page)) === "complete";
    return {
      domContentLoadedFired: true,
      loadFired,
      effectiveMilestone: loadFired ? "load" : "domcontentloaded",
      recoveredPartialReadiness: false,
      durationWaitMs: Date.now() - started,
    };
  } catch {
    const usable = await documentLooksUsable(page);
    const durationWaitMs = Date.now() - started;
    if (usable) {
      return {
        domContentLoadedFired,
        loadFired: false,
        effectiveMilestone: domContentLoadedFired ? "domcontentloaded" : "commit",
        recoveredPartialReadiness: true,
        readinessNote: "load-state-timeout-recovered-usable-dom",
        durationWaitMs,
      };
    }
    return {
      domContentLoadedFired,
      loadFired: false,
      effectiveMilestone: domContentLoadedFired ? "domcontentloaded" : "commit",
      recoveredPartialReadiness: false,
      readinessNote: "load-state-timeout-unusable-dom",
      durationWaitMs,
    };
  }
}
