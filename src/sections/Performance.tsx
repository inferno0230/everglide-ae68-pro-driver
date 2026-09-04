import * as React from "react";
import {
  Activity,
  AlertTriangle,
  Eye,
  EyeOff,
  MousePointerClick,
} from "lucide-react";
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
  useSliderDraft,
} from "@/components/ui";
import { capLabel } from "@/hid/keycodes";
import type { Performance as PerfRecord } from "@/hid/protocol/performance";
import { cn, mm, mmTrim } from "@/lib/utils";

/** The board's usable travel. Reads are clamped to this for display. */
const MAX_TRAVEL_UM = 4000;

/**
 * The travel step, in micrometres.
 *
 * The wire carries micrometres, so one micrometre — 0.001 mm — is the board's
 * own resolution, and the official driver steps every travel field by it: the
 * actuation point as much as rapid trigger and the dead zones. Holding a
 * coarser step anywhere would round a value set there into a different one
 * here, so all of them step in micrometres and print what they hold.
 */
const TRAVEL_STEP = 1;

/** Rapid trigger measures movement, so it needs some to work with. */
const RT_FLOOR = 10;

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
  // The corner values and the guide that explains them travel together: with
  // the values off there is nothing for the guide to annotate.
  const [showValues, setShowValues] = React.useState(true);
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

  const label = React.useCallback((key: KeyGeometry) => {
    const kc = useDevice.getState().keymap[0]?.[key.row]?.[key.col] ?? 0;
    return capLabel(kc);
  }, []);

  const state = React.useCallback(
    (key: KeyGeometry) => {
      const um = travel.get(key.id);
      const config = performance.get(key.id);
      const hasDeadZone =
        config && (config.pressDead > 0 || config.releaseDead > 0);

      return {
        ...(live && um !== undefined
          ? { level: Math.min(1, um / MAX_TRAVEL_UM) }
          : {}),
        ...(clamped.has(key.id) ? { mark: "clamped" as const } : {}),
        ...(showValues && hasDeadZone
          ? {
              topLeft: mmTrim(config.pressDead),
              bottomLeft: mmTrim(config.releaseDead),
            }
          : {}),
        ...(showValues && config?.mode === 1 ? { bottomRight: "RT" } : {}),
      };
    },
    [travel, live, clamped, performance, showValues],
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

        <div
          className={cn(
            "flex flex-col items-center justify-center gap-4 overflow-x-auto p-4",
            // The guide sits beside the board once there is room for it. On
            // its own the board is simply centred at every width.
            showValues && "2xl:flex-row",
          )}
        >
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

          {showValues ? <PerformanceKeyGuide /> : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2">
          <p className="text-2xs text-fg-muted">
            {selection.size === 0
              ? "Click a key to edit it. Shift-click to add more."
              : `${selection.size} of 68 keys selected`}
          </p>
          <div className="flex items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2">
              <Switch
                checked={showValues}
                onCheckedChange={setShowValues}
                id="show-values"
              />
              <span className="flex items-center gap-1 text-xs text-fg">
                {showValues ? (
                  <Eye size={14} className="text-accent" />
                ) : (
                  <EyeOff size={14} />
                )}
                Key values
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <Switch checked={live} onCheckedChange={setLive} id="live" />
              <span className="flex items-center gap-1 text-xs text-fg">
                <Activity size={14} className={live ? "text-accent" : ""} />
                Live travel test
              </span>
            </label>
          </div>
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
          onChange={(patch) => writePerformance(selected, patch)}
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

      <div
        className="relative mx-auto mt-3 h-16 w-16 rounded-[4px] bg-canvas-overlay text-3xs ring-1 ring-inset ring-line"
        aria-hidden
      >
        <span className="absolute top-1.5 left-1.5 text-[10px] font-normal text-fg-subtle">
          0.1
        </span>
        <span className="absolute bottom-1.5 left-1.5 text-[10px] font-normal text-fg-subtle">
          0.2
        </span>
        <span className="absolute right-1.5 bottom-1.5 text-[10px] font-semibold text-accent">
          RT
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-[5.5rem_1fr] items-baseline gap-x-2 gap-y-2 text-2xs">
        <dt className="whitespace-nowrap text-[10px] font-semibold tracking-wide text-fg-subtle uppercase">
          Top left
        </dt>
        <dd className="text-fg-muted">Top dead zone</dd>

        <dt className="whitespace-nowrap text-[10px] font-semibold tracking-wide text-fg-subtle uppercase">
          Bottom left
        </dt>
        <dd className="text-fg-muted">Bottom dead zone</dd>

        <dt className="whitespace-nowrap text-[10px] font-semibold tracking-wide text-fg-subtle uppercase">
          Bottom right
        </dt>
        <dd className="text-fg-muted">
          <span className="font-semibold text-accent">RT</span> enabled
        </dd>
      </dl>

      <p className="mt-3 border-t border-line pt-2 text-3xs text-fg-subtle">
        Dead-zone values are shown in millimetres.
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
  onChange: (patch: Partial<PerfRecord>) => Promise<void>;
}) {
  const [section, setSection] = React.useState<"trigger" | "dead-zone">(
    "trigger",
  );

  if (!record) return null;
  const rapid = record.mode === 1;

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
                Choose a fixed actuation point or movement-sensitive rapid
                trigger.
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
                  step={TRAVEL_STEP}
                  revision={revision}
                  clamped={clamped}
                  disabled={busy}
                  onCommit={(rtFirst) => onChange({ rtFirst })}
                />
                <TravelControl
                  label="Press sensitivity"
                  hint="Downward movement needed to re-trigger."
                  value={record.rtPress}
                  min={RT_FLOOR}
                  max={1000}
                  step={TRAVEL_STEP}
                  revision={revision}
                  clamped={clamped}
                  disabled={busy}
                  onCommit={(rtPress) => onChange({ rtPress })}
                />
                <TravelControl
                  label="Release sensitivity"
                  hint="Upward movement needed to release."
                  value={record.rtRelease}
                  min={RT_FLOOR}
                  max={1000}
                  step={TRAVEL_STEP}
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
                step={TRAVEL_STEP}
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
            step={TRAVEL_STEP}
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
            step={TRAVEL_STEP}
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
  onCommit: (value: number) => Promise<void>;
}) {
  // Track the drag locally so the slider stays smooth, but only write to the
  // device on release — every write is a round trip to the board.
  const { draft, drag, commit } = useSliderDraft(onCommit);
  const shown = draft ?? value;

  // The editor is only rendered with a record, so an absent value means one
  // thing: the selected keys disagree. That is the case multi-select exists
  // for — the control shows no number, but setting one writes it to all of
  // them. Disabling here would leave the board uneditable precisely when the
  // user wants to bring the keys back into line.
  const mixed = value === undefined;

  // While the field is being typed into, the text belongs to the user. A
  // number input hands back "" for a half-written "0.2", so reformatting on
  // every keystroke swallows the decimal point and micrometre precision can
  // only be reached by dragging. Hold the raw string until focus leaves.
  const [typed, setTyped] = React.useState<string | null>(null);
  const text = typed ?? (shown === undefined ? "" : mmTrim(shown));
  const commitDraft = () => {
    setTyped(null);
    if (draft !== null) commit(draft);
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
            disabled={disabled}
            onValueChange={([v]) => drag(v ?? min)}
            onValueCommit={([v]) => {
              if (v !== undefined) commit(v);
            }}
            aria-label={label}
          />
          <Settle
            revision={revision}
            tone={clamped ? "danger" : "accent"}
            className="shrink-0"
          >
            {/* The number and its unit are one centred group, not a number
                pinned to an edge: "0.2" and "0.271" are different widths, and
                right-aligning them against a fixed unit leaves the short one
                adrift in the box. The field grows to its content — `size` is
                the fallback where `field-sizing` is missing — so the pair
                stays centred whatever the value holds. */}
            <label className="flex h-7 w-24 items-center justify-center gap-1 rounded-md bg-canvas-overlay px-2 ring-1 ring-inset ring-line transition-shadow hover:ring-line-strong focus-within:ring-accent">
              <input
                type="text"
                inputMode="decimal"
                size={5}
                value={text}
                placeholder={mixed ? "—" : undefined}
                disabled={disabled}
                aria-label={`${label} in millimetres`}
                aria-invalid={clamped || undefined}
                onChange={(event) => {
                  const raw = event.currentTarget.value;
                  setTyped(raw);
                  const next = Number(raw);
                  if (raw.trim() === "" || !Number.isFinite(next)) return;
                  const micrometres = Math.round((next * 1000) / step) * step;
                  drag(Math.min(max, Math.max(min, micrometres)));
                }}
                onBlur={commitDraft}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="min-w-0 [field-sizing:content] bg-transparent text-center font-mono text-xs text-fg outline-none"
              />
              <span className="text-3xs text-fg-subtle">mm</span>
            </label>
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
    if (present.every((r) => r[field] === first[field]))
      out[field] = first[field];
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
