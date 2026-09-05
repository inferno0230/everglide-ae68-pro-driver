import { create } from "zustand";
import { Transport, HidError } from "@/hid/transport";
import { Keyboard, type DeviceSnapshot } from "@/hid/keyboard";
import { createSimulatedDevice } from "@/hid/simulator";
import type { Performance } from "@/hid/protocol/performance";
import type { MacroAction, MacroMode } from "@/hid/protocol/macro";
import type { LightingBase, PaletteSlot, Rgb } from "@/hid/protocol/lighting";
import type {
  HigherKeyConfig,
  HigherKeyRecord,
  KeyRef,
} from "@/hid/protocol/higherkey";
import {
  AxisKind,
  HigherKeyMode,
  KeyMode,
  MACRO_ACTION_POOL,
  MACRO_ACTIONS_PER_PAGE,
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
  /** Lighting is per area: 0 is the keyboard, 1 the light bar. */
  lighting: Record<number, LightingBase>;
  palette: Record<number, PaletteSlot[]>;
  /**
   * Individually pinned colours per lighting area, keyed `row:col`.
   *
   * Only LEDs actually held by the board are present. The read reports live
   * state for everything else, so an unpinned LED is absent rather than
   * carrying whatever frame the effect happened to be on.
   */
  lightColors: Record<number, Map<string, Rgb>>;

  /**
   * Advanced keys, keyed by `row:col` — only the keys that actually have one.
   * The board has no "list the configured keys" call, so this map is built by
   * asking all 68, exactly as the vendor's own app does.
   */
  higher: Map<string, HigherKeyRecord>;

  /** All 16 macro slots, always present; an unused slot has `actionCount` 0. */
  macros: MacroMode[];
  /** Actions per slot, only for slots that hold any. */
  macroActions: Map<number, MacroAction[]>;
  /** Total actions the board can hold across every slot. */
  macroCapacity: number;

  selection: Set<string>;
  layer: number;
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
  setLayer: (layer: number) => void;

  writePerformance: (
    ids: string[],
    patch: Partial<Performance>,
  ) => Promise<void>;
  writeKeycode: (row: number, col: number, keycode: number) => Promise<void>;
  writeLighting: (area: number, patch: Partial<LightingBase>) => Promise<void>;
  writePalette: (area: number, slots: PaletteSlot[]) => Promise<void>;
  writeHigherKey: (key: KeyRef, config: HigherKeyConfig) => Promise<void>;
  clearHigherKeys: (keys: readonly KeyRef[]) => Promise<void>;
  /**
   * Write one macro slot. Resolves to null when the board refused the write
   * because the shared action pool is full.
   */
  writeMacro: (
    macroId: number,
    actions: readonly MacroAction[],
    options?: { repeatCount?: number; mode?: number },
  ) => Promise<MacroMode | null>;
  clearMacro: (macroId: number) => Promise<void>;

  /** Pin LEDs in an area to a colour, or hand them back to its effect. */
  paintLights: (
    area: number,
    ids: readonly string[],
    color: Rgb | null,
  ) => Promise<void>;

  switchProfile: (index: number) => Promise<void>;
  renameProfile: (index: number, name: string) => Promise<void>;
  setReportRate: (hz: number) => Promise<void>;
  save: () => Promise<void>;
  factoryReset: (target: SaveTarget) => Promise<void>;
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
  lighting: {},
  palette: {},
  lightColors: {},
  higher: new Map(),
  macros: [],
  macroActions: new Map(),
  macroCapacity: MACRO_ACTION_POOL,
  selection: new Set(),
  layer: 0,
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
      lighting: {},
      palette: {},
      lightColors: {},
      higher: new Map(),
      macros: [],
      macroActions: new Map(),
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

  setLayer(layer) {
    set({ layer });
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

  async writeKeycode(row, col, keycode) {
    const { layer } = get();
    set({ busy: true });
    try {
      await keyboard.setKeycode(layer, row, col, keycode);
      const fresh = await keyboard.keymap(layer, row);
      const keymap = get().keymap.map((l) => l.map((r) => [...r]));
      const layerRows = keymap[layer];
      if (layerRows) layerRows[row] = fresh;
      set({ keymap, dirty: withDirty(get().dirty, SaveTarget.Layout) });
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set({ busy: false });
    }
  },

  async writeLighting(area, patch) {
    const current = get().lighting[area];
    if (!current) return;
    set({ busy: true });
    try {
      const stored = await keyboard.setLightingBase({ ...current, ...patch }, area);
      set({
        lighting: { ...get().lighting, [area]: stored },
        revision: bumped(get().revision, [`lighting:${area}`]),
        dirty: withDirty(get().dirty, SaveTarget.Lighting),
      });
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set({ busy: false });
    }
  },

  async writePalette(area, slots) {
    set({ busy: true });
    try {
      await keyboard.setPalette(slots, area);
      set({
        palette: { ...get().palette, [area]: slots },
        dirty: withDirty(get().dirty, SaveTarget.Lighting),
      });
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set({ busy: false });
    }
  },

  /**
   * Write one macro slot.
   *
   * The board holds one 960-action pool across all 16 slots and refuses an
   * over-budget write *silently* — no error, the slot simply keeps what it had.
   * So the driver's reply is the truth here as everywhere else: a returned
   * record that does not carry the action count we sent means refused, and the
   * caller gets null rather than a cache that quietly disagrees with the board.
   */
  async writeMacro(macroId, actions, options = {}) {
    set({ busy: true });
    try {
      const stored = await keyboard.setMacro(macroId, actions, options);
      const refused = stored.actionCount !== actions.length;

      const macros = get().macros.map((m) =>
        m.macroId === macroId ? stored : m,
      );
      const macroActions = new Map(get().macroActions);
      if (refused) {
        set({ macros });
        return null;
      }
      if (actions.length === 0) macroActions.delete(macroId);
      else macroActions.set(macroId, [...actions]);

      set({
        macros,
        macroActions,
        revision: bumped(get().revision, [`macro:${macroId}`]),
        dirty: withDirty(get().dirty, SaveTarget.Macro),
      });
      return stored;
    } catch (err) {
      set({ error: message(err) });
      return null;
    } finally {
      set({ busy: false });
    }
  },

  /**
   * Empty a slot and hand its actions back to the pool.
   *
   * The pages are zeroed as well as the mode record. A stale page left behind
   * is invisible while `actionCount` is 0, but it reappears the moment the slot
   * is reused with a longer macro than the write that follows.
   */
  async clearMacro(macroId) {
    const held = get().macroActions.get(macroId)?.length ?? 0;
    set({ busy: true });
    try {
      await keyboard.clearMacro(
        macroId,
        Math.max(1, Math.ceil(held / MACRO_ACTIONS_PER_PAGE)),
      );
      const macros = get().macros.map((m) =>
        m.macroId === macroId
          ? { ...m, valid: false, actionCount: 0, repeatCount: 0, mode: 0 }
          : m,
      );
      const macroActions = new Map(get().macroActions);
      macroActions.delete(macroId);
      set({
        macros,
        macroActions,
        revision: bumped(get().revision, [`macro:${macroId}`]),
        dirty: withDirty(get().dirty, SaveTarget.Macro),
      });
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set({ busy: false });
    }
  },

  /**
   * Paint individual LEDs, or clear them.
   *
   * A page write replaces a page, so the board only keeps what the last write
   * contained — there is no per-key update. The whole map goes every time,
   * which is also how the vendor clears a single key.
   */
  async paintLights(area, ids, color) {
    const zone = get().snapshot?.ledZones.find((candidate) => candidate.index === area);
    if (!zone) return;
    const next = new Map(get().lightColors[area]);
    for (const id of ids) {
      if (color) next.set(id, color);
      else next.delete(id);
    }
    set({ busy: true });
    try {
      set({
        lightColors: {
          ...get().lightColors,
          [area]: await keyboard.setCustomColors(next, area, zone),
        },
        revision: bumped(get().revision, [`lighting:${area}`]),
        dirty: withDirty(get().dirty, SaveTarget.Lighting),
      });
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set({ busy: false });
    }
  },

  /**
   * Write one advanced key. Pair modes carry their partner in `data.other`,
   * and the driver sends both packets, so the refresh has to cover both keys.
   *
   * A pair is two records that name each other, and the board will happily
   * hold half of one. Rebinding either end therefore has to clear whatever it
   * used to point at, or the board keeps a record referring to a key that no
   * longer refers back.
   */
  async writeHigherKey(key, config) {
    const newPartner =
      "data" in config && "other" in config.data ? config.data.other : null;
    const orphans = [
      partnerOf(get().higher, key),
      newPartner ? partnerOf(get().higher, newPartner) : null,
    ].filter(
      (ref): ref is KeyRef =>
        ref !== null &&
        !sameKey(ref, key) &&
        !(newPartner !== null && sameKey(ref, newPartner)),
    );

    set({ busy: true });
    try {
      switch (config.mode) {
        case HigherKeyMode.None:
          await keyboard.clearHigherKey(key);
          break;
        case HigherKeyMode.DKS:
          await keyboard.setDks(key, config.data);
          break;
        case HigherKeyMode.MPT:
          await keyboard.setMpt(key, config.data);
          break;
        case HigherKeyMode.MT:
          await keyboard.setMt(key, config.data);
          break;
        case HigherKeyMode.TGL:
          await keyboard.setTgl(key, config.data);
          break;
        case HigherKeyMode.END:
          await keyboard.setEnd(key, config.data);
          break;
        case HigherKeyMode.SOCD:
          await keyboard.setSocd(key, config.data);
          break;
        case HigherKeyMode.RS:
          await keyboard.setRs(key, config.data);
          break;
      }
      for (const orphan of orphans) await keyboard.clearHigherKey(orphan);
      await refreshHigher([key, ...(newPartner ? [newPartner] : []), ...orphans]);
      set({ dirty: withDirty(get().dirty, SaveTarget.HigherKey) });
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set({ busy: false });
    }
  },

  async clearHigherKeys(keys) {
    // Clearing one half of a pair has to clear the other, for the same reason.
    const all = [...keys];
    for (const key of keys) {
      const partner = partnerOf(get().higher, key);
      if (partner && !all.some((k) => sameKey(k, partner))) all.push(partner);
    }
    set({ busy: true });
    try {
      for (const key of all) await keyboard.clearHigherKey(key);
      await refreshHigher(all);
      set({ dirty: withDirty(get().dirty, SaveTarget.HigherKey) });
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set({ busy: false });
    }
  },

  async switchProfile(index) {
    set({ busy: true });
    try {
      await keyboard.setActiveProfile(index);
      // Switching reloads every per-profile setting on the board, so nothing
      // cached here survives it.
      await reload();
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set({ busy: false });
    }
  },

  async renameProfile(index, name) {
    try {
      await keyboard.setProfileName(index, name);
      const snapshot = get().snapshot;
      if (!snapshot) return;
      const profiles = snapshot.profiles.map((p) =>
        p.index === index ? { ...p, name } : p,
      );
      set({ snapshot: { ...snapshot, profiles } });
    } catch (err) {
      set({ error: message(err) });
    }
  },

  async setReportRate(hz) {
    const { simulated } = get();
    const identity = transport.identity;

    // The simulator does not restart, so keep its fast in-place path.
    if (simulated) {
      try {
        await keyboard.setReportRate(hz);
        const snapshot = get().snapshot;
        if (snapshot) set({ snapshot: { ...snapshot, reportRateHz: hz } });
      } catch (err) {
        set({ error: message(err) });
      }
      return;
    }

    if (!identity) {
      set({ status: "disconnected", error: "no keyboard connected" });
      return;
    }

    set({ status: "reconnecting", busy: true, error: null });

    // Attach before writing: the USB reset can happen before the command's
    // reply reaches the browser. Both promises handle rejection immediately,
    // so neither becomes an unhandled rejection while the other is pending.
    const reconnected = Transport.waitForReconnect(identity).then(
      (hid) => ({ hid, error: null as unknown }),
      (error: unknown) => ({ hid: null, error }),
    );
    const wrote = keyboard.setReportRate(hz).then(
      () => null,
      (error: unknown) => error,
    );

    try {
      const cycle = await reconnected;
      if (!cycle.hid) throw cycle.error;

      // Closing rejects a report-rate waiter if the board restarted before it
      // could acknowledge the command. That is expected; the fresh read below
      // is the source of truth.
      await transport.close();
      await wrote;
      await transport.open(cycle.hid);
      await reload();
      set({ status: "connected", error: null, dirty: new Set() });
    } catch (err) {
      await transport.close();
      const writeError = await wrote;
      set({
        status: "error",
        error: message(writeError ?? err),
      });
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

  async factoryReset(target) {
    set({ busy: true });
    try {
      await keyboard.factoryReset(target);
      await reload();
      set({ dirty: new Set() });
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set({ busy: false });
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

const sameKey = (a: KeyRef, b: KeyRef): boolean =>
  a.row === b.row && a.col === b.col;

/** The key this one is currently paired with, if it is in a pair mode. */
function partnerOf(
  higher: ReadonlyMap<string, HigherKeyRecord>,
  key: KeyRef,
): KeyRef | null {
  const record = higher.get(keyId(key.row, key.col));
  if (!record || !("data" in record) || !("other" in record.data)) return null;
  return record.data.other;
}

/**
 * Re-read some keys' advanced config and fold the result into the map.
 *
 * The reply is the truth here as everywhere else: the board answers with the
 * record it actually holds, and a key that came back NONE leaves the map so
 * "configured" stays a simple membership test.
 */
async function refreshHigher(keys: readonly KeyRef[]): Promise<void> {
  const higher = new Map(useDevice.getState().higher);
  for (const key of keys) {
    const record = await keyboard.higherKey(key);
    const id = keyId(key.row, key.col);
    if (!record || record.mode === HigherKeyMode.None) higher.delete(id);
    else higher.set(id, record);
  }
  useDevice.setState({ higher });
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

  // Every zone the board reports gets its own base record and palette; the
  // light bar keeps settings entirely separate from the keyboard.
  const lighting: Record<number, LightingBase> = {};
  const palette: Record<number, PaletteSlot[]> = {};
  const lightColors: Record<number, Map<string, Rgb>> = {};
  for (const zone of snapshot.ledZones) {
    lighting[zone.index] = await keyboard.lightingBase(zone.index);
    palette[zone.index] = await keyboard.palette(zone.index);
    lightColors[zone.index] = await keyboard.customColors(zone.index, zone);
  }

  // 68 reads, one per key. There is no bulk query; the vendor's app sweeps the
  // whole matrix on entering its Advanced Key page for exactly this reason.
  const higher = new Map<string, HigherKeyRecord>();
  for (const key of snapshot.keys) {
    const record = await keyboard.higherKey(key);
    if (record && record.mode !== HigherKeyMode.None) {
      higher.set(keyId(key.row, key.col), record);
    }
  }

  // 16 mode records, then the pages of whichever slots actually hold a macro.
  // There is no bulk query, and an empty slot has no pages worth reading.
  const macros = await keyboard.allMacros();
  const macroActions = new Map<number, MacroAction[]>();
  for (const record of macros) {
    if (record.actionCount === 0) continue;
    macroActions.set(record.macroId, (await keyboard.macro(record.macroId)).actions);
  }
  const space = await keyboard.macroSpace();

  set({
    snapshot,
    keymap,
    performance,
    lighting,
    palette,
    lightColors,
    higher,
    macros,
    macroActions,
    macroCapacity: space.totalActions || MACRO_ACTION_POOL,
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
