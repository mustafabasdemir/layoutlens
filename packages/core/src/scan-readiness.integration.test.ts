import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanUrl } from "./scan.js";

let server: Server;
let baseUrl: string;

function startServer(
  handlers: Record<string, (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      const h = handlers[path];
      if (h) {
        h(req, res);
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
    "/fast": (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!DOCTYPE html><html><body><p>Fast page with enough text content for tests.</p></body></html>");
    },
    "/slow-js": (_req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      });
      setTimeout(() => {
        res.end("// delayed script\n");
      }, 6000);
    },
    "/delayed-load": (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<!DOCTYPE html><html><body><p>Content before slow script.</p><script async src="/slow-js"></script></body></html>`,
      );
    },
    "/network-activity": (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html><body><p>Busy page</p><script>
        setInterval(function(){ fetch('/fast').catch(function(){}); }, 80);
      </script></body></html>`);
    },
    "/hang": () => {
      /* intentional: never respond */
    },
    "/empty-body-slow-js": (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html><body><script async src="/slow-js"></script></body></html>`);
    },
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
});

describe("scanUrl readiness and per-viewport outcomes", () => {
  it(
    "fast successful navigation (all viewports complete)",
    async () => {
      const r = await scanUrl({ url: `${baseUrl}/fast`, headless: true });
      expect(r.summary.scanCompletionStatus).toBe("full");
      expect(r.navigationDiagnostics?.firstGotoWaitUntil).toBe("domcontentloaded");
      expect(r.viewports.every((v) => v.inspectionStatus === undefined || v.inspectionStatus === "completed")).toBe(true);
    },
    120_000,
  );

  it(
    "completes with perpetual background fetch (no networkidle)",
    async () => {
      const r = await scanUrl({ url: `${baseUrl}/network-activity`, headless: true });
      expect(r.summary.scanCompletionStatus).toBe("full");
    },
    120_000,
  );

  it(
    "handles navigation timeout on first viewport (remaining skipped)",
    async () => {
      const r = await scanUrl({
        url: `${baseUrl}/hang`,
        headless: true,
        timeouts: { navigationMs: 800, readinessMs: 500, postLoadSettleMs: 0 },
      });
      expect(r.navigation?.documentLoaded).toBe(false);
      expect(r.summary.scanCompletionStatus).toBe("failed");
      expect(r.viewports.filter((v) => v.inspectionStatus === "skipped").length).toBeGreaterThan(0);
    },
    120_000,
  );

  it(
    "screenshot timeout fails that viewport (bounded timeout)",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "layoutlens-ss-"));
      try {
        const r = await scanUrl({
          url: `${baseUrl}/fast`,
          headless: true,
          artifacts: { directory: dir },
          timeouts: { screenshotMs: 1 },
        });
        expect(r.viewports.some((v) => v.inspectionStatus === "failed")).toBe(true);
        expect(r.summary.scanCompletionStatus).toBe("failed");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it(
    "readiness recovery when load is slow but DOM is usable",
    async () => {
      const r = await scanUrl({
        url: `${baseUrl}/delayed-load`,
        headless: true,
        timeouts: { readinessMs: 2000, postLoadSettleMs: 0 },
      });
      expect(r.navigationDiagnostics?.firstPartialReadinessRecovery).toBe(true);
      expect(r.summary.scanCompletionStatus).toBe("full");
    },
    120_000,
  );

  it(
    "readiness failure when load times out and DOM is effectively empty",
    async () => {
      const r = await scanUrl({
        url: `${baseUrl}/empty-body-slow-js`,
        headless: true,
        timeouts: { readinessMs: 800, postLoadSettleMs: 0 },
      });
      expect(r.summary.scanCompletionStatus).toBe("failed");
      expect(r.viewports[0]?.inspectionStatus).toBe("failed");
    },
    120_000,
  );
});
