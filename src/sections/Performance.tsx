import * as React from "react";
import { Activity, AlertTriangle, MousePointerClick } from "lucide-react";
import { useDevice, keyId } from "@/store/device";
import { KeyboardView, type KeyGeometry } from "@/components/KeyboardView";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Panel,
  PanelHeader,
  Readout,
  Segmented,
  Settle,
  Slider,
  Switch,
  Tooltip,
} from "@/components/ui";
import { capLabel } from "@/hid/keycodes";
import type { Performance as PerfRecord } from "@/hid/protocol/performance";
import { mm } from "@/lib/utils";

/** The board's usable travel. Reads are clamped to this for display. */
const MAX_TRAVEL_UM = 4000;
const POLL_HZ = 20;

export function PerformanceSection() {
  const {
    snapshot,
    performance,
    selection,
    select,
    selectAll,
    clearSelection,
    writePerformance,
    clamped,
    revision,
    busy,
    pollAxis,
  } = useDevice();

  const [live, setLive] = React.useState(false);
  const [travel, setTravel] = React.useState<Map<string, number>>(new Map());

  const keys = snapshot?.keys ?? [];
  const rows = snapshot?.rows ?? [];
  const selected = [...selection];

  // The live travel test. Polling is a plain interval rather than an animation
  // frame: the board sets the pace, not the display.
  React.useEffect(() => {
    if (!live || rows.length === 0) {
      setTravel(new Map());
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const next = await pollAxis(1, rows);
        if (!cancelled) setTravel(next);
      } catch {
        // A dropped poll is not worth interrupting the user; the next one wins.
      }
      if (!cancelled) timer = setTimeout(tick, 1000 / POLL_HZ);
    };
    void tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [live, rows, pollAxis]);

  /** The record shown in the editor: the shared value, or null when mixed. */
  const record = React.useMemo(
    () => sharedRecord(selected.map((id) => performance.get(id))),
    [selected, performance],
  );

  const label = React.useCallback(
    (key: KeyGeometry) => {
      const kc = useDevice.getState().keymap[0]?.[key.row]?.[key.col] ?? 0;
      return capLabel(kc);
    },
    [],
  );

  const state = React.useCallback(
    (key: KeyGeometry) => {
      const um = travel.get(key.id);
      const config = performance.get(key.id);
      const hasDeadZone =
        config && (config.pressDead > 0 || config.releaseDead > 0);
      const deadZone = hasDeadZone
        ? config.pressDead === config.releaseDead
          ? mm(config.pressDead)
          : `${mm(config.pressDead)}/${mm(config.releaseDead)}`
        : undefined;

      return {
        ...(live && um !== undefined
          ? { level: Math.min(1, um / MAX_TRAVEL_UM) }
          : {}),
        ...(clamped.has(key.id) ? { mark: "clamped" as const } : {}),
        ...(config?.mode === 1 ? { topRight: "RT" } : {}),
        ...(deadZone ? { bottomLeft: deadZone } : {}),
      };
    },
    [travel, live, clamped, performance],
  );

  if (!snapshot) return null;

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader>
          <span>Select keys</span>
          <div className="flex items-center gap-2">
            {clamped.size > 0 ? (
              <Tooltip content="The firmware stored a different value than the one sent. The shown value is what the board actually holds.">
                <span>
                  <Badge tone="danger">
                    <AlertTriangle size={11} />
                    {clamped.size} adjusted by firmware
                  </Badge>
                </span>
              </Tooltip>
            ) : null}
            <Button size="sm" variant="ghost" onClick={selectAll}>
              All 68
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={clearSelection}
              disabled={selection.size === 0}
            >
              Clear
            </Button>
          </div>
        </PanelHeader>

        <div className="flex flex-col items-center gap-4 overflow-x-auto p-4 2xl:flex-row 2xl:justify-center">
          <KeyboardView
            keys={keys}
            selection={selection}
            onSelect={(id, additive) =>
              select([id], additive ? "toggle" : "replace")
            }
            label={label}
            state={state}
            className="mx-0 shrink-0"
            ariaLabel="Select keys to edit their actuation"
          />

          <PerformanceKeyGuide />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2">
          <p className="text-2xs text-fg-muted">
            {selection.size === 0
              ? "Click a key to edit it. Shift-click to add more."
              : `${selection.size} of 68 keys selected`}
          </p>
          <label className="flex cursor-pointer items-center gap-2">
            <Switch checked={live} onCheckedChange={setLive} id="live" />
            <span className="flex items-center gap-1 text-xs text-fg">
              <Activity size={14} className={live ? "text-accent" : ""} />
              Live travel test
            </span>
          </label>
        </div>
      </Panel>

      {live ? <LiveReadout travel={travel} selected={selected} /> : null}

      {selection.size === 0 ? (
        <Panel>
          <EmptyState
            icon={<MousePointerClick size={22} strokeWidth={1.5} />}
            title="No keys selected"
          >
            Pick one or more keys above to set their actuation point, rapid
            trigger and dead zones. Every change applies to the board
            immediately, and stays in volatile memory until you save.
          </EmptyState>
        </Panel>
      ) : (
        <Editor
          record={record}
          count={selection.size}
          busy={busy}
          // One key: its own answer. Several: the most recent of them, so a
          // multi-key commit still reads as the board replying once.
          revision={Math.max(0, ...selected.map((id) => revision.get(id) ?? 0))}
          clamped={selected.some((id) => clamped.has(id))}
          onChange={(patch) => void writePerformance(selected, patch)}
        />
      )}
    </div>
  );
}

