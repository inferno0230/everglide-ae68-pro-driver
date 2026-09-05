/**
 * Category 7 — Macro. See .codex/reverse/PROTOCOL.md section 10.
 *
 * Verified against an AE68 Pro: mode record and action pages written, read
 * back, and decoded exactly, including multi-page macros across a power cycle.
 *
 * 16 slots. A macro is bound to a key by giving that key keycode
 * `0xF500 + macroId` (see keycodes.ts).
 */

import { pad64, readU16, readU32, u16le, u32le } from "../codec";
import {
  Category,
  MACRO_ACTION_POOL,
  MACRO_ACTIONS_PER_PAGE,
} from "./constants";

const Sub = {
  GetMode: 1,
  SetMode: 2,
  GetData: 3,
  SetData: 4,
} as const;

/** Delay is 15 bits on the wire. */
export const MAX_DELAY_MS = 32767;

/**
 * One macro may use the whole pool, so the per-macro cap *is* the pool.
 *
 * The board reports 16 slots and 960 in `02 0E 00`, and 960 counts **actions,
 * not bytes** — 16 slots x 60 actions is exactly 960, and filling all sixteen
 * that way is accepted to the last action. Measured on an AE68 Pro:
 *
 *   - a single slot takes 960 and refuses 961;
 *   - once one slot holds 960, a *one*-action macro elsewhere is refused;
 *   - 100-action macros in three slots survived save + power cycle intact.
 *
 * The refusal is silent. The board does not answer with an error, it simply
 * does not store the mode record, so the read-back is the only way to know a
 * write landed — hence `setMacro` returning what the board kept.
 */
export const MAX_ACTIONS_PER_MACRO = MACRO_ACTION_POOL;

export interface MacroAction {
  /** true = key down, false = key up. */
  down: boolean;
  /**
   * Milliseconds attached to this action, 0-32767.
   *
   * The vendor's recorder writes the measured gap between two events onto the
   * *earlier* of them and gives the newest action a 10 ms placeholder, so in
   * vendor-authored macros this reads as "wait after this action". Match that
   * convention and playback lines up with the vendor's own macros; the field's
   * width is the only part the firmware pins down.
   */
  delay: number;
  keycode: number;
}

export interface MacroMode {
  macroId: number;
  /** Whether the slot holds a usable macro. */
  valid: boolean;
  /** Number of actions the firmware should expect. */
  actionCount: number;
  /** Repeat count. */
  repeatCount: number;
  mode: number;
}

// --- mode record -----------------------------------------------------------

export const getMacroMode = (macroId: number) =>
  pad64([Category.Macro, Sub.GetMode, macroId]);

export const setMacroMode = (m: MacroMode) =>
  pad64([
    Category.Macro,
    Sub.SetMode,
    m.macroId,
    m.valid ? 1 : 0,
    ...u16le(m.actionCount),
    ...u16le(m.repeatCount),
    m.mode,
  ]);

export function parseMacroMode(r: Uint8Array): MacroMode {
  return {
    macroId: r[2] ?? 0,
    valid: r[3] === 1,
    actionCount: readU16(r, 4),
    repeatCount: readU16(r, 6),
    mode: r[8] ?? 0,
  };
}

/**
 * Actions already claimed across every slot.
 *
 * The board's own capacity report is a fixed number, not a remaining count, so
 * free space is only knowable by adding up what the slots hold. Slots are
 * summed whatever their `valid` flag says: clearing a slot means zeroing its
 * action count, and treating a stale count as free is how you earn a silent
 * refusal.
 */
export const poolUsed = (modes: readonly MacroMode[]): number =>
  modes.reduce((n, m) => n + m.actionCount, 0);

// --- action pages ----------------------------------------------------------

/**
 * Pack one action into its u32 word.
 *
 *   bit 31      down
 *   bits 30..16 delay (ms)
 *   bits 15..0  keycode
 *
 * `1 << 31` is negative as a JS int32, so force it back to unsigned before
 * splitting into bytes.
 */
export function packAction(a: MacroAction): number {
  if (a.delay > MAX_DELAY_MS) {
    throw new RangeError(`macro delay ${a.delay}ms exceeds ${MAX_DELAY_MS}ms`);
  }
  if (a.keycode > 0xffff) {
    throw new RangeError(`macro keycode ${a.keycode} exceeds 0xFFFF`);
  }
  return (
    (((a.down ? 1 : 0) << 31) | (a.delay << 16) | (a.keycode & 0xffff)) >>> 0
  );
}

export function unpackAction(word: number): MacroAction {
  return {
    down: ((word >>> 31) & 1) === 1,
    delay: (word >>> 16) & 0x7fff,
    keycode: word & 0xffff,
  };
}

export const getMacroData = (macroId: number, page: number) =>
  pad64([Category.Macro, Sub.GetData, macroId, page]);

export const setMacroData = (
  macroId: number,
  page: number,
  actions: readonly MacroAction[],
) =>
  pad64([
    Category.Macro,
    Sub.SetData,
    macroId,
    page,
    ...actions
      .slice(0, MACRO_ACTIONS_PER_PAGE)
      .flatMap((a) => u32le(packAction(a))),
  ]);

export function parseMacroData(r: Uint8Array): {
  macroId: number;
  page: number;
  actions: MacroAction[];
} {
  const actions: MacroAction[] = [];
  for (let i = 0; i < MACRO_ACTIONS_PER_PAGE; i++) {
    actions.push(unpackAction(readU32(r, 4 + i * 4)));
  }
  return { macroId: r[2] ?? 0, page: r[3] ?? 0, actions };
}

/** Split a macro into the pages the wire format wants. */
export function pageActions(
  actions: readonly MacroAction[],
): MacroAction[][] {
  const pages: MacroAction[][] = [];
  for (let i = 0; i < actions.length; i += MACRO_ACTIONS_PER_PAGE) {
    pages.push(actions.slice(i, i + MACRO_ACTIONS_PER_PAGE));
  }
  return pages;
}
