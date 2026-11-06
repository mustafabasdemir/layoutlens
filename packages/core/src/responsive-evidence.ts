/**
 * Raw responsive measurements from the page. Classification happens in responsive-classify.ts.
 */

export interface RawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RawInteractive {
  selector: string;
  selectorMatches: number;
  tagName: string;
  rect: RawRect;
  visible: RawRect | null;
  invisible: boolean;
  disabled: boolean;
  role: string | null;
  tabIndex: number | null;
  position: string;
  pointerEvents: string;
  zIndex: number;
  /** Inside overflow-x/y auto|scroll ancestor. */
  inScrollContainer: boolean;
  /** Fully clipped horizontally relative to viewport (no painted intersection). */
  horizontalInaccessible: boolean;
  /** Intersects the viewport vertically (layout viewport Y range). */
  verticalIntersectsViewport: boolean;
  /** Entirely below the layout viewport (not an "offscreen control" defect). */
  belowTheFold: boolean;
  /** Nearest clipping ancestor selector if any. */
  clipSelector: string | null;
  clipOverflowX: string | null;
  /** Inside a closed/hidden nav, off-canvas panel, or aria-hidden subtree. */
  hiddenByUi: boolean;
  /** Author-hidden (inert, hidden, closed details, etc.) — offscreen detector skips. */
  intentionallyHidden: boolean;
}

export interface RawOverlapCandidate {
  targetSelector: string;
  targetTag: string;
  targetMatches: number;
  targetRect: RawRect;
  targetVisible: RawRect;
  blockerSelector: string;
  blockerTag: string;
  blockerMatches: number;
  blockerRect: RawRect;
  overlapAreaPx: number;
  coverageRatio: number;
  hitTestBlocked: boolean;
  targetPointerEvents: string;
  blockerPointerEvents: string;
  blockerPosition: string;
  targetZIndex: number;
  blockerZIndex: number;
  /** Blocker matches cookie / CMP / GDPR banner heuristics (not domain-specific). */
  likelyConsentOverlay: boolean;
}

export interface RawTextClipCandidate {
  selector: string;
  selectorMatches: number;
  tagName: string;
  rect: RawRect;
  visible: RawRect | null;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  overflowX: string;
  overflowY: string;
  whiteSpace: string;
  textOverflow: string;
  lineClamp: number | null;
  /** Used to filter sub-pixel / line-height metric noise. */
  fontSizePx: number;
  lineHeightPx: number;
  inScrollContainer: boolean;
  invisible: boolean;
  clipSelector: string | null;
  horizontalTrack: boolean;
  intentional: boolean;
}

export interface RawTouchCandidate {
  selector: string;
  selectorMatches: number;
  tagName: string;
  rect: RawRect;
  visible: RawRect | null;
  hitWidth: number;
  hitHeight: number;
  spacingToNearestPx: number | null;
  disabled: boolean;
  invisible: boolean;
  /** Same as interactive: nearest overflow clipping ancestor. */
  clipSelector: string | null;
  clipOverflowX: string | null;
  /** Inside collapsed/hidden nav — skip touch advisories. */
  hiddenByUi: boolean;
  intentionallyHidden: boolean;
}

export interface RawResponsiveEvidence {
  viewportWidth: number;
  viewportHeight: number;
  rootClips: boolean;
  elementsInspected: number;
  candidatesOmitted: number;
  interactives: RawInteractive[];
  overlaps: RawOverlapCandidate[];
  textClips: RawTextClipCandidate[];
  touchTargets: RawTouchCandidate[];
}

export interface ResponsiveCollectParams {
  viewportWidth: number;
  viewportHeight: number;
  maxElements: number;
  touchTargetMinPx: number;
  touchTargetSpacingPx: number;
  touchTargetsEnabled: boolean;
  overlapEnabled: boolean;
  textClippingEnabled: boolean;
  offscreenEnabled: boolean;
}

