/**
 * The decorative strip, arranged just inside a keyboard-shaped case outline.
 *
 * The board reports this zone as `1 × cols` — a 40-LED bar on the AE68 Pro —
 * so it gets a strip of cells at the width the device actually declares, not a
 * hard-coded count.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

type Placement = {
  column: number;
  row: number;
  edge: "top" | "right" | "bottom" | "left";
};

/**
 * The hardware addresses run anticlockwise around the case. The four measured
 * corners are 2 (top-right), 17 (top-left), 22 (bottom-left), and 37
 * (bottom-right). These are zero-based addresses; in the 1-based UI they are
 * LEDs 3, 18, 23, and 38. The remaining addresses fill each edge in order.
 */
export function lightBarPlacement(index: number): Placement {
  if (index >= 2 && index <= 17) {
    return { column: 18 - index, row: 1, edge: "top" };
  }
  if (index >= 18 && index <= 21) {
    return { column: 1, row: index - 16, edge: "left" };
  }
  if (index >= 22 && index <= 37) {
    return { column: index - 21, row: 6, edge: "bottom" };
  }
  // Right edge, top to bottom: 1, 0, 39, 38.
  return {
    column: 16,
    row: index >= 38 ? 43 - index : 3 - index,
    edge: "right",
  };
}

export function LightBar({
  count,
  color,
  custom,
  onPaint,
  onPaintEnd,
  onClear,
  className,
}: {
  count: number;
  /** Colour for LED `i` of `count`, or null when the zone is off. */
  color: (index: number, total: number) => string | null;
  /** Whether LED `i` is pinned instead of following the area effect. */
  custom?: (index: number) => boolean;
  onPaint?: (index: number) => void;
  onPaintEnd?: () => void;
  onClear?: (index: number) => void;
  className?: string;
}) {
  const stroke = React.useRef<{ live: boolean; last: number | null }>({
    live: false,
    last: null,
  });
  const endStroke = React.useRef<(() => void) | undefined>(undefined);
  endStroke.current = onPaintEnd;

  React.useEffect(() => {
    if (!onPaint) return;
    const stop = () => {
      if (!stroke.current.live) return;
      stroke.current = { live: false, last: null };
      endStroke.current?.();
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [onPaint]);

  if (count <= 0) return null;

  const interactive = Boolean(onPaint);

  const cell = (i: number, placement?: Placement) => {
    const fill = color(i, count);
    const pinned = custom?.(i) ?? false;
    const style: React.CSSProperties = fill ? { backgroundColor: fill } : {};
    if (placement) {
      style.gridColumn = placement.column;
      style.gridRow = placement.row;
    }

    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={pinned}
        aria-label={`Light bar LED ${i + 1}, address ${i}`}
        title={`Address ${i}`}
        key={i}
        className={cn(
          "relative z-10 rounded-[3px] border p-0 transition-colors",
          placement ? "h-6 w-6 place-self-center" : "h-11 w-3.5",
          fill ? "border-line" : "border-line bg-canvas-overlay opacity-40",
          interactive && "cursor-pointer hover:border-line-strong",
        )}
        style={style}
        onPointerDown={
          onPaint
            ? (e) => {
                if (e.button !== 0) return;
                stroke.current = { live: true, last: i };
                onPaint(i);
              }
            : undefined
        }
        onPointerOver={
          onPaint
            ? () => {
                if (!stroke.current.live || stroke.current.last === i) return;
                stroke.current.last = i;
                onPaint(i);
              }
            : undefined
        }
        onContextMenu={
          onClear
            ? (e) => {
                e.preventDefault();
                onClear(i);
              }
            : undefined
        }
      >
        {pinned ? (
          <span
            aria-hidden
            className="absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 shadow-sm"
          />
        ) : null}
      </button>
    );
  };

  if (count !== 40) {
    return (
      <div
        role={interactive ? "group" : "img"}
        aria-label={`Light bar, ${count} LEDs`}
        className={cn("flex min-w-max gap-[3px] rounded-md", className)}
      >
        {Array.from({ length: count }, (_, i) => cell(i))}
      </div>
    );
  }

  return (
    <div
      role={interactive ? "group" : "img"}
      aria-label={`Light bar, ${count} LEDs`}
      className={cn(
        "relative grid h-[286px] w-[720px] min-w-[720px] grid-cols-[repeat(16,minmax(0,1fr))] grid-rows-[repeat(6,minmax(0,1fr))] gap-[3px] rounded-xl border border-line bg-canvas-inset/70 p-2 shadow-inner",
        className,
      )}
    >
      {Array.from({ length: count }, (_, i) => cell(i, lightBarPlacement(i)))}
    </div>
  );
}
