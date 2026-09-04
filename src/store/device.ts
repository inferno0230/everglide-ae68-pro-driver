import { create } from "zustand";
import { Transport, HidError } from "@/hid/transport";
import { Keyboard, type DeviceSnapshot } from "@/hid/keyboard";
import { createSimulatedDevice } from "@/hid/simulator";
import type { Performance } from "@/hid/protocol/performance";
import {
  AxisKind,
  KeyMode,
  SaveTarget,
  LAYER_COUNT,
} from "@/hid/protocol/constants";

export type Status =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "error";

export const keyId = (row: number, col: number) => `${row}:${col}`;

/**
 * Which stores hold RAM-only changes.
 *
 * The board applies every write immediately but loses it on unplug; only a
 * save command commits to flash. So "dirty" here does not mean "not sent to the
 * device" — it means "sent, visible, and still one power cycle from gone".
 */
export type DirtyTarget = SaveTarget;

interface DeviceState {
  status: Status;
  error: string | null;
  simulated: boolean;

  snapshot: DeviceSnapshot | null;
  /** keymap[layer][row][col] */
  keymap: number[][][];
  performance: Map<string, Performance>;

  selection: Set<string>;
  dirty: Set<DirtyTarget>;
  saving: boolean;
  busy: boolean;

  /** Keys whose last write came back changed by the firmware. */
  clamped: Set<string>;

  /**
   * How many times each thing has been reconciled with the board.
   *
   * Nothing reads these as a quantity. They exist so the interface can tell a
   * value that just came back from the firmware from one that has been sitting
   * there, which is otherwise indistinguishable: the reply always wins, so by
   * the time it renders it simply *is* the value. Bumping a counter gives the
   * arrival an identity a component can key an animation to.
   *
   * Ids are `row:col` for a key, `lighting:<area>` for a light zone, and
   * `saved` for the moment volatile work reaches flash.
   */
  revision: Map<string, number>;

  init: () => Promise<void>;
  connect: () => Promise<void>;
  connectSimulated: () => Promise<void>;
  disconnect: () => Promise<void>;

  select: (ids: string[], mode?: "replace" | "toggle") => void;
  selectAll: () => void;
  clearSelection: () => void;

  writePerformance: (
    ids: string[],
    patch: Partial<Performance>,
  ) => Promise<void>;

  save: () => Promise<void>;
  runCalibration: (phase: "start" | "stop") => Promise<void>;

  pollAxis: (kind: AxisKind, rows: number[]) => Promise<Map<string, number>>;
}

const transport = new Transport();
const keyboard = new Keyboard(transport);

/** The driver, for callers that need it directly (the live travel test). */
export const device = keyboard;

const message = (err: unknown): string =>
  err instanceof HidError || err instanceof Error
    ? err.message
    : "the keyboard stopped responding";

export const useDevice = create<DeviceState>((set, get) => ({
  status: "disconnected",
  error: null,
  simulated: false,
  snapshot: null,
  keymap: [],
  performance: new Map(),
  selection: new Set(),
  dirty: new Set(),
  saving: false,
  busy: false,
  clamped: new Set(),
  revision: new Map(),

  async init() {
    if (!Transport.isSupported()) {
      set({ status: "unsupported" });
      return;
    }
    // A board already granted to this origin reconnects with no prompt and no
    // user gesture, so the app can come up connected.
    const granted = await Transport.granted();
    const first = granted[0];
    if (first) await open(first, false);
  },

  async connect() {
    if (!Transport.isSupported()) {
      set({ status: "unsupported" });
      return;
    }
    try {
      const [chosen] = await Transport.request();
      if (!chosen) return; // the user dismissed the picker
      await open(chosen, false);
    } catch (err) {
      set({ status: "error", error: message(err) });
    }
  },

  async connectSimulated() {
    await open(createSimulatedDevice(), true);
  },

  async disconnect() {
    await transport.close();
    set({
      status: "disconnected",
      snapshot: null,
      keymap: [],
      performance: new Map(),
      selection: new Set(),
      dirty: new Set(),
      clamped: new Set(),
      revision: new Map(),
      simulated: false,
      error: null,
    });
  },

  select(ids, mode = "replace") {
    if (mode === "replace") {
      set({ selection: new Set(ids) });
      return;
    }
    const next = new Set(get().selection);
    for (const id of ids) {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    }
    set({ selection: next });
  },

  selectAll() {
    const keys = get().snapshot?.keys ?? [];
    set({ selection: new Set(keys.map((k) => keyId(k.row, k.col))) });
  },

  clearSelection() {
    set({ selection: new Set() });
  },

  async writePerformance(ids, patch) {
    const perf = new Map(get().performance);
    const clamped = new Set(get().clamped);
    const answered: string[] = [];
    set({ busy: true });
    try {
      for (const id of ids) {
        const [row, col] = id.split(":").map(Number);
        if (row === undefined || col === undefined) continue;
        const current = perf.get(id);
        if (!current) continue;

        const wanted = { ...current, ...patch };
        // The reply is the truth: the firmware clamps silently, and in fixed
        // mode collapses the reset point onto the actuation point.
        const stored = await keyboard.setPerformance(row, col, wanted);
        perf.set(id, stored);

        if (differs(wanted, stored)) clamped.add(id);
        else clamped.delete(id);
        answered.push(id);
      }
      set({
        performance: perf,
        clamped,
        revision: bumped(get().revision, answered),
        dirty: withDirty(get().dirty, SaveTarget.Performance),
      });
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set({ busy: false });
    }
  },
  async save() {
    if (get().dirty.size === 0) return;
    set({ saving: true });
    try {
      // One save per touched store, so a lighting change never rewrites the
      // keymap's flash pages.
      for (const target of get().dirty) await keyboard.save(target);
      set({ dirty: new Set(), revision: bumped(get().revision, ["saved"]) });
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set({ saving: false });
    }
  },

  async runCalibration(phase) {
    try {
      if (phase === "start") await keyboard.startCalibration();
      else {
        await keyboard.stopCalibration();
        set({ dirty: withDirty(get().dirty, SaveTarget.Calibration) });
      }
    } catch (err) {
      set({ error: message(err) });
    }
  },

  async pollAxis(kind, rows) {
    const out = new Map<string, number>();
    for (const row of rows) {
      const values = await keyboard.axisData(kind, row);
      values.forEach((v, col) => out.set(keyId(row, col), v));
    }
    return out;
  },
}));

