import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SCAN_API_PREFIX, type ScanApiErrorBody } from "@layoutlens/shared";
import { ApiError } from "./errors.js";
import { assertTrustedRequest, type RequestGuardOptions } from "./request-guard.js";
import type { ScanService } from "./scan-service.js";

export const MAX_BODY_BYTES = 8 * 1024;

const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
};

function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...extra,
  });
  res.end(payload);
}

function sendError(res: ServerResponse, error: ApiError): void {
  const body: ScanApiErrorBody = { error: { code: error.code, message: error.message } };
  sendJson(res, error.status, body, error.status === 405 ? { Allow: "GET, POST" } : {});
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const type = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", "Send the request body as application/json.");
  }
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, "body_too_large", "Request body is too large.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new ApiError(413, "body_too_large", "Request body is too large.");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ApiError(400, "invalid_json", "Request body isn't valid JSON.");
  }
}

function methodNotAllowed(): ApiError {
  return new ApiError(405, "method_not_allowed", "Method not allowed.");
}

export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/**
 * Routes:
 *   GET  /api/health
 *   GET  /api/scans                     POST /api/scans {url}
 *   GET  /api/scans/:id                 POST /api/scans/:id/cancel
 *   POST /api/scans/:id/retry          — Phase 10.3 retry failed site-scan tasks
 *   GET  /api/scans/:id/results         GET  /api/scans/:id/files/(screenshots|visual)/<name>.png
 *   GET  /api/scans/:id/pages/:n/report  — per-page JsonReport (multi-page scans only)
 */
export function createApiHandler(service: ScanService, guard: RequestGuardOptions): ApiHandler {
  return async (req, res) => {
    try {
      assertTrustedRequest(req, guard);
      const method = req.method ?? "GET";
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (!pathname.startsWith(`${SCAN_API_PREFIX}/`)) throw new ApiError(404, "not_found", "Unknown API route.");
      const parts = pathname.slice(SCAN_API_PREFIX.length + 1).split("/").map((p) => decodeURIComponent(p));

      if (parts.length === 1 && parts[0] === "health") {
        if (method !== "GET") throw methodNotAllowed();
        return sendJson(res, 200, service.info());
      }
      if (parts[0] !== "scans") throw new ApiError(404, "not_found", "Unknown API route.");

      if (parts.length === 1) {
        if (method === "GET") return sendJson(res, 200, { scans: await service.list() });
        if (method === "POST") {
          const view = await service.create(await readJsonBody(req));
          return sendJson(res, 202, view, { Location: `${SCAN_API_PREFIX}/scans/${view.id}` });
        }
        throw methodNotAllowed();
      }

      const id = parts[1]!;
      if (parts.length === 2) {
        if (method !== "GET") throw methodNotAllowed();
        return sendJson(res, 200, await service.get(id));
      }
      if (parts.length === 3 && parts[2] === "results") {
        if (method !== "GET") throw methodNotAllowed();
        return sendJson(res, 200, await service.results(id));
      }
      if (
        parts.length === 5 &&
        parts[2] === "pages" &&
        parts[4] === "report" &&
        /^[0-9]+$/.test(parts[3]!)
      ) {
        if (method !== "GET") throw methodNotAllowed();
        const n = Number(parts[3]!);
        return sendJson(res, 200, await service.pageReport(id, n));
      }
      if (parts.length === 3 && parts[2] === "cancel") {
        if (method !== "POST") throw methodNotAllowed();
        return sendJson(res, 202, await service.cancel(id));
      }
      if (parts.length === 3 && parts[2] === "retry") {
        if (method !== "POST") throw methodNotAllowed();
        const view = await service.retry(id, await readJsonBody(req));
        return sendJson(res, 202, view);
      }
      if (parts[2] === "files" && parts.length >= 4) {
        if (method !== "GET") throw methodNotAllowed();
        const file = await service.file(id, parts.slice(3).join("/"));
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          "Cache-Control": "private, max-age=3600",
          "Content-Type": "image/png",
          "Content-Length": file.size,
        });
        createReadStream(file.path).pipe(res);
        return;
      }
      throw new ApiError(404, "not_found", "Unknown API route.");
    } catch (error) {
      if (error instanceof ApiError) return sendError(res, error);
      const message = error instanceof URIError ? "Malformed URL." : "Unexpected server error.";
      return sendError(res, new ApiError(error instanceof URIError ? 400 : 500, "internal", message));
    }
  };
}
