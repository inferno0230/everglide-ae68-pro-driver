/** Category 1 — Device. See .codex/reverse/PROTOCOL.md section 4. */

import { pad64, readString, readU32be } from "../codec";
import { Category } from "./constants";

const Sub = { Protocol: 1, DeviceInfo: 2, Feature: 3 } as const;

export interface ProtocolVersion {
  main: number;
  sub: number;
  hardware: number;
  software: number;
}

export interface DeviceInfo {
  type: number;
  subType: number;
  boardId: number;
  appVersion: string;
  pcbVersion: string;
  runModeVersion: number;
  serialNumber: string;
  buildTimestamp: string;
}

export interface DeviceFeature {
  axis: {
    mechanical: boolean;
    magnetic: boolean;
    optical: boolean;
    inductive: boolean;
    magnetic3d: boolean;
  };
  connection: { usb: boolean; wireless24g: boolean; ble: boolean; usb3: boolean };
  basic: { rgb: boolean; knob: boolean };
  extended: {
    smallScreen: boolean;
    fullScreen: boolean;
    haptic: boolean;
    voicePlayback: boolean;
    voiceRecognition: boolean;
    gamepad: boolean;
    dotMatrix: boolean;
  };
}

export const getProtocol = () => pad64([Category.Device, Sub.Protocol]);
export const getDeviceInfo = () => pad64([Category.Device, Sub.DeviceInfo]);
export const getFeature = () => pad64([Category.Device, Sub.Feature]);

export function parseProtocol(r: Uint8Array): ProtocolVersion {
  return {
    main: r[2] ?? 0,
    sub: r[3] ?? 0,
    hardware: r[4] ?? 0,
    software: r[5] ?? 0,
  };
}

export function parseDeviceInfo(r: Uint8Array): DeviceInfo {
  const version = (start: number, sep: string) =>
    Array.from(r.subarray(start, start + 4)).join(sep);
  return {
    type: r[2] ?? 0,
    subType: r[3] ?? 0,
    boardId: readU32be(r, 4),
    appVersion: version(8, "."),
    pcbVersion: version(12, "-"),
    runModeVersion: r[16] ?? 0,
    serialNumber: readSerial(r),
    buildTimestamp: readString(r, 29, 45),
  };
}

/**
 * Serial number, bytes [17:29].
 *
 * Not twelve decimal digits, which is how an earlier pass read it: on the
 * AE68 Pro it is a printable ASCII prefix followed by a binary unique id
 * (`50 36 37 42 34 35 | 1f 93 01 99 a8 00` — "P67B45", then six raw bytes).
 * Joining the byte values produced a plausible-looking number that was simply
 * the ASCII codes in decimal.
 */
function readSerial(r: Uint8Array): string {
  const bytes = r.subarray(17, 29);

  let split = bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    if (b < 0x20 || b > 0x7e) {
      split = i;
      break;
    }
  }

  const text = new TextDecoder().decode(bytes.subarray(0, split));
  const rest = Array.from(bytes.subarray(split))
    .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
    .join("");

  return rest ? (text ? `${text}-${rest}` : rest) : text;
}

export function parseFeature(r: Uint8Array): DeviceFeature {
  const axis = r[2] ?? 0;
  const connection = r[3] ?? 0;
  const basic = r[4] ?? 0;
  const extended = r[5] ?? 0;
  const has = (field: number, bit: number) => (field & bit) !== 0;
  return {
    axis: {
      mechanical: has(axis, 1),
      magnetic: has(axis, 2),
      optical: has(axis, 4),
      inductive: has(axis, 8),
      magnetic3d: has(axis, 16),
    },
    connection: {
      usb: has(connection, 1),
      wireless24g: has(connection, 2),
      ble: has(connection, 4),
      usb3: has(connection, 8),
    },
    basic: { rgb: has(basic, 1), knob: has(basic, 2) },
    extended: {
      smallScreen: has(extended, 1),
      fullScreen: has(extended, 2),
      haptic: has(extended, 4),
      voicePlayback: has(extended, 8),
      voiceRecognition: has(extended, 16),
      gamepad: has(extended, 32),
      dotMatrix: has(extended, 64),
    },
  };
}
