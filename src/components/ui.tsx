/**
 * The component set, in Primer's vocabulary.
 *
 * GitHub dark is the named craft bar, so these follow its actual conventions:
 * 5px radii, 1px borders that lighten on hover, buttons that shift ground
 * rather than glow, and 12px labels above 13px controls.
 */

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// --- button ----------------------------------------------------------------

type ButtonVariant = "default" | "primary" | "danger" | "ghost";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  default:
    "bg-canvas-overlay text-fg border-line hover:bg-canvas-raised hover:border-line-strong active:bg-canvas-subtle",
  primary:
    "bg-[#238636] text-white border-[#2ea043]/60 hover:bg-[#2ea043] active:bg-[#1f7a31]",
  danger:
    "bg-canvas-overlay text-danger border-line hover:bg-danger hover:text-white hover:border-danger",
  ghost:
    "bg-transparent text-fg-muted border-transparent hover:bg-canvas-overlay hover:text-fg",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md border font-medium",
        "transition-colors duration-100",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-canvas-overlay",
        size === "sm" ? "h-6 px-2 text-2xs" : "h-7 px-3 text-xs",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";

// --- surfaces --------------------------------------------------------------

export function Panel({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-md border border-line bg-canvas-subtle",
        className,
      )}
      {...props}
    />
  );
}

export function PanelHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex h-9 items-center justify-between gap-3 border-b border-line px-3",
        "text-xs font-semibold text-fg",
        className,
      )}
      {...props}
    />
  );
}

// --- form scaffolding ------------------------------------------------------

