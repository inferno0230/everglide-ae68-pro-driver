/**
 * The driver's public surface: one object per connected keyboard.
 *
 * Everything below goes through Transport, which serialises I/O, so callers
 * can await these freely without coordinating.
 */

import { Transport, type SendOptions } from "./transport";
import * as codec from "./codec";
import {
  AxisKind,
  Category,
  LAYER_COUNT,
  LightArea,
  MACRO_SLOTS,
  PROFILE_COUNT,
  SaveTarget,
} from "./protocol/constants";
import * as device from "./protocol/device";
import * as glob from "./protocol/global";
import * as layout from "./protocol/layout";
import * as perf from "./protocol/performance";
import * as light from "./protocol/lighting";

/** Shape advertised by the AE68 Pro when no topology is supplied by a caller. */
const KEYBOARD_COLOR_GRID = { rows: 6, cols: 15 } as const;
const LIGHT_BAR_COLOR_GRID = { rows: 1, cols: 40 } as const;

type ColorGrid = { rows: number; cols: number };

const colorGrid = (area: number, grid?: ColorGrid): ColorGrid =>
  grid ??
  (area === LightArea.Keyboard ? KEYBOARD_COLOR_GRID : LIGHT_BAR_COLOR_GRID);

/** Keyboard rows use their measured 21-slot pitch; strips are contiguous. */
const colorSlot = (
  area: number,
  grid: ColorGrid,
  row: number,
  col: number,
): number =>
  area === LightArea.Keyboard ? light.ledIndex(row, col) : row * grid.cols + col;

/** A logical key normally has one slot; the spacebar fans out to five. */
const colorSlots = (
  area: number,
  grid: ColorGrid,
  row: number,
  col: number,
): number[] =>
  area === LightArea.Keyboard
    ? light.ledIndices(row, col)
    : [colorSlot(area, grid, row, col)];

const colorBufferLength = (area: number, grid: ColorGrid): number =>
  grid.rows <= 0 || grid.cols <= 0
    ? 0
    : colorSlot(area, grid, grid.rows - 1, grid.cols - 1) + 1;

const colorPages = (area: number, grid: ColorGrid): number =>
  area === LightArea.Keyboard
    ? light.KEY_COLOR_PAGES
    : Math.ceil(colorBufferLength(area, grid) / light.KEYS_PER_PAGE);

/** The pinned LEDs in a colour buffer, keyed `row:col`. */
function pinned(
  buffer: readonly light.KeyColor[],
  area: number,
  grid: ColorGrid,
): Map<string, light.Rgb> {
  const out = new Map<string, light.Rgb>();
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      // The extra spacebar positions are physical LEDs, not separate keys.
      // Exposing them would make one spacebar appear as five painted keys and
      // would let stale auxiliary colours overwrite a later spacebar paint.
      if (
        area === LightArea.Keyboard &&
        light.isSpacebarAuxiliaryPosition(row, col)
      ) {
        continue;
      }

      const primary = buffer[colorSlot(area, grid, row, col)];
      const entry = primary?.custom
        ? primary
        : colorSlots(area, grid, row, col)
            .map((slot) => buffer[slot])
            .find((candidate) => candidate?.custom);
      if (entry?.custom) {
        out.set(`${row}:${col}`, { r: entry.r, g: entry.g, b: entry.b });
      }
    }
  }
  return out;
}
import * as adv from "./protocol/higherkey";
import * as mac from "./protocol/macro";

/** Flash writes and calibration take noticeably longer than a read. */
const SLOW: SendOptions = { timeout: 3000 };
/** AxisData replies are only distinguishable by kind + row. */
const AXIS: SendOptions = { matchBytes: 4, timeout: 500, retries: 1 };
/** Paged lighting read-back is disambiguated by area + page. */
const PAGED: SendOptions = { matchBytes: 4 };

