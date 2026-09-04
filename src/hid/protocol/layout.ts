/** Category 3 — LayoutAndKey. See .codex/reverse/PROTOCOL.md section 5. */

import { pad64, readU16, readU16Array, u16le } from "../codec";
import { Category } from "./constants";

const Sub = {
  GetKeyLayout: 1,
  SetKeyLayout: 2,
  GetKeyCode: 3,
  SetKeyCode: 4,
  GetKeyLayoutStyle: 5,
} as const;

/** One physical key as the board describes it. */
export interface PhysicalKey {
  /** Matrix row, 1-5 on the AE68 Pro. */
  row: number;
  /** Electrical column — resolved, not the raw drawing coordinate. */
  col: number;
  /** Drawing X in key units. Not the same thing as `col`. */
  x: number;
  /** Key width class. 12 = knob, 13-15 = screen segment. */
  ratio: number;
}

export const getKeyLayoutStyle = (row: number) =>
  pad64([Category.LayoutAndKey, Sub.GetKeyLayoutStyle, row]);

export const getKeyLayout = (layer: number, row: number) =>
  pad64([Category.LayoutAndKey, Sub.GetKeyLayout, layer, row]);

export const getKeyCode = (layer: number, row: number, col: number) =>
  pad64([Category.LayoutAndKey, Sub.GetKeyCode, layer, row, col]);

export const setKeyCode = (
  layer: number,
  row: number,
  col: number,
  keycode: number,
) =>
  pad64([
    Category.LayoutAndKey,
    Sub.SetKeyCode,
    layer,
    row,
    col,
    ...u16le(keycode),
  ]);

export const setKeyLayout = (
  layer: number,
  row: number,
  keycodes: readonly number[],
) =>
  pad64([
    Category.LayoutAndKey,
    Sub.SetKeyLayout,
    layer,
    row,
    ...keycodes.flatMap(u16le),
  ]);

/** `[4:]` of a GetKeyLayout reply is one u16 keycode per electrical column. */
export const parseKeyLayout = (r: Uint8Array): number[] => readU16Array(r, 4);

export const parseKeyCode = (
  r: Uint8Array,
): { layer: number; row: number; col: number; keycode: number } => ({
  layer: r[2] ?? 0,
  row: r[3] ?? 0,
  col: r[4] ?? 0,
  keycode: readU16(r, 5),
});

/**
 * Unpack a layout-style row. Returns the row's physical keys with `col` still
 * unresolved (set to the raw floor(x) fallback) — call `resolveColumns` with
 * the row's keycode array to fix them up.
 *
 * Returns an empty array for unused rows.
 */
export function parseKeyLayoutStyle(r: Uint8Array): PhysicalKey[] {
  if (r[2] === 0xff) return [];

  const keys: PhysicalKey[] = [];
  for (let i = 3; i + 1 < 64; i += 2) {
    const packed = readU16(r, i);
    if (packed === 0) continue;
    const s = (packed >> 11) & 0x1f;
    const l = (packed >> 4) & 0x7f;
    const ratio = packed & 0x0f;
    keys.push({ row: s >> 2, col: Math.floor(l / 4), x: l / 4, ratio });
  }
  return keys;
}

/**
 * Resolve drawing X to real matrix columns.
 *
 * `x = l/4` is a layout coordinate: wide keys and split-key gaps push it past
 * the electrical column, so the naive floor(x) is wrong (on the AE68 Pro's
 * bottom row it misplaces Space and the whole right-hand cluster). The board
 * tells us the truth in the keycode array — the populated columns, left to
 * right, are exactly the physical keys, left to right.
 *
 * Falls back to floor(x) when the counts disagree, which is the vendor's own
 * behaviour.
 */
export function resolveColumns(
  keys: readonly PhysicalKey[],
  keycodes: readonly number[],
): PhysicalKey[] {
  const liveCols = keycodes.flatMap((kc, col) => (kc !== 0 ? [col] : []));
  const sorted = [...keys].sort((a, b) => a.x - b.x);

  if (liveCols.length !== sorted.length) return sorted;

  return sorted.map((key, index) => ({ ...key, col: liveCols[index] ?? key.col }));
}
