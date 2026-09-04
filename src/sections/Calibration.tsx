import * as React from "react";
import { Check, Crosshair, TriangleAlert } from "lucide-react";
import { useDevice, keyId } from "@/store/device";
import { KeyboardView, type KeyGeometry } from "@/components/KeyboardView";
import {
  Badge,
  Button,
  Panel,
  PanelHeader,
  Readout,
} from "@/components/ui";
import { AxisKind } from "@/hid/protocol/constants";
import { capLabel } from "@/hid/keycodes";
import { mm } from "@/lib/utils";

/** Travel that counts as "bottomed out" for the purposes of this run. */
const BOTTOMED_UM = 3200;
const MAX_TRAVEL_UM = 4000;
const POLL_HZ = 20;

type Phase = "idle" | "running" | "done";

export function CalibrationSection() {
  const { snapshot, runCalibration, pollAxis } = useDevice();

  const [phase, setPhase] = React.useState<Phase>("idle");
  const [map, setMap] = React.useState<Map<string, number>>(new Map());
  const [travel, setTravel] = React.useState<Map<string, number>>(new Map());
  const [pressed, setPressed] = React.useState<Set<string>>(new Set());

  const rows = snapshot?.rows ?? [];
  const keys = snapshot?.keys ?? [];

  // The board's own calibration map: `04 03 02 <row>` reports 1 for every key
  // it holds calibration data for, 0 for unpopulated columns.
  const readMap = React.useCallback(async () => {
    if (rows.length === 0) return;
    try {
      setMap(await pollAxis(AxisKind.Calibrate, rows));
    } catch {
      /* a failed read leaves the previous map; the next one wins */
    }
  }, [rows, pollAxis]);

  React.useEffect(() => {
    void readMap();
  }, [readMap]);

  /*
   * While a run is in progress the board does not report per-key progress, so
   * this watches live travel instead and records which keys have actually been
   * pressed to the bottom. That is our own tracking of the physical routine,
   * not a claim about what the firmware has stored.
   */
  React.useEffect(() => {
    if (phase !== "running" || rows.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const next = await pollAxis(AxisKind.Route, rows);
        if (!cancelled) {
          setTravel(next);
          setPressed((prev) => {
            const out = new Set(prev);
            for (const [id, um] of next) if (um >= BOTTOMED_UM) out.add(id);
            return out;
          });
        }
      } catch {
        /* dropped polls are not worth interrupting the routine */
      }
      if (!cancelled) timer = setTimeout(tick, 1000 / POLL_HZ);
    };
    void tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase, rows, pollAxis]);

  const calibrated = keys.filter((k) => (map.get(keyId(k.row, k.col)) ?? 0) > 0);
  const running = phase === "running";

  const label = React.useCallback(
    (key: KeyGeometry) =>
      capLabel(useDevice.getState().keymap[0]?.[key.row]?.[key.col] ?? 0),
    [],
  );

  const state = React.useCallback(
    (key: KeyGeometry) => {
      if (running) {
        const um = travel.get(key.id) ?? 0;
        return {
          level: Math.min(1, um / MAX_TRAVEL_UM),
          ...(pressed.has(key.id) ? { mark: "custom" as const } : {}),
        };
      }
      // Idle: dim anything the board holds no calibration for.
      return (map.get(key.id) ?? 0) > 0 ? undefined : { dim: true };
    },
    [running, travel, pressed, map],
  );

  if (!snapshot) return null;

  const start = async () => {
    setPressed(new Set());
    setTravel(new Map());
    await runCalibration("start");
    setPhase("running");
  };

  const finish = async () => {
    await runCalibration("stop");
    setPhase("done");
    await readMap();
  };

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader>
          <span>{running ? "Press every key" : "Switch calibration"}</span>
          {running ? (
            <Badge tone="accent">
              {pressed.size} of {keys.length} pressed
            </Badge>
          ) : (
            <Badge tone={calibrated.length === keys.length ? "success" : "attention"}>
              {calibrated.length} of {keys.length} calibrated
            </Badge>
          )}
        </PanelHeader>

        <div className="overflow-x-auto p-4">
          <KeyboardView
            keys={keys}
            selection={EMPTY}
            label={label}
            state={state}
            ariaLabel={
              running
                ? "Keys pressed so far in this calibration run"
                : "Per-key calibration state reported by the board"
            }
          />
        </div>

        <p className="border-t border-line px-3 py-2 text-2xs text-fg-muted">
          {running
            ? "Each key fills as it travels. A dot marks the ones that have reached the bottom this run."
            : "Dimmed keys are ones the board holds no calibration data for."}
        </p>
      </Panel>

      <Panel>
        <PanelHeader>
          <span>{running ? "Run in progress" : "Run calibration"}</span>
          {phase === "done" ? (
            <Badge tone="success">
              <Check size={11} />
              Finished
            </Badge>
          ) : null}
        </PanelHeader>

        <div className="flex flex-wrap items-start justify-between gap-4 p-4">
          <div className="max-w-lg space-y-2">
            {running ? (
              <>
                <p className="text-xs leading-relaxed text-fg">
                  Press <strong>every key</strong> all the way down and let it
                  rise fully, one at a time. The board learns each switch's true
                  range as you go.
                </p>
                <p className="text-2xs leading-relaxed text-fg-muted">
                  The counter tracks keys this app has seen bottom out — the
                  board does not report its own progress during a run, so finish
                  only once you have pressed all {keys.length}.
                </p>
              </>
            ) : (
              <>
                <p className="text-xs leading-relaxed text-fg-muted">
                  Teaches the board the true travel range of every switch. Worth
                  doing after changing switches, or if actuation feels
                  inconsistent across the board.
                </p>
                <p className="text-2xs leading-relaxed text-fg-subtle">
                  Calibration is stored separately from your actuation settings,
                  so a factory reset of those will not force you to redo it.
                </p>
              </>
            )}
          </div>

          {running ? (
            <Button variant="primary" onClick={() => void finish()}>
              <Check size={14} />
              Finish calibration
            </Button>
          ) : (
            <Button onClick={() => void start()}>
              <Crosshair size={14} />
              {phase === "done" ? "Calibrate again" : "Start calibration"}
            </Button>
          )}
        </div>

        {phase === "done" ? (
          <div className="flex gap-2 border-t border-line px-4 py-2.5">
            <TriangleAlert
              size={14}
              className="mt-px shrink-0 text-attention"
              strokeWidth={2}
            />
            <p className="text-2xs leading-relaxed text-fg-muted">
              Calibration is live on the board but not yet written to flash.
              Save it from the sidebar, or it is lost when the keyboard is
              unplugged.
            </p>
          </div>
        ) : null}
      </Panel>

      {running ? <LiveRow travel={travel} /> : null}
    </div>
  );
}

const EMPTY: ReadonlySet<string> = new Set();

/** The deepest key right now, so the routine gives feedback without the mouse. */
function LiveRow({ travel }: { travel: Map<string, number> }) {
  const peak = travel.size === 0 ? 0 : Math.max(...travel.values());
  return (
    <Panel className="flex items-center gap-5 px-4 py-3">
      <div>
        <p className="text-2xs font-semibold tracking-wide text-fg-muted uppercase">
          Deepest key
        </p>
        <Readout
          value={mm(peak)}
          unit="mm"
          size="lg"
          tone={peak >= BOTTOMED_UM ? "accent" : "muted"}
        />
      </div>
      <div className="h-8 w-px bg-line" />
      <p className="text-2xs text-fg-muted">
        A key counts once it passes {mm(BOTTOMED_UM)} mm. Keep both hands on the
        board — nothing here needs the mouse until you are done.
      </p>
    </Panel>
  );
}
