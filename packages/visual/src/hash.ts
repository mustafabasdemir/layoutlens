import { createHash } from "node:crypto";

export function normalizeUrlForBaseline(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return url.trim();
  }
}

export function urlKeyForBaseline(url: string): string {
  return createHash("sha256")
    .update(normalizeUrlForBaseline(url))
    .digest("hex")
    .slice(0, 16);
}

export async function sha256FileHex(buffer: Buffer): Promise<string> {
  return createHash("sha256").update(buffer).digest("hex");
}
