/**
 * Category 6 — HigherKey (advanced keys). See .codex/reverse/PROTOCOL.md section 9.
 *
 * Verified byte-for-byte against an AE68 Pro: all eight modes written, read
 * back, and compared field by field.
 *
 * Every packet, request and reply, opens with the same 5-byte header:
 *
 *     06 <rw> <row> <col> <mode>
 *
 * so all payload offsets below start at [5]. Travel is micrometres, time is
 * milliseconds.
 */

import { pad64, readU16, u16le, type Report } from "../codec";
import {
  Category,
  HigherKeyMode,
  Rw,
  SOCD_RESOLUTION,
  type SocdMode,
} from "./constants";

export interface KeyRef {
  row: number;
  col: number;
}

/**
 * Where in the press-release cycle a DKS keycode fires. The two travel
 * thresholds `minTravel` and `maxTravel` cut the stroke into seven positions;
 * even ones are instantaneous crossings, odd ones are sustained holds.
 */
export const DksPosition = {
  PressMin: 0,
  HoldBetween: 1,
  PressMax: 2,
  HoldBottom: 3,
  ReleaseMax: 4,
  ReleaseBetween: 5,
  ReleaseMin: 6,
} as const;
export type DksPosition = (typeof DksPosition)[keyof typeof DksPosition];

/**
 * Position 3 occupies TWO bits and both must be set. Anything else here is a
 * plain one-bit flag.
 */
const DKS_BITS: readonly number[] = [0x01, 0x02, 0x04, 0x08 | 0x10, 0x20, 0x40, 0x80];

export function packDksTrigger(positions: Iterable<DksPosition>): number {
  let bits = 0;
  for (const p of positions) bits |= DKS_BITS[p] ?? 0;
  return bits;
}

export function unpackDksTrigger(bits: number): DksPosition[] {
  const out: DksPosition[] = [];
  for (let p = 0; p < DKS_BITS.length; p++) {
    const mask = DKS_BITS[p] ?? 0;
    // Position 3's mask has two bits; both must be present.
    if ((bits & mask) === mask) out.push(p as DksPosition);
  }
  return out;
}

export interface DksConfig {
  /** Four keycodes; 0 means the slot is unused. */
  keycodes: [number, number, number, number];
  /** Trigger bitfield per keycode — build with `packDksTrigger`. */
  triggers: [number, number, number, number];
  minTravel: number;
  maxTravel: number;
}

export interface MptConfig {
  keycodes: [number, number, number];
  /** Three trigger depths, micrometres. */
  depths: [number, number, number];
}

export interface MtConfig {
  tap: number;
  hold: number;
  holdTime: number;
}

export interface TglConfig {
  keycode: number;
  time: number;
}

export interface EndConfig {
  keycodes: [number, number];
  delay: number;
}

export interface PairConfig {
  /** The other key of the pair. */
  other: KeyRef;
  /** Keycode for this key, then for the other. */
  keycodes: [number, number];
  delay: number;
}

export interface SocdConfig extends PairConfig {
  resolution: SocdMode;
}

export type HigherKeyConfig =
  | { mode: typeof HigherKeyMode.None }
  | { mode: typeof HigherKeyMode.DKS; data: DksConfig }
  | { mode: typeof HigherKeyMode.MPT; data: MptConfig }
  | { mode: typeof HigherKeyMode.MT; data: MtConfig }
  | { mode: typeof HigherKeyMode.TGL; data: TglConfig }
  | { mode: typeof HigherKeyMode.END; data: EndConfig }
  | { mode: typeof HigherKeyMode.SOCD; data: SocdConfig }
  | { mode: typeof HigherKeyMode.RS; data: PairConfig };

const header = (rw: number, key: KeyRef, mode: number) => [
  Category.HigherKey,
  rw,
  key.row,
  key.col,
  mode,
];

/**
 * Read a key's advanced-key config. The reply carries the key's *actual* mode
 * in byte 4, so dispatch parsing on that rather than on what you asked for.
 */
export const getHigherKey = (key: KeyRef, mode: number = HigherKeyMode.None) =>
  pad64(header(Rw.Read, key, mode));

/** Clear a key back to plain behaviour. */
export const setNone = (key: KeyRef) =>
  pad64(header(Rw.Write, key, HigherKeyMode.None));

export const setDks = (key: KeyRef, d: DksConfig) =>
  pad64([
    ...header(Rw.Write, key, HigherKeyMode.DKS),
    ...d.keycodes.flatMap(u16le),
    ...d.triggers,
    ...u16le(d.minTravel),
    ...u16le(d.maxTravel),
  ]);

export const setMpt = (key: KeyRef, d: MptConfig) =>
  pad64([
    ...header(Rw.Write, key, HigherKeyMode.MPT),
    ...d.keycodes.flatMap(u16le),
    ...d.depths.flatMap(u16le),
  ]);

