/**
 * Advanced keys — category 6. See .codex/reverse/PROTOCOL.md section 9.
 *
 * Two things here come straight off the vendor's own app rather than out of
 * the bundle: the travel and time envelopes each mode accepts, and the habit of
 * seeding every keycode slot from the key's existing keymap so a freshly bound
 * key starts as a no-op version of the mode instead of an empty one.
 *
 * Where this deliberately departs from the vendor: writes land as you make
 * them, the way every other section of this app behaves, instead of waiting
 * behind a Confirm button. Nothing reaches flash either way until Save.
 */

import * as React from "react";
import { MousePointerClick, Trash2 } from "lucide-react";
import { useDevice, keyId } from "@/store/device";
import { KeyboardView, type KeyGeometry } from "@/components/KeyboardView";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Panel,
  PanelHeader,
  Readout,
  Segmented,
  Select,
  Slider,
  Tooltip,
  useSliderDraft,
} from "@/components/ui";
import { byGroup, capLabel } from "@/hid/keycodes";
import { HigherKeyMode, SocdMode } from "@/hid/protocol/constants";
import {
  DksPosition,
  packDksTrigger,
  unpackDksTrigger,
  type DksConfig,
  type EndConfig,
  type HigherKeyConfig,
  type KeyRef,
  type MptConfig,
  type MtConfig,
  type PairConfig,
  type TglConfig,
} from "@/hid/protocol/higherkey";
import { cn, mm } from "@/lib/utils";

/**
 * The envelopes the vendor's UI enforces. These are narrower than the fields
 * can hold — travel is a u16 of micrometres — and they are the values the
 * firmware was tuned against, so they are the ones worth offering.
 */
const TRAVEL_MIN = 100;
const TRAVEL_MAX = 3300;
const TRAVEL_STEP = 10;
const MT_TIME_MAX = 1000;
const DELAY_MAX = 50;

const DEFAULT_TRAVEL = 1400;
const DEFAULT_MAX_TRAVEL = 3000;
const MPT_DEFAULT_DEPTHS: [number, number, number] = [500, 1000, 1500];
const MT_DEFAULT_TIME = 200;

type Mode = HigherKeyMode;

interface ModeInfo {
  value: Mode;
  label: string;
  name: string;
  blurb: string;
  /** SOCD and RS bind a pair; every other mode is one key. */
  pair?: boolean;
}

const MODES: ModeInfo[] = [
  {
    value: HigherKeyMode.None,
    label: "Off",
    name: "No advanced behaviour",
    blurb: "The key does exactly what the keymap says and nothing more.",
  },
  {
    value: HigherKeyMode.DKS,
    label: "DKS",
    name: "Dynamic keystroke",
    blurb:
      "Four keycodes fired at chosen points of a single stroke. Two travel thresholds cut the press and release into seven positions; each keycode picks the positions it responds to.",
  },
  {
    value: HigherKeyMode.MPT,
    label: "MPT",
    name: "Multi-point trigger",
    blurb:
      "Three keycodes, each with its own trigger depth. Pressing further sends more of them.",
  },
  {
    value: HigherKeyMode.MT,
    label: "MT",
    name: "Tap or hold",
    blurb:
      "One keycode on a quick tap, another when the key is held past the trigger time.",
  },
  {
    value: HigherKeyMode.TGL,
    label: "TGL",
    name: "Toggle",
    blurb:
      "Press once to latch the keycode down, press again to let it up. The record carries a time field, but the vendor never writes anything but zero, so neither do we.",
  },
  {
    value: HigherKeyMode.END,
    label: "END",
    name: "Press and release",
    blurb:
      "One keycode on the way down, a different one on the way up, with an optional delay between the release and its keycode.",
  },
  {
    value: HigherKeyMode.SOCD,
    label: "SOCD",
    name: "Snap tap",
    blurb:
      "Binds two keys and decides what happens when both are held — the classic opposing-input problem. Written as two packets, one from each key's point of view.",
    pair: true,
  },
  {
    value: HigherKeyMode.RS,
    label: "RS",
    name: "Rappy snappy",
    blurb:
      "Binds two keys as a pair with a delay, and leaves the resolution to the firmware. The vendor exposes no more than this, and what the board does with it is not something this app can verify.",
    pair: true,
  },
];

