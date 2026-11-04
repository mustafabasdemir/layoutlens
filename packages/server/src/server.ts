import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve, sep } from "node:path";
import { SCAN_API_PREFIX } from "@layoutlens/shared";
import { createApiHandler } from "./http-api.js";
import { ScanService, type ScanServiceOptions } from "./scan-service.js";

export const DEFAULT_PORT = 4317;
const LOOPBACK_BIND = new Set(["127.0.0.1", "::1", "localhost"]);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

export interface ScanServerOptions extends Omit<ScanServiceOptions, "blockedLoopbackPorts"> {
  host?: string;
  port?: number;
  /** Built Studio (`apps/studio/dist`) to serve at `/`. */
  staticDir?: string;
  /** Extra exact origins allowed to call the API (e.g. `http://127.0.0.1:5173`). */
  allowedOrigins?: readonly string[];
}

export interface RunningScanServer {
  url: string;
  port: number;
  service: ScanService;
  close(): Promise<void>;
}

export function assertLoopbackHost(host: string): void {
  if (!LOOPBACK_BIND.has(host)) {
    throw new Error(
      `Refusing to bind the LayoutLens API to "${host}". It only listens on loopback (127.0.0.1, ::1, localhost).`,
    );
  }
}

function serveStatic(root: string) {
  const base = resolve(root);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const candidate = resolve(base, `.${pathname}`);
    let file = candidate.startsWith(base + sep) ? candidate : join(base, "index.html");
    try {
      const realBase = await realpath(base);
      let info = await stat(file).catch(() => null);
      if (!info?.isFile()) {
        file = join(base, "index.html");
        info = await stat(file);
      }
      const real = await realpath(file);
      if (!real.startsWith(realBase + sep)) throw new Error("outside root");
      res.writeHead(200, {
        "Content-Type": MIME[extname(real)] ?? "application/octet-stream",
        "Content-Length": info.size,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "Cache-Control": extname(real) === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
      });
      if (req.method === "HEAD") res.end();
      else createReadStream(real).pipe(res);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    }
  };
}

/** Start the local scanning API (and optionally the built Studio) on loopback only. */
export async function startScanServer(options: ScanServerOptions): Promise<RunningScanServer> {
  const host = options.host ?? "127.0.0.1";
  assertLoopbackHost(host);
  let port = options.port ?? DEFAULT_PORT;

  const service = new ScanService({ ...options, blockedLoopbackPorts: () => [port] });
  await service.init();
  const api = createApiHandler(service, {
    ports: () => [port],
    ...(options.allowedOrigins ? { extraOrigins: options.allowedOrigins } : {}),
  });
  const statics = options.staticDir ? serveStatic(options.staticDir) : null;

  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    if (path === SCAN_API_PREFIX || path.startsWith(`${SCAN_API_PREFIX}/`)) {
      void api(req, res);
    } else if (statics) {
      void statics(req, res);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("LayoutLens scan API");
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolveListen());
  });
  port = (server.address() as AddressInfo).port;
  const shownHost = host === "::1" ? "[::1]" : host;

  return {
    url: `http://${shownHost}:${port}/`,
    port,
    service,
    async close() {
      await service.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
