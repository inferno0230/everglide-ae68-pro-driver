/**
 * The board, drawn from what the device reported.
 *
 * Geometry comes from the layout-style read: `x` is a drawing coordinate in key
 * units, and `col` is the separately-resolved electrical column used to address
 * the key. Width is derived from the gap to the next key in the row rather than
 * from `ratio`, because `ratio` is a 4-bit field and cannot express a 6.25u
 * spacebar; `ratio` is still authoritative for knob and screen segments.
 */

import * as React from "react";
import type { PhysicalKey } from "@/hid/protocol/layout";
import { keyId } from "@/store/device";
import { cn } from "@/lib/utils";

const UNIT = 52; // px per key unit at scale 1
const GAP = 4;
const ROW_HEIGHT = UNIT;
const MAX_FIT_SCALE = 1.35;

export interface KeyGeometry extends PhysicalKey {
  id: string;
  width: number;
  kind: "key" | "knob" | "screen";
}

/** Resolve drawing widths for every key, row by row. */
export function useGeometry(keys: readonly PhysicalKey[]): {
  geometry: KeyGeometry[];
  rows: number[];
  widthUnits: number;
} {
  return React.useMemo(() => {
    const byRow = new Map<number, PhysicalKey[]>();
    for (const key of keys) {
      const list = byRow.get(key.row) ?? [];
      list.push(key);
      byRow.set(key.row, list);
    }

    const geometry: KeyGeometry[] = [];
    let widthUnits = 0;

    for (const [row, list] of byRow) {
      const sorted = [...list].sort((a, b) => a.x - b.x);
      sorted.forEach((key, i) => {
        const next = sorted[i + 1];
        // The gap to the next key is the honest width. A split-key gap would
        // overstate it, so cap at the widest real keycap (a 7u spacebar).
        const gap = next ? next.x - key.x : 1;
        const width = gap > 0 && gap <= 7 ? gap : Math.max(1, key.ratio / 4);
        geometry.push({
          ...key,
          id: keyId(key.row, key.col),
          width,
          kind:
            key.ratio === 12 ? "knob" : key.ratio >= 13 ? "screen" : "key",
        });
        widthUnits = Math.max(widthUnits, key.x + width);
      });
      void row;
    }

    return {
      geometry,
      rows: [...byRow.keys()].sort((a, b) => a - b),
      widthUnits,
    };
  }, [keys]);
}

export interface KeyRenderState {
  /** Fill colour for the cap. Omit to use the resting surface. */
  fill?: string;
  /** Legend colour chosen to remain readable over a custom fill. */
  foreground?: string;
  /** A 0-1 level drawn as a bar rising from the bottom of the cap. */
  level?: number;
  /** Right-hand corner mark: unsaved, clamped, etc. */
  mark?: "dirty" | "clamped" | "custom";
  /** Plain status text shown in the top-left corner of the key. */
  topLeft?: string;
  /** Plain status text shown in the bottom-left corner of the key. */
  bottomLeft?: string;
  /** Plain status text shown in the bottom-right corner of the key. */
  bottomRight?: string;
  /**
   * A short tag along the bottom of the cap — the vendor's own affordance for
   * "this key does something beyond its legend", and the only way to read an
   * advanced-key map at a glance.
   */
  badge?: string;
  /** Dimmed keys read as out of scope for the current task. */
  dim?: boolean;
}

