import { describe, expect, it } from "vitest";
import { computeDocumentOverflow } from "./overflow.js";

describe("computeDocumentOverflow", () => {
  it("detects overflow when scroll width exceeds client width", () => {
    const result = computeDocumentOverflow(500, 390);
    expect(result.hasHorizontalOverflow).toBe(true);
    expect(result.overflowPx).toBe(110);
  });

  it("reports no overflow when widths match within tolerance", () => {
    const result = computeDocumentOverflow(390, 390);
    expect(result.hasHorizontalOverflow).toBe(false);
    expect(result.overflowPx).toBe(0);
  });

  it("ignores sub-pixel noise", () => {
    const result = computeDocumentOverflow(391, 390);
    expect(result.hasHorizontalOverflow).toBe(false);
  });
});
