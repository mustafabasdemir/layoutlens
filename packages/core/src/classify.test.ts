import { describe, expect, it } from "vitest";
import { classifyLayoutEvidence } from "./classify.js";
import type { RawCandidate, RawClipper, RawLayoutEvidence } from "./layout-evidence.js";

const V = 390;

function cand(partial: Partial<RawCandidate> & Pick<RawCandidate, "selector" | "rect">): RawCandidate {
  return {
    selectorMatches: 1,
    tagName: "div",
    depth: 2,
    parent: -1,
    contentRight: null,
    scrollWidth: partial.rect.width,
    clientWidth: partial.rect.width,
    position: "static",
    transformed: false,
    invisible: false,
    fixedToViewport: false,
    clip: null,
    innerClipper: -1,
    outerClipper: -1,
    pattern: null,
    ...partial,
  };
}

function evidence(partial: Partial<RawLayoutEvidence>): RawLayoutEvidence {
  return {
    viewportWidth: V,
    documentScrollWidth: V,
    documentClientWidth: V,
    rootOverflowX: "visible",
    rootClips: false,
    rtl: false,
    elementsInspected: 100,
    candidatesOmitted: 0,
    candidates: [],
    clippers: [],
    ...partial,
  };
}

const carouselClipper: RawClipper = {
  selector: ".carousel",
  selectorMatches: 1,
  tagName: "div",
  overflowX: "hidden",
  kind: "clip",
  rect: { x: 16, y: 100, width: 358, height: 200 },
};

