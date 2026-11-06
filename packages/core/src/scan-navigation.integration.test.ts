import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanUrl } from "./scan.js";

let server: Server;
let baseUrl: string;

function startServer(handlers: Record<string, (res: import("node:http").ServerResponse) => void>): Promise<void> {
  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      const h = handlers[path];
      if (h) {
        h(res);
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
    server.on("error", reject);
  });
}

beforeAll(async () => {
  await startServer({
    "/ok": (res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!DOCTYPE html><html><body><h1>OK page</h1></body></html>");
    },
    "/301": (res) => {
      res.writeHead(301, { Location: "/ok" });
      res.end();
    },
    "/403": (res) => {
      res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!DOCTYPE html><html><body>Forbidden</body></html>");
    },
    "/404": (res) => {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!DOCTYPE html><html><body>Not found</body></html>");
    },
    "/429": (res) => {
      res.writeHead(429, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!DOCTYPE html><html><body>Too many requests</body></html>");
    },
    "/500": (res) => {
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!DOCTYPE html><html><body>Server error</body></html>");
    },
    "/challenge": (res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html><head><title>Just a moment</title></head><body><p>Checking your browser. captcha</p></body></html>`);
    },
    "/security-blog": (res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<!DOCTYPE html><html><head><title>Our security practices</title></head><body>` +
          `<p>We discuss captcha alternatives and rate limiting for legitimate users.</p></body></html>`,
      );
    },
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
});

describe("scanUrl navigation metadata", () => {
  it(
    "records HTTP 200 and optional redirect chain",
    async () => {
      const r = await scanUrl({ url: `${baseUrl}/ok`, headless: true });
      expect(r.navigation?.httpStatus).toBe(200);
      expect(r.summary.scanTrust).toBe("trusted");
    },
    120_000,
  );

  it(
    "records redirect chain for 301",
    async () => {
      const r = await scanUrl({ url: `${baseUrl}/301`, headless: true });
      expect(r.navigation?.httpStatus).toBe(200);
      expect(r.navigation?.redirectChain.length).toBeGreaterThanOrEqual(1);
      expect(r.summary.scanTrust).toBe("trusted");
    },
    120_000,
  );

  it(
    "records HTTP 403 and flags scanTrust http_error",
    async () => {
      const r = await scanUrl({ url: `${baseUrl}/403`, headless: true });
      expect(r.navigation?.httpStatus).toBe(403);
      expect(r.summary.scanTrust).toBe("http_error");
      expect(r.viewports.length).toBeGreaterThan(0);
    },
    120_000,
  );

  it(
    "records HTTP 404 and flags scanTrust http_error",
    async () => {
      const r = await scanUrl({ url: `${baseUrl}/404`, headless: true });
      expect(r.navigation?.httpStatus).toBe(404);
      expect(r.summary.scanTrust).toBe("http_error");
    },
    120_000,
  );

  it(
    "records HTTP 429 and flags scanTrust http_error",
    async () => {
      const r = await scanUrl({ url: `${baseUrl}/429`, headless: true });
      expect(r.navigation?.httpStatus).toBe(429);
      expect(r.summary.scanTrust).toBe("http_error");
    },
    120_000,
  );

  it(
    "records HTTP 500 and flags scanTrust http_error",
    async () => {
      const r = await scanUrl({ url: `${baseUrl}/500`, headless: true });
      expect(r.navigation?.httpStatus).toBe(500);
      expect(r.summary.scanTrust).toBe("http_error");
    },
    120_000,
  );

  it(
    "records network_error when nothing accepts the connection",
    async () => {
      const r = await scanUrl({ url: "http://127.0.0.1:1/nope", headless: true });
      expect(r.navigation?.documentLoaded).toBe(false);
      expect(r.summary.scanTrust).toBe("network_error");
      expect(r.viewports.length).toBe(3);
      expect(r.viewports[0]?.analysis.elementsInspected).toBe(0);
    },
    120_000,
  );

  it(
    "flags heuristic challenge on generic interstitial HTML",
    async () => {
      const r = await scanUrl({ url: `${baseUrl}/challenge`, headless: true });
      expect(r.navigation?.httpStatus).toBe(200);
      expect(r.navigation?.challengePageLikely).toBe(true);
      expect(r.summary.scanTrust).toBe("challenge_uncertain");
    },
    120_000,
  );

  it(
    "does not flag normal page mentioning security terms",
    async () => {
      const r = await scanUrl({ url: `${baseUrl}/security-blog`, headless: true });
      expect(r.navigation?.httpStatus).toBe(200);
      expect(r.navigation?.challengePageLikely).not.toBe(true);
      expect(r.summary.scanTrust).toBe("trusted");
    },
    120_000,
  );
});
