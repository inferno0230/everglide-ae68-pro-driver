/** Category 5 — Lighting. See .codex/reverse/PROTOCOL.md section 8. */

import { pad64 } from "../codec";
import { Category, LightConfig, Rw } from "./constants";

const Sub = { ReadBack: 3, Custom: 4, DirectDrive: 5, Caps: 6 } as const;

/**
 * Per-key colour is addressed as a matrix with a **21-slot row pitch**, not as
 * a list of keys.
 *
 * Measured on hardware by writing all 135 addressable slots and reading back
 * which ones the board kept: it accepts exactly six runs of 15, each starting
 * at a multiple of 21 (0-14, 21-35, 42-56, 63-77, 84-98, 105-119) and silently
 * drops the six padding slots at the end of every row along with everything
 * from 126 up. Both independent checks agree — the vendor painting Esc (row 1,
 * col 0) lands on 21, and the right arrow (row 5, col 14) lands on 119.
 *
 * So the 6x15 matrix the topology query reports is embedded in a 21-wide
 * buffer, and a driver that assumes physical key order writes colours to the
 * wrong keys.
 */
export const LED_ROW_PITCH = 21;
/** Pages of 15 slots. Page 9 gets no reply, so the space stops at 135. */
export const KEY_COLOR_PAGES = 9;

export const ledIndex = (row: number, col: number): number =>
  row * LED_ROW_PITCH + col;

/**
 * The 6.25u spacebar is one logical key but occupies five lighting positions.
 * The keyboard applies each position to both its north- and south-facing LED,
 * so painting this group controls all ten physical spacebar LEDs.
 *
 * This matches the vendor driver's special-lighting expansion: its centre key
 * is row 5, column 6, and the completed run spans columns 4 through 8.
 */
export const SPACEBAR_KEY = { row: 5, col: 6 } as const;
export const SPACEBAR_LED_COLUMNS = [4, 5, 6, 7, 8] as const;

export const isSpacebarAuxiliaryPosition = (
  row: number,
  col: number,
): boolean =>
  row === SPACEBAR_KEY.row &&
  col !== SPACEBAR_KEY.col &&
  SPACEBAR_LED_COLUMNS.some((candidate) => candidate === col);

/** All electrical LED slots controlled by one logical key. */
export const ledIndices = (row: number, col: number): number[] =>
  row === SPACEBAR_KEY.row && col === SPACEBAR_KEY.col
    ? SPACEBAR_LED_COLUMNS.map((ledCol) => ledIndex(row, ledCol))
    : [ledIndex(row, col)];

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** A palette slot. `h` is the vendor's hue byte, stored alongside the colour. */
export interface PaletteSlot extends Rgb {
  h: number;
}

export interface LightingBase {
  /** Bitfield, not an enum: bit 1 south, bit 2 north. See LightOpen. */
  open: number;
  effect: number;
  brightness: number;
  speed: number;
  direction: number;
  paletteSlot: number;
}

/** Palette slot 0 is the "cycle hues" slot. The device stores it as {0,0,0}. */
export const RGB_SLOT = 0;
export const PALETTE_SLOTS = 8;
/** Per-key direct drive carries 15 keys per packet. */
export const KEYS_PER_PAGE = 15;

// --- base ------------------------------------------------------------------

export const getBase = (area: number) =>
  pad64([Category.Lighting, Rw.Read, area, LightConfig.Base]);

export const setBase = (area: number, b: LightingBase) =>
  pad64([
    Category.Lighting,
    Rw.Write,
    area,
    LightConfig.Base,
    b.open,
    b.effect,
    b.brightness,
    b.speed,
    b.direction,
    b.paletteSlot,
  ]);

export function parseBase(r: Uint8Array): LightingBase {
  return {
    open: r[4] ?? 0,
    effect: r[5] ?? 0,
    brightness: r[6] ?? 0,
    speed: r[7] ?? 0,
    direction: r[8] ?? 0,
    paletteSlot: r[9] ?? 0,
  };
}

// --- palette ---------------------------------------------------------------
// Eight slots of four bytes each, in B, G, R, H order.

export const getPalette = (area: number) =>
  pad64([Category.Lighting, Rw.Read, area, LightConfig.Palette]);

export const setPalette = (area: number, slots: readonly PaletteSlot[]) =>
  pad64([
    Category.Lighting,
    Rw.Write,
    area,
    LightConfig.Palette,
    ...slots.flatMap((s) => [s.b, s.g, s.r, s.h]),
  ]);

export function parsePalette(r: Uint8Array): PaletteSlot[] {
  return Array.from({ length: PALETTE_SLOTS }, (_, i) => {
    const at = 4 + i * 4;
    return { b: r[at] ?? 0, g: r[at + 1] ?? 0, r: r[at + 2] ?? 0, h: r[at + 3] ?? 0 };
  });
}

// --- colour correction -----------------------------------------------------

export const getCorrection = (area: number) =>
  pad64([Category.Lighting, Rw.Read, area, LightConfig.Correction]);

export const setCorrection = (area: number, c: Rgb) =>
  pad64([Category.Lighting, Rw.Write, area, LightConfig.Correction, c.r, c.g, c.b]);

export const parseCorrection = (r: Uint8Array): Rgb => ({
  r: r[4] ?? 0,
  g: r[5] ?? 0,
  b: r[6] ?? 0,
});

// --- per-key colour --------------------------------------------------------

export interface KeyColor extends Rgb {
  /** Custom colour, vs. "let the effect drive this key". */
  custom: boolean;
}

/** Read one page of per-key colours. Match on 3 bytes plus the page. */
export const getKeyColors = (area: number, page: number) =>
  pad64([Category.Lighting, Sub.ReadBack, area, page]);

export function parseKeyColors(r: Uint8Array): KeyColor[] {
  return Array.from({ length: KEYS_PER_PAGE }, (_, i) => {
    const at = 4 + i * 4;
    return {
      b: r[at] ?? 0,
      g: r[at + 1] ?? 0,
      r: r[at + 2] ?? 0,
      custom: r[at + 3] === 0xff,
    };
  });
}

/**
 * Assign a page of per-key colours. This is what the vendor's paint tool uses.
 *
 * Unlike direct drive this is a normal request/reply write that the board keeps
 * — `flag` `0xFF` pins the key to `B,G,R` and overrides the running effect, `0`
 * hands it back. It lives in the Lighting flash region, so it is RAM-only until
 * a save like everything else; the vendor issues no save of its own when you
 * paint.
 */
export const setKeyColors = (
  area: number,
  page: number,
  colors: readonly KeyColor[],
) =>
  pad64([
    Category.Lighting,
    Sub.Custom,
    area,
    page,
    ...colors
      .slice(0, KEYS_PER_PAGE)
      .flatMap((c) => [c.b, c.g, c.r, c.custom ? 0xff : 0]),
  ]);

/**
 * Direct-drive a page of up to 15 keys. This gets NO reply — send it and pace
 * successive packets about 4 ms apart.
 *
 * The vendor never uses this for painting; `setKeyColors` is the persistent
 * path. Kept because the command is real and decoded.
 */
export const driveKeyColors = (
  area: number,
  page: number,
  colors: readonly KeyColor[],
) =>
  pad64([
    Category.Lighting,
    Sub.DirectDrive,
    area,
    page,
    ...colors
      .slice(0, KEYS_PER_PAGE)
      .flatMap((c) => [c.b, c.g, c.r, c.custom ? 0xff : 0]),
  ]);

/** Caps-lock indicator colour. */
export const setCapsColor = (c: Rgb) =>
  pad64([Category.Lighting, Sub.Caps, c.b, c.g, c.r]);