describe("classifyLayoutEvidence", () => {
  it("excludes carousel slides clipped by their container and groups them under it", () => {
    const slides = Array.from({ length: 30 }, (_, i) =>
      cand({
        selector: `.slide:nth-of-type(${i + 2})`,
        rect: { x: 16 + 358 * (i + 1), y: 100, width: 358, height: 200 },
        clip: { x: 16, y: 100, width: 358, height: 200 },
        innerClipper: 0,
        outerClipper: 0,
        transformed: true,
      }),
    );
    const r = classifyLayoutEvidence(evidence({ candidates: slides, clippers: [carouselClipper] }));
    expect(r.findings).toEqual([]);
    expect(r.excluded).toHaveLength(1);
    expect(r.excluded[0]).toMatchObject({ reason: "clipped-by-ancestor", selector: ".carousel", elementCount: 30 });
    expect(r.excluded[0]!.samples.length).toBeLessThanOrEqual(5);
    expect(r.analysis.userScrollable).toBe(false);
  });

  it("confirms an unclipped element only when the document really scrolls, capping contribution at the document overflow", () => {
    const wide = cand({ selector: "#wide", rect: { x: 0, y: 10, width: 5000, height: 40 } });
    const confirmed = classifyLayoutEvidence(evidence({ documentScrollWidth: 600, candidates: [wide] }));
    expect(confirmed.findings[0]).toMatchObject({
      classification: "confirmed",
      severity: "high",
      scrollContributionPx: 210,
      documentContributionPx: 4610,
      visibleBox: { x: 0, y: 10, width: 390, height: 40 },
    });

    const noScroll = classifyLayoutEvidence(evidence({ documentScrollWidth: V, candidates: [wide] }));
    expect(noScroll.findings[0]).toMatchObject({ classification: "insufficient-evidence", severity: "low", scrollContributionPx: 0 });
  });

  it("treats content cut off by a root overflow-x: hidden as potential (never high)", () => {
    const banner = cand({ selector: "#banner", rect: { x: 16, y: 100, width: 560, height: 40 } });
    const offscreen = cand({ selector: ".decor", rect: { x: 900, y: 0, width: 200, height: 200 } });
    const r = classifyLayoutEvidence(
      evidence({ documentScrollWidth: 1100, rootOverflowX: "hidden", rootClips: true, candidates: [banner, offscreen] }),
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ selector: "#banner", classification: "potential", severity: "medium" });
    expect(r.excluded[0]).toMatchObject({ selector: ".decor", reason: "offscreen" });
    expect(r.analysis.maskedOverflowPx).toBe(710);
    expect(r.analysis.unattributedOverflowPx).toBe(0);
  });

  it("separates closed off-canvas panels from partially cut-off fixed elements", () => {
    const drawer = cand({ selector: "#drawer", position: "fixed", fixedToViewport: true, rect: { x: 390, y: 0, width: 300, height: 844 } });
    const toast = cand({ selector: "#toast", position: "fixed", fixedToViewport: true, rect: { x: 200, y: 700, width: 300, height: 60 } });
    const r = classifyLayoutEvidence(evidence({ documentScrollWidth: V, candidates: [drawer, toast] }));
    expect(r.findings.map((f) => [f.selector, f.classification])).toEqual([["#toast", "potential"]]);
    expect(r.excluded.map((e) => [e.selector, e.reason])).toEqual([["#drawer", "offscreen"]]);
  });

  it("reports content inside a scroll container as intentional", () => {
    const table = cand({
      selector: "table",
      rect: { x: 16, y: 0, width: 900, height: 100 },
      clip: { x: 16, y: 0, width: 358, height: 100 },
      innerClipper: 0,
      outerClipper: 0,
    });
    const r = classifyLayoutEvidence(
      evidence({ candidates: [table], clippers: [{ ...carouselClipper, selector: ".table-wrap", overflowX: "auto", kind: "scroll" }] }),
    );
    expect(r.findings).toEqual([]);
    expect(r.excluded[0]).toMatchObject({ reason: "inside-scroll-container", selector: ".table-wrap" });
  });

  it("flags partly visible content past the left edge as potential and fully hidden skip links as offscreen", () => {
    const cut = cand({ selector: ".bleed", rect: { x: -80, y: 0, width: 300, height: 40 } });
    const skip = cand({ selector: ".skip-link", rect: { x: -9999, y: 0, width: 200, height: 20 } });
    const r = classifyLayoutEvidence(evidence({ candidates: [cut, skip] }));
    expect(r.findings.map((f) => [f.selector, f.classification])).toEqual([[".bleed", "potential"]]);
    expect(r.excluded.map((e) => e.selector)).toEqual([".skip-link"]);
  });

  it("groups children under the responsible container without merging unrelated issues", () => {
    const grid = cand({ selector: "#grid", rect: { x: 16, y: 0, width: 1000, height: 300 } });
    const cards = [0, 1, 2, 3].map((i) =>
      cand({ selector: `.card:nth-of-type(${i + 1})`, parent: 0, depth: 3, rect: { x: 16 + 250 * i, y: 0, width: 240, height: 300 } }),
    );
    const input = cand({ selector: "#newsletter", rect: { x: 16, y: 400, width: 520, height: 30 } });
    const r = classifyLayoutEvidence(
      evidence({ documentScrollWidth: 1016, candidates: [grid, ...cards.filter((c) => c.rect.x + c.rect.width > V), input] }),
    );
    expect(r.findings.map((f) => f.selector)).toEqual(["#grid", "#newsletter"]);
    expect(r.findings[0]!.relatedCount).toBe(3);
    expect(r.findings[0]!.related.map((x) => x.selector)).toContain(".card:nth-of-type(4)");
  });

  it("keeps a wrapper whose only overflow comes from a child out of the report", () => {
    const main = cand({ selector: "main", rect: { x: 0, y: 0, width: 390, height: 500 }, contentRight: 1220, scrollWidth: 1220, clientWidth: 390 });
    const banner = cand({ selector: "#wide-banner", parent: 0, depth: 2, rect: { x: 20, y: 0, width: 1200, height: 60 } });
    const r = classifyLayoutEvidence(evidence({ documentScrollWidth: 1220, candidates: [main, banner] }));
    expect(r.findings.map((f) => f.selector)).toEqual(["#wide-banner"]);
  });

  it("never silently truncates: limits are reported with omitted counts", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      cand({ selector: `#w${i}`, rect: { x: 0, y: i * 50, width: 400 + i * 10, height: 40 } }),
    );
    const r = classifyLayoutEvidence(evidence({ documentScrollWidth: 700, candidates: many, candidatesOmitted: 7 }), {
      findings: 25,
      related: 3,
    });
    expect(r.findings).toHaveLength(25);
    expect(r.analysis).toMatchObject({ findingLimit: 25, findingsOmitted: 5, candidatesOmitted: 7, candidateCount: 37 });
  });

  it("mirrors geometry for right-to-left documents", () => {
    const wide = cand({ selector: "#rtl-wide", rect: { x: -300, y: 0, width: 690, height: 40 } });
    const r = classifyLayoutEvidence(evidence({ rtl: true, documentScrollWidth: 690, candidates: [wide] }));
    expect(r.findings[0]).toMatchObject({ classification: "confirmed", scrollContributionPx: 300 });
    expect(r.findings[0]!.reason).toContain("left edge is 300px past");
  });
});
