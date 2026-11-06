import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { SCAN_FILE_PATTERN, type ScanJobView } from "@layoutlens/shared";

export const SCAN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SCAN_RECORD_FILE = "scan.json";
export const MAX_SERVED_FILE_BYTES = 25 * 1024 * 1024;

export type StoredScan = Omit<ScanJobView, "queuePosition">;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStoredScan(v: unknown): v is StoredScan {
  return (
    isRecord(v) &&
    typeof v.id === "string" &&
    SCAN_ID_PATTERN.test(v.id) &&
    typeof v.url === "string" &&
    typeof v.state === "string" &&
    typeof v.createdAt === "string" &&
    isRecord(v.progress)
  );
}

async function directorySize(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) total += await directorySize(p);
    else if (entry.isFile()) total += (await stat(p).catch(() => null))?.size ?? 0;
  }
  return total;
}

/** Scan bundles on disk: `<root>/<scanId>/{scan.json, report.json, index.html, screenshots/, visual/}`. */
export class ScanStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  dirFor(id: string): string {
    if (!SCAN_ID_PATTERN.test(id)) throw new Error("Invalid scan id");
    return join(this.root, id);
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async loadAll(): Promise<StoredScan[]> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    const scans: StoredScan[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !SCAN_ID_PATTERN.test(entry.name)) continue;
      try {
        const parsed: unknown = JSON.parse(await readFile(join(this.root, entry.name, SCAN_RECORD_FILE), "utf8"));
        if (isStoredScan(parsed) && parsed.id === entry.name) scans.push(parsed);
      } catch {
        /* incomplete or foreign directory — ignored */
      }
    }
    return scans;
  }

  async save(scan: StoredScan): Promise<void> {
    const dir = this.dirFor(scan.id);
    await mkdir(dir, { recursive: true });
    const target = join(dir, SCAN_RECORD_FILE);
    const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, JSON.stringify(scan, null, 2), "utf8");
    await rename(tmp, target);
  }

  async remove(id: string): Promise<void> {
    await rm(this.dirFor(id), { recursive: true, force: true });
  }

  async removeArtifacts(id: string): Promise<void> {
    const dir = this.dirFor(id);
    await Promise.all(
      ["pages", "screenshots", "visual", "site-scan.json", "report.json", "index.html"].map((p) =>
        rm(join(dir, p), { recursive: true, force: true }),
      ),
    );
  }

  async readReport(id: string): Promise<unknown> {
    return JSON.parse(await readFile(join(this.dirFor(id), "report.json"), "utf8"));
  }

  /** Resolve a whitelisted report asset, refusing anything that escapes the scan directory. */
  async resolveFile(id: string, relativePath: string): Promise<{ path: string; size: number } | null> {
    if (!SCAN_ID_PATTERN.test(id) || !SCAN_FILE_PATTERN.test(relativePath)) return null;
    const dir = this.dirFor(id);
    const candidate = resolve(dir, relativePath);
    if (!candidate.startsWith(dir + sep)) return null;
    try {
      const [realDir, realFile] = await Promise.all([realpath(dir), realpath(candidate)]);
      if (!realFile.startsWith(realDir + sep)) return null;
      const info = await stat(realFile);
      if (!info.isFile() || info.size > MAX_SERVED_FILE_BYTES) return null;
      return { path: realFile, size: info.size };
    } catch {
      return null;
    }
  }

  /**
   * Delete the oldest finished scans beyond `maxScans`, then until total size fits `maxBytes`.
   * Scans in `protect` (queued/running) are never removed.
   */
  async prune(scans: readonly StoredScan[], maxScans: number, maxBytes: number, protect: ReadonlySet<string>): Promise<string[]> {
    const finished = scans
      .filter((s) => !protect.has(s.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const removed: string[] = [];
    const keepCount = Math.max(0, maxScans - protect.size);
    for (const s of finished.slice(keepCount)) {
      await this.remove(s.id);
      removed.push(s.id);
    }
    const kept = finished.slice(0, keepCount);
    const sizes = await Promise.all(kept.map((s) => directorySize(this.dirFor(s.id))));
    let total = sizes.reduce((a, b) => a + b, 0);
    for (let i = kept.length - 1; i >= 0 && total > maxBytes; i--) {
      await this.remove(kept[i]!.id);
      removed.push(kept[i]!.id);
      total -= sizes[i]!;
    }
    return removed;
  }
}
