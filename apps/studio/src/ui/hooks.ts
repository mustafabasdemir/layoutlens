import { useEffect, useState, type RefObject } from "react";

export interface Size {
  width: number;
  height: number;
}

export function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export type ImageState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; naturalWidth: number; naturalHeight: number }
  | { status: "error" };

/** Load an image off-DOM to read its intrinsic size before rendering overlays. */
export function useImageSize(src: string | null): ImageState {
  const [state, setState] = useState<ImageState>(src ? { status: "loading" } : { status: "idle" });
  useEffect(() => {
    if (!src) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    const img = new Image();
    img.onload = () => {
      if (!cancelled) {
        setState({ status: "loaded", naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
      }
    };
    img.onerror = () => {
      if (!cancelled) setState({ status: "error" });
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return state;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}
