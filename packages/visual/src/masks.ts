import type {
  VisualMaskRegion,
  VisualViewportMask,
  ViewportWidth,
} from "@layoutlens/shared";

export function masksForViewport(
  masks: VisualViewportMask[] | undefined,
  width: ViewportWidth,
): VisualMaskRegion[] {
  if (!masks || masks.length === 0) {
    return [];
  }
  const regions: VisualMaskRegion[] = [];
  for (const mask of masks) {
    if (mask.viewport === "all" || mask.viewport === width) {
      regions.push(...mask.regions);
    }
  }
  return regions;
}

/** Copy baseline pixels into actual inside mask regions so masked areas always match. */
export function applyMaskRegions(
  baseline: Buffer,
  actual: Buffer,
  width: number,
  height: number,
  regions: VisualMaskRegion[],
): void {
  for (const region of regions) {
    const x0 = Math.max(0, Math.floor(region.x));
    const y0 = Math.max(0, Math.floor(region.y));
    const x1 = Math.min(width, Math.ceil(region.x + region.width));
    const y1 = Math.min(height, Math.ceil(region.y + region.height));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const idx = (width * y + x) * 4;
        actual[idx] = baseline[idx]!;
        actual[idx + 1] = baseline[idx + 1]!;
        actual[idx + 2] = baseline[idx + 2]!;
        actual[idx + 3] = baseline[idx + 3]!;
      }
    }
  }
}