const modeInfo = (mode: Mode): ModeInfo =>
  MODES.find((m) => m.value === mode) ?? MODES[0]!;

const SOCD_RESOLUTIONS: ReadonlyArray<{
  value: SocdMode;
  label: string;
  title: string;
}> = [
  {
    value: SocdMode.LastOverride,
    label: "Last wins",
    title: "The most recent press overrides the one already held.",
  },
  {
    value: SocdMode.PriorityA,
    label: "A wins",
    title: "The first key of the pair always wins.",
  },
  {
    value: SocdMode.PriorityB,
    label: "B wins",
    title: "The second key of the pair always wins.",
  },
  {
    value: SocdMode.Neutralize,
    label: "Neither",
    title: "Holding both sends nothing.",
  },
];

const refOf = (id: string): KeyRef => {
  const [row = 0, col = 0] = id.split(":").map(Number);
  return { row, col };
};

export function AdvancedSection() {
  const {
    snapshot,
    keymap,
    performance,
    higher,
    busy,
    writeHigherKey,
    clearHigherKeys,
  } = useDevice();

  /**
   * Local, not the shared selection: order matters here (the first key picked
   * is A) and the cap is two, neither of which the store's set-of-keys
   * selection can express.
   */
  const [picked, setPicked] = React.useState<string[]>([]);
  const [mode, setMode] = React.useState<Mode>(HigherKeyMode.None);

  React.useEffect(() => {
    if (picked.length === 0) return;

    const clearSelection = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // An open confirmation owns Escape and should close before the keyboard
      // selection beneath it changes.
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      setPicked([]);
      setMode(HigherKeyMode.None);
    };

    window.addEventListener("keydown", clearSelection);
    return () => window.removeEventListener("keydown", clearSelection);
  }, [picked.length]);

  const keys = snapshot?.keys ?? [];
  const info = modeInfo(mode);

  const keycodeAt = React.useCallback(
    (id: string): number => {
      const { row, col } = refOf(id);
      return keymap[0]?.[row]?.[col] ?? 0;
    },
    [keymap],
  );

  const pick = (id: string) => {
    const existing = higher.get(id);
    // Clicking a configured key opens *that* key's mode, the way the vendor's
    // app does — otherwise a stray click on a bound key silently offers to
    // overwrite it with whatever mode happened to be showing.
    if (existing && !picked.includes(id)) {
      setMode(existing.mode);
      if ("data" in existing && "other" in existing.data) {
        const other = existing.data.other;
        setPicked([id, keyId(other.row, other.col)]);
      } else {
        setPicked([id]);
      }
      return;
    }
    if (!modeInfo(mode).pair) {
      setPicked(picked[0] === id ? [] : [id]);
      return;
    }
    if (picked.includes(id)) {
      setPicked(picked.filter((p) => p !== id));
      return;
    }
    setPicked(picked.length >= 2 ? [picked[1]!, id] : [...picked, id]);
  };

  const changeMode = (next: Mode) => {
    setMode(next);
    // Dropping from a pair mode to a single one leaves the second key bound to
    // nothing; keep the first and let the user re-pick.
    if (!modeInfo(next).pair && picked.length > 1) setPicked([picked[0]!]);
  };

  const label = React.useCallback(
    (key: KeyGeometry) => capLabel(keymap[0]?.[key.row]?.[key.col] ?? 0),
    [keymap],
  );

  const state = React.useCallback(
    (key: KeyGeometry) => {
      const record = higher.get(key.id);
      return record ? { badge: modeInfo(record.mode).label } : undefined;
    },
    [higher],
  );

  if (!snapshot) return null;

  const selection = new Set(picked);
  const ready = info.pair ? picked.length === 2 : picked.length >= 1;
  const primary = picked[0] ? refOf(picked[0]) : null;
  const secondary = picked[1] ? refOf(picked[1]) : null;
  const stored = picked[0] ? higher.get(picked[0]) : undefined;

  const commit = (config: HigherKeyConfig) => {
    if (!primary) return;
    void writeHigherKey(primary, config);
  };

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader>
          <span>Select keys</span>
          <div className="flex items-center gap-2">
            {higher.size > 0 ? (
              <Badge tone="accent">
                {higher.size} advanced {higher.size === 1 ? "key" : "keys"}
              </Badge>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPicked([])}
              disabled={picked.length === 0}
            >
              Clear
            </Button>
          </div>
        </PanelHeader>

        <div className="overflow-x-auto p-4">
          <KeyboardView
            keys={keys}
            selection={selection}
            onSelect={(id) => pick(id)}
            label={label}
            state={state}
            ariaLabel="Select a key to give it an advanced behaviour"
          />
        </div>

        <p className="border-t border-line px-3 py-2 text-2xs text-fg-muted">
          {info.pair
            ? "Pick two keys — the first is A, the second B."
            : "Pick one key. Clicking a key that already has a behaviour opens it."}{" "}
          Press Esc to clear the selection.
        </p>
      </Panel>

      <Panel>
        <PanelHeader>
          <span>
            Behaviour
            {picked.length > 0 ? (
              <span className="ml-2 font-normal text-fg-muted">
                {picked.map((id) => capLabel(keycodeAt(id)) || id).join(" · ")}
              </span>
            ) : null}
          </span>
          <div className="flex items-center gap-2">
            {stored ? (
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="danger" disabled={busy}>
                    <Trash2 size={12} />
                    Remove
                  </Button>
                }
                title="Remove this advanced behaviour?"
                description="The selected key or key pair will return to its normal keymap behaviour."
                confirmLabel="Remove behaviour"
                onConfirm={() => {
                  void clearHigherKeys(picked.map(refOf));
                  setMode(HigherKeyMode.None);
                  // A pair leaves two keys picked; without this the panel asks
                  // for a second key for a mode that does not take one.
                  setPicked(picked.slice(0, 1));
                }}
              />
            ) : null}
          </div>
        </PanelHeader>

        <div className="border-b border-line px-3 py-2.5">
          <Segmented
            size="sm"
            value={mode}
            onChange={changeMode}
            options={MODES.filter(
              (candidate) => !stored || candidate.value !== HigherKeyMode.None,
            ).map((m) => ({
              value: m.value,
              label: m.label,
              title: m.name,
            }))}
          />
          <p className="mt-2 max-w-[70ch] text-2xs leading-relaxed text-fg-subtle">
            <span className="text-fg-muted">{info.name}.</span> {info.blurb}
          </p>
        </div>

        {picked.length === 0 ? (
          <EmptyState
            icon={<MousePointerClick size={22} strokeWidth={1.5} />}
            title="No key selected"
          >
            Pick a key on the board above. Advanced keys sit on top of the
            keymap: the board keeps sending the key's normal keycode until one
            of these takes over.
          </EmptyState>
        ) : !ready ? (
          <EmptyState
            icon={<MousePointerClick size={22} strokeWidth={1.5} />}
            title="Pick a second key"
          >
            {info.name} binds a pair. The behaviour is written to both keys, one
            packet each, and removing it clears both.
          </EmptyState>
        ) : (
          <Editor
            mode={mode}
            primary={primary!}
            secondary={secondary}
            stored={stored}
            busy={busy}
            defaultTravel={performance.get(picked[0]!)?.press ?? DEFAULT_TRAVEL}
            keycodeAt={keycodeAt}
            picked={picked}
            onCommit={commit}
          />
        )}
      </Panel>
    </div>
  );
}