function PerformanceKeyGuide() {
  return (
    <aside
      className="w-full max-w-sm rounded-md bg-canvas-inset p-3 ring-1 ring-inset ring-line 2xl:w-60 2xl:shrink-0"
      aria-label="Keyboard indicator guide"
    >
      <p className="text-xs font-semibold text-fg">Key indicators</p>
      <p className="mt-1 text-2xs leading-relaxed text-fg-muted">
        Performance settings appear in the corners of each key.
      </p>

      <div className="mt-3 grid grid-cols-[3.5rem_1fr] items-center gap-3">
        <div
          className="relative h-14 w-14 shrink-0 rounded-[4px] bg-canvas-overlay text-3xs ring-1 ring-inset ring-line"
          aria-hidden
        >
          <span className="absolute top-1.5 right-1.5 font-semibold text-accent">
            RT
          </span>
          <span className="absolute bottom-1.5 left-1.5 font-medium text-fg-subtle">
            0.10
          </span>
        </div>
        <div className="space-y-2.5">
          <div>
            <p className="text-3xs font-semibold tracking-wide text-fg-subtle uppercase">
              Top right
            </p>
            <p className="mt-0.5 text-2xs text-fg-muted">
              <span className="font-semibold text-accent">RT</span> means rapid
              trigger is on.
            </p>
          </div>
          <div>
            <p className="text-3xs font-semibold tracking-wide text-fg-subtle uppercase">
              Bottom left
            </p>
            <p className="mt-0.5 text-2xs text-fg-muted">
              Dead-zone travel in mm.
            </p>
          </div>
        </div>
      </div>

      <p className="mt-3 border-t border-line pt-2 text-3xs leading-relaxed text-fg-subtle">
        Two values such as 0.10/0.20 mean top/bottom dead zone.
      </p>
    </aside>
  );
}

// --- live readout ----------------------------------------------------------

