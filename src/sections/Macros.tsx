import * as React from "react";
import {
  Circle,
  ChevronDown,
  ChevronUp,
  Clock,
  Keyboard as KeyboardIcon,
  ListOrdered,
  MemoryStick,
  Pencil,
  Plus,
  Square,
  Trash2,
} from "lucide-react";
import { useDevice } from "@/store/device";
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
  Settle,
  Switch,
  Tooltip,
} from "@/components/ui";
import {
  MAX_DELAY_MS,
  poolUsed,
  type MacroAction,
  type MacroMode,
} from "@/hid/protocol/macro";
import { MACRO_SLOTS } from "@/hid/protocol/constants";
import { keycodeForEvent, LOCKABLE_CODES } from "@/hid/browserKeys";
import { describe as describeKey, byGroup, macroKeycode } from "@/hid/keycodes";
import { cn } from "@/lib/utils";

/**
 * The placeholder the vendor gives the newest recorded action, and what a
 * hand-inserted action starts at.
 */
const DEFAULT_DELAY_MS = 10;
/** The firmware treats 65535 as "forever" for the hold-to-run modes. */
const INFINITE_REPEAT = 65535;
const MAX_REPEAT = 9999;

/** Keymap layers, named as the Keymap section names them. */
const LAYER_NAMES = ["Main", "Fn1", "Fn2", "Fn3"];

/**
 * Is the browser showing this page fullscreen?
 *
 * Two ways in, and they report differently. A page that called
 * `requestFullscreen` sets `fullscreenElement`; the browser's own fullscreen —
 * F11, or the green button on a Mac — leaves that null and shows up only as
 * the `display-mode` media feature. Recording needs either, so check both.
 */
const isFullscreen = (): boolean =>
  document.fullscreenElement !== null ||
  window.matchMedia("(display-mode: fullscreen)").matches;

type PlaybackMode = "press" | "toggle" | "hold";

interface ModeInfo {
  id: PlaybackMode;
  label: string;
  /** The firmware mode this writes. */
  firmware: number;
  /** Fixed repeat count, or null when the count is the user's to choose. */
  repeats: number | null;
}

/**
 * Three modes, from the board's six.
 *
 * The firmware distinguishes press/hold, and then — separately — whether a
 * second press or a release cuts the macro off *immediately* or lets the pass
 * in progress finish. That second axis is what makes six, and it is not worth
 * a user's attention: this driver always takes the finishing variant.
 *
 * That is a safety choice as much as a simplicity one. A recorded macro is
 * pairs of down and up, so a run stopped between the two leaves a key the
 * board still believes is held. Finishing the pass cannot stray into that
 * state; cutting it short can. Modes 1, 2 and 4 are therefore never written,
 * only read — a macro made in the vendor app still lands in the right bucket.
 */
const MODES: ModeInfo[] = [
  { id: "press", label: "Press", firmware: 0, repeats: null },
  { id: "toggle", label: "Toggle", firmware: 3, repeats: MAX_REPEAT },
  { id: "hold", label: "Hold", firmware: 5, repeats: INFINITE_REPEAT },
];

/** Which of the three a stored firmware mode belongs to. */
const modeOf = (firmware: number): PlaybackMode =>
  firmware >= 4 ? "hold" : firmware >= 2 ? "toggle" : "press";

const modeInfo = (id: PlaybackMode): ModeInfo =>
  MODES.find((m) => m.id === id) ?? MODES[0]!;

/**
 * What the current settings will actually do, in a sentence.
 *
 * Toggle takes its repeat count into account rather than always promising to
 * run forever. A slot written by the vendor app can be a toggle with a count
 * of one, which plays through exactly once — saying "starts the macro
 * repeating" about that would be a plain lie until the slot is rewritten.
 */
function modeNote(id: PlaybackMode, repeats: number): string {
  const second = "Pressing it again lets the pass in progress finish, then stops.";
  switch (id) {
    case "toggle":
      if (repeats >= MAX_REPEAT) {
        return `Pressing the key starts the macro repeating. ${second}`;
      }
      return `Pressing the key ${
        repeats === 1
          ? "plays the macro once"
          : `repeats the macro up to ${repeats} times`
      }. ${second}`;
    case "hold":
      return "The macro repeats for as long as you hold the key. Letting go lets the pass in progress finish, then stops.";
    default:
      return `Pressing the key plays the macro ${
        repeats === 1 ? "once" : `${repeats} times`
      }, then stops. Presses while it runs are ignored.`;
  }
}


