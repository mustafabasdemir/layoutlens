import {
  SCAN_API_PREFIX,
  SCAN_API_SERVICE,
  type CreateScanRequestBody,
  type ScanJobView,
  type ScanListResponse,
  type ScanServiceInfo,
} from "@layoutlens/shared";

/** Client for the local scanning API served by `@layoutlens/server` on the Studio origin. */

export class ScanApiError extends Error {
  override name = "ScanApiError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The local scanning service isn't reachable (e.g. Studio opened from a static build). */
export class ScanServiceUnavailableError extends ScanApiError {
  override name = "ScanServiceUnavailableError";
  constructor() {
    super(
      0,
      "service_unavailable",
      "The local LayoutLens scanning service isn't running. Start Studio with `pnpm studio` (or `pnpm studio:serve`) and try again.",
    );
  }
}

export interface ScanApi {
  health(): Promise<ScanServiceInfo>;
  startScan(url: string): Promise<ScanJobView>;
  getScan(id: string): Promise<ScanJobView>;
  listScans(): Promise<ScanJobView[]>;
  getResults(id: string): Promise<unknown>;
  cancelScan(id: string): Promise<ScanJobView>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function createScanApi(fetchImpl: FetchLike = (input, init) => fetch(input, init)): ScanApi {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${SCAN_API_PREFIX}${path}`, {
        credentials: "same-origin",
        cache: "no-store",
        ...init,
        headers: { Accept: "application/json", ...(init?.headers ?? {}) },
      });
    } catch {
      throw new ScanServiceUnavailableError();
    }
    const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
    if (!isJson) throw new ScanServiceUnavailableError();
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ScanServiceUnavailableError();
    }
    if (!res.ok) {
      const err = isRecord(body) && isRecord(body.error) ? body.error : {};
      throw new ScanApiError(
        res.status,
        typeof err.code === "string" ? err.code : "http_error",
        typeof err.message === "string" ? err.message : `The scanning service returned HTTP ${res.status}.`,
      );
    }
    return body as T;
  }

  const id = (scanId: string) => encodeURIComponent(scanId);

  return {
    async health() {
      const info = await request<ScanServiceInfo>("/health");
      if (!isRecord(info) || info.service !== SCAN_API_SERVICE) throw new ScanServiceUnavailableError();
      return info;
    },
    startScan(url) {
      const body: CreateScanRequestBody = { url };
      return request<ScanJobView>("/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    getScan: (scanId) => request<ScanJobView>(`/scans/${id(scanId)}`),
    async listScans() {
      const res = await request<ScanListResponse>("/scans");
      return Array.isArray(res.scans) ? res.scans : [];
    },
    getResults: (scanId) => request<unknown>(`/scans/${id(scanId)}/results`),
    cancelScan: (scanId) => request<ScanJobView>(`/scans/${id(scanId)}/cancel`, { method: "POST" }),
  };
}

export const scanApi = createScanApi();

/** Equivalent CLI command, offered when the scanning service isn't running. */
export function cliCommandFor(url: string): string {
  return `pnpm cli scan ${JSON.stringify(url)} --format html --output ./layoutlens-report`;
}
