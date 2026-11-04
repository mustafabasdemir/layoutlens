/** True when pixelmatch marked this RGBA pixel as different. */
export function isPixelmatchDiffPixel(
  diffBuffer: Buffer,
  pixelIndex: number,
): boolean {
  const idx = pixelIndex * 4;
  return (
    diffBuffer[idx]! > 0 ||
    diffBuffer[idx + 1]! > 0 ||
    diffBuffer[idx + 2]! > 0 ||
    diffBuffer[idx + 3]! > 0
  );
}

/**
 * Build a human-readable diff PNG: dimmed baseline context + magenta changed pixels.
 * Uses the existing pixelmatch diff buffer (no second comparison pass).
 */
export function buildHighlightDiffRgba(
  baselineRgba: Buffer,
  diffBuffer: Buffer,
  width: number,
  height: number,
): Buffer {
  const total = width * height;
  const out = Buffer.alloc(total * 4);
  const unchangedDim = 0.38;

  for (let i = 0; i < total; i += 1) {
    const idx = i * 4;
    if (isPixelmatchDiffPixel(diffBuffer, i)) {
      out[idx] = 255;
      out[idx + 1] = 0;
      out[idx + 2] = 180;
      out[idx + 3] = 255;
    } else {
      out[idx] = Math.round(baselineRgba[idx]! * unchangedDim);
      out[idx + 1] = Math.round(baselineRgba[idx + 1]! * unchangedDim);
      out[idx + 2] = Math.round(baselineRgba[idx + 2]! * unchangedDim);
      out[idx + 3] = 255;
    }
  }

  return out;
}
