import { describe, expect, it } from "vitest";
import {
  VIEWPORT_WIDTHS,
  VIEWPORT_LABELS,
  getViewportLabel,
} from "./index.js";

describe("shared constants", () => {
  it("defines three standard viewport widths", () => {
    expect(VIEWPORT_WIDTHS).toEqual([390, 768, 1440]);
  });

  it("labels match widths", () => {
    expect(VIEWPORT_LABELS.map((v) => v.width)).toEqual([...VIEWPORT_WIDTHS]);
  });

  it("getViewportLabel returns known labels", () => {
    expect(getViewportLabel(390)).toBe("mobile");
    expect(getViewportLabel(768)).toBe("tablet");
    expect(getViewportLabel(1440)).toBe("desktop");
  });
});
