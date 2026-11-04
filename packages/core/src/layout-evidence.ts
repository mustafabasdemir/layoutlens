/**
 * Raw layout measurements taken inside the page. No classification happens here;
 * see classify.ts for how the evidence is interpreted.
 */

export interface RawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RawClipper {
  selector: string;
  /** How many elements the selector matches (more than 1 means it is ambiguous, e.g. duplicate ids). */
  selectorMatches: number;
  tagName: string;
  overflowX: string;
  kind: "clip" | "scroll";
  rect: RawRect;
}

export interface RawCandidate {
  selector: string;
  selectorMatches: number;
  tagName: string;
  depth: number;
  /** Index of the nearest ancestor that is also a candidate, or -1. */
  parent: number;
  rect: RawRect;
  /** Right edge of overflowing content for overflow: visible boxes, else null. */
  contentRight: number | null;
  scrollWidth: number;
  clientWidth: number;
  position: string;
  transformed: boolean;
  invisible: boolean;
  /** position: fixed with the viewport as containing block — never scrolls with the page. */
  fixedToViewport: boolean;
  /** Intersection of all ancestor clip rects that apply to this element (null when none). */
  clip: RawRect | null;
  /** Index into `clippers` of the innermost / outermost ancestor that cut the element horizontally. */
  innerClipper: number;
  outerClipper: number;
  pattern: "horizontal-track" | null;
}

export interface RawLayoutEvidence {
  viewportWidth: number;
  documentScrollWidth: number;
  documentClientWidth: number;
  /** Effective overflow-x of the viewport after html → body propagation. */
  rootOverflowX: string;
  /** html or body clips horizontal overflow, so users cannot scroll to it. */
  rootClips: boolean;
  rtl: boolean;
  elementsInspected: number;
  candidatesOmitted: number;
  candidates: RawCandidate[];
  clippers: RawClipper[];
}

export interface CollectParams {
  viewportWidth: number;
  tolerance: number;
  maxCandidates: number;
}

/**
 * Runs in the browser via page.evaluate — must stay self-contained (no imports or outer references).
 */
