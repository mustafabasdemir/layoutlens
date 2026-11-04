import { describe, expect, it } from "vitest";
import { escapeHtml, safeJsonForHtmlScript } from "./escape.js";

describe("escapeHtml", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<img onerror="alert(1)">`)).toBe(
      "&lt;img onerror=&quot;alert(1)&quot;&gt;",
    );
  });
});

describe("safeJsonForHtmlScript", () => {
  it("neutralizes script-breaking sequences in JSON", () => {
    const payload = { url: "https://evil.com</script><script>alert(1)</script>" };
    const serialized = safeJsonForHtmlScript(payload);
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c/script\\u003e");
  });
});
