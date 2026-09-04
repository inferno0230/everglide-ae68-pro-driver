/** Category 2 — Global. See .codex/reverse/PROTOCOL.md section 7. */

import { pad64, readString, readU16, type Report } from "../codec";
import { Category, REPORT_RATES, type SaveTarget } from "./constants";

const Sub = {
  ResetFactory: 1,
  SaveParam: 2,
  ConfigSwitch: 3,
  ReportRate: 5,
  Calibration: 6,
  EffectAreaQuery: 8,
  DoubleLightingQuery: 10,
  SpecialLightingQuery: 11,
  RtPrecisionQuery: 12,
  MacroSpaceQuery: 14,
} as const;

/**
 * Nothing the driver writes survives a power cycle without this. Give it a
 * 3 s timeout — the board is writing flash.
 */
export const saveParam = (target: SaveTarget) =>
  pad64([Category.Global, Sub.SaveParam, target]);

export const resetFactory = (target: SaveTarget) =>
  pad64([Category.Global, Sub.ResetFactory, target]);

// --- config profiles -------------------------------------------------------

export const getActiveProfile = () => pad64([Category.Global, Sub.ConfigSwitch, 1]);
export const setActiveProfile = (index: number) =>
  pad64([Category.Global, Sub.ConfigSwitch, 2, index]);
export const getProfileName = (index: number) =>
  pad64([Category.Global, Sub.ConfigSwitch, 3, index]);

export function setProfileName(index: number, name: string): Report {
  const bytes = Array.from(new TextEncoder().encode(name).subarray(0, 32));
  return pad64([Category.Global, Sub.ConfigSwitch, 4, index, ...bytes]);
}

export const parseActiveProfile = (r: Uint8Array): number => r[3] ?? 0;
export const parseProfileName = (r: Uint8Array): string => readString(r, 4, 36);

// --- calibration -----------------------------------------------------------

/** Start, then press every key fully down and fully release it. */
export const startCalibration = () => pad64([Category.Global, Sub.Calibration, 0]);
export const stopCalibration = () => pad64([Category.Global, Sub.Calibration, 1]);

// --- report rate -----------------------------------------------------------

export const getReportRate = () => pad64([Category.Global, Sub.ReportRate, 1]);
export const setReportRate = (code: number) =>
  pad64([Category.Global, Sub.ReportRate, 2, code]);

export function parseReportRate(r: Uint8Array): number {
  const code = r[3] ?? 3;
  return REPORT_RATES.find((entry) => entry.code === code)?.hz ?? 1000;
}

export function reportRateCode(hz: number): number {
  return REPORT_RATES.find((entry) => entry.hz === hz)?.code ?? 3;
}

// --- capability queries ----------------------------------------------------

/**
 * A lighting zone.
 *
 * The second byte is the number of **effects** the zone supports, not how many
 * LEDs it has: the AE68 Pro reports 20 for the keyboard (which offers L1-L20)
 * and 5 for the light bar (L1-L5), while its actual LED counts are 68 and 40.
 * `cols` is what carries the LED count on a strip.
 */
export interface LedZone {
  index: number;
  effectCount: number;
  rows: number;
  cols: number;
}

export const getLedZones = () => pad64([Category.Global, Sub.EffectAreaQuery, 0]);

export function parseLedZones(r: Uint8Array): LedZone[] {
  const count = r[3] ?? 0;
  const zones: LedZone[] = [];
  for (let i = 0; i < count; i++) {
    const at = 4 + i * 4;
    zones.push({
      index: r[at] ?? i,
      effectCount: r[at + 1] ?? 0,
      rows: r[at + 2] ?? 0,
      cols: r[at + 3] ?? 0,
    });
  }
  return zones;
}

/** Non-zero when the board has both north (top) and south (underglow) LEDs. */
export const getDoubleLighting = () =>
  pad64([Category.Global, Sub.DoubleLightingQuery, 0]);
export const parseDoubleLighting = (r: Uint8Array): boolean => (r[3] ?? 0) !== 0;

/** Smallest rapid-trigger step the firmware honours, in millimetres. */
export const getRtPrecision = () =>
  pad64([Category.Global, Sub.RtPrecisionQuery, 0]);
export const parseRtPrecision = (r: Uint8Array): number => (r[3] ?? 10) / 1000;

export const getMacroSpace = () =>
  pad64([Category.Global, Sub.MacroSpaceQuery, 0]);

export function parseMacroSpace(r: Uint8Array): {
  slots: number;
  totalBytes: number;
} {
  return { slots: r[3] ?? 0, totalBytes: readU16(r, 4) };
}