/** Matrix rows the board might populate. */
const MAX_ROWS = 8;
/** Pacing for fire-and-forget direct-drive packets. */
const DIRECT_DRIVE_GAP_MS = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface KeyboardProfile {
  index: number;
  name: string;
}

export interface DeviceSnapshot {
  protocol: device.ProtocolVersion;
  info: device.DeviceInfo;
  feature: device.DeviceFeature;
  keys: layout.PhysicalKey[];
  rows: number[];
  activeProfile: number;
  profiles: KeyboardProfile[];
  ledZones: glob.LedZone[];
  dualLighting: boolean;
  reportRateHz: number;
  rtPrecisionMm: number;
}

export class Keyboard {
  constructor(private readonly transport: Transport) {}

  get isOpen(): boolean {
    return this.transport.isOpen;
  }

  // --- connect -------------------------------------------------------------

  /**
   * The connect sequence from PROTOCOL.md section 2, in order. Cache the
   * result; none of it changes while the board stays plugged in, except the
   * active profile.
   */
  async describe(): Promise<DeviceSnapshot> {
    const protocol = device.parseProtocol(
      await this.transport.send(device.getProtocol()),
    );
    const info = device.parseDeviceInfo(
      await this.transport.send(device.getDeviceInfo()),
    );
    const feature = device.parseFeature(
      await this.transport.send(device.getFeature()),
    );

    const { keys, rows } = await this.readLayout();

    const activeProfile = glob.parseActiveProfile(
      await this.transport.send(glob.getActiveProfile()),
    );
    const profiles: KeyboardProfile[] = [];
    for (let i = 0; i < PROFILE_COUNT; i++) {
      profiles.push({ index: i, name: await this.profileName(i) });
    }

    const ledZones = glob.parseLedZones(
      await this.transport.send(glob.getLedZones()),
    );
    const dualLighting = glob.parseDoubleLighting(
      await this.transport.send(glob.getDoubleLighting()),
    );
    const reportRateHz = glob.parseReportRate(
      await this.transport.send(glob.getReportRate()),
    );
    const rtPrecisionMm = glob.parseRtPrecision(
      await this.transport.send(glob.getRtPrecision()),
    );

    return {
      protocol,
      info,
      feature,
      keys,
      rows,
      activeProfile,
      profiles,
      ledZones,
      dualLighting,
      reportRateHz,
      rtPrecisionMm,
    };
  }

  /**
   * Walk the matrix rows, unpacking the physical layout and resolving each
   * row's drawing coordinates to real electrical columns.
   */
  async readLayout(): Promise<{ keys: layout.PhysicalKey[]; rows: number[] }> {
    const keys: layout.PhysicalKey[] = [];
    const rows: number[] = [];

    for (let row = 0; row < MAX_ROWS; row++) {
      const style = layout.parseKeyLayoutStyle(
        await this.transport.send(layout.getKeyLayoutStyle(row)),
      );
      if (style.length === 0) continue;

      const keycodes = layout.parseKeyLayout(
        await this.transport.send(layout.getKeyLayout(0, row)),
      );
      keys.push(...layout.resolveColumns(style, keycodes));
      rows.push(row);
    }
    return { keys, rows };
  }

  // --- keymap --------------------------------------------------------------

  async keymap(layer: number, row: number): Promise<number[]> {
    return layout.parseKeyLayout(
      await this.transport.send(layout.getKeyLayout(layer, row)),
    );
  }

  async setKeycode(
    layer: number,
    row: number,
    col: number,
    keycode: number,
  ): Promise<void> {
    await this.transport.send(layout.setKeyCode(layer, row, col, keycode));
  }

  /** Read every layer of every populated row. */
  async allKeymaps(rows: readonly number[]): Promise<number[][][]> {
    const layers: number[][][] = [];
    for (let layer = 0; layer < LAYER_COUNT; layer++) {
      const byRow: number[][] = [];
      for (const row of rows) byRow[row] = await this.keymap(layer, row);
      layers.push(byRow);
    }
    return layers;
  }

