import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { layoutlensScanApi } from "@layoutlens/server";
import { defineConfig } from "vite";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const dataDir = process.env.LAYOUTLENS_DATA_DIR
  ? resolve(process.env.INIT_CWD ?? process.cwd(), process.env.LAYOUTLENS_DATA_DIR)
  : resolve(repoRoot, ".layoutlens");

export default defineConfig({
  // The scan API is mounted on the same loopback origin as Studio (dev and preview).
  plugins: [react(), layoutlensScanApi({ dataDir })],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
});
