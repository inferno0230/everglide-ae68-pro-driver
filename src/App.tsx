import * as React from "react";
import { Loader2, Unplug, FlaskConical } from "lucide-react";
import { useDevice } from "@/store/device";
import { Sidebar, type SectionId } from "@/components/Sidebar";
import { TooltipProvider, Button, Badge } from "@/components/ui";
import { Connect } from "@/sections/Connect";
import { PerformanceSection } from "@/sections/Performance";
import { KeymapSection } from "@/sections/Keymap";
import { LightingSection } from "@/sections/Lighting";
import { CalibrationSection } from "@/sections/Calibration";
import { DeviceSection } from "@/sections/Device";

const TITLES: Record<SectionId, { title: string; blurb: string }> = {
  performance: {
    title: "Performance",
    blurb: "Actuation point, rapid trigger and dead zones, per key.",
  },
  keymap: {
    title: "Keymap",
    blurb: "What each key sends, across four layers.",
  },
  lighting: {
    title: "Lighting",
    blurb: "Effect, brightness and the board's eight-slot palette.",
  },
  calibration: {
    title: "Calibration",
    blurb: "Teach the board the true travel range of every switch.",
  },
  device: {
    title: "Device",
    blurb: "Firmware, capabilities and lighting topology.",
  },
};

export default function App() {
  const { status, init, dirty, disconnect, simulated } = useDevice();
  const [section, setSection] = React.useState<SectionId>("performance");

  React.useEffect(() => {
    void init();
  }, [init]);

  // The one thing that must never be lost silently: RAM-only changes die with
  // the USB connection, so leaving with unsaved work gets the browser's own
  // confirmation.
  React.useEffect(() => {
    if (dirty.size === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty.size]);

  const connected = status === "connected";

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden bg-canvas">
        {connected ? (
          <Sidebar section={section} onSection={setSection} />
        ) : null}

        <main className="min-w-0 flex-1 overflow-y-auto">
          {!connected ? (
            <Connect />
          ) : (
            <>
              <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 py-3 backdrop-blur-sm">
                {/* Same box as the content below, so the two left edges line up. */}
                <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-6">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-fg">
                      {TITLES[section].title}
                    </h2>
                    {TITLES[section].blurb ? (
                      <p className="mt-0.5 truncate text-2xs text-fg-muted">
                        {TITLES[section].blurb}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {simulated ? (
                      <Badge tone="attention">
                        <FlaskConical size={11} />
                        Simulated board — synthetic data
                      </Badge>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void disconnect()}
                    >
                      <Unplug size={14} />
                      Disconnect
                    </Button>
                  </div>
                </div>
              </header>

              {/*
                The board is a fixed 16.25 key units wide, so an unbounded
                column strands it against the left edge and stretches every
                slider beside it. Cap the measure the way GitHub does.
              */}
              <div className="mx-auto max-w-[1240px] px-6 py-5">
                <Section id={section} />
              </div>
            </>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}

function Section({ id }: { id: SectionId }) {
  switch (id) {
    case "performance":
      return <PerformanceSection />;
    case "keymap":
      return <KeymapSection />;
    case "lighting":
      return <LightingSection />;
    case "calibration":
      return <CalibrationSection />;
    case "device":
      return <DeviceSection />;
    default:
      return null;
  }
}

export function Loading() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 size={18} className="animate-spin text-fg-muted" />
    </div>
  );
}