  // --- performance ---------------------------------------------------------

  async performance(row: number, col: number): Promise<perf.Performance> {
    return perf.parsePerformance(
      await this.transport.send(perf.getPerformance(row, col)),
    );
  }

  /**
   * Write a key's actuation settings.
   *
   * Read-modify-write: `axis`, `calibrate`, `axisV2Id`, `axisRangeMax` and
   * `axisCoefficient` are calibration constants, so pass through what a prior
   * read gave you. The firmware also clamps silently (in fixed mode it forces
   * `release === press`), so the returned record — not what you sent — is the
   * truth.
   */
  async setPerformance(
    row: number,
    col: number,
    p: perf.Performance,
  ): Promise<perf.Performance> {
    return perf.parsePerformance(
      await this.transport.send(perf.setPerformance(row, col, p)),
    );
  }

  /** One row of live telemetry. Poll at 15-25 Hz for a travel test. */
  async axisData(kind: AxisKind, row: number): Promise<number[]> {
    return perf.parseAxisData(
      await this.transport.send(perf.getAxisData(kind, row), AXIS),
    );
  }

  // --- lighting ------------------------------------------------------------

  async lightingBase(area: number = LightArea.Keyboard): Promise<light.LightingBase> {
    return light.parseBase(await this.transport.send(light.getBase(area)));
  }

  async setLightingBase(
    base: light.LightingBase,
    area: number = LightArea.Keyboard,
  ): Promise<light.LightingBase> {
    return light.parseBase(
      await this.transport.send(light.setBase(area, base)),
    );
  }

  async palette(area: number = LightArea.Keyboard): Promise<light.PaletteSlot[]> {
    return light.parsePalette(
      await this.transport.send(light.getPalette(area)),
    );
  }

  async setPalette(
    slots: readonly light.PaletteSlot[],
    area: number = LightArea.Keyboard,
  ): Promise<void> {
    await this.transport.send(light.setPalette(area, slots));
  }

  async correction(area: number = LightArea.Keyboard): Promise<light.Rgb> {
    return light.parseCorrection(
      await this.transport.send(light.getCorrection(area)),
    );
  }

  async setCorrection(c: light.Rgb, area: number = LightArea.Keyboard): Promise<void> {
    await this.transport.send(light.setCorrection(area, c));
  }

  /**
   * The whole per-key colour buffer, one entry per addressable slot.
   *
   * The read reports the LEDs' *live* state, so most slots carry whatever the
   * running effect is painting this instant; only `custom` marks a colour the
   * board is actually holding. Callers that want the assignment rather than the
   * animation should filter on it — see `customColors`.
   */
  async keyColorBuffer(
    area: number = LightArea.Keyboard,
    topology?: ColorGrid,
  ): Promise<light.KeyColor[]> {
    const grid = colorGrid(area, topology);
    const colors: light.KeyColor[] = [];
    for (let page = 0; page < colorPages(area, grid); page++) {
      colors.push(
        ...light.parseKeyColors(
          await this.transport.send(light.getKeyColors(area, page), PAGED),
        ),
      );
    }
    return colors;
  }

  /** Just the keys pinned to a colour, keyed `row:col`. */
  async customColors(
    area: number = LightArea.Keyboard,
    topology?: ColorGrid,
  ): Promise<Map<string, light.Rgb>> {
    const grid = colorGrid(area, topology);
    return pinned(await this.keyColorBuffer(area, grid), area, grid);
  }

