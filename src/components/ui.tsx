/**
 * The component set, in Primer's vocabulary.
 *
 * GitHub dark is the named craft bar, so these follow its actual conventions:
 * 5px radii, 1px borders that lighten on hover, buttons that shift ground
 * rather than glow, and 12px labels above 13px controls.
 */

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as SliderPrimitive from "@radix-ui/react-slider";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
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

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border font-medium",
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
        "relative flex h-4 w-full cursor-pointer touch-none items-center select-none",
        "disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-0.5 w-full grow overflow-hidden rounded-full bg-line">
        <SliderPrimitive.Range className="absolute h-full bg-accent" />
      </SliderPrimitive.Track>
      {(props.value ?? props.defaultValue ?? [0]).map((_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          className={cn(
            "block h-3.5 w-1 rounded-full bg-accent",
            "transition-transform hover:scale-y-125 active:scale-y-125",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
}

/**
 * Holds the dragged value across the write instead of dropping it on release.
 *
 * A commit is a round trip to the board, and the store only takes the new
 * value once the board answers. Clearing the local value on release would
 * show the *old* one for the length of that trip — the slider snaps back,
 * then jumps forward when the answer lands. So the draft stays until the
 * commit settles; a fresh drag invalidates any commit still in flight, so a
 * late answer can never yank the thumb out from under the pointer.
 */
export function useSliderDraft(
  onCommit: (value: number) => void | Promise<void>,
) {
  const [draft, setDraft] = React.useState<number | null>(null);
  const generation = React.useRef(0);

  const drag = (value: number) => {
    generation.current += 1;
    setDraft(value);
  };

  const commit = (value: number) => {
    const mine = ++generation.current;
    setDraft(value);
    void Promise.resolve(onCommit(value)).finally(() => {
      if (generation.current === mine) setDraft(null);
    });
  };

  return { draft, drag, commit };
}

// --- switch ----------------------------------------------------------------

export function Switch({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors",
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
              "cursor-pointer rounded-sm font-medium transition-colors",
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

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean | undefined;
}

export interface SelectGroup {
  label?: string;
  options: readonly SelectOption[];
}

export function Select({
  value,
  onValueChange,
  options,
  disabled,
  id,
  "aria-label": ariaLabel,
  className,
}: {
  value: string | number;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[] | readonly SelectGroup[];
  disabled?: boolean | undefined;
  id?: string | undefined;
  "aria-label"?: string | undefined;
  className?: string | undefined;
}) {
  const groups: readonly SelectGroup[] =
    options.length > 0 && "options" in options[0]!
      ? (options as readonly SelectGroup[])
      : [{ options: options as readonly SelectOption[] }];

  return (
    <SelectPrimitive.Root
      value={String(value)}
      onValueChange={onValueChange}
      {...(disabled !== undefined ? { disabled } : {})}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          "flex h-7 w-full cursor-pointer items-center justify-between gap-2 rounded-md bg-canvas-overlay px-2",
          "text-xs text-fg ring-1 ring-inset ring-line outline-none transition-shadow",
          "hover:ring-line-strong focus-visible:ring-accent data-[state=open]:ring-accent",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon asChild>
          <ChevronDown size={14} className="shrink-0 text-fg-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md bg-canvas-raised p-1 text-xs text-fg ring-1 ring-line shadow-xl"
        >
          <SelectPrimitive.ScrollUpButton className="flex h-4 cursor-default items-center justify-center text-fg-subtle">
            <ChevronUp size={13} />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="scrollbar-thin-visible overflow-y-auto pr-1">
            {groups.map((group, groupIndex) => (
              <SelectPrimitive.Group key={group.label ?? groupIndex}>
                {group.label ? (
                  <SelectPrimitive.Label className="px-2 py-1.5 text-3xs font-semibold tracking-wide text-fg-subtle uppercase">
                    {group.label}
                  </SelectPrimitive.Label>
                ) : null}
                {group.options.map((option) => (
                  <SelectPrimitive.Item
                    key={String(option.value)}
                    value={String(option.value)}
                    {...(option.disabled !== undefined
                      ? { disabled: option.disabled }
                      : {})}
                    className="relative flex h-7 cursor-pointer select-none items-center rounded-sm pr-8 pl-2 text-fg-muted outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent-subtle data-[highlighted]:text-fg"
                  >
                    <SelectPrimitive.ItemText>
                      {option.label}
                    </SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="absolute right-2 text-accent">
                      <Check size={13} strokeWidth={2} />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Group>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-4 cursor-default items-center justify-center text-fg-subtle">
            <ChevronDown size={13} />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

// Retained as a stable wrapper for value layout, without the old flashing
// response wash. Device replies now update in place without visual flicker.
export function Settle({
  revision: _revision,
  tone: _tone = "accent",
  slow: _slow,
  className,
  children,
}: {
  revision: number;
  tone?: "accent" | "danger" | "success";
  slow?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={className}>{children}</span>;
}

// --- confirmation dialog -------------------------------------------------

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-canvas/80 backdrop-blur-sm" />
        <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-canvas-subtle p-5 shadow-2xl">
          <DialogPrimitive.Title className="text-sm font-semibold text-fg">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-2 text-xs leading-relaxed text-fg-muted">
            {description}
          </DialogPrimitive.Description>
          <div className="mt-5 flex justify-end gap-2">
            <DialogPrimitive.Close asChild>
              <Button>Cancel</Button>
            </DialogPrimitive.Close>
            <DialogPrimitive.Close asChild>
              <Button variant="danger" onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
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
