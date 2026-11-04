import { describe, expect, it } from "vitest";
import {
  classifySeverity,
  countSeverities,
  emptySeverityCounts,
} from "./severity.js";

describe("classifySeverity", () => {
  it("marks large contributions as high", () => {
    expect(classifySeverity(100, 390)).toBe("high");
    expect(classifySeverity(98, 390)).toBe("high");
  });

  it("marks moderate contributions as medium", () => {
    expect(classifySeverity(40, 390)).toBe("medium");
    expect(classifySeverity(20, 390)).toBe("medium");
  });

  it("marks small contributions as low", () => {
    expect(classifySeverity(5, 390)).toBe("low");
  });
});

describe("countSeverities", () => {
  it("aggregates counts", () => {
    expect(countSeverities(["high", "high", "low"])).toEqual({
      high: 2,
      medium: 0,
      low: 1,
    });
    expect(emptySeverityCounts()).toEqual({
      high: 0,
      medium: 0,
      low: 0,
    });
  });
});
