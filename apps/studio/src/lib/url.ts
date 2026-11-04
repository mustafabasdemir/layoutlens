export type UrlValidation =
  | { ok: true; url: string }
  | { ok: false; message: string };

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Client-side check for a website URL before it is sent to the scanning service
 * (which re-validates and resolves the host). Adds https:// when the scheme is omitted.
 */
export function validateScanUrl(input: string): UrlValidation {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, message: "Enter a website URL to scan." };
  if (trimmed.length > 2048) return { ok: false, message: "That URL is too long." };
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(trimmed);
  const looksLocal = /^(localhost|127\.|\[::1\])/i.test(trimmed);
  const withScheme = hasScheme ? trimmed : `${looksLocal ? "http" : "https"}://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, message: "That doesn't look like a valid URL." };
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, message: "Only http and https URLs can be scanned." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, message: "Remove the username or password from the URL." };
  }
  const host = parsed.hostname;
  const isLocal = host === "localhost" || host.endsWith(".localhost") || host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host);
  if (!isLocal && !host.includes(".")) {
    return { ok: false, message: "Include a full domain, for example https://example.com." };
  }
  parsed.hash = "";
  return { ok: true, url: parsed.href };
}