export function collectResponsiveEvidence(params: ResponsiveCollectParams): RawResponsiveEvidence {
  const {
    viewportWidth,
    viewportHeight,
    maxElements,
    touchTargetMinPx,
    touchTargetSpacingPx,
    touchTargetsEnabled,
    overlapEnabled,
    textClippingEnabled,
  } = params;

  const docEl = document.documentElement;
  const body = document.body;
  const tol = 1.5;
  const round = (n: number) => Math.round(n * 10) / 10;
  const toRect = (r: DOMRect): RawRect =>
    roundRect({ x: r.x, y: r.y, width: r.width, height: r.height });

  function roundRect(r: RawRect): RawRect {
    return { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) };
  }

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

  const parseZ = (s: CSSStyleDeclaration): number => {
    const z = parseInt(s.zIndex, 10);
    return Number.isFinite(z) ? z : 0;
  };

  const lineHeightToPx = (s: CSSStyleDeclaration, fontSize: number): number => {
    const lh = s.lineHeight;
    if (!lh || lh === "normal") return fontSize * 1.2;
    const v = parseFloat(lh);
    if (!Number.isFinite(v)) return fontSize * 1.2;
    if (/\bpx\b/i.test(lh)) return v;
    return v * fontSize;
  };

  const isInvisible = (el: Element, s: CSSStyleDeclaration): boolean =>
    typeof (el as HTMLElement).checkVisibility === "function"
      ? !(el as HTMLElement).checkVisibility({ opacityProperty: true, visibilityProperty: true })
      : s.visibility === "hidden" || parseFloat(s.opacity) === 0;

  const intersectArea = (a: RawRect, b: RawRect): number => {
    const l = Math.max(a.x, b.x);
    const t = Math.max(a.y, b.y);
    const r = Math.min(a.x + a.width, b.x + b.width);
    const bt = Math.min(a.y + a.height, b.y + b.height);
    if (r <= l || bt <= t) return 0;
    return (r - l) * (bt - t);
  };

  const visibleInViewport = (rect: RawRect): RawRect | null => {
    const l = Math.max(0, rect.x);
    const t = Math.max(0, rect.y);
    const r = Math.min(viewportWidth, rect.x + rect.width);
    const b = Math.min(viewportHeight, rect.y + rect.height);
    if (r <= l || b <= t) return null;
    return { x: round(l), y: round(t), width: round(r - l), height: round(b - t) };
  };

  const clipInfo = (
    el: Element,
  ): { visible: RawRect | null; inScroll: boolean; clipSelector: string | null; clipOx: string | null; hInacc: boolean } => {
    const rect = toRect(el.getBoundingClientRect());
    let clipL = rect.x;
    let clipR = rect.x + rect.width;
    let clipT = rect.y;
    let clipB = rect.y + rect.height;
    let inScroll = false;
    let clipSelector: string | null = null;
    let clipOx: string | null = null;
    for (let a = el.parentElement; a && a !== body && a !== docEl; a = a.parentElement) {
      const as = styleOf(a);
      const ox = as.overflowX;
      const oy = as.overflowY;
      if (ox === "auto" || ox === "scroll" || oy === "auto" || oy === "scroll") inScroll = true;
      const kind =
        ox === "hidden" || ox === "clip" || oy === "hidden" || oy === "clip"
          ? "clip"
          : ox === "auto" || ox === "scroll"
            ? "scroll"
            : null;
      if (!kind) continue;
      const ar = a.getBoundingClientRect();
      const nl = Math.max(clipL, ar.left);
      const nr = Math.min(clipR, ar.right);
      const nt = Math.max(clipT, ar.top);
      const nb = Math.min(clipB, ar.bottom);
      if (nl > clipL + tol || nr < clipR - tol) {
        clipSelector = buildSelector(a);
        clipOx = ox;
      }
      clipL = nl;
      clipR = nr;
      clipT = nt;
      clipB = nb;
    }
    if (clipR <= clipL || clipB <= clipT) {
      return { visible: null, inScroll, clipSelector, clipOx, hInacc: true };
    }
    const clipped = { x: clipL, y: clipT, width: clipR - clipL, height: clipB - clipT };
    const vis = visibleInViewport(clipped);
    const hInacc = vis === null || vis.width < tol;
    return { visible: vis ? roundRect(vis) : null, inScroll, clipSelector, clipOx, hInacc };
  };

  const verticalIntersectsViewport = (rect: RawRect): boolean =>
    rect.y + rect.height > -tol && rect.y < viewportHeight + tol;

  const belowTheFold = (rect: RawRect): boolean => rect.y >= viewportHeight - tol;

  const isInHiddenPopover = (el: Element): boolean => {
    let n: Element | null = el;
    while (n && n !== docEl) {
      if (n instanceof HTMLElement && n.hasAttribute("popover")) {
        try {
          return !n.matches(":popover-open");
        } catch {
          return false;
        }
      }
      n = n.parentElement;
    }
    return false;
  };

  const isInteractiveInClosedDetails = (el: Element): boolean => {
    let n: Element | null = el;
    while (n && n !== body && n !== docEl) {
      if (n instanceof HTMLDetailsElement && !n.open) {
        const sum = n.querySelector(":scope > summary");
        if (sum && (sum === el || sum.contains(el))) return false;
        return true;
      }
      n = n.parentElement;
    }
    return false;
  };

  /** Strong author-hiding: skip offscreen reporting (not a horizontal reachability bug). */
  const intentionallyHiddenContext = (el: Element, s: CSSStyleDeclaration): boolean => {
    let n: Element | null = el;
    for (let d = 0; d < 12 && n; d++, n = n.parentElement) {
      if (n === docEl) break;
      const h = n as HTMLElement;
      if (h.inert === true) return true;
      if (n.hasAttribute("inert")) return true;
      if (n.hasAttribute("hidden")) return true;
      const ns = n === el ? s : styleOf(n);
      if (ns.contentVisibility === "hidden") return true;
    }
    if (isInHiddenPopover(el)) return true;
    if (isInteractiveInClosedDetails(el)) return true;
    return false;
  };

  /**
   * UI-panel context (drawer / transformed off-canvas): used to suppress touch noise only.
   * Uses layout (fixed panel shifted past edge + overflow hidden), not class names.
   */
  const isShiftedOffCanvasPanel = (el: Element): boolean => {
    let n: Element | null = el;
    for (let depth = 0; depth < 8 && n && n !== body; depth++, n = n.parentElement) {
      const ns = styleOf(n);
      if (ns.display === "none" || ns.visibility === "hidden") return false;
      if (ns.position !== "fixed" && ns.position !== "absolute") continue;
      const tr = ns.transform;
      if (!tr || tr === "none") continue;
      const m = tr.match(/matrix(?:3d)?\(([^)]+)\)/);
      if (!m) continue;
      const p = m[1]!.split(/[\s,]+/).map(Number);
      const tx = p.length === 16 ? p[12] : p.length === 6 ? p[4] : 0;
      if (tx === undefined || !Number.isFinite(tx)) continue;
      if (Math.abs(tx) < 24) continue;
      const ox = ns.overflowX;
      const oy = ns.overflowY;
      if (ox === "hidden" || ox === "clip" || oy === "hidden" || oy === "clip") {
        if (tx <= -40 || tx >= viewportWidth - 20) return true;
      }
    }
    return false;
  };

  const isInteractive = (el: Element): boolean => {
    const tag = el.tagName.toLowerCase();
    if (tag === "a" || tag === "button" || tag === "input" || tag === "select" || tag === "textarea") return true;
    const s = styleOf(el);
    if (s.cursor === "pointer" && el.hasAttribute("onclick")) return true;
    const role = el.getAttribute("role");
    if (role && /^(button|link|menuitem|tab|checkbox|radio|switch|option)$/i.test(role)) return true;
    return false;
  };

  const isModalLike = (el: Element): boolean => {
    const role = el.getAttribute("role");
    if (role === "dialog" || role === "alertdialog") return true;
    if (el.classList.contains("modal") || el.classList.contains("overlay")) return true;
    return el.getAttribute("aria-modal") === "true";
  };

  const contains = (outer: Element, inner: Element): boolean =>
    outer === inner || outer.contains(inner);

  const htmlStyle = getComputedStyle(docEl);
  const bodyStyle = body ? getComputedStyle(body) : null;
  const rootOx = htmlStyle.overflowX !== "visible" ? htmlStyle.overflowX : (bodyStyle?.overflowX ?? "visible");
  const rootClips = rootOx === "hidden" || rootOx === "clip";

  const interactiveSelector =
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';

  const nodes = Array.from(body?.querySelectorAll(interactiveSelector) ?? []);
  let elementsInspected = 0;
  let candidatesOmitted = 0;
  const interactives: RawInteractive[] = [];

  for (const el of nodes) {
    if (elementsInspected >= maxElements) {
      candidatesOmitted += 1;
      continue;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    elementsInspected += 1;
    const s = styleOf(el);
    const clip = clipInfo(el);
    const selector = buildSelector(el);
    const rrect = toRect(rect);
    const vInt = verticalIntersectsViewport(rrect);
    const btf = belowTheFold(rrect);
    const intHidden = intentionallyHiddenContext(el, s);
    let subtreeAriaHidden = false;
    for (let a = el.parentElement; a && a !== docEl; a = a.parentElement) {
      if (a.getAttribute("aria-hidden") === "true") {
        subtreeAriaHidden = true;
        break;
      }
    }
    interactives.push({
      selector,
      selectorMatches: countMatches(selector),
      tagName: el.tagName.toLowerCase(),
      rect: rrect,
      visible: clip.visible,
      invisible: isInvisible(el, s),
      disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true",
      role: el.getAttribute("role"),
      tabIndex: el.hasAttribute("tabindex") ? parseInt(el.getAttribute("tabindex") ?? "0", 10) : null,
      position: s.position,
      pointerEvents: s.pointerEvents,
      zIndex: parseZ(s),
      inScrollContainer: clip.inScroll,
      horizontalInaccessible: clip.hInacc,
      verticalIntersectsViewport: vInt,
      belowTheFold: btf,
      clipSelector: clip.clipSelector,
      clipOverflowX: clip.clipOx,
      intentionallyHidden: intHidden || subtreeAriaHidden,
      hiddenByUi: isShiftedOffCanvasPanel(el),
    });
  }

  const overlaps: RawOverlapCandidate[] = [];
  if (overlapEnabled) {
    const likelyConsentOverlayBlocker = (el: Element, s: CSSStyleDeclaration): boolean => {
      const fixed = s.position === "fixed" || s.position === "sticky";
      if (!fixed) return false;
      const r = el.getBoundingClientRect();
      const wide = r.width >= viewportWidth * 0.82;
      const bottomAnchored = r.bottom >= viewportHeight - 28 && r.top > viewportHeight * 0.38;
      const z = parseZ(s);
      const veryHighZ = z >= 1000;
      const id = (el.id || "").toLowerCase();
      const cls = typeof el.className === "string" ? el.className.toLowerCase() : "";
      const role = (el.getAttribute("role") || "").toLowerCase();
      const combined = `${id} ${cls} ${role}`.toLowerCase();
      const token =
        /cookie|consent|gdpr|privacy|eu[\s_-]?cookie|cmp|onetrust|didomi|usercentrics|trustarc|quantcast/.test(combined);
      if (token && wide) return true;
      if (wide && bottomAnchored && veryHighZ) return true;
      if (role === "dialog" || el.getAttribute("aria-modal") === "true") {
        return wide && veryHighZ;
      }
      return false;
    };

    const blockers = Array.from(body?.querySelectorAll("*") ?? []).filter((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "html" || tag === "body") return false;
      if (tag === "main" || el.getAttribute("role") === "main") return false;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      if (r.bottom < 0 || r.top > viewportHeight || r.right < 0 || r.left > viewportWidth) return false;
      const s = styleOf(el);
      if (s.pointerEvents === "none") return false;
      if (isInvisible(el, s)) return false;
      const pos = s.position;
      const z = parseZ(s);
      const big = r.width * r.height > viewportWidth * viewportHeight * 0.2;
      /** Stacking overlays only — exclude static full-page flow (e.g. main) mistaken as a blocker. */
      if (pos === "fixed" || pos === "sticky") return true;
      if (z > 0) return true;
      if ((pos === "absolute" || pos === "relative") && big) return true;
      return false;
    });

    for (const t of nodes) {
      if (!isInteractive(t)) continue;
      const ts = styleOf(t);
      if (isInvisible(t, ts) || ts.pointerEvents === "none") continue;
      const tClip = clipInfo(t);
      if (!tClip.visible || tClip.visible.width < 8 || tClip.visible.height < 8) continue;
      if ((t as HTMLButtonElement).disabled) continue;

      const tRect = toRect(t.getBoundingClientRect());
      const tVis = tClip.visible;
      const tArea = tVis.width * tVis.height;

      for (const b of blockers) {
        if (contains(t, b) || contains(b, t)) continue;
        if (t.closest(".swiper") && b.closest(".swiper")) continue;
        /** Do not skip role=dialog blockers (e.g. cookie CMP) that sit above targets outside the dialog. */
        const bs = styleOf(b);
        const bRect = toRect(b.getBoundingClientRect());
        const area = intersectArea(tVis, bRect);
        if (area < 24) continue;
        const coverage = area / tArea;
        if (coverage < 0.2) continue;

        const samplePoints = [
          { x: tVis.x + tVis.width / 2, y: tVis.y + tVis.height / 2 },
          { x: tVis.x + 4, y: tVis.y + 4 },
          { x: tVis.x + tVis.width - 4, y: tVis.y + tVis.height - 4 },
        ];
        let blocked = 0;
        for (const p of samplePoints) {
          const hit = document.elementFromPoint(p.x, p.y);
          if (hit && !contains(t, hit) && hit !== t) blocked += 1;
        }
        const hitTestBlocked = blocked >= 2;
        if (!hitTestBlocked && coverage < 0.45) continue;

        overlaps.push({
          targetSelector: buildSelector(t),
          targetTag: t.tagName.toLowerCase(),
          targetMatches: countMatches(buildSelector(t)),
          targetRect: tRect,
          targetVisible: tVis,
          blockerSelector: buildSelector(b),
          blockerTag: b.tagName.toLowerCase(),
          blockerMatches: countMatches(buildSelector(b)),
          blockerRect: bRect,
          overlapAreaPx: round(area),
          coverageRatio: round(coverage * 1000) / 1000,
          hitTestBlocked,
          targetPointerEvents: ts.pointerEvents,
          blockerPointerEvents: bs.pointerEvents,
          blockerPosition: bs.position,
          targetZIndex: parseZ(ts),
          blockerZIndex: parseZ(bs),
          likelyConsentOverlay: likelyConsentOverlayBlocker(b, bs),
        });
        if (overlaps.length >= 200) break;
      }
      if (overlaps.length >= 200) break;
    }
  }

  const textClips: RawTextClipCandidate[] = [];
  if (textClippingEnabled) {
    const textTags = new Set(["p", "span", "a", "h1", "h2", "h3", "h4", "h5", "h6", "label", "li", "td", "th", "figcaption"]);
    for (const el of Array.from(body?.querySelectorAll("*") ?? [])) {
      if (textClips.length >= 150) break;
      const tag = el.tagName.toLowerCase();
      if (!textTags.has(tag) && !(el instanceof HTMLElement && el.innerText.trim().length > 0 && el.children.length === 0))
        continue;
      if (!(el.textContent ?? "").trim()) continue;
      const s = styleOf(el);
      if (isInvisible(el, s)) continue;
      const rect = toRect(el.getBoundingClientRect());
      if (rect.width < 20 || rect.height < 8) continue;
      const fontSizePx = parseFloat(s.fontSize) || 16;
      const lineHeightPx = lineHeightToPx(s, fontSizePx);
      const sw = el.scrollWidth;
      const cw = el.clientWidth;
      const sh = el.scrollHeight;
      const ch = el.clientHeight;
      const hClip = sw > cw + tol;
      const vClip = sh > ch + tol;
      if (!hClip && !vClip) continue;
      const clip = clipInfo(el);
      if (clip.inScroll && (s.overflowX === "auto" || s.overflowX === "scroll" || s.overflowY === "auto" || s.overflowY === "scroll"))
        continue;
      const lineClampMatch = s.webkitLineClamp ?? s.getPropertyValue("-webkit-line-clamp");
      const lineClamp = lineClampMatch && lineClampMatch !== "none" ? parseInt(lineClampMatch, 10) : null;
      const intentional =
        s.textOverflow === "ellipsis" ||
        (lineClamp !== null && Number.isFinite(lineClamp) && lineClamp > 0) ||
        s.display === "-webkit-box";
      let horizontalTrack = false;
      for (let a = el.parentElement; a && a !== body; a = a.parentElement) {
        if (a.classList.contains("swiper") || a.classList.contains("swiper-slide")) {
          horizontalTrack = true;
          break;
        }
      }
      if (horizontalTrack && clip.clipSelector) continue;

      textClips.push({
        selector: buildSelector(el),
        selectorMatches: countMatches(buildSelector(el)),
        tagName: tag,
        rect,
        visible: clip.visible,
        scrollWidth: sw,
        clientWidth: cw,
        scrollHeight: sh,
        clientHeight: ch,
        overflowX: s.overflowX,
        overflowY: s.overflowY,
        whiteSpace: s.whiteSpace,
        textOverflow: s.textOverflow,
        lineClamp: Number.isFinite(lineClamp) ? lineClamp : null,
        fontSizePx,
        lineHeightPx,
        inScrollContainer: clip.inScroll,
        invisible: false,
        clipSelector: clip.clipSelector,
        horizontalTrack,
        intentional,
      });
    }
  }

  const touchTargets: RawTouchCandidate[] = [];
  if (touchTargetsEnabled && viewportWidth <= 390) {
    const sorted = interactives
      .filter((i) => !i.invisible && !i.disabled && i.visible && !i.hiddenByUi && !i.intentionallyHidden)
      .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i]!;
      const vis = cur.visible ?? cur.rect;
      let spacing: number | null = null;
      for (let j = 0; j < sorted.length; j++) {
        if (i === j) continue;
        const other = sorted[j]!;
        const ov = other.visible ?? other.rect;
        const dx = Math.max(0, Math.max(cur.rect.x - (ov.x + ov.width), ov.x - (cur.rect.x + cur.rect.width)));
        const dy = Math.max(0, Math.max(cur.rect.y - (ov.y + ov.height), ov.y - (cur.rect.y + cur.rect.height)));
        const d = Math.max(dx, dy);
        if (spacing === null || d < spacing) spacing = d;
      }
      touchTargets.push({
        selector: cur.selector,
        selectorMatches: cur.selectorMatches,
        tagName: cur.tagName,
        rect: cur.rect,
        visible: cur.visible,
        hitWidth: round(vis.width),
        hitHeight: round(vis.height),
        spacingToNearestPx: spacing === null ? null : round(spacing),
        disabled: cur.disabled,
        invisible: cur.invisible,
        clipSelector: cur.clipSelector,
        clipOverflowX: cur.clipOverflowX,
        hiddenByUi: cur.hiddenByUi,
        intentionallyHidden: cur.intentionallyHidden,
      });
    }
  }

  return {
    viewportWidth,
    viewportHeight,
    rootClips,
    elementsInspected,
    candidatesOmitted,
    interactives,
    overlaps,
    textClips,
    touchTargets,
  };
}
