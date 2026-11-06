import type { InspectorElementNode, InspectorHitTestGrid } from "./inspector.js";

export interface HitTestAtPointResult {
  /** Unordered ids whose layout box contains the point (degenerate z-order). */
  containingIds: string[];
  /** From coarse `hitTest` grid when the point lands in a cell; top-first when known. */
  gridOrderedIds: string[] | null;
  uncertain: boolean;
}

function pointInBox(px: number, py: number, box: { x: number; y: number; width: number; height: number }): boolean {
  return px >= box.x && py >= box.y && px <= box.x + box.width && py <= box.y + box.height;
}

/** Map a CSS-pixel point in layout viewport coordinates to element id candidates. */
export function hitTestInspectorAtPoint(
  elements: readonly InspectorElementNode[],
  hitTest: InspectorHitTestGrid | undefined,
  x: number,
  y: number,
): HitTestAtPointResult {
  const containingIds: string[] = [];
  for (const el of elements) {
    if (el.visibleBox.width > 0 && el.visibleBox.height > 0) {
      if (pointInBox(x, y, el.visibleBox)) containingIds.push(el.id);
      continue;
    }
    if (pointInBox(x, y, el.boundingBox)) containingIds.push(el.id);
  }

  let gridOrderedIds: string[] | null = null;
  if (hitTest?.samples?.length) {
    let best: { dist: number; sample: (typeof hitTest.samples)[0] } | null = null;
    for (const s of hitTest.samples) {
      const dx = s.x - x;
      const dy = s.y - y;
      const dist = dx * dx + dy * dy;
      if (!best || dist < best.dist) best = { dist, sample: s };
    }
    if (best && best.dist <= (hitTest.stepPx * hitTest.stepPx * 2)) {
      gridOrderedIds = [...best.sample.topIds];
    }
  }

  const uncertain =
    containingIds.length > 1 || (gridOrderedIds !== null && gridOrderedIds.length > 1 && containingIds.length > 0);
  return { containingIds, gridOrderedIds, uncertain };
}
