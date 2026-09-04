/**
 * The keycode namespace. See .codex/reverse/PROTOCOL.md section 5.
 *
 * Keycodes are u16 and banded by range. The catalogue in .codex/reverse/keycodes.json
 * is the vendor's own table, merged with its English labels.
 */

import catalogue from "./keycodes.json";

export type KeycodeGroup =
  | "special"
  | "basic"
  | "system"
  | "media"
  | "mouse"
  | "gamepad"
  | "control"
  | "lighting"
  | "wireless"
  | "macro"
  | "combo";

export interface KeycodeInfo {
  label: string;
  group: KeycodeGroup;
  /** HID usage-page-7 id, for codes that are plain keyboard keys. */
  hid: number | null;
  /** Present when the vendor's short name differs from the English label. */
  vendorName?: string;
  /**
   * The vendor's own label where it is not English — the International and
   * Language keys are named in native script (`変換`, `한영`, `かな`). Kept so
   * nothing is lost, but never used for a legend; `.codex/reverse/keycodes.json` holds
   * the faithful extraction.
   */
  nativeName?: string;
}

// The JSON widens `group` to string, hence the two-step cast.
const CATALOGUE = catalogue as unknown as Record<string, KeycodeInfo>;

// --- band boundaries -------------------------------------------------------

export const Keycode = {
  Unmapped: 0x0000,
  /** On a non-main layer, falls through to the layer below. */
  Transparent: 0x0001,
  ComboBase: 0x1000,
  MediaBase: 0x2000,
  MouseBase: 0x4000,
  LayerBase: 0xf100,
  ControlBase: 0xf200,
  LightingBase: 0xf300,
  WirelessBase: 0xf400,
  MacroBase: 0xf500,
} as const;

/** Modifier bits inside a combo keycode. */
export const Modifier = { Ctrl: 1, Shift: 2, Alt: 4, Win: 8 } as const;
export type Modifier = (typeof Modifier)[keyof typeof Modifier];

const MODIFIER_NAMES: ReadonlyArray<[Modifier, string]> = [
  [Modifier.Ctrl, "Ctrl"],
  [Modifier.Shift, "Shift"],
  [Modifier.Alt, "Alt"],
  [Modifier.Win, "Win"],
];

// --- combos ----------------------------------------------------------------

export interface Combo {
  /** OR of Modifier bits. */
  modifiers: number;
  /** HID usage-page-7 id of the base key. */
  base: number;
}

export const isCombo = (kc: number): boolean =>
  kc > Keycode.ComboBase && kc < Keycode.MediaBase;

export function decodeCombo(kc: number): Combo | null {
  if (!isCombo(kc)) return null;
  const value = kc - Keycode.ComboBase;
  return { modifiers: (value >> 8) & 0xff, base: value & 0xff };
}

export function encodeCombo({ modifiers, base }: Combo): number {
  return Keycode.ComboBase | ((modifiers & 0xff) << 8) | (base & 0xff);
}

export function modifierNames(modifiers: number): string[] {
  return MODIFIER_NAMES.flatMap(([bit, name]) =>
    (modifiers & bit) !== 0 ? [name] : [],
  );
}

// --- macros ----------------------------------------------------------------

export const macroKeycode = (macroId: number): number =>
  Keycode.MacroBase + macroId;

export const macroIdOf = (kc: number): number | null =>
  kc >= Keycode.MacroBase && kc <= Keycode.MacroBase + 0x0f
    ? kc - Keycode.MacroBase
    : null;

// --- layers ----------------------------------------------------------------

/** 0xF100 main, 0xF101 Fn1, 0xF102 Fn2, 0xF103 Fn3. */
export const layerKeycode = (layer: number): number => Keycode.LayerBase + layer;

export const layerOf = (kc: number): number | null =>
  kc >= Keycode.LayerBase && kc <= Keycode.LayerBase + 3
    ? kc - Keycode.LayerBase
    : null;

// --- lookup ----------------------------------------------------------------

export function lookup(kc: number): KeycodeInfo | undefined {
  return CATALOGUE[String(kc)];
}

/**
 * Human label for any keycode.
 *
 * Combos are decoded first, on purpose: a handful of them *are* catalogued,
 * but only under opaque vendor mnemonics (0x1808 is listed as "WFIL"), and
 * "Win+E" is the more useful thing to show. The mnemonic stays reachable
 * through `lookup`.
 */
export function describe(kc: number): string {
  const combo = decodeCombo(kc);
  if (combo) {
    const base = lookup(combo.base)?.label ?? `0x${combo.base.toString(16)}`;
    return [...modifierNames(combo.modifiers), base].join("+");
  }
  return (
    lookup(kc)?.label ?? `0x${kc.toString(16).toUpperCase().padStart(4, "0")}`
  );
}

/**
 * The legend for a keycap, which has far less room than a list row.
 *
 * The catalogue carries a short vendor mnemonic alongside every long English
 * label ("Fn1" for "Switch Fn1 layer", "Bri+" for "Lighting Bri+"), so a cap
 * can stay readable without inventing abbreviations.
 */
export function capLabel(kc: number): string {
  if (kc === Keycode.Unmapped) return "";
  if (kc === Keycode.Transparent) return "▽";

  const info = lookup(kc);
  if (info) {
    return info.vendorName && info.label.length > 7
      ? info.vendorName
      : info.label;
  }
  return describe(kc);
}

export function groupOf(kc: number): KeycodeGroup {
  return lookup(kc)?.group ?? (isCombo(kc) ? "combo" : "special");
}

/** Every catalogued keycode in a group, in numeric order. */
export function byGroup(group: KeycodeGroup): Array<KeycodeInfo & { code: number }> {
  return Object.entries(CATALOGUE)
    .filter(([, info]) => info.group === group)
    .map(([code, info]) => ({ ...info, code: Number(code) }))
    .sort((a, b) => a.code - b.code);
}

export const GROUP_LABELS: Record<KeycodeGroup, string> = {
  basic: "Keyboard",
  special: "Special",
  combo: "Shortcut",
  system: "System",
  media: "Media",
  mouse: "Mouse",
  gamepad: "Gamepad",
  control: "Keyboard Control",
  lighting: "Lighting",
  wireless: "Wireless",
  macro: "Macro",
};
