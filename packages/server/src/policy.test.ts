import type { IncomingMessage } from "node:http";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApiError } from "./errors.js";
import { assertTrustedRequest } from "./request-guard.js";
import { ScanStore } from "./scan-store.js";
import { assertAllowedTarget, classifyAddress, parseTargetUrl, type TargetPolicy } from "./url-policy.js";
import { describeScanError } from "./scan-service.js";
import { assertLoopbackHost } from "./server.js";

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ApiError ? e.code : "other";
  }
  return undefined;
}

async function asyncCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return e instanceof ApiError ? e.code : "other";
  }
  return undefined;
}

describe("parseTargetUrl", () => {
  it("accepts http and https and strips the fragment", () => {
    expect(parseTargetUrl(" https://example.com/a?b=1#frag ").href).toBe("https://example.com/a?b=1");
    expect(parseTargetUrl("http://localhost:3000/").href).toBe("http://localhost:3000/");
  });

  it("rejects unsupported schemes, credentials, junk and oversized input", () => {
    for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "ftp://x.com", "chrome://settings"]) {
      expect(code(() => parseTargetUrl(bad)), bad).toBe("unsupported_scheme");
    }
    expect(code(() => parseTargetUrl("https://user:pw@example.com"))).toBe("invalid_url");
    expect(code(() => parseTargetUrl("not a url"))).toBe("invalid_url");
    expect(code(() => parseTargetUrl(""))).toBe("invalid_url");
    expect(code(() => parseTargetUrl(42))).toBe("invalid_url");
    expect(code(() => parseTargetUrl(`https://example.com/${"a".repeat(2100)}`))).toBe("invalid_url");
  });
});

describe("classifyAddress", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.8.9.10", "loopback"],
    ["::1", "loopback"],
    ["::ffff:127.0.0.1", "loopback"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.10", "private"],
    ["100.64.0.1", "private"],
    ["fd12:3456::1", "private"],
    ["169.254.169.254", "blocked"],
    ["::ffff:169.254.169.254", "blocked"],
    ["0.0.0.0", "blocked"],
    ["::", "blocked"],
    ["224.0.0.1", "blocked"],
    ["255.255.255.255", "blocked"],
    ["fe80::1", "blocked"],
    ["ff02::1", "blocked"],
    ["93.184.216.34", "public"],
    ["172.32.0.1", "public"],
    ["2606:4700::6810:85e5", "public"],
    ["not-an-ip", "blocked"],
  ])("%s → %s", (address, expected) => {
    expect(classifyAddress(address)).toBe(expected);
  });
});

describe("assertAllowedTarget", () => {
  const policy = (over: Partial<TargetPolicy> = {}): TargetPolicy => ({
    allowPrivateNetwork: true,
    blockedLoopbackPorts: () => [4317],
    lookup: async (host) => {
      const table: Record<string, string[]> = {
        "public.test": ["93.184.216.34"],
        "metadata.test": ["93.184.216.34", "169.254.169.254"],
        "lan.test": ["192.168.0.20"],
      };
      const hit = table[host];
      if (!hit) throw new Error("ENOTFOUND");
      return hit.map((address) => ({ address, family: 4 }));
    },
    ...over,
  });

  it("allows public hosts, loopback dev servers and LAN hosts by default", async () => {
    await expect(assertAllowedTarget(new URL("https://public.test/"), policy())).resolves.toBeUndefined();
    await expect(assertAllowedTarget(new URL("http://localhost:3000/"), policy())).resolves.toBeUndefined();
    await expect(assertAllowedTarget(new URL("http://lan.test/"), policy())).resolves.toBeUndefined();
  });

  it("blocks metadata/link-local addresses, even when only one record resolves there", async () => {
    expect(await asyncCode(assertAllowedTarget(new URL("http://169.254.169.254/latest"), policy()))).toBe("blocked_target");
    expect(await asyncCode(assertAllowedTarget(new URL("http://metadata.test/"), policy()))).toBe("blocked_target");
    expect(await asyncCode(assertAllowedTarget(new URL("http://[fe80::1]/"), policy()))).toBe("blocked_target");
  });

  it("refuses to scan the LayoutLens server itself", async () => {
    expect(await asyncCode(assertAllowedTarget(new URL("http://127.0.0.1:4317/api/scans"), policy()))).toBe("blocked_target");
    expect(await asyncCode(assertAllowedTarget(new URL("http://localhost:4317/"), policy()))).toBe("blocked_target");
    expect(await asyncCode(assertAllowedTarget(new URL("http://[::1]:4317/"), policy()))).toBe("blocked_target");
  });

  it("honours --no-private-network and reports unresolvable hosts", async () => {
    expect(await asyncCode(assertAllowedTarget(new URL("http://lan.test/"), policy({ allowPrivateNetwork: false })))).toBe(
      "private_network_disabled",
    );
    expect(await asyncCode(assertAllowedTarget(new URL("https://nope.test/"), policy()))).toBe("unresolvable_host");
  });
});

