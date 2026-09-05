/** Protocol enums, transcribed from .codex/reverse/PROTOCOL.md section 3. */

/** Command category — byte 0 of every report. */
export const Category = {
  Device: 1,
  Global: 2,
  LayoutAndKey: 3,
  Performance: 4,
  Lighting: 5,
  HigherKey: 6,
  Macro: 7,
  FirmwareUpgrade: 8,
  CustomCommand: 10,
  Displayer: 12,
  ThreeMode: 13,
  Voice: 14,
  Touch: 15,
  Handle: 16,
  ThreeD: 17,
} as const;

/** Read/Write discriminator used by lighting and advanced keys. */
export const Rw = { Read: 1, Write: 2 } as const;

/** `02 02 <target>` save / `02 01 <target>` factory reset. */
export const SaveTarget = {
  All: 0,
  Calibration: 1,
  Performance: 2,
  Lighting: 3,
  Layout: 4,
  HigherKey: 5,
  Macro: 6,
  Axis: 7,
} as const;
export type SaveTarget = (typeof SaveTarget)[keyof typeof SaveTarget];

/** Actuation behaviour for a single key. */
export const KeyMode = { Fixed: 0, RapidTrigger: 1 } as const;
export type KeyMode = (typeof KeyMode)[keyof typeof KeyMode];

/** `04 03 <kind> <row>` live axis telemetry. */
export const AxisKind = {
  Adc: 0,
  Route: 1,
  Calibrate: 2,
  KeyStatus: 3,
} as const;
export type AxisKind = (typeof AxisKind)[keyof typeof AxisKind];

/** Report rate codes for `02 05`. */
export const REPORT_RATES = [
  { code: 0, hz: 8000 },
  { code: 1, hz: 4000 },
  { code: 2, hz: 2000 },
  { code: 3, hz: 1000 },
  { code: 4, hz: 500 },
  { code: 5, hz: 250 },
] as const;

/**
 * Effect speed is a 0-100 scale, like brightness — not the five-step enum the
 * vendor bundle's `Speed1..Speed5` names suggest. Its UI drives this with the
 * same slider it uses for brightness, and an AE68 Pro stores any byte 0-255.
 */
export const SPEED_MAX = 100;

/** Lighting areas: 0 is the keyboard itself, 1-5 are decorative strips. */
export const LightArea = { Keyboard: 0, Decorate1: 1 } as const;

/**
 * The `open` byte means different things per area. Only the keyboard, and only
 * when it has both LED faces, uses the four-state form; a decorative strip is a
 * plain on/off. The vendor app reflects this exactly: two switches for the
 * keyboard, one for the strip.
 */
export const isDualFaceArea = (area: number, dualLighting: boolean): boolean =>
  area === LightArea.Keyboard && dualLighting;

/** North is the top-facing LED (bit 2), south the underglow (bit 1). */
export const LightFace = { South: 1, North: 2 } as const;

export const faceIsOn = (open: number, face: number): boolean =>
  (open & face) !== 0;

export const withFace = (open: number, face: number, on: boolean): number =>
  on ? open | face : open & ~face;

/** Lighting sub-config selector (`05 <rw> <area> <config>`). */
export const LightConfig = { Base: 0, Palette: 1, Correction: 2 } as const;

/**
 * The `open` byte. On a keyboard with dual (north + south) lighting this is a
 * 4-state field; everywhere else it is a plain on/off.
 */
export const LightOpen = {
  Off: 0,
  SouthOnly: 1,
  NorthOnly: 2,
  Both: 3,
} as const;
export type LightOpen = (typeof LightOpen)[keyof typeof LightOpen];

/**
 * Twenty effects, ids 0-19.
 *
 * The bundle's enum only names sixteen, which made 0-16 look like the whole
 * set. The vendor UI actually offers L1-L20 and selecting L20 sends effect
 * `0x13` (19), so three ids exist that the enum never named. Hardware testing
 * identifies those final three as the board's interactive RGB modes.
 */
export interface LightingEffect {
  id: number;
  name: string;
  description?: string;
  interactive?: boolean;
}

export const EFFECTS: readonly LightingEffect[] = [
  { id: 0, name: "Static" },
  { id: 1, name: "Ripple" },
  { id: 2, name: "Ebb & Flow" },
  { id: 3, name: "Ripple Gently" },
  { id: 4, name: "Rotating Storm" },
  { id: 5, name: "Lucky Rainbow" },
  { id: 6, name: "Shining Rainbow" },
  { id: 7, name: "Shining" },
  { id: 8, name: "Moving Window" },
  { id: 9, name: "Wave" },
  { id: 10, name: "Shift" },
  { id: 11, name: "Sine Curve" },
  { id: 12, name: "Cloud Flow" },
  { id: 13, name: "Blooming" },
  { id: 14, name: "Rainbow" },
  { id: 15, name: "Rainfall" },
  { id: 16, name: "Jump" },
  {
    id: 17,
    name: "Reactive Region",
    description: "Pressing a key lights the region around that key.",
    interactive: true,
  },
  {
    id: 18,
    name: "Reactive Column",
    description: "Pressing a key lights its entire vertical column.",
    interactive: true,
  },
  {
    id: 19,
    name: "Water Ripple",
    description: "Pressing a key sends a water-drop ripple across the whole keyboard.",
    interactive: true,
  },
] as const;

/** The vendor labels effects L1-L20; ours are zero-based. */
export const effectLabel = (id: number, name: string): string =>
  name === `L${id + 1}` ? name : `L${id + 1} · ${name}`;

/** Advanced-key modes (category 6). */
export const HigherKeyMode = {
  None: 0,
  DKS: 1,
  MPT: 2,
  MT: 3,
  TGL: 4,
  END: 5,
  SOCD: 6,
  RS: 7,
} as const;
export type HigherKeyMode =
  (typeof HigherKeyMode)[keyof typeof HigherKeyMode];

/** SOCD conflict resolution, and the byte pair each mode writes. */
export const SocdMode = {
  LastOverride: 0,
  PriorityA: 1,
  PriorityB: 2,
  Neutralize: 3,
} as const;
export type SocdMode = (typeof SocdMode)[keyof typeof SocdMode];

/** Packet A gets `[0]`, packet B gets `[1]`. */
export const SOCD_RESOLUTION: Record<SocdMode, readonly [number, number]> = {
  [SocdMode.LastOverride]: [0, 0],
  [SocdMode.PriorityA]: [1, 2],
  [SocdMode.PriorityB]: [2, 1],
  [SocdMode.Neutralize]: [3, 3],
};

/** Four config profiles, and four keymap layers (main + Fn1/Fn2/Fn3). */
export const PROFILE_COUNT = 4;
export const LAYER_COUNT = 4;
export const MACRO_SLOTS = 16;
/** (64 - 4) / 4 — action words that fit in one macro page. */
export const MACRO_ACTIONS_PER_PAGE = 15;
/**
 * Actions the board can hold across *all* macro slots, as reported by
 * `02 0E 00`. One pool, not a per-slot allowance — see `macro.ts`.
 */
export const MACRO_ACTION_POOL = 960;