export function KeyboardView({
  keys,
  selection,
  onSelect,
  onPaint,
  onPaintEnd,
  onClear,
  label,
  state,
  scale = 1,
  className,
  ariaLabel = "Keyboard layout",
}: {
  keys: readonly PhysicalKey[];
  selection: ReadonlySet<string>;
  onSelect?: (id: string, additive: boolean) => void;
  /**
   * Painting, which is a drag and not a click: crossing a key with the button
   * already down has to count, or colouring a row means 15 separate clicks.
   * Called once per key entered, never twice for the same key in one stroke.
   */
  onPaint?: (id: string) => void;
  /** End of a stroke. Buffer the keys and write them here, not per key. */
  onPaintEnd?: () => void;
  /** Right-click, the vendor's own gesture for handing a key back. */
  onClear?: (id: string) => void;
  /** The cap legend. */
  label: (key: KeyGeometry) => React.ReactNode;
  state?: (key: KeyGeometry) => KeyRenderState | undefined;
  scale?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const { geometry, rows, widthUnits } = useGeometry(keys);
  const unit = UNIT * scale;
  const boardWidth = widthUnits * unit;
  const boardHeight = rows.length * (unit + GAP) - GAP;
  const interactive = Boolean(onSelect) || Boolean(onPaint);

  // A stroke is held on the window, not on a key: the pointer leaves the key
  // it went down on immediately, and it has to end even if the button comes up
  // somewhere off the board entirely.
  const stroke = React.useRef<{ live: boolean; last: string | null }>({
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

  if (geometry.length === 0) return null;

  return (
    <div
      role={interactive ? "group" : undefined}
      aria-label={ariaLabel}
      className={cn("relative mx-auto select-none", className)}
      style={{
        width: "100%",
        minWidth: boardWidth,
        maxWidth: boardWidth * MAX_FIT_SCALE,
        aspectRatio: `${boardWidth} / ${boardHeight}`,
      }}
    >
      {geometry.map((key) => {
        const rowIndex = rows.indexOf(key.row);
        const selected = selection.has(key.id);
        const s = state?.(key);

        return (
          <KeyCap
            key={key.id}
            geometry={key}
            unit={unit}
            top={rowIndex * (ROW_HEIGHT * scale + GAP)}
            boardWidth={boardWidth}
            boardHeight={boardHeight}
            selected={selected}
            interactive={interactive}
            state={s}
            onSelect={onSelect}
            onPaintStart={
              onPaint
                ? (id) => {
                    stroke.current = { live: true, last: id };
                    onPaint(id);
                  }
                : undefined
            }
            onPaintEnter={
              onPaint
                ? (id) => {
                    // `pointerover` bubbles, so it also arrives from the cap's
                    // own children; and a stroke can wander back onto a key it
                    // already covered. Both are the same key twice.
                    if (!stroke.current.live || stroke.current.last === id) {
                      return;
                    }
                    stroke.current.last = id;
                    onPaint(id);
                  }
                : undefined
            }
            onClear={onClear}
          >
            {label(key)}
          </KeyCap>
        );
      })}
    </div>
  );
}

function KeyCap({
  geometry,
  unit,
  top,
  boardWidth,
  boardHeight,
  selected,
  interactive,
  state,
  onSelect,
  onPaintStart,
  onPaintEnter,
  onClear,
  children,
}: {
  geometry: KeyGeometry;
  unit: number;
  top: number;
  boardWidth: number;
  boardHeight: number;
  selected: boolean;
  interactive: boolean;
  state: KeyRenderState | undefined;
  onSelect: ((id: string, additive: boolean) => void) | undefined;
  onPaintStart: ((id: string) => void) | undefined;
  onPaintEnter: ((id: string) => void) | undefined;
  onClear: ((id: string) => void) | undefined;
  children: React.ReactNode;
}) {
  const width = geometry.width * unit - GAP;
  const height = unit - GAP;

  const style: React.CSSProperties = {
    left: `${(geometry.x * unit * 100) / boardWidth}%`,
    top: `${(top * 100) / boardHeight}%`,
    width: `${(width * 100) / boardWidth}%`,
    height: `${(height * 100) / boardHeight}%`,
  };
  if (state?.fill) style.backgroundColor = state.fill;
  if (state?.foreground) style.color = state.foreground;

  const content = (
    <>
      {/* Live level, drawn behind the legend so the label stays readable. */}
      {state?.level !== undefined && state.level > 0.01 ? (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 rounded-b-[3px] bg-accent/35"
          style={{ height: `${Math.min(1, state.level) * 100}%` }}
        />
      ) : null}

      <span
        className={cn(
          "relative z-10 truncate px-0.5 leading-none",
          width < 60 ? "text-3xs" : "text-2xs",
          // The badge takes the bottom strip, so the legend rides above it.
          state?.badge && "-translate-y-1",
        )}
      >
        {children}
      </span>

      {state?.badge ? (
        <span
          key={state.badge}
          className="absolute inset-x-0 bottom-0 z-10 animate-badge-in truncate rounded-b-[3px] bg-accent px-0.5 text-center text-3xs leading-[1.3] font-semibold text-white"
        >
          {state.badge}
        </span>
      ) : null}

      {state?.topLeft ? (
        <span className="absolute top-1 left-1 z-10 text-[10px] leading-none font-normal text-fg-subtle">
          {state.topLeft}
        </span>
      ) : null}

      {state?.bottomLeft ? (
        <span className="absolute bottom-1 left-1 z-10 text-[10px] leading-none font-normal text-fg-subtle">
          {state.bottomLeft}
        </span>
      ) : null}

      {state?.bottomRight ? (
        <span className="absolute right-1 bottom-1 z-10 text-[10px] leading-none font-semibold text-accent">
          {state.bottomRight}
        </span>
      ) : null}

      {state?.mark ? (
        <span
          aria-hidden
          className={cn(
            "absolute top-1 right-1 z-10 h-1.5 w-1.5 rounded-full",
            state.mark === "dirty" && "bg-attention",
            state.mark === "clamped" && "bg-danger",
            state.mark === "custom" && "bg-accent",
          )}
        />
      ) : null}
    </>
  );

  const shell = cn(
    "absolute flex items-center justify-center overflow-hidden rounded-[4px] ring-1 ring-inset",
    "transition-[background-color,color,box-shadow] duration-100",
    selected
      ? "bg-accent-subtle text-fg ring-accent"
      : "bg-canvas-overlay text-fg-muted ring-line",
    state?.dim && !selected && "opacity-40",
    interactive && !selected && "hover:text-fg hover:ring-line-strong",
    interactive && "cursor-pointer",
  );

  if (!interactive) {
    return (
      <div className={shell} style={style}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={`Row ${geometry.row} column ${geometry.col}`}
      className={shell}
      style={style}
      onClick={(e) => onSelect?.(geometry.id, e.shiftKey || e.metaKey || e.ctrlKey)}
      onPointerDown={
        onPaintStart
          ? (e) => {
              if (e.button === 0) onPaintStart(geometry.id);
            }
          : undefined
      }
      // `pointerover`, not `pointerenter`: enter/leave are not delegated the
      // way the bubbling pair is, and do not survive a drag reliably.
      onPointerOver={onPaintEnter ? () => onPaintEnter(geometry.id) : undefined}
      onContextMenu={
        onClear
          ? (e) => {
              e.preventDefault();
              onClear(geometry.id);
            }
          : undefined
      }
    >
      {content}
    </button>
  );
}