function LiveReadout({
  travel,
  selected,
}: {
  travel: Map<string, number>;
  selected: string[];
}) {
  const focus = selected[0];
  const um = focus ? (travel.get(focus) ?? 0) : peak(travel);
  const isPeak = !focus;

  return (
    <Panel className="flex items-center gap-5 px-4 py-3">
      <div>
        <p className="text-2xs font-semibold tracking-wide text-fg-muted uppercase">
          {isPeak ? "Deepest key" : "Selected key"}
        </p>
        <Readout
          value={mm(um)}
          unit="mm"
          size="lg"
          tone={um > 100 ? "accent" : "muted"}
        />
      </div>
      <div className="h-8 w-px bg-line" />
      <div className="min-w-0 flex-1">
        <p className="mb-1.5 text-2xs text-fg-muted">
          Press a key on the keyboard — travel is read straight from the Hall
          sensors at {POLL_HZ} Hz.
        </p>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-canvas-overlay"
          role="meter"
          aria-valuenow={Math.round(um / 10)}
          aria-valuemin={0}
          aria-valuemax={400}
          aria-label="Travel"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-75"
            style={{ width: `${Math.min(100, (um / MAX_TRAVEL_UM) * 100)}%` }}
          />
        </div>
      </div>
    </Panel>
  );
}

const peak = (travel: Map<string, number>): number =>
  travel.size === 0 ? 0 : Math.max(...travel.values());

// --- editor ----------------------------------------------------------------

function Editor({
  record,
  count,
  busy,
  revision,
  clamped,
  onChange,
}: {
  record: Partial<PerfRecord> | null;
  count: number;
  busy: boolean;
  revision: number;
  clamped: boolean;
  onChange: (patch: Partial<PerfRecord>) => void;
}) {
  const [section, setSection] = React.useState<"trigger" | "dead-zone">(
    "trigger",
  );

  if (!record) return null;
  const rapid = record.mode === 1;
  const step = 10;

  return (
    <Panel>
      <PanelHeader>
        <span>
          Performance
          {count > 1 ? (
            <span className="ml-2 font-normal text-fg-muted">
              {count} keys — mixed values shown as blank
            </span>
          ) : null}
        </span>
        <Segmented
          size="sm"
          value={section}
          onChange={setSection}
          options={[
            { value: "trigger", label: "Trigger" },
            { value: "dead-zone", label: "Dead zone" },
          ]}
        />
      </PanelHeader>

      {section === "trigger" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <p className="text-xs font-semibold text-fg">Trigger mode</p>
              <p className="mt-0.5 text-2xs text-fg-muted">
                Choose a fixed actuation point or movement-sensitive rapid trigger.
              </p>
            </div>
            <Segmented
              size="sm"
              value={rapid ? 1 : 0}
              onChange={(mode) => onChange({ mode: mode as 0 | 1 })}
              options={[
                { value: 0, label: "Fixed point" },
                { value: 1, label: "Rapid trigger" },
              ]}
            />
          </div>

          <div className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2">
            {rapid ? (
              <>
                <TravelControl
                  label="First actuation depth"
                  hint="Travel required for the very first press of a stroke."
                  value={record.rtFirst}
                  min={50}
                  max={MAX_TRAVEL_UM}
                  step={step}
                  revision={revision}
                  clamped={clamped}
                  disabled={busy}
                  onCommit={(rtFirst) => onChange({ rtFirst })}
                />
                <TravelControl
                  label="Press sensitivity"
                  hint="Downward movement needed to re-trigger."
                  value={record.rtPress}
                  min={step}
                  max={1000}
                  step={step}
                  revision={revision}
                  clamped={clamped}
                  disabled={busy}
                  onCommit={(rtPress) => onChange({ rtPress })}
                />
                <TravelControl
                  label="Release sensitivity"
                  hint="Upward movement needed to release."
                  value={record.rtRelease}
                  min={step}
                  max={1000}
                  step={step}
                  revision={revision}
                  clamped={clamped}
                  disabled={busy}
                  onCommit={(rtRelease) => onChange({ rtRelease })}
                />
              </>
            ) : (
              <TravelControl
                label="Actuation point"
                hint="How far the key travels before it registers and resets."
                value={record.press}
                min={100}
                max={MAX_TRAVEL_UM}
                step={step}
                revision={revision}
                clamped={clamped}
                disabled={busy}
                onCommit={(press) => onChange({ press })}
              />
            )}
          </div>
        </>
      ) : (
        <div className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2">
          <TravelControl
            label="Top dead zone"
            hint="Travel ignored at the top of the stroke."
            value={record.pressDead}
            min={0}
            max={1000}
            step={step}
            revision={revision}
            clamped={clamped}
            disabled={busy}
            onCommit={(pressDead) => onChange({ pressDead })}
          />

          <TravelControl
            label="Bottom dead zone"
            hint="Travel ignored at the bottom of the stroke."
            value={record.releaseDead}
            min={0}
            max={1000}
            step={step}
            revision={revision}
            clamped={clamped}
            disabled={busy}
            onCommit={(releaseDead) => onChange({ releaseDead })}
          />
        </div>
      )}
    </Panel>
  );
}

