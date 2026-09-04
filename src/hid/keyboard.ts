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
  PROFILE_COUNT,
  SaveTarget,
} from "./protocol/constants";
import * as device from "./protocol/device";
import * as glob from "./protocol/global";
import * as layout from "./protocol/layout";
import * as perf from "./protocol/performance";

/** Flash writes and calibration take noticeably longer than a read. */
const SLOW: SendOptions = { timeout: 3000 };
/** AxisData replies are only distinguishable by kind + row. */
const AXIS: SendOptions = { matchBytes: 4, timeout: 500, retries: 1 };

/** Matrix rows the board might populate. */
const MAX_ROWS = 8;

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

  // --- profiles, calibration, save -----------------------------------------

  async activeProfile(): Promise<number> {
    return glob.parseActiveProfile(
      await this.transport.send(glob.getActiveProfile()),
    );
  }

  async profileName(index: number): Promise<string> {
    return glob.parseProfileName(
      await this.transport.send(glob.getProfileName(index), { matchBytes: 3 }),
    );
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
}

export { Transport, codec, Category, AxisKind, SaveTarget };
export { perf, layout, device, glob };
