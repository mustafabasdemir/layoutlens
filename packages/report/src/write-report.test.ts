import { describe, expect, it } from "vitest";
import { resolveHtmlReportDirectory } from "./write-report.js";

describe("resolveHtmlReportDirectory", () => {
  it("treats paths without .html as directories", () => {
    expect(resolveHtmlReportDirectory("./layoutlens-report")).toBe(
      "./layoutlens-report",
    );
  });

  it("uses parent directory when output ends with .html", () => {
    expect(resolveHtmlReportDirectory("./out/report.html")).toBe("./out");
  });
});