describe("assertTrustedRequest", () => {
  const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;
  const opts = { ports: () => [4317] };

  it("accepts loopback hosts on the server port with same-origin or no Origin", () => {
    expect(code(() => assertTrustedRequest(req({ host: "127.0.0.1:4317" }), opts))).toBeUndefined();
    expect(code(() => assertTrustedRequest(req({ host: "localhost:4317", origin: "http://localhost:4317" }), opts))).toBeUndefined();
    expect(code(() => assertTrustedRequest(req({ host: "[::1]:4317", origin: "http://127.0.0.1:4317" }), opts))).toBeUndefined();
  });

  it("rejects DNS-rebinding hosts and foreign origins", () => {
    expect(code(() => assertTrustedRequest(req({ host: "evil.test:4317" }), opts))).toBe("untrusted_host");
    expect(code(() => assertTrustedRequest(req({ host: "127.0.0.1:9999" }), opts))).toBe("untrusted_host");
    expect(code(() => assertTrustedRequest(req({}), opts))).toBe("untrusted_host");
    expect(code(() => assertTrustedRequest(req({ host: "127.0.0.1:4317", origin: "https://evil.test" }), opts))).toBe("cross_origin");
    expect(code(() => assertTrustedRequest(req({ host: "127.0.0.1:4317", origin: "http://127.0.0.1:5173" }), opts))).toBe("cross_origin");
    expect(code(() => assertTrustedRequest(req({ host: "127.0.0.1:4317", origin: "null" }), opts))).toBe("cross_origin");
    expect(code(() => assertTrustedRequest(req({ host: "127.0.0.1:4317", "sec-fetch-site": "cross-site" }), opts))).toBe("cross_origin");
  });

  it("allows explicitly configured extra origins", () => {
    const withExtra = { ...opts, extraOrigins: ["http://127.0.0.1:5173"] };
    expect(code(() => assertTrustedRequest(req({ host: "127.0.0.1:4317", origin: "http://127.0.0.1:5173" }), withExtra))).toBeUndefined();
  });
});

describe("ScanStore.resolveFile", () => {
  it("serves only whitelisted PNGs inside the scan folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "ll-store-"));
    const store = new ScanStore(root);
    const id = "0b5c2a6e-1d1e-4f1a-9c3b-2f9a7d0e1a11";
    const dir = store.dirFor(id);
    await mkdir(join(dir, "screenshots"), { recursive: true });
    await writeFile(join(dir, "screenshots", "viewport-390.png"), "png");
    await writeFile(join(dir, "scan.json"), "{}");
    await writeFile(join(root, "secret.png"), "secret");

    expect(await store.resolveFile(id, "screenshots/viewport-390.png")).not.toBeNull();
    for (const bad of [
      "scan.json",
      "../secret.png",
      "screenshots/../../secret.png",
      "screenshots/..%2f..%2fsecret.png",
      "/etc/passwd",
      "C:\\Windows\\win.ini",
      "screenshots\\viewport-390.png",
      "other/viewport-390.png",
    ]) {
      expect(await store.resolveFile(id, bad), bad).toBeNull();
    }
    expect(await store.resolveFile("../escape", "screenshots/viewport-390.png")).toBeNull();
    expect(() => store.dirFor("..")).toThrow();

    try {
      await symlink(join(root, "secret.png"), join(dir, "screenshots", "link.png"));
      expect(await store.resolveFile(id, "screenshots/link.png")).toBeNull();
    } catch {
      /* symlinks need extra privileges on Windows */
    }
  });
});

describe("misc", () => {
  it("binds only to loopback", () => {
    expect(() => assertLoopbackHost("0.0.0.0")).toThrow(/loopback/);
    expect(() => assertLoopbackHost("192.168.1.2")).toThrow();
    expect(() => assertLoopbackHost("127.0.0.1")).not.toThrow();
  });

  it("turns raw scanner errors into short UI messages", () => {
    expect(describeScanError(new Error("page.goto: net::ERR_NAME_NOT_RESOLVED at https://x.invalid/\nCall log:\n..."), 1000)).toBe(
      "The page couldn't be loaded (ERR_NAME_NOT_RESOLVED).",
    );
    expect(describeScanError(new Error("browserType.launch: Executable doesn't exist at C:\\x"), 1000)).toMatch(/browser:install/);
  });
});
