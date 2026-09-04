/** Category 4 — Performance. See .codex/reverse/PROTOCOL.md section 6. */

import { pad64, readU16, readU16Array, u16le, type Report } from "../codec";
import { AxisKind, Category, type KeyMode } from "./constants";

const Sub = { Get: 1, Set: 2, AxisData: 3 } as const;

/**
 * One key's actuation settings. All travel values are micrometres — the UI
 * converts to millimetres at the edge, never in here.
 */
export interface Performance {
  mode: KeyMode;
  /** Actuation point. */
  press: number;
  /** Reset point. In fixed mode the firmware forces this equal to `press`. */
  release: number;
  /** Rapid trigger: depth of the first actuation. */
  rtFirst: number;
  /** Rapid trigger: press sensitivity. */
  rtPress: number;
  /** Rapid trigger: release sensitivity. */
  rtRelease: number;
  /** Top dead zone. */
  pressDead: number;
  /** Bottom dead zone. */
  releaseDead: number;
  /**
   * Calibration constants. These are not user settings — read them, keep them,
   * write them back unchanged.
   */
  axis: number;
  calibrate: number;
  axisV2Id: number;
  axisRangeMax: number;
  axisCoefficient: number;
}

export const getPerformance = (row: number, col: number) =>
  pad64([Category.Performance, Sub.Get, row, col]);

export function setPerformance(
  row: number,
  col: number,
  p: Performance,
): Report {
  return pad64([
    Category.Performance,
    Sub.Set,
    row,
    col,
    p.mode,
    ...u16le(p.press),
    ...u16le(p.release),
    ...u16le(p.rtFirst),
    ...u16le(p.rtPress),
    ...u16le(p.rtRelease),
    ...u16le(p.pressDead),
    ...u16le(p.releaseDead),
    p.axis,
    p.calibrate,
    ...u16le(p.axisV2Id),
    ...u16le(p.axisRangeMax),
    ...u16le(p.axisCoefficient),
  ]);
}

export function parsePerformance(r: Uint8Array): Performance {
  return {
    mode: (r[4] ?? 0) as KeyMode,
    press: readU16(r, 5),
    release: readU16(r, 7),
    rtFirst: readU16(r, 9),
    rtPress: readU16(r, 11),
    rtRelease: readU16(r, 13),
    pressDead: readU16(r, 15),
    releaseDead: readU16(r, 17),
    axis: r[19] ?? 0,
    calibrate: r[20] ?? 0,
    axisV2Id: readU16(r, 21),
    axisRangeMax: readU16(r, 23),
    axisCoefficient: readU16(r, 25),
  };
}

/**
 * Live telemetry for a whole matrix row. Poll `Adc` or `Route` at 15-25 Hz for
 * a travel test; no enable command is needed.
 *
 * Several of these are in flight at once during a poll, and only kind + row
 * tell them apart — always send this with `matchBytes: 4`.
 */
export const getAxisData = (kind: AxisKind, row: number) =>
  pad64([Category.Performance, Sub.AxisData, kind, row]);

/** `[4:]` is one u16 per electrical column. */
export const parseAxisData = (r: Uint8Array): number[] => readU16Array(r, 4);

export { AxisKind };
