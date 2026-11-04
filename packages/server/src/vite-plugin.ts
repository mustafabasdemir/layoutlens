import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { SCAN_API_PREFIX } from "@layoutlens/shared";
import { createApiHandler } from "./http-api.js";
import { ScanService, type ScanServiceOptions } from "./scan-service.js";

type Next = (err?: unknown) => void;

interface DevServerLike {
  middlewares: { use(fn: (req: IncomingMessage, res: ServerResponse, next: Next) => void): void };
  httpServer: { address(): ReturnType<Server["address"]>; once(event: "close", listener: () => void): unknown } | null;
}

/** Structural subset of a Vite plugin, so this package doesn't depend on Vite. */
export interface LayoutLensVitePlugin {
  name: string;
  configureServer(server: DevServerLike): Promise<void>;
  configurePreviewServer(server: DevServerLike): Promise<void>;
}

/**
 * Mounts the scan API at `/api` inside the Studio dev/preview server, so Studio and
 * the API share one loopback origin. Vite must be bound to 127.0.0.1.
 */
export function layoutlensScanApi(options: Omit<ScanServiceOptions, "blockedLoopbackPorts">): LayoutLensVitePlugin {
  async function mount(server: DevServerLike): Promise<void> {
    const ports = (): number[] => {
      const address = server.httpServer?.address() as AddressInfo | null | undefined;
      return address && typeof address === "object" ? [address.port] : [];
    };
    const service = new ScanService({ ...options, blockedLoopbackPorts: ports });
    await service.init();
    const api = createApiHandler(service, { ports });
    server.httpServer?.once("close", () => void service.close());
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      if (path === SCAN_API_PREFIX || path.startsWith(`${SCAN_API_PREFIX}/`)) void api(req, res);
      else next();
    });
  }
  return {
    name: "layoutlens-scan-api",
    configureServer: mount,
    configurePreviewServer: mount,
  };
}