export const setMt = (key: KeyRef, d: MtConfig) =>
  pad64([
    ...header(Rw.Write, key, HigherKeyMode.MT),
    ...u16le(d.tap),
    ...u16le(d.hold),
    ...u16le(d.holdTime),
  ]);

export const setTgl = (key: KeyRef, d: TglConfig) =>
  pad64([
    ...header(Rw.Write, key, HigherKeyMode.TGL),
    ...u16le(d.keycode),
    ...u16le(d.time),
  ]);

export const setEnd = (key: KeyRef, d: EndConfig) =>
  pad64([
    ...header(Rw.Write, key, HigherKeyMode.END),
    ...d.keycodes.flatMap(u16le),
    ...u16le(d.delay),
  ]);

/**
 * SOCD and Rappy-Snappy bind a *pair* of keys, and each write is TWO packets —
 * one registered from each key's point of view, with the keycodes swapped.
 * Send both, in order.
 */
export function setSocd(key: KeyRef, d: SocdConfig): [Report, Report] {
  const [a, b] = d.keycodes;
  const [resA, resB] = SOCD_RESOLUTION[d.resolution];
  return [
    pad64([
      ...header(Rw.Write, key, HigherKeyMode.SOCD),
      d.other.row,
      d.other.col,
      ...u16le(a),
      ...u16le(b),
      ...u16le(d.delay),
      resA,
    ]),
    pad64([
      ...header(Rw.Write, d.other, HigherKeyMode.SOCD),
      key.row,
      key.col,
      ...u16le(b),
      ...u16le(a),
      ...u16le(d.delay),
      resB,
    ]),
  ];
}

export function setRs(key: KeyRef, d: PairConfig): [Report, Report] {
  const [a, b] = d.keycodes;
  return [
    pad64([
      ...header(Rw.Write, key, HigherKeyMode.RS),
      d.other.row,
      d.other.col,
      ...u16le(a),
      ...u16le(b),
      ...u16le(d.delay),
    ]),
    pad64([
      ...header(Rw.Write, d.other, HigherKeyMode.RS),
      key.row,
      key.col,
      ...u16le(b),
      ...u16le(a),
      ...u16le(d.delay),
    ]),
  ];
}

export type HigherKeyRecord = KeyRef & HigherKeyConfig;

export function parseHigherKey(r: Uint8Array): HigherKeyRecord | null {
  const key: KeyRef = { row: r[2] ?? 0, col: r[3] ?? 0 };
  const pair = (): PairConfig => ({
    other: { row: r[5] ?? 0, col: r[6] ?? 0 },
    keycodes: [readU16(r, 7), readU16(r, 9)],
    delay: readU16(r, 11),
  });

  switch (r[4]) {
    case HigherKeyMode.None:
      return { ...key, mode: HigherKeyMode.None };

    case HigherKeyMode.DKS:
      return {
        ...key,
        mode: HigherKeyMode.DKS,
        data: {
          keycodes: [
            readU16(r, 5),
            readU16(r, 7),
            readU16(r, 9),
            readU16(r, 11),
          ],
          triggers: [r[13] ?? 0, r[14] ?? 0, r[15] ?? 0, r[16] ?? 0],
          minTravel: readU16(r, 17),
          maxTravel: readU16(r, 19),
        },
      };

    case HigherKeyMode.MPT:
      // Confirmed on hardware: the board stores and returns these raw in
      // micrometres. The vendor converts mm to um when writing but not when
      // reading, so only one side of their pair is right; we use um in both.
      return {
        ...key,
        mode: HigherKeyMode.MPT,
        data: {
          keycodes: [readU16(r, 5), readU16(r, 7), readU16(r, 9)],
          depths: [readU16(r, 11), readU16(r, 13), readU16(r, 15)],
        },
      };

    case HigherKeyMode.MT:
      return {
        ...key,
        mode: HigherKeyMode.MT,
        data: {
          tap: readU16(r, 5),
          hold: readU16(r, 7),
          holdTime: readU16(r, 9),
        },
      };

    case HigherKeyMode.TGL:
      return {
        ...key,
        mode: HigherKeyMode.TGL,
        data: { keycode: readU16(r, 5), time: readU16(r, 7) },
      };

    case HigherKeyMode.END:
      return {
        ...key,
        mode: HigherKeyMode.END,
        data: { keycodes: [readU16(r, 5), readU16(r, 7)], delay: readU16(r, 9) },
      };

    case HigherKeyMode.SOCD:
      return {
        ...key,
        mode: HigherKeyMode.SOCD,
        data: { ...pair(), resolution: (r[13] ?? 0) as SocdMode },
      };

    case HigherKeyMode.RS:
      return { ...key, mode: HigherKeyMode.RS, data: pair() };

    default:
      return null;
  }
}