interface Draft {
  actions: MacroAction[];
  mode: number;
  repeatCount: number;
}

const sameDraft = (a: Draft, b: Draft): boolean =>
  a.mode === b.mode &&
  a.repeatCount === b.repeatCount &&
  a.actions.length === b.actions.length &&
  a.actions.every(
    (x, i) =>
      x.down === b.actions[i]?.down &&
      x.delay === b.actions[i]?.delay &&
      x.keycode === b.actions[i]?.keycode,
  );

export function MacrosSection({
  onOpenKeymap,
}: {
  onOpenKeymap?: () => void;
}) {
  const {
    macros,
    macroActions,
    macroCapacity,
    keymap,
    writeMacro,
    clearMacro,
    busy,
    revision,
  } = useDevice();

  const [slot, setSlot] = React.useState(0);
  const [draft, setDraft] = React.useState<Draft>({
    actions: [],
    mode: 0,
    repeatCount: 1,
  });
  const [editing, setEditing] = React.useState<number | null>(null);
  const [refused, setRefused] = React.useState(false);

  const record = macros.find((m) => m.macroId === slot);

  /** What the board currently holds for this slot. */
  const committed = React.useMemo<Draft>(
    () => ({
      actions: macroActions.get(slot) ?? [],
      mode: record?.mode ?? 0,
      // Kept verbatim, 65535 included: Toggle and Hold store a fixed count, so
      // flattening it here would make every such slot look edited on load.
      // Only an empty slot's 0 becomes the 1 a fresh Press macro starts at.
      repeatCount: record?.repeatCount || 1,
    }),
    [macroActions, record, slot],
  );

  // Selecting a slot loads what the board holds; a later reload of the same
  // slot must not stamp over edits in progress, so this keys on the slot.
  React.useEffect(() => {
    setDraft({
      actions: committed.actions.map((a) => ({ ...a })),
      mode: committed.mode,
      repeatCount: committed.repeatCount,
    });
    setEditing(null);
    setRefused(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, macros.length]);

  const unwritten = !sameDraft(draft, committed);

  // Every slot but this one is already spoken for; the draft has to fit in
  // whatever is left of the board's shared action budget.
  const used = poolUsed(macros);
  const usedElsewhere = used - (record?.actionCount ?? 0);
  const remaining = macroCapacity - usedElsewhere;
  const overBudget = draft.actions.length > remaining;

  /**
   * Which layers already send this macro.
   *
   * A written macro does nothing until a key sends its keycode, and that
   * binding lives in a different section — so the one place a user is looking
   * at the macro is the place to say whether it is reachable at all.
   */
  const boundLayers = React.useMemo(() => {
    const code = macroKeycode(slot);
    return keymap.flatMap((rows, layer) =>
      rows?.some((cols) => cols?.some((kc) => kc === code))
        ? [LAYER_NAMES[layer] ?? `Layer ${layer}`]
        : [],
    );
  }, [keymap, slot]);

  const mode = modeOf(draft.mode);

  /** Switching mode carries its fixed repeat count with it. */
  const setMode = (id: PlaybackMode) => {
    const next = modeInfo(id);
    setDraft((d) => ({
      ...d,
      mode: next.firmware,
      repeatCount: next.repeats ?? (d.repeatCount > MAX_REPEAT ? 1 : d.repeatCount),
    }));
  };

  const commit = async () => {
    const stored = await writeMacro(slot, draft.actions, {
      repeatCount: draft.repeatCount,
      mode: draft.mode,
    });
    setRefused(stored === null);
  };

  if (macros.length === 0) return null;

  return (
    <div className="space-y-4">
      <SlotRail
        slot={slot}
        onSlot={setSlot}
        macros={macros}
        used={used}
        capacity={macroCapacity}
      />

      <Panel>
        <PanelHeader>
          <span>Playback</span>
          <Badge tone="default">Macro {slot}</Badge>
        </PanelHeader>
        <div className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2">
          <Field
            label="Mode"
            hint={modeNote(mode, draft.repeatCount)}
            control={
              <Segmented
                value={mode}
                onChange={setMode}
                options={MODES.map((m) => ({ value: m.id, label: m.label }))}
              />
            }
          />
          {/*
            Only Press takes a count. Toggle and Hold run until the key says
            otherwise, so a number beside them would be a control with nothing
            to control — better absent than present and inert.
          */}
          {mode === "press" ? (
            <Field
              label="Repeats"
              hint={`How many times one press plays it, up to ${MAX_REPEAT}.`}
              control={
                <input
                  type="number"
                  min={1}
                  max={MAX_REPEAT}
                  value={draft.repeatCount}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      repeatCount: clamp(Number(e.target.value), 1, MAX_REPEAT),
                    }))
                  }
                  className="h-7 w-full rounded-md border border-line bg-canvas-inset px-2 font-mono text-xs tabular-nums text-fg"
                />
              }
            />
          ) : null}
        </div>
      </Panel>

      <Recorder
        draft={draft}
        setDraft={setDraft}
        editing={editing}
        setEditing={setEditing}
      />

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="min-w-0 space-y-0.5">
            <Settle
              revision={revision.get(`macro:${slot}`) ?? 0}
              className="flex flex-wrap items-center gap-3"
            >
              <Readout
                value={`${draft.actions.length}`}
                unit={draft.actions.length === 1 ? "action" : "actions"}
                size="sm"
                tone={overBudget ? "attention" : "muted"}
              />
              {unwritten ? (
                <Badge tone="attention">Not yet on the keyboard</Badge>
              ) : null}
            </Settle>
            <p className="text-2xs text-fg-subtle">
              {refused
                ? "The keyboard would not take this macro — there is no room left for it. Make it shorter, or empty a slot you are not using."
                : overBudget
                  ? `This macro is too long. The other slots leave room for ${remaining} actions, and the keyboard turns down anything longer without saying so.`
                  : unwritten
                    ? "Edits live in this page until you write them to the keyboard."
                    : "This slot matches what the keyboard holds."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {committed.actions.length > 0 ? (
              <ConfirmDialog
                trigger={
                  <Button variant="danger" disabled={busy}>
                    <Trash2 size={14} />
                    Clear slot
                  </Button>
                }
                title={`Clear Macro ${slot}?`}
                description="The slot is emptied on the keyboard, and the room it used becomes available to the other slots. Any key bound to this macro stops doing anything."
                confirmLabel="Clear slot"
                onConfirm={() => void clearMacro(slot)}
              />
            ) : null}
            <Button
              variant={unwritten ? "primary" : "default"}
              disabled={busy || !unwritten}
              onClick={() => void commit()}
            >
              Write to keyboard
            </Button>
          </div>
        </div>

        {/*
          A macro sitting in a slot is inert. The keycode that reaches it is
          assigned in another section entirely, so this says plainly whether
          anything presses it yet, and offers the way there.
        */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
          {/*
            The text is one flex item, not several: a gap on this row would
            otherwise land between every text node, spacing out the layer name
            and stranding the full stop.
          */}
          <p className="flex items-center gap-1.5 text-2xs text-fg-muted">
            <KeyboardIcon size={12} className="shrink-0 text-fg-subtle" />
            <span>
              {boundLayers.length > 0 ? (
                <>
                  Sent by a key on{" "}
                  <span className="text-fg">{boundLayers.join(", ")}</span>.
                </>
              ) : committed.actions.length > 0 ? (
                <>
                  No key sends this macro yet — assign{" "}
                  <span className="text-fg">M{slot}</span> to one in Keymap,
                  under the Macro group.
                </>
              ) : (
                <>
                  Once written, assign <span className="text-fg">M{slot}</span>{" "}
                  to a key in Keymap, under the Macro group.
                </>
              )}
            </span>
          </p>
          {onOpenKeymap ? (
            <Button size="sm" variant="ghost" onClick={onOpenKeymap}>
              Open Keymap
            </Button>
          ) : null}
        </div>
      </Panel>

      {editing !== null ? (
        <ActionDialog
          action={draft.actions[editing]!}
          onCancel={() => setEditing(null)}
          onSave={(next) => {
            setDraft((d) => ({
              ...d,
              actions: d.actions.map((a, i) => (i === editing ? next : a)),
            }));
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

const clamp = (n: number, lo: number, hi: number): number =>
  Number.isNaN(n) ? lo : Math.min(hi, Math.max(lo, n));

// --- slots -----------------------------------------------------------------

function SlotRail({
  slot,
  onSlot,
  macros,
  used,
  capacity,
}: {
  slot: number;
  onSlot: (id: number) => void;
  macros: readonly MacroMode[];
  used: number;
  capacity: number;
}) {
  return (
    <Panel>
      <PanelHeader>
        <span>Slots</span>
        {/*
          The board reports its ceiling but never the remaining space, so the
          only way a user learns memory is running out is if the interface adds
          it up. The icon carries what the word "Memory" was carrying: that the
          figure is the board's storage, shared by every slot, not a per-slot
          allowance. The tooltip says it in full for anyone the icon loses.
        */}
        <Tooltip content="Macro memory used across all sixteen slots">
          <span
            className="flex items-center gap-1.5"
            aria-label={`Macro memory: ${used} of ${capacity} actions used`}
          >
            <MemoryStick
              size={12}
              aria-hidden
              className="shrink-0 text-fg-subtle"
            />
            <Readout
              value={`${used} / ${capacity}`}
              unit="actions"
              size="sm"
              tone={used >= capacity ? "attention" : "muted"}
            />
          </span>
        </Tooltip>
      </PanelHeader>
      <div className="grid grid-cols-4 gap-2 p-3 sm:grid-cols-8">
        {Array.from({ length: MACRO_SLOTS }, (_, id) => {
          const count = macros.find((m) => m.macroId === id)?.actionCount ?? 0;
          const active = id === slot;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSlot(id)}
              aria-pressed={active}
              title={
                count > 0
                  ? `Macro ${id} — ${count} ${count === 1 ? "action" : "actions"}`
                  : `Macro ${id} — empty`
              }
              aria-label={
                count > 0
                  ? `Macro ${id}, ${count} ${count === 1 ? "action" : "actions"}`
                  : `Macro ${id}, empty`
              }
              className={cn(
                "relative flex h-10 items-center justify-center rounded-md border transition-colors",
                active
                  ? "border-accent bg-accent-subtle text-fg"
                  : "border-line bg-canvas-inset text-fg-muted hover:text-fg",
              )}
            >
              {/*
                The dot is always drawn, and only its colour carries the state.
                A mark that appears and disappears makes sixteen tiles twitch as
                slots fill; a mark that is always in the same place turns the
                whole rail into one row of on/off lights that can be read in a
                glance. The exact length lives in the tooltip — it matters when
                you are editing a slot, not when you are picking one.
              */}
              <span
                aria-hidden
                className={cn(
                  "absolute top-1 right-1 h-1.5 w-1.5 rounded-full transition-colors",
                  count > 0 ? "bg-accent" : "bg-line-strong",
                )}
              />
              <span className="text-xs font-semibold">M{id}</span>
            </button>
          );
        })}
      </div>
      {/*
        What an action *is* is the part that surprises people: a press and its
        release are separate, so typing a five-letter word costs ten, not five.
      */}
      <p className="border-t border-line px-3 py-2 text-2xs text-fg-subtle">
        All sixteen slots share the keyboard's macro memory. Pressing a key and
        letting it go count as one action each, so a macro that types{" "}
        <span className="font-mono text-fg-muted">ab</span> uses four.
      </p>
    </Panel>
  );
}

// --- recorder --------------------------------------------------------------

function Recorder({
  draft,
  setDraft,
  editing,
  setEditing,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  editing: number | null;
  setEditing: (index: number | null) => void;
}) {
  const [recording, setRecording] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(isFullscreen);
  const [fixedDelay, setFixedDelay] = React.useState(false);
  const [fixedDelayMs, setFixedDelayMs] = React.useState(DEFAULT_DELAY_MS);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Refs, not state: the key handler is installed once per recording session
  // and must see the live values without being torn down on every keystroke.
  const lastEventAt = React.useRef(0);
  const held = React.useRef(new Set<string>());
  const options = React.useRef({ fixedDelay, fixedDelayMs });
  options.current = { fixedDelay, fixedDelayMs };

  /**
   * Append one event.
   *
   * The gap since the previous event lands on the *previous* action and the new
   * one takes a placeholder, which is the vendor's convention: a delay reads as
   * "wait after this action". Recording it the other way round would play back
   * shifted by one against every vendor-authored macro.
   */
  const append = React.useCallback(
    (keycode: number, down: boolean) => {
      const now = Date.now();
      const { fixedDelay: fixed, fixedDelayMs: fixedMs } = options.current;
      const gap = fixed
        ? fixedMs
        : lastEventAt.current
          ? Math.min(now - lastEventAt.current, MAX_DELAY_MS)
          : DEFAULT_DELAY_MS;
      lastEventAt.current = now;

      setDraft((d) => {
        const actions = d.actions.map((a) => ({ ...a }));
        const previous = actions[actions.length - 1];
        if (previous) previous.delay = gap;
        actions.push({
          down,
          delay: fixed ? fixedMs : DEFAULT_DELAY_MS,
          keycode,
        });
        return { ...d, actions };
      });
    },
    [setDraft],
  );

  React.useEffect(() => {
    if (!recording) return;

    const onKey = (event: KeyboardEvent) => {
      // The browser's own auto-repeat is not a keystroke the user made.
      if (event.repeat) return;
      event.preventDefault();
      event.stopPropagation();

      const keycode = keycodeForEvent(event);
      if (keycode === null) return;

      const down = event.type === "keydown";
      if (down && held.current.has(event.code)) return;
      if (down) held.current.add(event.code);
      else held.current.delete(event.code);
      append(keycode, down);
    };

    /**
     * Leaving the page strands anything still down. Releasing it here keeps a
     * macro from ending mid-press, which on playback would leave the key stuck.
     */
    const flush = () => {
      for (const code of held.current) {
        const keycode = keycodeForEvent({ code } as KeyboardEvent);
        if (keycode !== null) append(keycode, false);
      }
      held.current.clear();
    };

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", flush);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", flush);
      flush();
    };
  }, [recording, append]);

  // Keep the newest action in view while a recording runs.
  React.useEffect(() => {
    if (recording && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [draft.actions.length, recording]);

  // Leaving fullscreen mid-recording takes the keyboard lock with it, so the
  // recording ends with it rather than carrying on half-deaf.
  React.useEffect(() => {
    const sync = () => setFullscreen(isFullscreen());
    const media = window.matchMedia("(display-mode: fullscreen)");
    document.addEventListener("fullscreenchange", sync);
    media.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      media.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);


  const start = async () => {
    lastEventAt.current = 0;
    held.current.clear();
    // The page is already fullscreen — Record is disabled otherwise — so the
    // lock has what it needs. It is still best-effort: where it is refused,
    // Escape and the OS modifiers just do not make it into the recording.
    try {
      await navigator.keyboard?.lock?.([...LOCKABLE_CODES]);
    } catch {
      // Every ordinary key still records.
    }
    setRecording(true);
  };

  const stop = React.useCallback(() => {
    setRecording(false);
    try {
      navigator.keyboard?.unlock?.();
    } catch {
      // Nothing here is worth interrupting the user over.
    }
  }, []);

  React.useEffect(() => {
    if (recording && !fullscreen) stop();
  }, [recording, fullscreen, stop]);

  const insertAfter = (index: number) => {
    setDraft((d) => {
      const actions = d.actions.map((a) => ({ ...a }));
      actions.splice(index + 1, 0, {
        down: true,
        delay: DEFAULT_DELAY_MS,
        keycode: 4,
      });
      return { ...d, actions };
    });
    setEditing(index + 1);
  };

  const remove = (index: number) =>
    setDraft((d) => ({
      ...d,
      actions: d.actions.filter((_, i) => i !== index),
    }));

  const move = (index: number, by: number) =>
    setDraft((d) => {
      const to = index + by;
      if (to < 0 || to >= d.actions.length) return d;
      const actions = d.actions.map((a) => ({ ...a }));
      const [moved] = actions.splice(index, 1);
      actions.splice(to, 0, moved!);
      return { ...d, actions };
    });

  return (
    <Panel>
      <PanelHeader>
        <span>Actions</span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-2xs text-fg-muted">
            Fixed delay
            <Switch
              checked={fixedDelay}
              onCheckedChange={setFixedDelay}
              disabled={recording}
              aria-label="Use one fixed delay instead of recorded timings"
            />
            <input
              type="number"
              min={1}
              max={MAX_DELAY_MS}
              value={fixedDelayMs}
              disabled={!fixedDelay || recording}
              onChange={(e) =>
                setFixedDelayMs(clamp(Number(e.target.value), 1, MAX_DELAY_MS))
              }
              className="h-5 w-16 rounded border border-line bg-canvas-inset px-1 font-mono text-2xs tabular-nums text-fg disabled:opacity-40"
            />
            ms
          </label>
          <Button
            size="sm"
            variant="ghost"
            disabled={recording || draft.actions.length === 0}
            onClick={() => setDraft((d) => ({ ...d, actions: [] }))}
          >
            Clear
          </Button>
          <RecordButton
            recording={recording}
            fullscreen={fullscreen}
            onToggle={() => void (recording ? stop() : start())}
          />
        </div>
      </PanelHeader>

      {recording ? (
        <p className="border-b border-line bg-attention-subtle px-3 py-2 text-2xs text-attention">
          Recording — every key you press and release is captured, timings
          included. Nothing you type reaches the page.
        </p>
      ) : null}

      {draft.actions.length === 0 ? (
        <EmptyState
          icon={<ListOrdered size={20} />}
          title={recording ? "Press any key to begin" : "No actions yet"}
        >
          {recording
            ? "Presses and releases are recorded separately, so a macro can hold a key down while it does something else."
            : "Select Record to capture keystrokes, or add an action by hand once there is one to insert after."}
          {!recording && draft.actions.length === 0 ? (
            <div className="mt-3">
              <Button size="sm" onClick={() => insertAfter(-1)}>
                <Plus size={12} />
                Add an action
              </Button>
            </div>
          ) : null}
        </EmptyState>
      ) : (
        <div ref={listRef} className="max-h-[22rem] overflow-y-auto">
          <ol>
            {draft.actions.map((action, index) => (
              <ActionRow
                key={index}
                action={action}
                index={index}
                last={index === draft.actions.length - 1}
                disabled={recording}
                active={editing === index}
                onEdit={() => setEditing(index)}
                onInsert={() => insertAfter(index)}
                onDelete={() => remove(index)}
                onMove={(by) => move(index, by)}
              />
            ))}
          </ol>
        </div>
      )}
    </Panel>
  );
}

/**
 * Record, and the reason it is sometimes unavailable.
 *
 * Recording is gated on fullscreen rather than quietly forcing the browser
 * into it: only fullscreen hands a page Escape, Tab and the Windows key, and a
 * recording that silently drops those is worse than one that waits — the macro
 * would look right in the list and play wrong on the board.
 *
 * A disabled button swallows pointer events, so the trigger has to be a
 * wrapper around it rather than the button itself, or the tooltip explaining
 * the disabled state never opens.
 */
function RecordButton({
  recording,
  fullscreen,
  onToggle,
}: {
  recording: boolean;
  fullscreen: boolean;
  onToggle: () => void;
}) {
  const button = (
    <Button
      size="sm"
      variant={recording ? "danger" : "default"}
      disabled={!recording && !fullscreen}
      onClick={onToggle}
    >
      {recording ? (
        <>
          <Square size={11} />
          Stop
        </>
      ) : (
        <>
          <Circle size={11} />
          Record
        </>
      )}
    </Button>
  );

  if (recording || fullscreen) return button;

  return (
    <Tooltip content="Only works in fullscreen (F11). Outside it the browser keeps Escape, Tab and the Windows key for itself, so they never reach the recording.">
      <span className="inline-block">{button}</span>
    </Tooltip>
  );
}

function ActionRow({
  action,
  index,
  last,
  disabled,
  active,
  onEdit,
  onInsert,
  onDelete,
  onMove,
}: {
  action: MacroAction;
  index: number;
  last: boolean;
  disabled: boolean;
  active: boolean;
  onEdit: () => void;
  onInsert: () => void;
  onDelete: () => void;
  onMove: (by: number) => void;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 border-b border-line px-3 py-1.5 last:border-b-0",
        active && "bg-accent-subtle",
      )}
    >
      <span className="w-6 shrink-0 font-mono text-3xs tabular-nums text-fg-subtle">
        {index + 1}
      </span>

      {/*
        Down and up are the whole grammar of a macro, so they carry a shape and
        a word rather than a colour alone.
      */}
      <span
        className={cn(
          "flex w-14 shrink-0 items-center gap-1 text-2xs",
          action.down ? "text-fg" : "text-fg-muted",
        )}
      >
        {action.down ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        {action.down ? "Down" : "Up"}
      </span>

      <span className="min-w-0 flex-1 truncate text-xs text-fg">
        {describeKey(action.keycode)}
      </span>

      <span className="flex shrink-0 items-center gap-1 text-fg-subtle">
        <Clock size={11} />
        <Readout
          value={`${action.delay}`}
          unit="ms"
          size="sm"
          tone="muted"
        />
      </span>

      <span className="flex shrink-0 items-center gap-0.5">
        <IconButton label="Move up" disabled={disabled || index === 0} onClick={() => onMove(-1)}>
          <ChevronUp size={13} />
        </IconButton>
        <IconButton label="Move down" disabled={disabled || last} onClick={() => onMove(1)}>
          <ChevronDown size={13} />
        </IconButton>
        <IconButton label="Edit" disabled={disabled} onClick={onEdit}>
          <Pencil size={13} />
        </IconButton>
        <IconButton label="Insert after" disabled={disabled} onClick={onInsert}>
          <Plus size={13} />
        </IconButton>
        <IconButton label="Delete" disabled={disabled} onClick={onDelete}>
          <Trash2 size={13} />
        </IconButton>
      </span>
    </li>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="cursor-pointer rounded p-1 text-fg-subtle transition-colors hover:bg-canvas-overlay hover:text-fg disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

// --- one action ------------------------------------------------------------

/**
 * Editing a single action.
 *
 * The key is chosen by pressing it, exactly as the recorder captures it, so a
 * user never has to find their key in a list of 200. The list stays as the
 * fallback for keys the browser will not deliver.
 */
function ActionDialog({
  action,
  onSave,
  onCancel,
}: {
  action: MacroAction;
  onSave: (action: MacroAction) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = React.useState<MacroAction>({ ...action });
  const [capturing, setCapturing] = React.useState(false);

  React.useEffect(() => {
    if (!capturing) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      const keycode = keycodeForEvent(event);
      if (keycode === null) return;
      setDraft((d) => ({ ...d, keycode }));
      setCapturing(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing]);

  const keys = React.useMemo(() => byGroup("basic"), []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <Panel
        className="w-full max-w-md bg-canvas"
        onClick={(e) => e.stopPropagation()}
      >
        <PanelHeader>
          <span>Edit action</span>
        </PanelHeader>
        <div className="space-y-4 p-4">
          <Field
            label="Key"
            hint="Select Press a key, then press the one you want."
            control={
              <div className="flex gap-2">
                <Select
                  value={draft.keycode}
                  onValueChange={(value) =>
                    setDraft((d) => ({ ...d, keycode: Number(value) }))
                  }
                  options={keys.map((k) => ({ value: k.code, label: k.label }))}
                  aria-label="Key"
                  className="flex-1"
                />
                <Button
                  variant={capturing ? "primary" : "default"}
                  onClick={() => setCapturing((c) => !c)}
                >
                  {capturing ? "Listening…" : "Press a key"}
                </Button>
              </div>
            }
          />
          <Field
            label="Direction"
            hint="A press and its release are separate actions."
            control={
              <Segmented
                value={draft.down ? "down" : "up"}
                onChange={(value) =>
                  setDraft((d) => ({ ...d, down: value === "down" }))
                }
                options={[
                  { value: "down", label: "Down" },
                  { value: "up", label: "Up" },
                ]}
              />
            }
          />
          <Field
            label="Delay after"
            hint={`How long the board waits before the next action, up to ${MAX_DELAY_MS} ms.`}
            control={
              <input
                type="number"
                min={0}
                max={MAX_DELAY_MS}
                value={draft.delay}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    delay: clamp(Number(e.target.value), 0, MAX_DELAY_MS),
                  }))
                }
                className="h-7 w-full rounded-md border border-line bg-canvas-inset px-2 font-mono text-xs tabular-nums text-fg"
              />
            }
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-line p-3">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave(draft)}>
            Save action
          </Button>
        </div>
      </Panel>
    </div>
  );
}
