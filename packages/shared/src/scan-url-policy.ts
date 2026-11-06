/**
 * URL validation + resolution policy for scanning (shared by core CLI and server).
 * Mirrors `packages/server/src/url-policy.ts` behavior but throws plain `Error` for CLI.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_SCAN_TARGET_URL_LENGTH = 2048;

export type AddressClass = "loopback" | "private" | "public" | "blocked";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type HostLookup = (hostname: string) => Promise<ResolvedAddress[]>;

export interface ScanTargetPolicy {
  allowPrivateNetwork: boolean;
  blockedLoopbackPorts: () => readonly number[];
  lookup?: HostLookup;
}

const defaultLookup: HostLookup = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

function ipv4Octets(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => Number(p));
  return octets.every((o, i) => /^\d{1,3}$/.test(parts[i]!) && o >= 0 && o <= 255) ? octets : null;
}

function classifyIpv4(address: string): AddressClass {
  const o = ipv4Octets(address);
  if (!o) return "blocked";
  const [a, b] = o as [number, number, number, number];
  if (a === 127) return "loopback";
  if (a === 0 || a >= 224) return "blocked";
  if (a === 169 && b === 254) return "blocked";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "private";
  return "public";
}

function expandIpv6(address: string): number[] | null {
  let addr = address.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);
  const lastColon = addr.lastIndexOf(":");
  const maybeV4 = addr.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const o = ipv4Octets(maybeV4);
    if (!o) return null;
    const hi = ((o[0]! << 8) | o[1]!).toString(16);
    const lo = ((o[2]! << 8) | o[3]!).toString(16);
    addr = `${addr.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) => (s ? s.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN)) : []);
  const head = parse(halves[0] ?? "");
  const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function classifyIpv6(address: string): AddressClass {
  const g = expandIpv6(address);
  if (!g) return "blocked";
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return classifyIpv4(`${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`);
  }
  if (g.slice(0, 7).every((x) => x === 0)) return g[7] === 1 ? "loopback" : "blocked";
  const first = g[0]!;
  if ((first & 0xffc0) === 0xfe80) return "blocked";
  if ((first & 0xff00) === 0xff00) return "blocked";
  if ((first & 0xfe00) === 0xfc00) return "private";
  return "public";
}

export function classifyAddress(address: string): AddressClass {
  const family = isIP(address);
  if (family === 4) return classifyIpv4(address);
  if (family === 6) return classifyIpv6(address);
  return "blocked";
}

export function parseScanTargetUrl(input: string): URL {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new Error("Enter a website URL to scan.");
  if (trimmed.length > MAX_SCAN_TARGET_URL_LENGTH) {
    throw new Error(`URLs longer than ${MAX_SCAN_TARGET_URL_LENGTH} characters are not supported.`);
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("That isn't a valid absolute URL (include http:// or https://).");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http and https URLs can be scanned (got ${url.protocol}).`);
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not accepted.");
  }
  if (!url.hostname) {
    throw new Error("The URL has no host name.");
  }
  url.hash = "";
  return url;
}

function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

function bareHostname(url: URL): string {
  return url.hostname.replace(/^\[(.*)\]$/, "$1");
}

export async function assertScanTargetAllowed(url: URL, policy: ScanTargetPolicy): Promise<void> {
  const host = bareHostname(url).toLowerCase();
  let addresses: ResolvedAddress[];
  if (isIP(host)) {
    addresses = [{ address: host, family: isIP(host) }];
  } else if (host === "localhost" || host.endsWith(".localhost")) {
    addresses = [{ address: "127.0.0.1", family: 4 }];
  } else {
    try {
      addresses = await (policy.lookup ?? defaultLookup)(host);
    } catch {
      throw new Error(`Couldn't resolve “${host}”. Check the address and your network connection.`);
    }
    if (addresses.length === 0) {
      throw new Error(`Couldn't resolve “${host}”.`);
    }
  }

  for (const { address } of addresses) {
    const kind = classifyAddress(address);
    if (kind === "blocked") {
      throw new Error(
        `“${host}” resolves to ${address}, a link-local, multicast, or reserved address that LayoutLens won't scan.`,
      );
    }
    if (kind === "private" && !policy.allowPrivateNetwork) {
      throw new Error(
        `“${host}” resolves to the private address ${address}. Private-network scanning is disabled (set allowPrivateNetwork).`,
      );
    }
    if (kind === "loopback" && policy.blockedLoopbackPorts().includes(effectivePort(url))) {
      throw new Error("LayoutLens can't scan its own Studio or API server port.");
    }
  }
}
