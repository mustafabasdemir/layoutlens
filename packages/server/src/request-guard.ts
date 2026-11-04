import type { IncomingMessage } from "node:http";
import { ApiError } from "./errors.js";

export const LOOPBACK_HOSTNAMES = ["127.0.0.1", "localhost", "[::1]"] as const;

export interface RequestGuardOptions {
  /** Ports this server (or the Studio dev server hosting it) listens on. */
  ports: () => readonly number[];
  /** Additional exact origins allowed to call the API, e.g. a separate Studio dev server. */
  extraOrigins?: readonly string[];
}

function parseHostHeader(host: string): { hostname: string; port: number | null } | null {
  const m = /^(\[[0-9a-fA-F:.]+\]|[^:\[\]]+)(?::(\d{1,5}))?$/.exec(host.trim());
  if (!m) return null;
  return { hostname: m[1]!.toLowerCase(), port: m[2] ? Number(m[2]) : null };
}

function isLocalHostPort(hostname: string, port: number | null, ports: readonly number[]): boolean {
  return (LOOPBACK_HOSTNAMES as readonly string[]).includes(hostname) && port !== null && ports.includes(port);
}

/**
 * Blocks DNS-rebinding (unexpected Host header) and cross-origin browser requests.
 * The API never emits CORS headers, so other origins can't read responses either.
 */
export function assertTrustedRequest(req: IncomingMessage, options: RequestGuardOptions): void {
  const ports = options.ports();
  const host = parseHostHeader(String(req.headers.host ?? ""));
  if (!host || !isLocalHostPort(host.hostname, host.port, ports)) {
    throw new ApiError(421, "untrusted_host", "Requests must address the local LayoutLens server directly.");
  }

  const origin = req.headers.origin;
  if (origin !== undefined) {
    let allowed = (options.extraOrigins ?? []).includes(origin);
    if (!allowed) {
      try {
        const o = new URL(origin);
        allowed =
          o.protocol === "http:" &&
          isLocalHostPort(o.hostname.toLowerCase(), o.port ? Number(o.port) : 80, ports);
      } catch {
        allowed = false;
      }
    }
    if (!allowed) {
      throw new ApiError(403, "cross_origin", "Cross-origin requests to the LayoutLens API are not allowed.");
    }
    return;
  }

  const site = req.headers["sec-fetch-site"];
  if (site === "cross-site" || site === "same-site") {
    throw new ApiError(403, "cross_origin", "Cross-origin requests to the LayoutLens API are not allowed.");
  }
}
