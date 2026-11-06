import type { Page } from "playwright";
import type { SiteScanScope } from "@layoutlens/shared";
import { normalizePageUrl, urlKey } from "./url-normalize.js";

/**
 * Extract same-origin http(s) links from the current document (normal <a href> only).
 */
export async function extractDiscoveredUrls(page: Page, base: URL, scope: SiteScanScope): Promise<string[]> {
  const hrefs = await page.$$eval(
    'a[href]:not([href^="mailto:"]):not([href^="tel:"]):not([href^="javascript:"])',
    (anchors) =>
      anchors.map((a) => (a as HTMLAnchorElement).href).filter((h) => typeof h === "string" && h.length > 0),
  );
  const out = new Set<string>();
  for (const h of hrefs) {
    const u = normalizePageUrl(base, h, scope);
    if (!u) continue;
    out.add(urlKey(u));
  }
  return [...out];
}
