import {
  Gauge,
  Cpu,
} from "lucide-react";
import { useDevice } from "@/store/device";
import { Tooltip } from "@/components/ui";
import { cn } from "@/lib/utils";

export type SectionId =
  | "device";

interface NavItem {
  id: SectionId;
  label: string;
  icon: typeof Gauge;
  /** Sections whose write paths are not yet verified on hardware. */
  pending?: boolean;
}

const NAV: NavItem[] = [
  { id: "device", label: "Device", icon: Cpu },
];

export function Sidebar({
  section,
  onSection,
}: {
  section: SectionId;
  onSection: (id: SectionId) => void;
}) {
  const { snapshot, status, simulated } = useDevice();
  const connected = status === "connected";

  return (
    <nav className="flex w-[248px] shrink-0 flex-col border-r border-line bg-canvas-inset">
      <header className="border-b border-line px-3 py-3">
        <h1 className="text-sm font-semibold text-fg">AE68 Pro</h1>
        <p className="mt-0.5 truncate text-2xs text-fg-muted">
          {connected
            ? simulated
              ? "Simulated board"
              : `Firmware ${snapshot?.info.appVersion ?? "—"}`
            : "Not connected"}
        </p>
      </header>

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

    </nav>
  );
}