  /**
   * Replace the per-key colour assignment for an area.
   *
   * The whole buffer goes every time, because a page write replaces a page: a
   * key left out of the map is a key handed back to the effect. That is also
   * how the vendor clears one — it rewrites everything with the flag off.
   */
  async setCustomColors(
    colors: ReadonlyMap<string, light.Rgb>,
    area: number = LightArea.Keyboard,
    topology?: ColorGrid,
  ): Promise<Map<string, light.Rgb>> {
    const grid = colorGrid(area, topology);
    const pageCount = colorPages(area, grid);
    const slots: light.KeyColor[] = Array.from(
      { length: pageCount * light.KEYS_PER_PAGE },
      () => ({ r: 0, g: 0, b: 0, custom: false }),
    );
    for (const [id, rgb] of colors) {
      const [row = 0, col = 0] = id.split(":").map(Number);
      if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) continue;
      if (
        area === LightArea.Keyboard &&
        light.isSpacebarAuxiliaryPosition(row, col)
      ) {
        continue;
      }
      for (const slot of colorSlots(area, grid, row, col)) {
        slots[slot] = { ...rgb, custom: true };
      }
    }
    // The write echoes its own payload, and that echo is the reconciliation.
    // Reading the buffer back instead would race the LED driver: for a beat
    // after a write the read-back still reports the frame it was already
    // painting, custom flags and all, so a fresh read says nothing was stored.
    const stored: light.KeyColor[] = [];
    for (let page = 0; page < pageCount; page++) {
      const slice = slots.slice(
        page * light.KEYS_PER_PAGE,
        (page + 1) * light.KEYS_PER_PAGE,
      );
      const reply = await this.transport.send(
        light.setKeyColors(area, page, slice),
        PAGED,
      );
      stored.push(...light.parseKeyColors(reply));
    }
    return pinned(stored, area, grid);
  }

  /**
   * Push per-key colours straight to the LEDs. These packets get no reply, so
   * pace them or the board drops some.
   */
  async driveKeyColors(
    colors: readonly light.KeyColor[],
    area: number = LightArea.Keyboard,
  ): Promise<void> {
    const pages = Math.ceil(colors.length / light.KEYS_PER_PAGE);
    for (let page = 0; page < pages; page++) {
      const slice = colors.slice(
        page * light.KEYS_PER_PAGE,
        (page + 1) * light.KEYS_PER_PAGE,
      );
      await this.transport.sendNoReply(light.driveKeyColors(area, page, slice));
      if (page < pages - 1) await sleep(DIRECT_DRIVE_GAP_MS);
    }
  }

  async setCapsColor(c: light.Rgb): Promise<void> {
    await this.transport.send(light.setCapsColor(c));
  }

  // --- advanced keys -------------------------------------------------------
  //
  // Verified byte-for-byte on an AE68 Pro, and again against transcripts taken
  // from the vendor's own Advanced Key page. See .codex/reverse/PROTOCOL.md section 9.

  async higherKey(
    key: adv.KeyRef,
  ): Promise<adv.HigherKeyRecord | null> {
    return adv.parseHigherKey(
      await this.transport.send(adv.getHigherKey(key), { matchBytes: 4 }),
    );
  }

  async clearHigherKey(key: adv.KeyRef): Promise<void> {
    await this.transport.send(adv.setNone(key));
  }

  async setDks(key: adv.KeyRef, d: adv.DksConfig): Promise<void> {
    await this.transport.send(adv.setDks(key, d));
  }

  async setMpt(key: adv.KeyRef, d: adv.MptConfig): Promise<void> {
    await this.transport.send(adv.setMpt(key, d));
  }

  async setMt(key: adv.KeyRef, d: adv.MtConfig): Promise<void> {
    await this.transport.send(adv.setMt(key, d));
  }

  async setTgl(key: adv.KeyRef, d: adv.TglConfig): Promise<void> {
    await this.transport.send(adv.setTgl(key, d));
  }

  async setEnd(key: adv.KeyRef, d: adv.EndConfig): Promise<void> {
    await this.transport.send(adv.setEnd(key, d));
  }

  /** SOCD and Rappy-Snappy each write two packets — one per key of the pair. */
  async setSocd(key: adv.KeyRef, d: adv.SocdConfig): Promise<void> {
    for (const packet of adv.setSocd(key, d)) {
      await this.transport.send(packet, { matchBytes: 4 });
    }
  }

  async setRs(key: adv.KeyRef, d: adv.PairConfig): Promise<void> {
    for (const packet of adv.setRs(key, d)) {
      await this.transport.send(packet, { matchBytes: 4 });
    }
  }

  // --- macros (unverified on hardware) -------------------------------------

  async macroSpace(): Promise<{ slots: number; totalBytes: number }> {
    return glob.parseMacroSpace(
      await this.transport.send(glob.getMacroSpace()),
    );
  }

  async macro(
    macroId: number,
  ): Promise<{ mode: mac.MacroMode; actions: mac.MacroAction[] }> {
    const mode = mac.parseMacroMode(
      await this.transport.send(mac.getMacroMode(macroId)),
    );
    const pages = Math.ceil(mode.actionCount / 15);
    const actions: mac.MacroAction[] = [];
    for (let page = 0; page < pages; page++) {
      const { actions: pageActions } = mac.parseMacroData(
        await this.transport.send(mac.getMacroData(macroId, page), PAGED),
      );
      actions.push(...pageActions);
    }
    return { mode, actions: actions.slice(0, mode.actionCount) };
  }

  async allMacros(slots = MACRO_SLOTS): Promise<mac.MacroMode[]> {
    const modes: mac.MacroMode[] = [];
    for (let id = 0; id < slots; id++) {
      modes.push(
        mac.parseMacroMode(await this.transport.send(mac.getMacroMode(id))),
      );
    }
    return modes;
  }

  /**
   * Write a mac. The mode record carries the action count, so it must land
   * before the pages that follow it.
   */
  async setMacro(
    macroId: number,
    actions: readonly mac.MacroAction[],
    options: { repeatCount?: number; mode?: number } = {},
  ): Promise<void> {
    await this.transport.send(
      mac.setMacroMode({
        macroId,
        valid: actions.length > 0,
        actionCount: actions.length,
        repeatCount: options.repeatCount ?? 1,
        mode: options.mode ?? 0,
      }),
    );
    const pages = mac.pageActions(actions);
    for (let page = 0; page < pages.length; page++) {
      await this.transport.send(
        mac.setMacroData(macroId, page, pages[page] ?? []),
        PAGED,
      );
    }
  }

  // --- profiles, calibration, save -----------------------------------------

  async activeProfile(): Promise<number> {
    return glob.parseActiveProfile(
      await this.transport.send(glob.getActiveProfile()),
    );
  }

  /** Switching a profile reloads every per-profile setting on the board. */
  async setActiveProfile(index: number): Promise<void> {
    await this.transport.send(glob.setActiveProfile(index), SLOW);
  }

  async profileName(index: number): Promise<string> {
    return glob.parseProfileName(
      await this.transport.send(glob.getProfileName(index), { matchBytes: 3 }),
    );
  }

  async setProfileName(index: number, name: string): Promise<void> {
    await this.transport.send(glob.setProfileName(index, name), {
      matchBytes: 3,
    });
  }

  async setReportRate(hz: number): Promise<void> {
    await this.transport.send(glob.setReportRate(glob.reportRateCode(hz)));
  }

  /** Start, then press every key fully down and fully release it. */
  async startCalibration(): Promise<void> {
    await this.transport.send(glob.startCalibration(), SLOW);
  }

  async stopCalibration(): Promise<void> {
    await this.transport.send(glob.stopCalibration(), SLOW);
  }

  /** Nothing written above survives a power cycle until this runs. */
  async save(target: SaveTarget = SaveTarget.All): Promise<void> {
    await this.transport.send(glob.saveParam(target), SLOW);
  }

  async factoryReset(target: SaveTarget = SaveTarget.All): Promise<void> {
    await this.transport.send(glob.resetFactory(target), SLOW);
  }
}

export { Transport, codec, Category, AxisKind, SaveTarget, LightArea };
export { perf, light, adv, mac, layout, device, glob };
