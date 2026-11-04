#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_PORT, startScanServer } from "./server.js";

const { values } = parseArgs({
  options: {
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: String(DEFAULT_PORT) },
    "data-dir": { type: "string" },
    "baselines-dir": { type: "string" },
    "static-dir": { type: "string" },
    "allow-origin": { type: "string", multiple: true },
    "no-private-network": { type: "boolean", default: false },
    "max-concurrent": { type: "string" },
    "timeout-ms": { type: "string" },
    "max-stored-scans": { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  process.stdout.write(`layoutlens-server — local scanning API for LayoutLens Studio

Options:
  --host <addr>            Loopback address to bind (default 127.0.0.1)
  --port <n>               Port (default ${DEFAULT_PORT})
  --data-dir <dir>         Where reports are stored (default ./.layoutlens)
  --baselines-dir <dir>    Read-only baselines folder (default <data-dir>/baselines)
  --static-dir <dir>       Serve the built Studio from this folder
  --allow-origin <origin>  Extra origin allowed to call the API (repeatable)
  --no-private-network     Refuse RFC 1918 / ULA targets
  --max-concurrent <n>     Concurrent scans (default 1, max 4)
  --timeout-ms <n>         Per-scan timeout (default 180000)
  --max-stored-scans <n>   Reports kept on disk (default 50)
`);
  process.exit(0);
}

const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));
const baseDir = process.env.INIT_CWD ?? process.cwd();
const dataDir = resolve(baseDir, values["data-dir"] ?? process.env.LAYOUTLENS_DATA_DIR ?? ".layoutlens");

try {
  const maxConcurrentScans = num(values["max-concurrent"]);
  const scanTimeoutMs = num(values["timeout-ms"]);
  const maxStoredScans = num(values["max-stored-scans"]);
  const server = await startScanServer({
    host: values.host ?? "127.0.0.1",
    port: Number(values.port),
    dataDir,
    allowPrivateNetwork: !values["no-private-network"],
    ...(values["baselines-dir"] ? { baselinesDir: resolve(baseDir, values["baselines-dir"]) } : {}),
    ...(values["static-dir"] ? { staticDir: resolve(baseDir, values["static-dir"]) } : {}),
    ...(values["allow-origin"] ? { allowedOrigins: values["allow-origin"] } : {}),
    ...(maxConcurrentScans !== undefined ? { maxConcurrentScans } : {}),
    ...(scanTimeoutMs !== undefined ? { scanTimeoutMs } : {}),
    ...(maxStoredScans !== undefined ? { maxStoredScans } : {}),
  });
  process.stderr.write(
    `LayoutLens ${values["static-dir"] ? "Studio" : "scan API"} listening on ${server.url}\n` +
      `Reports: ${server.service.dataDir}\nBaselines (read-only): ${server.service.baselinesDir}\n`,
  );
  const stop = () => {
    void server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (error) {
  process.stderr.write(`layoutlens-server: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
