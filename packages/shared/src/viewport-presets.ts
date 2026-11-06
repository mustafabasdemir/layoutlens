/**
 * Phase 10 — configurable viewport dimensions. Default presets match the historical width-only scans
 * (390×844, 768×1024, 1440×900).
 */

export interface ViewportSpec {
  readonly width: number;
  readonly height: number;
  /** Short label for UI and reports (e.g. "mobile"). */
  readonly label: string;
  /** Preset id when this row matches a built-in preset. */
  readonly preset?: "mobile" | "tablet" | "desktop";
}

export const DEFAULT_VIEWPORT_SPECS: readonly ViewportSpec[] = [
  { width: 390, height: 844, label: "mobile", preset: "mobile" },
  { width: 768, height: 1024, label: "tablet", preset: "tablet" },
  { width: 1440, height: 900, label: "desktop", preset: "desktop" },
] as const;

/** Stable file id: default presets use legacy `viewport-{w}.png`; other sizes use `viewport-{w}x{h}.png`. */
export function viewportArtifactBasename(width: number, height: number): string {
  const isDefaultPreset = DEFAULT_VIEWPORT_SPECS.some((s) => s.width === width && s.height === height);
  return isDefaultPreset ? `viewport-${width}.png` : `viewport-${width}x${height}.png`;
}

/** Kept for backward compatibility — the default widths checked on every run unless overridden. */
export const VIEWPORT_WIDTHS = DEFAULT_VIEWPORT_SPECS.map((v) => v.width) as readonly number[];

export type ViewportWidth = number;

const DIM_MIN = 200;
const DIM_MAX = 4096;

export function isDefaultPresetDimensions(width: number, height: number): boolean {
  return DEFAULT_VIEWPORT_SPECS.some((s) => s.width === width && s.height === height);
}

export function viewportLabelForDimensions(width: number, height: number): string {
  const hit = DEFAULT_VIEWPORT_SPECS.find((s) => s.width === width && s.height === height);
  return hit?.label ?? `${width}×${height}`;
}

/** Label for reports; width-only lookup matches the default preset row for that width. */
export function getViewportLabel(width: number, height?: number): string {
  if (height !== undefined) {
    const exact = DEFAULT_VIEWPORT_SPECS.find((s) => s.width === width && s.height === height);
    if (exact) return exact.label;
    return viewportLabelForDimensions(width, height);
  }
  const byWidth = DEFAULT_VIEWPORT_SPECS.find((s) => s.width === width);
  return byWidth?.label ?? `${width}px`;
}

/** Validate and normalize user-provided viewports; falls back to defaults when empty/invalid. */
export function mergeViewportSpecs(partial?: readonly Partial<ViewportSpec>[] | null): ViewportSpec[] {
  if (!partial || partial.length === 0) {
    return [...DEFAULT_VIEWPORT_SPECS];
  }
  const out: ViewportSpec[] = [];
  const seen = new Set<string>();
  for (const row of partial) {
    const w = clampInt(row.width, NaN, DIM_MIN, DIM_MAX);
    const h = clampInt(row.height, NaN, DIM_MIN, DIM_MAX);
    if (!Number.isFinite(w) || !Number.isFinite(h)) continue;
    const key = `${w}×${h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const presetMatch = DEFAULT_VIEWPORT_SPECS.find((s) => s.width === w && s.height === h);
    const label =
      typeof row.label === "string" && row.label.trim().length > 0
        ? row.label.trim().slice(0, 40)
        : presetMatch?.label ?? viewportLabelForDimensions(w, h);
    out.push({
      width: w,
      height: h,
      label,
      ...(presetMatch?.preset ? { preset: presetMatch.preset } : {}),
    });
    if (out.length >= 12) break;
  }
  return out.length > 0 ? out : [...DEFAULT_VIEWPORT_SPECS];
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
