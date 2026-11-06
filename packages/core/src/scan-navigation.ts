import type { NavigationKind, ScanNavigation } from "@layoutlens/shared";
import { urlForReport } from "@layoutlens/shared";
import type { Page, Response } from "playwright";

const CHALLENGE_TITLE_MARKERS = [
  "access denied",
  "forbidden",
  "403",
  "attention required",
  "just a moment",
  "verify you are human",
  "unavailable",
] as const;

/** Body phrases common on interstitials — excludes terms that appear on normal security blog copy (e.g. captcha, rate limiting). */
const CHALLENGE_BODY_MARKERS = [
  "access denied",
  "cloudflare",
  "checking your browser",
  "ddos protection",
  "please wait",
  "verify you are human",
  "bot detection",
] as const;

function classifyKind(status: number | null, redirectChainLength: number, documentLoaded: boolean): NavigationKind {
  if (!documentLoaded) return "network_error";
  if (status === null) return redirectChainLength > 0 ? "redirect" : "ok";
  if (status >= 200 && status < 400) {
    return redirectChainLength > 0 ? "redirect" : "ok";
  }
  if (status >= 400 && status < 500) return "client_error";
  if (status >= 500) return "server_error";
  return "ok";
}

function redirectUrlsFromResponse(response: Response | null): string[] {
  if (!response) return [];
  const chain: string[] = [];
  let req: { url: () => string; redirectedFrom: () => unknown } | null = response.request() as {
    url: () => string;
    redirectedFrom: () => unknown;
  };
  while (req) {
    chain.push(req.url());
    const prev = req.redirectedFrom();
    req = prev && typeof prev === "object" && prev !== null && "url" in prev ? (prev as { url: () => string; redirectedFrom: () => unknown }) : null;
  }
  chain.reverse();
  if (chain.length <= 1) return [];
  return chain.slice(0, -1).map(urlForReport);
}

/** Guess whether HTML looks like an interstitial; requires multiple weak signals (never definitive). */
export async function detectChallengePageHeuristic(page: Page): Promise<{ likely: boolean; signals: string[] }> {
  const signals: string[] = [];
  const snapshot = await page
    .evaluate(() => {
      const t = (document.title || "").toLowerCase();
      const body = (document.body?.innerText || "").slice(0, 4000).toLowerCase();
      return { title: t, body, bodyLen: (document.body?.innerText || "").length };
    })
    .catch(() => ({ title: "", body: "", bodyLen: 0 }));

  for (const m of CHALLENGE_TITLE_MARKERS) {
    if (snapshot.title.includes(m)) {
      signals.push(`title:${m}`);
      break;
    }
  }
  let bodyHits = 0;
  for (const m of CHALLENGE_BODY_MARKERS) {
    if (snapshot.body.includes(m)) {
      bodyHits++;
      signals.push(`body:${m}`);
    }
  }
  const shortPage = snapshot.bodyLen > 0 && snapshot.bodyLen < 450;
  if (shortPage) signals.push("short-body");

  /** Need multiple independent signals; one vague phrase on a long article is not enough. */
  const likely =
    signals.length >= 3 ||
    (signals.some((s) => s.startsWith("title:")) && bodyHits >= 1) ||
    (shortPage && bodyHits >= 2);
  return { likely, signals: signals.slice(0, 8) };
}

export async function buildScanNavigation(
  page: Page,
  requestedUrl: string,
  response: Response | null,
  documentLoaded: boolean,
): Promise<ScanNavigation> {
  const reqStripped = urlForReport(requestedUrl);
  const httpStatus: number | null = response ? response.status() : null;

  const redirectChain = redirectUrlsFromResponse(response);
  const finalUrl = urlForReport(page.url());
  const responseOk = response?.ok() ?? false;
  const kind = classifyKind(httpStatus, redirectChain.length, documentLoaded);

  let message: string | undefined;
  if (!documentLoaded) message = "Navigation did not complete";
  else if (httpStatus === 403) message = "Forbidden — the server refused this request";
  else if (httpStatus === 404) message = "Not found";
  else if (httpStatus === 429) message = "Too many requests";
  else if (httpStatus !== null && httpStatus >= 500) message = "Server error";

  const out: ScanNavigation = {
    requestedUrl: reqStripped,
    finalUrl,
    httpStatus,
    redirectChain,
    responseOk,
    documentLoaded,
    kind,
  };
  if (message !== undefined) out.message = message;
  if (documentLoaded && httpStatus === 200) {
    const h = await detectChallengePageHeuristic(page);
    if (h.likely) {
      out.challengePageLikely = true;
      out.challengeSignals = h.signals;
    }
  }
  return out;
}