export function Field({
  label,
  hint,
  control,
  htmlFor,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  control: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="block text-2xs font-semibold tracking-wide text-fg-muted uppercase"
      >
        {label}
      </label>
      {control}
      {hint ? <p className="text-2xs text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

// --- slider ----------------------------------------------------------------

export function Slider({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn(
        "relative flex h-4 w-full touch-none items-center select-none",
        "disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-canvas-overlay">
        <SliderPrimitive.Range className="absolute h-full bg-accent" />
      </SliderPrimitive.Track>
      {(props.value ?? props.defaultValue ?? [0]).map((_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          className={cn(
            "block h-3.5 w-3.5 rounded-full border border-line-strong bg-fg",
            "transition-colors hover:border-accent",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
}

// --- switch ----------------------------------------------------------------

export function Switch({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
        "border-line bg-canvas-overlay",
        "data-[state=checked]:border-[#2ea043] data-[state=checked]:bg-[#238636]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block h-3.5 w-3.5 rounded-full bg-fg shadow-sm",
          // The travel has to be derived, not stepped. It is the track's
          // content width less the thumb and the resting inset —
          // (9 - 3.5 - 0.5) spacing units, minus the 1px border on each side,
          // which is the one term that is not on the spacing scale. A fixed
          // step like `translate-x-4` only lands correctly at one value of
          // `--spacing`, and left the thumb 2.5px short of its own inset once
          // the interface was scaled up.
          "translate-x-0.5 transition-transform",
          "data-[state=checked]:translate-x-[calc(var(--spacing)*5-2px)]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

// --- segmented control -----------------------------------------------------

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="group"
      className={cn(
        "inline-flex rounded-md border border-line bg-canvas-inset p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            title={option.title ?? ""}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-sm font-medium transition-colors",
              size === "sm" ? "h-5 px-2 text-2xs" : "h-6 px-2.5 text-xs",
              active
                ? "bg-canvas-overlay text-fg shadow-[inset_0_0_0_1px_var(--color-line)]"
                : "text-fg-muted hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// --- select ----------------------------------------------------------------

/**
 * The chevron is a real icon, not a background image.
 *
 * An inline SVG data URI cannot live in a class string: it contains spaces, so
 * clsx splits it into a dozen junk class names and the arrow never renders —
 * and twMerge then drops the neighbouring `bg-canvas-overlay` as a conflicting
 * `bg-*` utility, leaving the control transparent and its native popup white.
 */
export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-7 w-full appearance-none rounded-md border border-line bg-canvas-overlay",
          "px-2 pr-7 text-xs text-fg transition-colors",
          "hover:border-line-strong focus:border-accent",
          className,
        )}
        {...props}
      />
      <ChevronDown
        size={14}
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-fg-muted"
      />
    </div>
  );
}

// --- the board answering ---------------------------------------------------

/*
 * One strength, everywhere. The `-subtle` tokens are 10% and disappear behind a
 * number; the wash has to be noticed to mean anything. 25% reads clearly on a
 * panel and still sits above the 10% accent-subtle fill of a selected keycap,
 * so a selected key answering does not look like a selected key.
 */
const SETTLE_TONES = {
  accent: "bg-accent/25",
  danger: "bg-danger/25",
  success: "bg-success/25",
} as const;

/**
 * A wash that decays behind something the board just answered for.
 *
 * This is the app's one authored motion. Every write round-trips and the reply
 * wins, so a reconciled value is indistinguishable from one that was already
 * sitting there — it simply *is* the number. The wash gives that arrival a
 * moment, and its tone says which kind of arrival it was: `accent` for the
 * board storing what was asked, `danger` for it storing something else,
 * `success` for volatile work reaching flash.
 *
 * `revision` is an identity, not a quantity: changing it remounts the tint and
 * so restarts the animation, which is the only reliable way to replay a CSS
 * keyframe on a value that did not otherwise change. At `0` nothing has been
 * answered yet and nothing renders, so a first paint is quiet.
 */
export function Settle({
  revision,
  tone = "accent",
  slow,
  className,
  children,
}: {
  revision: number;
  tone?: keyof typeof SETTLE_TONES;
  /** The footer commit holds a beat longer, because it covers more ground. */
  slow?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("relative isolate", className)}>
      {revision > 0 ? (
        <span
          key={revision}
          aria-hidden
          className={cn(
            // Bleeds past the content so the tint reads as a field behind the
            // value rather than a box drawn around it.
            "pointer-events-none absolute -inset-x-1.5 -inset-y-1 -z-10 rounded",
            slow ? "animate-settle-slow" : "animate-settle",
            SETTLE_TONES[tone],
          )}
        />
      ) : null}
      {children}
    </span>
  );
}

// --- numeric readout -------------------------------------------------------

/**
 * A measurement, not a label. Monospace here is doing its actual job: keeping
 * a column of travel values comparable as digits change.
 */
export function Readout({
  value,
  unit,
  size = "md",
  tone = "default",
  className,
}: {
  value: string;
  unit?: string;
  size?: "sm" | "md" | "lg";
  tone?: "default" | "muted" | "accent" | "attention";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        size === "lg" && "text-2xl",
        size === "md" && "text-sm",
        size === "sm" && "text-xs",
        tone === "default" && "text-fg",
        tone === "muted" && "text-fg-muted",
        tone === "accent" && "text-accent",
        tone === "attention" && "text-attention",
        className,
      )}
    >
      {value}
      {unit ? (
        <span className="ml-0.5 text-fg-subtle" style={{ fontSize: "0.75em" }}>
          {unit}
        </span>
      ) : null}
    </span>
  );
}

// --- badge -----------------------------------------------------------------

type BadgeTone = "default" | "accent" | "success" | "attention" | "danger";

const BADGE_TONES: Record<BadgeTone, string> = {
  default: "border-line text-fg-muted",
  accent: "border-accent/40 bg-accent-subtle text-accent",
  success: "border-success/40 bg-success-subtle text-success",
  attention: "border-attention/40 bg-attention-subtle text-attention",
  danger: "border-danger/40 bg-danger-subtle text-danger",
};

export function Badge({
  tone = "default",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-px text-2xs font-medium",
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

// --- tooltip ---------------------------------------------------------------

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-50 max-w-64 rounded-md border border-line bg-canvas-overlay px-2 py-1",
            "text-2xs text-fg shadow-lg shadow-black/40",
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// --- empty state -----------------------------------------------------------

export function EmptyState({
  icon,
  title,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? <div className="text-fg-subtle">{icon}</div> : null}
      <p className="text-sm font-semibold text-fg">{title}</p>
      {children ? (
        <div className="max-w-md text-xs leading-relaxed text-fg-muted">
          {children}
        </div>
      ) : null}
    </div>
  );
}
