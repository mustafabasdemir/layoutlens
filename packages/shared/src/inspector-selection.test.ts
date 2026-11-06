import { describe, expect, it } from "vitest";
import { pickInspectorTarget } from "./inspector-selection.js";
import type { InspectorElementNode } from "./inspector.js";

function el(
  id: string,
  opts: Partial<InspectorElementNode> & Pick<InspectorElementNode, "boundingBox" | "visibleBox" | "depth">,
): InspectorElementNode {
  return {
    id,
    tagName: opts.tagName ?? "div",
    selector: opts.selector ?? `#${id}`,
    selectorMatches: opts.selectorMatches ?? 1,
    parentId: opts.parentId ?? null,
    depth: opts.depth,
    boundingBox: opts.boundingBox,
    visibleBox: opts.visibleBox,
    scrollWidth: 100,
    scrollHeight: 100,
    clientWidth: 100,
    clientHeight: 100,
    computed: opts.computed ?? {},
    relatedFindingIds: opts.relatedFindingIds ?? [],
  };
}

describe("pickInspectorTarget", () => {
  it("prefers grid top element when multiple contain the point", () => {
    const parent = el("p", {
      depth: 2,
      boundingBox: { x: 0, y: 0, width: 200, height: 200 },
      visibleBox: { x: 0, y: 0, width: 200, height: 200 },
    });
    const child = el("b", {
      depth: 4,
      tagName: "button",
      selector: "button",
      boundingBox: { x: 50, y: 50, width: 40, height: 30 },
      visibleBox: { x: 50, y: 50, width: 40, height: 30 },
      computed: { pointerEvents: "auto" },
    });
    const elements = [parent, child];
    const byId = new Map(elements.map((n) => [n.id, n] as const));
    const hit = {
      containingIds: ["p", "b"],
      gridOrderedIds: ["b", "p"],
      uncertain: true,
    };
    const r = pickInspectorTarget(hit, byId, elements, 60, 60);
    expect(r.primaryId).toBe("b");
    expect(r.candidates[0]).toBe("b");
  });

  it("prefers interactive tag when no grid match", () => {
    const wrap = el("w", {
      depth: 2,
      boundingBox: { x: 0, y: 0, width: 300, height: 300 },
      visibleBox: { x: 0, y: 0, width: 300, height: 300 },
    });
    const btn = el("btn", {
      depth: 3,
      tagName: "button",
      selector: "button",
      boundingBox: { x: 10, y: 10, width: 80, height: 32 },
      visibleBox: { x: 10, y: 10, width: 80, height: 32 },
    });
    const elements = [wrap, btn];
    const byId = new Map(elements.map((n) => [n.id, n] as const));
    const hit = { containingIds: ["w", "btn"], gridOrderedIds: null, uncertain: true };
    const r = pickInspectorTarget(hit, byId, elements, 50, 20);
    expect(r.primaryId).toBe("btn");
  });
});
