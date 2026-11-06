import { describe, expect, it } from "vitest";
import { hitTestInspectorAtPoint } from "./inspector-hit-test.js";
import type { InspectorElementNode } from "./inspector.js";

function node(
  id: string,
  box: { x: number; y: number; width: number; height: number },
  vb = box,
): InspectorElementNode {
  return {
    id,
    tagName: "div",
    selector: `#${id}`,
    selectorMatches: 1,
    parentId: null,
    depth: 2,
    boundingBox: box,
    visibleBox: vb,
    scrollWidth: box.width,
    scrollHeight: box.height,
    clientWidth: box.width,
    clientHeight: box.height,
    computed: { display: "block" },
    relatedFindingIds: [],
  };
}

describe("hitTestInspectorAtPoint", () => {
  it("returns candidates containing the point", () => {
    const elements = [
      node("parent", { x: 0, y: 0, width: 200, height: 200 }),
      node("child", { x: 50, y: 50, width: 20, height: 20 }),
    ];
    const hit = hitTestInspectorAtPoint(elements, undefined, 55, 55);
    expect(hit.containingIds.sort()).toEqual(["child", "parent"].sort());
    expect(hit.gridOrderedIds).toBeNull();
  });

  it("uses grid sample order when provided", () => {
    const elements = [node("a", { x: 0, y: 0, width: 100, height: 100 }), node("b", { x: 0, y: 0, width: 100, height: 100 })];
    const hitTest = {
      stepPx: 24,
      samples: [{ x: 12, y: 12, topIds: ["b", "a"] }],
    };
    const hit = hitTestInspectorAtPoint(elements, hitTest, 12, 12);
    const pick = hit.gridOrderedIds?.[0];
    expect(pick).toBe("b");
  });
});
