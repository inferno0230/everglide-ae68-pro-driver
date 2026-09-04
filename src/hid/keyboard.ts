/**
 * The driver's public surface: one object per connected keyboard.
 *
 * Everything below goes through Transport, which serialises I/O, so callers
 * can await these freely without coordinating.
 */

import { Transport } from "./transport";
import * as codec from "./codec";
import {
  Category,
  PROFILE_COUNT,
  SaveTarget,
} from "./protocol/constants";
import * as device from "./protocol/device";
import * as glob from "./protocol/global";
import * as layout from "./protocol/layout";

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
}

export { Transport, codec, Category, SaveTarget };
export { layout, device, glob };