// --- helpers ---------------------------------------------------------------

/** Mark these ids as freshly answered by the board. */
function bumped(
  current: ReadonlyMap<string, number>,
  ids: readonly string[],
): Map<string, number> {
  if (ids.length === 0) return current as Map<string, number>;
  const next = new Map(current);
  for (const id of ids) next.set(id, (next.get(id) ?? 0) + 1);
  return next;
}

function withDirty(
  current: Set<DirtyTarget>,
  target: DirtyTarget,
): Set<DirtyTarget> {
  const next = new Set(current);
  next.add(target);
  return next;
}

/**
 * Did the firmware store something other than what we asked for?
 *
 * "Other than what we asked" has to mean *refused*, not merely *different*, or
 * the signal is worthless. In fixed-actuation mode the board defines the reset
 * point as the actuation point, so every ordinary change to `press` comes back
 * with a `release` we did not send. That is the documented contract, not a
 * rejection, and counting it flagged all 68 keys as firmware-adjusted on a
 * routine edit — which is how a warning stops being read.
 */
function differs(wanted: Performance, stored: Performance): boolean {
  const fields: Array<keyof Performance> = [
    "mode",
    "press",
    "release",
    "rtFirst",
    "rtPress",
    "rtRelease",
    "pressDead",
    "releaseDead",
  ];
  return fields.some((f) => {
    // Derived in fixed mode; only meaningful when rapid trigger owns it.
    if (f === "release" && stored.mode === KeyMode.Fixed) return false;
    return wanted[f] !== stored[f];
  });
}

async function open(hid: HIDDevice, simulated: boolean): Promise<void> {
  const set = useDevice.setState;
  set({ status: "connecting", error: null, simulated });
  try {
    await transport.open(hid);
    await reload();
    set({ status: "connected" });
  } catch (err) {
    set({ status: "error", error: message(err) });
  }
}

/** Read the whole per-profile picture from the board. */
async function reload(): Promise<void> {
  const set = useDevice.setState;
  const snapshot = await keyboard.describe();

  const keymap: number[][][] = [];
  for (let layer = 0; layer < LAYER_COUNT; layer++) {
    const rows: number[][] = [];
    for (const row of snapshot.rows) rows[row] = await keyboard.keymap(layer, row);
    keymap.push(rows);
  }

  const performance = new Map<string, Performance>();
  for (const key of snapshot.keys) {
    performance.set(
      keyId(key.row, key.col),
      await keyboard.performance(key.row, key.col),
    );
  }

  set({
    snapshot,
    keymap,
    performance,
    clamped: new Set(),
  });
}

/**
 * Dev-only handle for driving the protocol by hand from the console.
 *
 * Verifying an undocumented command means seeing the raw 64-byte reply, not a
 * parsed object, so this exposes the transport as well as the facade. Stripped
 * from production builds by the `import.meta.env.DEV` guard.
 */
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__ae68 = {
    transport,
    keyboard,
    useDevice,
  };
}
