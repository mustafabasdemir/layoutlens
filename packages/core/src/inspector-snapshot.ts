/**
 * Bounded DOM + computed-style snapshot for Phase 9 Visual Inspector.
 * Runs in the page via Playwright `page.evaluate` — must be self-contained (no runtime imports).
 */

import type {
  InspectorElementNode,
  InspectorSnapshot,
  InspectorSnapshotMeta,
} from "@layoutlens/shared";

export interface InspectorFindingRef {
  id: string;
  selector: string;
}

export interface CollectInspectorSnapshotParams {
  viewportWidth: number;
  viewportHeight: number;
  maxElements: number;
  maxDepth: number;
  maxSelectorLength: number;
  maxHitTestSamples: number;
  findingRefs: InspectorFindingRef[];
}

interface InternalElement extends Omit<InspectorElementNode, "relatedFindingIds"> {
  relatedFindingIds: string[];
}

/**
 * Browser-side collection — no imports or outer references.
 */
export function collectInspectorSnapshotInPage(params: CollectInspectorSnapshotParams): InspectorSnapshot {
  const snapshotVersion = 1 as const;
  /** Same keys as `INSPECTOR_COMPUTED_STYLE_KEYS` in shared (keep in sync). */
  const stylePropKeys = [
    "display",
    "position",
    "boxSizing",
    "width",
    "height",
    "minWidth",
    "maxWidth",
    "minHeight",
    "maxHeight",
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "overflowX",
    "overflowY",
    "top",
    "right",
    "bottom",
    "left",
    "zIndex",
    "transform",
    "flexDirection",
    "flexWrap",
    "justifyContent",
    "alignItems",
    "gridTemplateColumns",
    "fontSize",
    "lineHeight",
    "whiteSpace",
    "textOverflow",
    "overflowWrap",
    "visibility",
    "opacity",
    "pointerEvents",
  ] as const;
  const declFor: Record<(typeof stylePropKeys)[number], keyof CSSStyleDeclaration> = {
    display: "display",
    position: "position",
    boxSizing: "boxSizing",
    width: "width",
    height: "height",
    minWidth: "minWidth",
    maxWidth: "maxWidth",
    minHeight: "minHeight",
    maxHeight: "maxHeight",
    marginTop: "marginTop",
    marginRight: "marginRight",
    marginBottom: "marginBottom",
    marginLeft: "marginLeft",
    paddingTop: "paddingTop",
    paddingRight: "paddingRight",
    paddingBottom: "paddingBottom",
    paddingLeft: "paddingLeft",
    borderTopWidth: "borderTopWidth",
    borderRightWidth: "borderRightWidth",
    borderBottomWidth: "borderBottomWidth",
    borderLeftWidth: "borderLeftWidth",
    overflowX: "overflowX",
    overflowY: "overflowY",
    top: "top",
    right: "right",
    bottom: "bottom",
    left: "left",
    zIndex: "zIndex",
    transform: "transform",
    flexDirection: "flexDirection",
    flexWrap: "flexWrap",
    justifyContent: "justifyContent",
    alignItems: "alignItems",
    gridTemplateColumns: "gridTemplateColumns",
    fontSize: "fontSize",
    lineHeight: "lineHeight",
    whiteSpace: "whiteSpace",
    textOverflow: "textOverflow",
    overflowWrap: "overflowWrap",
    visibility: "visibility",
    opacity: "opacity",
    pointerEvents: "pointerEvents",
  };

  const {
    viewportWidth,
    viewportHeight,
    maxElements,
    maxDepth,
    maxSelectorLength,
    maxHitTestSamples,
    findingRefs,
  } = params;
  const t0 = performance.now();
  const docEl = document.documentElement;
  const styleKeys = stylePropKeys;

  const round = (n: number) => Math.round(n * 10) / 10;
  const clampStr = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

  const buildSelector = (el: Element): string => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    let current: Element | null = el;
    while (current && current !== docEl && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift(`#${CSS.escape(current.id)}`);
        break;
      }
      const className = Array.from(current.classList).find(
        (c) => c.length > 0 && !/^(\d|js-|is-active)/.test(c),
      );
      if (className) part += `.${CSS.escape(className)}`;
      const parent: Element | null = current.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === current!.tagName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = parent;
    }
    return clampStr(parts.join(" > "), maxSelectorLength);
  };

  const countMatches = (selector: string): number => {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  };

  const vw = Math.min(viewportWidth, window.innerWidth || viewportWidth);
  const vh = Math.min(viewportHeight, window.innerHeight || viewportHeight);

  const intersectViewport = (r: DOMRectReadOnly) => {
    const left = Math.max(0, r.left);
    const top = Math.max(0, r.top);
    const right = Math.min(vw, r.right);
    const bottom = Math.min(vh, r.bottom);
    const w = Math.max(0, right - left);
    const h = Math.max(0, bottom - top);
    return { x: round(left), y: round(top), width: round(w), height: round(h) };
  };

  const findingByEl = new Map<Element, string[]>();
  for (const f of findingRefs) {
    let sel = f.selector;
    if (sel.length > maxSelectorLength) sel = sel.slice(0, maxSelectorLength);
    try {
      document.querySelectorAll(sel).forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as Element;
        const cur = findingByEl.get(el);
        if (cur) cur.push(f.id);
        else findingByEl.set(el, [f.id]);
      });
    } catch {
      /* invalid selector from report */
    }
  }

  const skipTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "LINK", "META", "BASE"]);

  const elements: InternalElement[] = [];
  const idForElement = new WeakMap<Element, string>();
  let seq = 0;
  let elementsOmitted = 0;
  let truncated = false;

  const pickComputed = (cs: CSSStyleDeclaration): InspectorElementNode["computed"] => {
    const out: InspectorElementNode["computed"] = {};
    for (const k of styleKeys) {
      const decl = declFor[k];
      const v = String(cs[decl] ?? "");
      if (v.length > 0) (out as Record<string, string>)[k] = v;
    }
    return out;
  };

  function depthFromRoot(el: Element): number {
    let d = 0;
    let n: Element | null = el;
    while (n && n !== docEl) {
      d++;
      n = n.parentElement;
    }
    return d;
  }

  function visit(root: Element, depth: number, parentAssignedId: string | null): void {
    if (elements.length >= maxElements) {
      truncated = true;
      return;
    }
    if (skipTags.has(root.tagName)) return;
    if (depth > maxDepth) {
      elementsOmitted++;
      return;
    }

    const id = `el_${seq++}`;
    const rect = root.getBoundingClientRect();
    const boundingBox = {
      x: round(rect.left),
      y: round(rect.top),
      width: round(rect.width),
      height: round(rect.height),
    };
    const vis = intersectViewport(rect);
    const cs = getComputedStyle(root);
    const sel = buildSelector(root);
    const sm = countMatches(sel);

    const htmlEl = root as HTMLElement;
    const node: InternalElement = {
      id,
      tagName: root.tagName.toLowerCase(),
      selector: sel,
      selectorMatches: sm,
      parentId: parentAssignedId,
      depth: depthFromRoot(root),
      boundingBox,
      visibleBox: vis,
      scrollWidth: htmlEl.scrollWidth,
      scrollHeight: htmlEl.scrollHeight,
      clientWidth: htmlEl.clientWidth,
      clientHeight: htmlEl.clientHeight,
      computed: pickComputed(cs),
      relatedFindingIds: [...(findingByEl.get(root) ?? [])],
    };

    elements.push(node);
    idForElement.set(root, id);

    for (const child of Array.from(root.children)) {
      if (!(child instanceof Element)) continue;
      visit(child, depth + 1, id);
      if (elements.length >= maxElements) {
        truncated = true;
        return;
      }
    }
  }

  const body = document.body;
  if (body) visit(body, 0, null);
  else visit(docEl, 0, null);

  let hitTest: InspectorSnapshot["hitTest"];
  if (elements.length > 0 && maxHitTestSamples > 0) {
    let stepPx = 24;
    let gridCells = Math.ceil(vw / stepPx) * Math.ceil(vh / stepPx);
    while (gridCells > maxHitTestSamples && stepPx < 512) {
      stepPx += 8;
      gridCells = Math.ceil(vw / stepPx) * Math.ceil(vh / stepPx);
    }
    const samples: { x: number; y: number; topIds: string[] }[] = [];
    const inSnapshot = new Set(elements.map((e) => e.id));
    for (let y = stepPx / 2; y < vh; y += stepPx) {
      for (let x = stepPx / 2; x < vw; x += stepPx) {
        let stack: Element[];
        try {
          stack = document.elementsFromPoint(x, y) as Element[];
        } catch {
          continue;
        }
        const topIds: string[] = [];
        for (const raw of stack) {
          if (!(raw instanceof Element)) continue;
          const sid = idForElement.get(raw);
          if (sid && inSnapshot.has(sid) && !topIds.includes(sid)) topIds.push(sid);
          if (topIds.length >= 24) break;
        }
        if (topIds.length > 0) {
          samples.push({ x: round(x), y: round(y), topIds });
        }
      }
    }
    hitTest = { stepPx: round(stepPx), samples };
  }

  const meta: InspectorSnapshotMeta = {
    version: snapshotVersion,
    elementCount: elements.length,
    devicePixelRatio: typeof window.devicePixelRatio === "number" ? window.devicePixelRatio : 1,
    viewportWidth: vw,
    viewportHeight: vh,
    collectionDurationMs: Math.round(performance.now() - t0),
    truncated,
    elementsOmitted,
    maxDepth,
    maxElements,
    maxSelectorLength,
  };

  return { meta, elements, ...(hitTest ? { hitTest } : {}) };
}