export function collectLayoutEvidence(params: CollectParams): RawLayoutEvidence {
  const { viewportWidth, tolerance, maxCandidates } = params;
  const docEl = document.documentElement;
  const body = document.body;
  const htmlStyle = getComputedStyle(docEl);
  const bodyStyle = body ? getComputedStyle(body) : null;
  const rootOverflowX =
    htmlStyle.overflowX !== "visible" ? htmlStyle.overflowX : (bodyStyle?.overflowX ?? "visible");
  const bodyClipsItself = htmlStyle.overflowX !== "visible" && (bodyStyle?.overflowX ?? "visible") !== "visible";
  const scrollingElement = document.scrollingElement ?? docEl;
  const documentScrollWidth = scrollingElement.scrollWidth;
  const documentClientWidth = docEl.clientWidth || viewportWidth;
  const rtl = htmlStyle.direction === "rtl";

  const round = (n: number) => Math.round(n * 10) / 10;
  const toRect = (r: { x: number; y: number; width: number; height: number }) => ({
    x: round(r.x),
    y: round(r.y),
    width: round(r.width),
    height: round(r.height),
  });

  const buildSelector = (el: Element): string => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    let current: Element | null = el;
    while (current && current !== docEl && parts.length < 5) {
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
    return parts.join(" > ");
  };

  const countMatches = (selector: string): number => {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  };

  const styleCache = new Map<Element, CSSStyleDeclaration>();
  const styleOf = (el: Element) => {
    let s = styleCache.get(el);
    if (!s) {
      s = getComputedStyle(el);
      styleCache.set(el, s);
    }
    return s;
  };

  const establishesFixedContainingBlock = (s: CSSStyleDeclaration): boolean =>
    s.transform !== "none" ||
    s.perspective !== "none" ||
    s.filter !== "none" ||
    (s.backdropFilter !== undefined && s.backdropFilter !== "none" && s.backdropFilter !== "") ||
    /\b(paint|layout|strict|content)\b/.test(s.contain) ||
    /\b(transform|perspective|filter)\b/.test(s.willChange);

  type Mode = "flow" | "abs" | "fixed";
  const modeOf = (s: CSSStyleDeclaration): Mode =>
    s.position === "fixed" ? "fixed" : s.position === "absolute" ? "abs" : "flow";

  const clipKind = (s: CSSStyleDeclaration): { kind: "clip" | "scroll"; label: string } | null => {
    const ox = s.overflowX;
    if (ox === "auto" || ox === "scroll") return { kind: "scroll", label: ox };
    if (ox === "hidden" || ox === "clip") return { kind: "clip", label: ox };
    if (/\b(paint|strict|content)\b/.test(s.contain)) return { kind: "clip", label: `contain: ${s.contain}` };
    if (s.clipPath && s.clipPath !== "none") return { kind: "clip", label: "clip-path" };
    return null;
  };

  // Pass 1: find elements whose box or overflowing content crosses a viewport edge.
  const all = Array.from(body?.querySelectorAll("*") ?? []);
  const candidateEls: Element[] = [];
  const contentRightOf = new Map<Element, number | null>();
  let elementsInspected = 0;
  let candidatesOmitted = 0;
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "template" || tag === "noscript") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    elementsInspected += 1;
    const s = styleOf(el);
    let contentRight: number | null = null;
    if (
      el instanceof HTMLElement &&
      s.overflowX === "visible" &&
      s.display !== "inline" &&
      el.scrollWidth > el.clientWidth + tolerance
    ) {
      contentRight = rtl ? rect.right - el.clientLeft - el.scrollWidth : rect.left + el.clientLeft + el.scrollWidth;
    }
    let right = rect.right;
    let left = rect.left;
    if (contentRight !== null) {
      if (rtl) left = Math.min(left, contentRight);
      else right = Math.max(right, contentRight);
    }
    if (right > documentClientWidth + tolerance || left < -tolerance) {
      if (candidateEls.length >= maxCandidates) {
        candidatesOmitted += 1;
        continue;
      }
      candidateEls.push(el);
      contentRightOf.set(el, contentRight);
    }
  }

  const indexOf = new Map<Element, number>(candidateEls.map((el, i) => [el, i]));
  const clippers: RawClipper[] = [];
  const clipperIndex = new Map<Element, number>();
  const registerClipper = (el: Element, kind: { kind: "clip" | "scroll"; label: string }) => {
    let i = clipperIndex.get(el);
    if (i === undefined) {
      i = clippers.length;
      const selector = buildSelector(el);
      clippers.push({
        selector,
        selectorMatches: countMatches(selector),
        tagName: el.tagName.toLowerCase(),
        overflowX: kind.label,
        kind: kind.kind,
        rect: toRect(el.getBoundingClientRect()),
      });
      clipperIndex.set(el, i);
    }
    return i;
  };

  const detectTrack = (el: Element): "horizontal-track" | null => {
    const kids = Array.from(el.children).filter((k) => {
      const r = k.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (kids.length < 3) return null;
    const rects = kids.map((k) => k.getBoundingClientRect());
    const first = rects[0]!;
    const sameRow = rects.every((r) => Math.abs(r.top - first.top) <= 2);
    const sameWidth = rects.every((r) => Math.abs(r.width - first.width) <= 2);
    let ascending = true;
    for (let i = 1; i < rects.length; i++) {
      if (Math.abs(rects[i]!.left - rects[i - 1]!.left) < first.width * 0.5) ascending = false;
    }
    return sameRow && sameWidth && ascending ? "horizontal-track" : null;
  };

  const candidates: RawCandidate[] = candidateEls.map((el) => {
    const s = styleOf(el);
    const rect = el.getBoundingClientRect();
    let parent = -1;
    let depth = 1;
    for (let a = el.parentElement; a && a !== body && a !== docEl; a = a.parentElement) {
      if (parent === -1 && indexOf.has(a)) parent = indexOf.get(a)!;
      depth += 1;
    }

    // Walk ancestors applying overflow clipping only where CSS applies it:
    // abs/fixed boxes escape clipping ancestors below their containing block.
    let mode: Mode = modeOf(s);
    let transformed = s.transform !== "none";
    let clip: { l: number; t: number; r: number; b: number } | null = null;
    let innerClipper = -1;
    let outerClipper = -1;
    let curL = rect.left;
    let curR = rect.right;
    const contentRight = contentRightOf.get(el) ?? null;
    if (contentRight !== null) {
      if (rtl) curL = Math.min(curL, contentRight);
      else curR = Math.max(curR, contentRight);
    }
    // html/body clipping is the viewport's own clipping and is reported via rootClips instead.
    for (let a = el.parentElement; a && a !== body && a !== docEl; a = a.parentElement) {
      const as = styleOf(a);
      if (as.transform !== "none") transformed = true;
      let applies: boolean;
      if (mode === "flow") applies = true;
      else if (mode === "abs") applies = as.position !== "static" || establishesFixedContainingBlock(as);
      else applies = establishesFixedContainingBlock(as);
      if (!applies) continue;
      mode = modeOf(as);
      const kind = clipKind(as);
      if (!kind) continue;
      const ar = a.getBoundingClientRect();
      const next: { l: number; t: number; r: number; b: number } = clip
        ? { l: Math.max(clip.l, ar.left), t: Math.max(clip.t, ar.top), r: Math.min(clip.r, ar.right), b: Math.min(clip.b, ar.bottom) }
        : { l: ar.left, t: ar.top, r: ar.right, b: ar.bottom };
      const cutsHorizontally = next.l > curL + tolerance || next.r < curR - tolerance;
      clip = next;
      if (cutsHorizontally) {
        const ci = registerClipper(a, kind);
        if (innerClipper === -1) innerClipper = ci;
        outerClipper = ci;
        curL = Math.max(curL, next.l);
        curR = Math.min(curR, next.r);
      }
    }

    const invisible =
      typeof (el as HTMLElement).checkVisibility === "function"
        ? !(el as HTMLElement).checkVisibility({ opacityProperty: true, visibilityProperty: true })
        : s.visibility === "hidden" || parseFloat(s.opacity) === 0;

    const selector = buildSelector(el);
    return {
      selector,
      selectorMatches: countMatches(selector),
      tagName: el.tagName.toLowerCase(),
      depth,
      parent,
      rect: toRect(rect),
      contentRight: contentRight === null ? null : round(contentRight),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      position: s.position,
      transformed,
      invisible,
      fixedToViewport: mode === "fixed",
      clip: clip ? toRect({ x: clip.l, y: clip.t, width: Math.max(0, clip.r - clip.l), height: Math.max(0, clip.b - clip.t) }) : null,
      innerClipper,
      outerClipper,
      pattern: detectTrack(el),
    };
  });

  return {
    viewportWidth,
    documentScrollWidth,
    documentClientWidth,
    rootOverflowX,
    rootClips: rootOverflowX === "hidden" || rootOverflowX === "clip" || bodyClipsItself,
    rtl,
    elementsInspected,
    candidatesOmitted,
    candidates,
    clippers,
  };
}
