import { chromium } from "playwright";
import type { SiteScanScope } from "@layoutlens/shared";
import { extractDiscoveredUrls } from "./extract-links.js";
import { fetchRobotsDisallows, isPathAllowedByRobots } from "./robots.js";
import { normalizePageUrl, urlKey } from "./url-normalize.js";

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason: unknown = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new DOMException("The scan was aborted.", "AbortError");
}

function redirectHopCount(response: import("playwright").Response | null): number {
  if (!response) return 0;
  let n = 0;
  let req = response.request().redirectedFrom();
  while (req) {
    n += 1;
    req = req.redirectedFrom();
  }
  return n;
}

/**
 * BFS same-origin HTML page discovery. Bounded by `scope.maxPages` and `scope.maxDepth`.
 * Root URL is depth 0; direct links from it are depth 1, etc.
 */
export async function discoverSitePages(options: {
  startUrl: URL;
  scope: SiteScanScope;
  signal?: AbortSignal;
  navigationTimeoutMs: number;
  headless?: boolean;
}): Promise<readonly URL[]> {
  const { startUrl, scope, signal, navigationTimeoutMs, headless = true } = options;
  const normalizedStart = normalizePageUrl(startUrl, startUrl.href, scope);
  if (!normalizedStart) throw new Error("Invalid start URL for discovery.");
  const baseOrigin = normalizedStart.origin;

  throwIfAborted(signal);
  const robotsDisallows = await fetchRobotsDisallows(baseOrigin, signal);

  const queuedKeys = new Set<string>();
  const discoveredKeys = new Set<string>();
  const discovered: URL[] = [];

  const queue: { url: URL; depth: number }[] = [];

  function canCrawlPath(pathname: string): boolean {
    return isPathAllowedByRobots(pathname, robotsDisallows);
  }

  function enqueue(url: URL, depth: number): void {
    if (depth > scope.maxDepth) return;
    if (discovered.length >= scope.maxPages && depth > 0) return;
    if (!canCrawlPath(url.pathname)) return;
    if (url.origin !== baseOrigin) return;
    const k = urlKey(url);
    if (queuedKeys.has(k)) return;
    queuedKeys.add(k);
    queue.push({ url, depth });
  }

  enqueue(new URL(normalizedStart.href), 0);

  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    while (queue.length > 0 && discovered.length < scope.maxPages) {
      throwIfAborted(signal);
      const { url: toVisit, depth } = queue.shift()!;

      let finalUrl: URL | undefined;
      try {
        const resp = await page.goto(toVisit.href, {
          waitUntil: "domcontentloaded",
          timeout: navigationTimeoutMs,
        });
        if (redirectHopCount(resp) > scope.maxRedirectHops) continue;

        finalUrl = new URL(page.url());
        if (finalUrl.origin !== baseOrigin) continue;
        if (!canCrawlPath(finalUrl.pathname)) continue;

        const fk = urlKey(finalUrl);
        if (!discoveredKeys.has(fk) && discovered.length < scope.maxPages) {
          discoveredKeys.add(fk);
          discovered.push(finalUrl);
        }
      } catch {
        continue;
      }

      if (depth >= scope.maxDepth) continue;
      if (!finalUrl) continue;

      let links: string[];
      try {
        links = await extractDiscoveredUrls(page, finalUrl, scope);
      } catch {
        continue;
      }

      for (const href of links) {
        const next = normalizePageUrl(finalUrl, href, scope);
        if (!next) continue;
        enqueue(next, depth + 1);
      }
    }

    await context.close();
    return discovered;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
