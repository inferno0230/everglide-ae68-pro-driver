import {
  Gauge,
  Keyboard as KeyboardIcon,
  Lightbulb,
  Layers,
  ListOrdered,
  Cpu,
  Crosshair,
  HardDriveDownload,
  Loader2,
  Check,
  Github,
} from "lucide-react";
import { useDevice, type DirtyTarget } from "@/store/device";
import { SaveTarget } from "@/hid/protocol/constants";
import { Button, Select, Settle, Tooltip } from "@/components/ui";
import { cn } from "@/lib/utils";

/** What each flash region is called in the interface. */
const TARGET_NAMES: Partial<Record<DirtyTarget, string>> = {
  [SaveTarget.Performance]: "actuation",
  [SaveTarget.Lighting]: "lighting",
  [SaveTarget.Layout]: "keymap",
  [SaveTarget.Calibration]: "calibration",
  [SaveTarget.HigherKey]: "advanced keys",
  [SaveTarget.Macro]: "macros",
};

const describeTargets = (dirty: ReadonlySet<DirtyTarget>): string =>
  [...dirty].map((t) => TARGET_NAMES[t] ?? "settings").join(", ");

export type SectionId =
  | "performance"
  | "keymap"
  | "lighting"
  | "advanced"
  | "macros"
  | "calibration"
  | "device";

interface NavItem {
  id: SectionId;
  label: string;
  icon: typeof Gauge;
  /** Sections whose write paths are not yet verified on hardware. */
  pending?: boolean;
}

const NAV: NavItem[] = [
  { id: "performance", label: "Performance", icon: Gauge },
  { id: "keymap", label: "Keymap", icon: KeyboardIcon },
  { id: "lighting", label: "Lighting", icon: Lightbulb },
  { id: "advanced", label: "Advanced keys", icon: Layers },
  { id: "macros", label: "Macros", icon: ListOrdered },
  { id: "calibration", label: "Calibration", icon: Crosshair },
  { id: "device", label: "Device", icon: Cpu },
];

export function Sidebar({
  section,
  onSection,
}: {
  section: SectionId;
  onSection: (id: SectionId) => void;
}) {
  const { snapshot, status, simulated, dirty, saving, save, switchProfile, revision } =
    useDevice();
  const connected = status === "connected";
  const pendingCount = dirty.size;

  return (
    <nav className="flex w-[248px] shrink-0 flex-col border-r border-line bg-canvas-inset">
      <header className="border-b border-line px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-fg">AE68 Pro</h1>
            <p className="mt-0.5 truncate text-2xs text-fg-muted">
              {connected
                ? simulated
                  ? "Simulated board"
                  : `Firmware ${snapshot?.info.appVersion ?? "—"}`
                : "Not connected"}
            </p>
          </div>
          <a
            href="https://github.com/inferno0230/everglide-ae68-pro-driver"
            target="_blank"
            rel="noreferrer"
            aria-label="View source on GitHub"
            title="View source on GitHub"
            className="shrink-0 rounded-md p-1.5 text-fg-muted transition-colors hover:bg-canvas-overlay hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg-muted"
          >
            <Github size={20} strokeWidth={1.75} />
          </a>
        </div>
      </header>

      {connected && snapshot ? (
        <div className="border-b border-line px-3 py-2.5">
          <label
            htmlFor="profile"
            className="mb-1 block text-2xs font-semibold tracking-wide text-fg-muted uppercase"
          >
            Profile
          </label>
          <Select
            id="profile"
            value={snapshot.activeProfile}
            onValueChange={(value) => void switchProfile(Number(value))}
            options={snapshot.profiles.map((profile) => ({
              value: profile.index,
              label: profile.name || `Config ${profile.index + 1}`,
            }))}
          />
        </div>
      ) : null}

      <ul className="flex-1 overflow-y-auto p-2">
        {NAV.map((item) => {
          const active = item.id === section;
          const disabled = !connected || item.pending;
          const Icon = item.icon;

          const button = (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSection(item.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                active
                  ? "bg-canvas-overlay font-semibold text-fg"
                  : "text-fg-muted hover:bg-canvas-subtle hover:text-fg",
                disabled && "cursor-not-allowed opacity-45 hover:bg-transparent",
              )}
            >
              <Icon size={15} strokeWidth={1.75} className="shrink-0" />
              <span className="flex-1 text-left">{item.label}</span>
              {item.pending ? (
                <span className="text-3xs tracking-wide text-fg-subtle uppercase">
                  WIP
                </span>
              ) : null}
            </button>
          );

          return (
            <li key={item.id}>
              {item.pending ? (
                <Tooltip
                  side="right"
                  content="The protocol is decoded and verified on hardware. The editor for it is not built yet."
                >
                  <span className="block">{button}</span>
                </Tooltip>
              ) : (
                button
              )}
            </li>
          );
        })}
      </ul>

      {/*
        The save state lives here permanently rather than floating over content:
        nothing on this board survives a power cycle until it is written to
        flash, so it must never be somewhere the user can scroll past.
      */}
      <footer className="sticky bottom-0 z-10 border-t border-line bg-canvas-inset p-2.5">
        {connected ? (
          <>
            {/*
              The commit is the same wash as a reconciled value, in success and
              held a beat longer: work stopping being volatile is the one state
              change in this app as consequential as the board answering.
            */}
            <Settle
              revision={pendingCount === 0 ? (revision.get("saved") ?? 0) : 0}
              tone="success"
              slow
              className="mb-2 flex items-center gap-1.5 px-0.5"
            >
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  pendingCount > 0
                    ? "animate-pulse-ring bg-attention"
                    : "bg-success",
                )}
              />
              <span
                className={cn(
                  "text-2xs",
                  pendingCount > 0 ? "text-attention" : "text-fg-muted",
                )}
              >
                {/*
                  Naming what is unsaved, not counting it: `dirty` holds flash
                  regions, so a count reads as "1 change" after editing four
                  keys — true of the region, misleading about the work.
                */}
                {pendingCount > 0
                  ? `Unsaved: ${describeTargets(dirty)}`
                  : "All changes saved"}
              </span>
            </Settle>
            <Button
              variant={pendingCount > 0 ? "primary" : "default"}
              disabled={pendingCount === 0 || saving}
              onClick={() => void save()}
              className="w-full"
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Writing to flash
                </>
              ) : pendingCount > 0 ? (
                <>
                  <HardDriveDownload size={14} />
                  Save to keyboard
                </>
              ) : (
                <>
                  <Check size={14} />
                  Saved
                </>
              )}
            </Button>
            <p className="mt-1.5 px-0.5 text-3xs leading-snug text-fg-subtle">
              {pendingCount > 0
                ? "Changes are live on the board but will be lost when it is unplugged."
                : "Everything is written to the keyboard's flash."}
            </p>
          </>
        ) : null}
      </footer>
    </nav>
  );
}
