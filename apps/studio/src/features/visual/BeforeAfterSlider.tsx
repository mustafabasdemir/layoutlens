import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, n));
}

/** Divider position from a pointer X coordinate relative to the stage. */
export function percentFromPointer(clientX: number, rect: { left: number; width: number }): number {
  if (rect.width <= 0) return 50;
  return clampPercent(((clientX - rect.left) / rect.width) * 100);
}

/** CSS clip-path revealing the baseline from the left edge up to `percent`. */
export function baselineClipPath(percent: number): string {
  return `inset(0 ${100 - clampPercent(percent)}% 0 0)`;
}

export function keyboardStep(key: string, shift: boolean, current: number): number | null {
  const step = shift ? 10 : 1;
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return clampPercent(current - step);
    case "ArrowRight":
    case "ArrowUp":
      return clampPercent(current + step);
    case "PageDown":
      return clampPercent(current - 10);
    case "PageUp":
      return clampPercent(current + 10);
    case "Home":
      return 0;
    case "End":
      return 100;
    default:
      return null;
  }
}

/**
 * Baseline and current screenshots stacked in one coordinate space. Both layers fill
 * the same box; the baseline is revealed with clip-path, so the clip never depends
 * on measured element widths (which are 0 while a panel is hidden).
 */
export function BeforeAfterSlider({
  baselineSrc,
  currentSrc,
  initial = 50,
}: {
  baselineSrc: string;
  currentSrc: string;
  initial?: number;
}) {
  const [pos, setPos] = useState(clampPercent(initial));
  const stageRef = useRef<HTMLDivElement>(null);
  const activePointer = useRef<number | null>(null);

  function update(e: PointerEvent<HTMLDivElement>) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect) setPos(percentFromPointer(e.clientX, rect));
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = keyboardStep(e.key, e.shiftKey, pos);
    if (next === null) return;
    e.preventDefault();
    setPos(next);
  }

  const rounded = Math.round(pos);

  return (
    <div
      ref={stageRef}
      className="ba-stage"
      data-testid="ba-stage"
      data-position={rounded}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        activePointer.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => {
        if (activePointer.current === e.pointerId) update(e);
      }}
      onPointerUp={(e) => {
        activePointer.current = null;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
      }}
      onPointerCancel={() => {
        activePointer.current = null;
      }}
    >
      <img className="ba-layer ba-current" src={currentSrc} alt="After (current) screenshot" draggable={false} />
      <img
        className="ba-layer ba-baseline"
        src={baselineSrc}
        alt="Before (baseline) screenshot"
        draggable={false}
        style={{ clipPath: baselineClipPath(pos) }}
      />
      <span className="ba-tag ba-tag-left" aria-hidden="true">Before · Baseline</span>
      <span className="ba-tag ba-tag-right" aria-hidden="true">After · Current</span>
      <div className="ba-divider" style={{ left: `${pos}%` }} aria-hidden="true">
        <span className="ba-line" />
      </div>
      <div
        className="ba-handle"
        style={{ left: `${pos}%` }}
        role="slider"
        tabIndex={0}
        aria-label="Comparison divider: baseline on the left, current on the right"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
        aria-valuetext={`${rounded}% baseline visible`}
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <path d="M9 6l-6 6 6 6M15 6l6 6-6 6" />
        </svg>
      </div>
    </div>
  );
}