function TravelControl({
  label,
  hint,
  value,
  min,
  max,
  step,
  revision,
  clamped,
  disabled,
  onCommit,
}: {
  label: string;
  hint: string;
  value: number | undefined;
  min: number;
  max: number;
  step: number;
  revision: number;
  clamped: boolean;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  // Track the drag locally so the slider stays smooth, but only write to the
  // device on release — every write is a round trip to the board.
  const [dragging, setDragging] = React.useState<number | null>(null);
  const shown = dragging ?? value;
  const commitDraft = () => {
    if (dragging === null) return;
    setDragging(null);
    onCommit(dragging);
  };

  return (
    <Field
      label={label}
      hint={hint}
      control={
        <div className="flex items-center gap-3">
          <Slider
            value={[shown ?? min]}
            min={min}
            max={max}
            step={step}
            disabled={disabled || value === undefined}
            onValueChange={([v]) => setDragging(v ?? min)}
            onValueCommit={([v]) => {
              setDragging(null);
              if (v !== undefined) onCommit(v);
            }}
            aria-label={label}
          />
          <Settle
            revision={revision}
            tone={clamped ? "danger" : "accent"}
            className="shrink-0"
          >
            <span className="relative block w-20">
              <input
                type="number"
                min={min / 1000}
                max={max / 1000}
                step={step / 1000}
                value={shown === undefined ? "" : (shown / 1000).toFixed(2)}
                disabled={disabled || value === undefined}
                aria-label={`${label} in millimetres`}
                aria-invalid={clamped || undefined}
                onChange={(event) => {
                  const next = event.currentTarget.valueAsNumber;
                  if (!Number.isFinite(next)) return;
                  const micrometres = Math.round((next * 1000) / step) * step;
                  setDragging(Math.min(max, Math.max(min, micrometres)));
                }}
                onBlur={commitDraft}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="h-7 w-full rounded-md bg-canvas-overlay pr-7 pl-2 text-right font-mono text-xs text-fg ring-1 ring-inset ring-line transition-shadow hover:ring-line-strong focus:ring-accent"
              />
              <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-3xs text-fg-subtle">
                mm
              </span>
            </span>
          </Settle>
        </div>
      }
    />
  );
}

/** Fields shared across a multi-key selection; anything mixed comes back absent. */
function sharedRecord(
  records: Array<PerfRecord | undefined>,
): Partial<PerfRecord> | null {
  const present = records.filter((r): r is PerfRecord => r !== undefined);
  const first = present[0];
  if (!first) return null;

  const out: Partial<PerfRecord> = {};

  // Travel fields drop out of the editor when the selection disagrees, so a
  // multi-key edit never implies a value the keys do not share.
  const travelFields = [
    "press",
    "release",
    "rtFirst",
    "rtPress",
    "rtRelease",
    "pressDead",
    "releaseDead",
  ] as const;

  for (const field of travelFields) {
    if (present.every((r) => r[field] === first[field])) out[field] = first[field];
  }

  // Mode is the exception: the segmented control has to sit somewhere, so a
  // mixed selection shows the majority.
  const allSameMode = present.every((r) => r.mode === first.mode);
  if (allSameMode) {
    out.mode = first.mode;
  } else {
    const rapid = present.filter((r) => r.mode === 1).length;
    out.mode = rapid > present.length / 2 ? 1 : 0;
  }

  return out;
}

export { keyId };