// --- editor ----------------------------------------------------------------

function Editor({
  mode,
  primary,
  secondary,
  stored,
  busy,
  defaultTravel,
  keycodeAt,
  picked,
  onCommit,
}: {
  mode: Mode;
  primary: KeyRef;
  secondary: KeyRef | null;
  stored: HigherKeyConfig | undefined;
  busy: boolean;
  defaultTravel: number;
  keycodeAt: (id: string) => number;
  picked: string[];
  onCommit: (config: HigherKeyConfig) => void;
}) {
  const ownKeycode = keycodeAt(picked[0] ?? "");
  const otherKeycode = keycodeAt(picked[1] ?? "");

  /**
   * The draft is the record as it will be written. It reloads whenever the
   * selection or the mode changes, seeded from the board when the key already
   * carries this mode and from the vendor's defaults when it does not.
   */
  const seed = React.useCallback((): HigherKeyConfig => {
    if (stored && stored.mode === mode) return stored;
    switch (mode) {
      case HigherKeyMode.DKS:
        return {
          mode,
          data: {
            keycodes: [ownKeycode, 0, 0, 0],
            triggers: [packDksTrigger([DksPosition.PressMin]), 0, 0, 0],
            minTravel: defaultTravel,
            maxTravel: DEFAULT_MAX_TRAVEL,
          },
        };
      case HigherKeyMode.MPT:
        return {
          mode,
          data: {
            keycodes: [ownKeycode, 0, 0],
            depths: [...MPT_DEFAULT_DEPTHS],
          },
        };
      case HigherKeyMode.MT:
        return {
          mode,
          data: { tap: ownKeycode, hold: 0, holdTime: MT_DEFAULT_TIME },
        };
      case HigherKeyMode.TGL:
        return { mode, data: { keycode: ownKeycode, time: 0 } };
      case HigherKeyMode.END:
        return { mode, data: { keycodes: [ownKeycode, 0], delay: 0 } };
      case HigherKeyMode.SOCD:
        return {
          mode,
          data: {
            other: secondary ?? primary,
            keycodes: [ownKeycode, otherKeycode],
            delay: 0,
            resolution: SocdMode.LastOverride,
          },
        };
      case HigherKeyMode.RS:
        return {
          mode,
          data: {
            other: secondary ?? primary,
            keycodes: [ownKeycode, otherKeycode],
            delay: 0,
          },
        };
      default:
        return { mode: HigherKeyMode.None };
    }
  }, [
    mode,
    stored,
    ownKeycode,
    otherKeycode,
    defaultTravel,
    primary,
    secondary,
  ]);

  const [draft, setDraft] = React.useState<HigherKeyConfig>(seed);
  const identity = `${mode}:${picked.join(",")}`;
  const lastIdentity = React.useRef(identity);
  if (lastIdentity.current !== identity) {
    lastIdentity.current = identity;
    setDraft(seed());
  }

  /**
   * Choosing a mode is itself an edit.
   *
   * Everywhere else in this app a control moves and the board follows, so a
   * mode that sat there looking selected while the key stayed plain would be
   * the one screen that lies. The seed is a no-op version of the mode — the
   * key's own keycode at its own actuation point — so this commits nothing the
   * user has to undo.
   */
  const commitSeed = React.useRef(onCommit);
  commitSeed.current = onCommit;
  React.useEffect(() => {
    if (stored?.mode === mode) return;
    commitSeed.current(seed());
    // Only when the selection or mode changes; `seed` is stable for those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  /** Every edit is a whole-record write; the protocol has no partial update. */
  const push = (next: HigherKeyConfig) => {
    setDraft(next);
    onCommit(next);
  };

  if (draft.mode === HigherKeyMode.None) {
    return (
      <div className="px-4 py-6">
        <p className="text-xs text-fg-muted">
          This key is plain.{" "}
          {stored
            ? "Choose a behaviour above, or leave it as it is."
            : "Choose a behaviour above to give it one."}
        </p>
      </div>
    );
  }

  switch (draft.mode) {
    case HigherKeyMode.DKS:
      return (
        <DksEditor
          data={draft.data}
          busy={busy}
          onChange={(data) => push({ mode: HigherKeyMode.DKS, data })}
        />
      );
    case HigherKeyMode.MPT:
      return (
        <MptEditor
          data={draft.data}
          busy={busy}
          onChange={(data) => push({ mode: HigherKeyMode.MPT, data })}
        />
      );
    case HigherKeyMode.MT:
      return (
        <MtEditor
          data={draft.data}
          busy={busy}
          onChange={(data) => push({ mode: HigherKeyMode.MT, data })}
        />
      );
    case HigherKeyMode.TGL:
      return (
        <TglEditor
          data={draft.data}
          busy={busy}
          onChange={(data) => push({ mode: HigherKeyMode.TGL, data })}
        />
      );
    case HigherKeyMode.END:
      return (
        <EndEditor
          data={draft.data}
          busy={busy}
          onChange={(data) => push({ mode: HigherKeyMode.END, data })}
        />
      );
    case HigherKeyMode.SOCD:
      return (
        <PairEditor
          data={draft.data}
          busy={busy}
          picked={picked}
          keycodeAt={keycodeAt}
          resolution={draft.data.resolution}
          onChange={(data, resolution) =>
            push({
              mode: HigherKeyMode.SOCD,
              data: {
                ...data,
                resolution: resolution ?? draft.data.resolution,
              },
            })
          }
        />
      );
    case HigherKeyMode.RS:
      return (
        <PairEditor
          data={draft.data}
          busy={busy}
          picked={picked}
          keycodeAt={keycodeAt}
          onChange={(data) => push({ mode: HigherKeyMode.RS, data })}
        />
      );
    default:
      return null;
  }
}

// --- per-mode editors ------------------------------------------------------

const GRID = "grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2";

function DksEditor({
  data,
  busy,
  onChange,
}: {
  data: DksConfig;
  busy: boolean;
  onChange: (data: DksConfig) => void;
}) {
  const setSlot = (
    i: number,
    patch: { keycode?: number; trigger?: number },
  ) => {
    const keycodes = [...data.keycodes] as DksConfig["keycodes"];
    const triggers = [...data.triggers] as DksConfig["triggers"];
    if (patch.keycode !== undefined) keycodes[i] = patch.keycode;
    if (patch.trigger !== undefined) triggers[i] = patch.trigger;
    onChange({ ...data, keycodes, triggers });
  };

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-2">
        <TimelineHeader minTravel={data.minTravel} maxTravel={data.maxTravel} />
        {data.keycodes.map((keycode, i) => (
          <div key={i} className="flex flex-wrap items-center gap-3">
            <KeycodeSelect
              value={keycode}
              allowMouse
              disabled={busy}
              className="w-40 shrink-0"
              aria-label={`Keycode ${i + 1}`}
              onChange={(kc) => setSlot(i, { keycode: kc })}
            />
            <Timeline
              value={data.triggers[i] ?? 0}
              minTravel={data.minTravel}
              maxTravel={data.maxTravel}
              disabled={busy || keycode === 0}
              onChange={(trigger) => setSlot(i, { trigger })}
            />
          </div>
        ))}
      </div>

      <p className="text-2xs leading-relaxed text-fg-subtle">
        Round marks are instants — the moment the key crosses a threshold.
        Square marks are the stretches in between, where the keycode is held for
        as long as the key stays there.
      </p>

      <div className={cn(GRID, "border-t border-line pt-4 pr-0 pb-0 pl-0")}>
        <TravelField
          label="First threshold"
          hint="Seeded from this key's actuation point."
          value={data.minTravel}
          disabled={busy}
          onCommit={(minTravel) => onChange({ ...data, minTravel })}
        />
        <TravelField
          label="Second threshold"
          hint="Deeper than the first, or the middle positions collapse."
          value={data.maxTravel}
          disabled={busy}
          onCommit={(maxTravel) => onChange({ ...data, maxTravel })}
        />
      </div>
    </div>
  );
}

/** The seven positions of one stroke, laid out left to right. */
const POSITIONS: ReadonlyArray<{
  position: DksPosition;
  shape: "instant" | "hold";
  describe: (min: string, max: string) => string;
}> = [
  {
    position: DksPosition.PressMin,
    shape: "instant",
    describe: (min) => `Pressing past ${min} mm`,
  },
  {
    position: DksPosition.HoldBetween,
    shape: "hold",
    describe: (min, max) => `Held between ${min} and ${max} mm`,
  },
  {
    position: DksPosition.PressMax,
    shape: "instant",
    describe: (_, max) => `Pressing past ${max} mm`,
  },
  {
    position: DksPosition.HoldBottom,
    shape: "hold",
    describe: (_, max) => `Held below ${max} mm`,
  },
  {
    position: DksPosition.ReleaseMax,
    shape: "instant",
    describe: (_, max) => `Rising past ${max} mm`,
  },
  {
    position: DksPosition.ReleaseBetween,
    shape: "hold",
    describe: (min, max) => `Rising between ${max} and ${min} mm`,
  },
  {
    position: DksPosition.ReleaseMin,
    shape: "instant",
    describe: (min) => `Rising past ${min} mm`,
  },
];

/**
 * The stroke is a fixed measure, not a stretchy one. Spread across a wide
 * panel the seven marks stop reading as one press and become a ruler.
 */
const TIMELINE_BOX = "flex w-[340px] max-w-full shrink-0 justify-between px-3";

/** The two thresholds, labelled over the marks they belong to. */
function TimelineHeader({
  minTravel,
  maxTravel,
}: {
  minTravel: number;
  maxTravel: number;
}) {
  const marks = [
    mm(minTravel, 2),
    "",
    mm(maxTravel, 2),
    "",
    mm(maxTravel, 2),
    "",
    mm(minTravel, 2),
  ];
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-40 shrink-0" />
      <div className={TIMELINE_BOX}>
        {marks.map((label, i) => (
          <span
            key={i}
            className="w-3.5 shrink-0 text-center font-mono text-3xs tabular-nums text-fg-subtle"
          >
            {label ? (
              <span className="relative -left-2 inline-block w-8">{label}</span>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}

function Timeline({
  value,
  minTravel,
  maxTravel,
  disabled,
  onChange,
}: {
  value: number;
  minTravel: number;
  maxTravel: number;
  disabled: boolean;
  onChange: (bits: number) => void;
}) {
  const active = new Set(unpackDksTrigger(value));
  const min = mm(minTravel, 1);
  const max = mm(maxTravel, 1);

  const toggle = (position: DksPosition) => {
    const next = new Set(active);
    if (next.has(position)) next.delete(position);
    else next.add(position);
    onChange(packDksTrigger(next));
  };

  return (
    <div
      role="group"
      aria-label="Trigger positions"
      className={cn(
        TIMELINE_BOX,
        "relative items-center rounded-md bg-canvas-inset py-2",
        disabled && "opacity-40",
      )}
    >
      {/* The stroke itself, drawn behind the marks. */}
      <span
        aria-hidden
        className="absolute inset-x-5 top-1/2 h-px -translate-y-1/2 bg-line"
      />
      {POSITIONS.map(({ position, shape, describe }) => {
        const on = active.has(position);
        return (
          <Tooltip key={position} content={describe(min, max)}>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={on}
              aria-label={describe(min, max)}
              onClick={() => toggle(position)}
              className={cn(
                "relative z-10 h-3.5 w-3.5 border transition-colors",
                shape === "instant" ? "rounded-full" : "rounded-[2px]",
                on
                  ? "border-accent bg-accent"
                  : "border-line-strong bg-canvas-overlay hover:border-fg-muted",
                disabled ? "cursor-not-allowed" : "cursor-pointer",
              )}
            />
          </Tooltip>
        );
      })}
    </div>
  );
}

function MptEditor({
  data,
  busy,
  onChange,
}: {
  data: MptConfig;
  busy: boolean;
  onChange: (data: MptConfig) => void;
}) {
  return (
    <div className="space-y-3 p-4">
      {data.keycodes.map((keycode, i) => (
        <div key={i} className="flex flex-wrap items-center gap-3">
          <KeycodeSelect
            value={keycode}
            disabled={busy}
            className="w-40 shrink-0"
            aria-label={`Keycode ${i + 1}`}
            onChange={(kc) => {
              const keycodes = [...data.keycodes] as MptConfig["keycodes"];
              keycodes[i] = kc;
              onChange({ ...data, keycodes });
            }}
          />
          <TravelSlider
            value={data.depths[i] ?? 0}
            disabled={busy || keycode === 0}
            ariaLabel={`Trigger depth ${i + 1}`}
            onCommit={(depth) => {
              const depths = [...data.depths] as MptConfig["depths"];
              depths[i] = depth;
              onChange({ ...data, depths });
            }}
          />
        </div>
      ))}
      <p className="text-2xs text-fg-subtle">
        Depths are independent — the firmware does not sort them, so a shallower
        keycode further down the list simply fires first.
      </p>
    </div>
  );
}

function MtEditor({
  data,
  busy,
  onChange,
}: {
  data: MtConfig;
  busy: boolean;
  onChange: (data: MtConfig) => void;
}) {
  return (
    <div className={GRID}>
      <Field
        label="Tap"
        hint="Sent when the key is released before the trigger time."
        control={
          <KeycodeSelect
            value={data.tap}
            disabled={busy}
            aria-label="Tap keycode"
            onChange={(tap) => onChange({ ...data, tap })}
          />
        }
      />
      <Field
        label="Hold"
        hint="Sent once the key has been held past the trigger time."
        control={
          <KeycodeSelect
            value={data.hold}
            disabled={busy}
            aria-label="Hold keycode"
            onChange={(hold) => onChange({ ...data, hold })}
          />
        }
      />
      <MsField
        label="Trigger time"
        hint="The line between a tap and a hold."
        value={data.holdTime}
        max={MT_TIME_MAX}
        disabled={busy}
        onCommit={(holdTime) => onChange({ ...data, holdTime })}
      />
    </div>
  );
}

function TglEditor({
  data,
  busy,
  onChange,
}: {
  data: TglConfig;
  busy: boolean;
  onChange: (data: TglConfig) => void;
}) {
  return (
    <div className={GRID}>
      <Field
        label="Keycode"
        hint="Latched down on the first press, released on the next."
        control={
          <KeycodeSelect
            value={data.keycode}
            disabled={busy}
            aria-label="Toggled keycode"
            onChange={(keycode) => onChange({ ...data, keycode })}
          />
        }
      />
    </div>
  );
}

function EndEditor({
  data,
  busy,
  onChange,
}: {
  data: EndConfig;
  busy: boolean;
  onChange: (data: EndConfig) => void;
}) {
  return (
    <div className={GRID}>
      <Field
        label="On press"
        hint="Sent as the key goes down."
        control={
          <KeycodeSelect
            value={data.keycodes[0]}
            disabled={busy}
            aria-label="Press keycode"
            onChange={(kc) =>
              onChange({ ...data, keycodes: [kc, data.keycodes[1]] })
            }
          />
        }
      />
      <Field
        label="On release"
        hint="Sent as the key comes back up."
        control={
          <KeycodeSelect
            value={data.keycodes[1]}
            disabled={busy}
            aria-label="Release keycode"
            onChange={(kc) =>
              onChange({ ...data, keycodes: [data.keycodes[0], kc] })
            }
          />
        }
      />
      <MsField
        label="Delay"
        hint="Waited out before the release keycode is sent."
        value={data.delay}
        max={DELAY_MAX}
        disabled={busy}
        onCommit={(delay) => onChange({ ...data, delay })}
      />
    </div>
  );
}

function PairEditor({
  data,
  busy,
  picked,
  keycodeAt,
  resolution,
  onChange,
}: {
  data: PairConfig;
  busy: boolean;
  picked: string[];
  keycodeAt: (id: string) => number;
  resolution?: SocdMode;
  onChange: (data: PairConfig, resolution?: SocdMode) => void;
}) {
  const nameA = capLabel(keycodeAt(picked[0] ?? "")) || "A";
  const nameB = capLabel(keycodeAt(picked[1] ?? "")) || "B";

  return (
    <div className={GRID}>
      <Field
        label={`Key A sends — ${nameA}`}
        hint="What the first key of the pair reports."
        control={
          <KeycodeSelect
            value={data.keycodes[0]}
            disabled={busy}
            aria-label="Key A keycode"
            onChange={(kc) =>
              onChange({ ...data, keycodes: [kc, data.keycodes[1]] })
            }
          />
        }
      />
      <Field
        label={`Key B sends — ${nameB}`}
        hint="What the second key reports."
        control={
          <KeycodeSelect
            value={data.keycodes[1]}
            disabled={busy}
            aria-label="Key B keycode"
            onChange={(kc) =>
              onChange({ ...data, keycodes: [data.keycodes[0], kc] })
            }
          />
        }
      />
      {resolution !== undefined ? (
        <Field
          label="When both are held"
          hint="Written as a different byte to each key of the pair."
          control={
            <Segmented
              size="sm"
              value={resolution}
              onChange={(next) => onChange(data, next)}
              options={SOCD_RESOLUTIONS.map((r) => ({
                value: r.value,
                label: r.label,
                title: r.title,
              }))}
            />
          }
        />
      ) : null}
      <MsField
        label="Delay"
        hint="Held in both packets; the firmware applies it to the swap."
        value={data.delay}
        max={DELAY_MAX}
        disabled={busy}
        onCommit={(delay) => onChange({ ...data, delay })}
      />
    </div>
  );
}

// --- primitives ------------------------------------------------------------

/**
 * The keycode picker.
 *
 * The vendor's palette here is a curated subset — it leaves out Enter, Tab,
 * Backspace and the arrows for no reason the protocol explains, since the board
 * stores whatever u16 it is handed. So this offers the whole keyboard page,
 * plus mouse buttons where the vendor allows them (DKS only).
 */
function KeycodeSelect({
  value,
  onChange,
  disabled,
  allowMouse,
  className,
  ...rest
}: {
  value: number;
  onChange: (keycode: number) => void;
  disabled?: boolean;
  allowMouse?: boolean;
  className?: string;
} & Pick<React.ButtonHTMLAttributes<HTMLButtonElement>, "id" | "aria-label">) {
  const basic = React.useMemo(() => byGroup("basic"), []);
  const mouse = React.useMemo(() => byGroup("mouse"), []);

  // Split the keyboard page the way the vendor's two palettes do: the keys you
  // type with, then everything else.
  const typing = basic.filter((k) => k.code <= 56);
  const rest2 = basic.filter((k) => k.code > 56);

  return (
    <Select
      value={value}
      disabled={disabled}
      className={className}
      onValueChange={(next) => onChange(Number(next))}
      options={[
        { options: [{ value: 0, label: "— none —" }] },
        {
          label: "Letters, numbers and punctuation",
          options: typing.map((keycode) => ({
            value: keycode.code,
            label: keycode.label,
          })),
        },
        {
          label: "Function, navigation and modifiers",
          options: rest2.map((keycode) => ({
            value: keycode.code,
            label: keycode.label,
          })),
        },
        ...(allowMouse
          ? [
              {
                label: "Mouse",
                options: mouse.map((keycode) => ({
                  value: keycode.code,
                  label: keycode.label,
                })),
              },
            ]
          : []),
      ]}
      {...rest}
    />
  );
}

function TravelField({
  label,
  hint,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  hint: string;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  return (
    <Field
      label={label}
      hint={hint}
      control={
        <TravelSlider
          value={value}
          disabled={disabled}
          ariaLabel={label}
          onCommit={onCommit}
        />
      }
    />
  );
}

/** Travel in micrometres, shown in millimetres, written on release. */
function TravelSlider({
  value,
  disabled,
  ariaLabel,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  ariaLabel: string;
  onCommit: (value: number) => void;
}) {
  const { draft, drag, commit } = useSliderDraft(onCommit);
  const shown = draft ?? value;

  return (
    <div className="flex flex-1 items-center gap-3">
      <Slider
        value={[shown]}
        min={TRAVEL_MIN}
        max={TRAVEL_MAX}
        step={TRAVEL_STEP}
        disabled={disabled}
        onValueChange={([v]) => drag(v ?? TRAVEL_MIN)}
        onValueCommit={([v]) => {
          if (v !== undefined) commit(v);
        }}
        aria-label={ariaLabel}
      />
      <Readout
        className="w-14 shrink-0 text-right"
        value={mm(shown)}
        unit="mm"
        tone={disabled ? "muted" : "default"}
      />
    </div>
  );
}

function MsField({
  label,
  hint,
  value,
  max,
  disabled,
  onCommit,
}: {
  label: string;
  hint: string;
  value: number;
  max: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const { draft, drag, commit } = useSliderDraft(onCommit);
  const shown = draft ?? value;

  return (
    <Field
      label={label}
      hint={hint}
      control={
        <div className="flex items-center gap-3">
          <Slider
            value={[shown]}
            min={0}
            max={max}
            step={max > 100 ? 10 : 1}
            disabled={disabled}
            onValueChange={([v]) => drag(v ?? 0)}
            onValueCommit={([v]) => {
              if (v !== undefined) commit(v);
            }}
            aria-label={label}
          />
          <Readout
            className="w-14 shrink-0 text-right"
            value={String(shown)}
            unit="ms"
            tone={disabled ? "muted" : "default"}
          />
        </div>
      }
    />
  );
}
