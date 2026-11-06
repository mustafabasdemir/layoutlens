import type { SiteScanQueryParamPolicy, SiteScanScope } from "@layoutlens/shared";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "_ga",
  "mc_cid",
  "mc_eid",
]);

/** Normalize for deduplication and same-origin checks (no fetch). */
export function normalizePageUrl(base: URL, href: string, scope: SiteScanScope): URL | null {
  let resolved: URL;
  try {
    resolved = new URL(href, base);
  } catch {
    return null;
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
  if (resolved.hostname !== base.hostname) return null;
  if (resolved.port && resolved.port !== base.port) return null;

  resolved.hash = "";

  if (scope.queryParamPolicy === "strip_all") {
    resolved.search = "";
  } else if (scope.queryParamPolicy === "strip_known_tracking") {
    const sp = new URLSearchParams(resolved.search);
    for (const k of [...sp.keys()]) {
      if (TRACKING_PARAMS.has(k.toLowerCase())) sp.delete(k);
    }
    const next = sp.toString();
    resolved.search = next ? `?${next}` : "";
  }

  const path = resolved.pathname;
  if (scope.excludePathPrefixes?.some((p) => path.startsWith(p))) return null;
  if (scope.includePathPrefixes?.length && !scope.includePathPrefixes.some((p) => path.startsWith(p))) {
    return null;
  }

  // Skip obvious non-HTML
  if (/\.(pdf|zip|png|jpe?g|gif|webp|svg|ico|css|js|mjs|map|json|xml|woff2?|ttf|eot|mp4|webm|mp3)(\?|$)/i.test(path)) {
    return null;
  }

  return resolved;
}

export function urlKey(u: URL): string {
  return `${u.origin}${u.pathname}${u.search}`;
}
