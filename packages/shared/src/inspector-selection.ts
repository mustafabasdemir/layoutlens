import type { InspectorElementNode } from "./inspector.js";
import type { HitTestAtPointResult } from "./inspector-hit-test.js";

export interface InspectorPickResult {
  primaryId: string | null;
  /** Other plausible targets (deepest-first when no grid match), for cycling UI. */
  candidates: string[];
  uncertain: boolean;
}

const INTERACTIVE_TAGS = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "option",
  "summary",
]);

function isInteractiveNode(n: InspectorElementNode): boolean {
  if (n.tagName && INTERACTIVE_TAGS.has(n.tagName)) return true;
  const pe = n.computed.pointerEvents;
  if (pe && pe !== "none" && pe !== "auto") return true;
  return false;
}

function areaOf(n: InspectorElementNode): number {
  const b = n.visibleBox.width > 0 && n.visibleBox.height > 0 ? n.visibleBox : n.boundingBox;
  return Math.max(0, b.width) * Math.max(0, b.height);
}

function pointInBox(
  px: number,
  py: number,
  box: { x: number; y: number; width: number; height: number },
): boolean {
  return px >= box.x && py >= box.y && px <= box.x + box.width && py <= box.y + box.height;
}

/** Collect ids whose visible (or bounding) box contains the point. */
function containingIdsAtPoint(
  elements: readonly InspectorElementNode[],
  byId: ReadonlyMap<string, InspectorElementNode>,
  x: number,
  y: number,
): string[] {
  const ids: string[] = [];
  for (const el of elements) {
    const vb = el.visibleBox;
    if (vb.width > 0 && vb.height > 0 && pointInBox(x, y, vb)) {
      ids.push(el.id);
      continue;
    }
    if ((vb.width <= 0 || vb.height <= 0) && pointInBox(x, y, el.boundingBox)) {
      ids.push(el.id);
    }
  }
  return ids;
}

/**
 * Choose the best element for a click given coarse grid evidence and geometry.
 * Prefers capture-time stacking order when the click is near a grid sample; otherwise deepest interactive or smallest area.
 */
export function pickInspectorTarget(
  hit: HitTestAtPointResult,
  byId: ReadonlyMap<string, InspectorElementNode>,
  elements: readonly InspectorElementNode[],
  layoutX: number,
  layoutY: number,
): InspectorPickResult {
  const containing = containingIdsAtPoint(elements, byId, layoutX, layoutY);
  const set = new Set(containing);
  const { gridOrderedIds } = hit;

  let primaryId: string | null = null;
  let uncertain = false;

  if (gridOrderedIds && gridOrderedIds.length > 0) {
    const orderedInHit = gridOrderedIds.filter((id) => set.has(id));
    if (orderedInHit.length === 1) {
      primaryId = orderedInHit[0]!;
      uncertain = containing.length > 1;
    } else if (orderedInHit.length > 1) {
      primaryId = orderedInHit[0]!;
      uncertain = true;
    }
  }

  if (!primaryId && containing.length === 1) {
    primaryId = containing[0]!;
    uncertain = false;
  }

  if (!primaryId && containing.length > 0) {
    const scored = containing.map((id) => {
      const n = byId.get(id);
      if (!n) return { id, score: -1 };
      const interactive = isInteractiveNode(n) ? 1000 : 0;
      const depthScore = n.depth * 10;
      const invArea = 1 / (areaOf(n) + 1);
      return { id, score: interactive + depthScore + invArea };
    });
    scored.sort((a, b) => b.score - a.score);
    primaryId = scored[0]!.id;
    uncertain = containing.length > 1;
  }

  let candidates: string[] = [];
  if (gridOrderedIds && gridOrderedIds.length > 0) {
    const o = gridOrderedIds.filter((id) => set.has(id));
    if (o.length > 0) candidates = o;
  }
  if (candidates.length === 0 && containing.length > 0) {
    candidates = [...containing].sort((a, b) => {
      const na = byId.get(a);
      const nb = byId.get(b);
      if (!na || !nb) return 0;
      if (nb.depth !== na.depth) return nb.depth - na.depth;
      return areaOf(na) - areaOf(nb);
    });
  }

  if (primaryId && !candidates.includes(primaryId)) {
    candidates = [primaryId, ...candidates.filter((id) => id !== primaryId)];
  }

  return { primaryId, candidates, uncertain };
}
