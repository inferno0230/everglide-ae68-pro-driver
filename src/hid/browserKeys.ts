/**
 * `KeyboardEvent.code` → device keycode, for recording macros.
 *
 * The vendor keys its recorder off the deprecated `event.keyCode`, which
 * cannot tell left from right, so it carries a side table and three synthetic
 * codes (500/501/502) to patch the difference back in. `event.code` names the
 * physical key outright, so none of that is needed here.
 *
 * That indirection is not hypothetical: the vendor's own newer build regressed
 * its table, mapping both Win keys and Menu onto the "Lock Win Key" *control*
 * code, Pause/PageUp/PageDown onto codes the board does not know, and the
 * backtick onto the apostrophe, while dropping ScrollLock entirely. Every
 * entry below is asserted against the device's keycode catalogue by the
 * protocol tests, so that cannot happen quietly here.
 *
 * Values are HID usage page 7 ids, which is what the board's `basic` band is.
 */

const rangeCodes = (
  prefix: string,
  names: readonly string[],
  first: number,
): Array<[string, number]> =>
  names.map((name, i) => [`${prefix}${name}`, first + i]);

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
/** HID orders the digit row 1-9 then 0, not 0-9. */
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const FUNCTION_KEYS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const HIGH_FUNCTION_KEYS = Array.from({ length: 12 }, (_, i) => String(i + 13));

export const CODE_TO_KEYCODE: Readonly<Record<string, number>> =
  Object.fromEntries([
    ...rangeCodes("Key", LETTERS, 4),
    ...rangeCodes("Digit", DIGITS, 30),
    ...rangeCodes("F", FUNCTION_KEYS, 58),
    ...rangeCodes("F", HIGH_FUNCTION_KEYS, 104),

    ["Enter", 40],
    ["Escape", 41],
    ["Backspace", 42],
    ["Tab", 43],
    ["Space", 44],
    ["Minus", 45],
    ["Equal", 46],
    ["BracketLeft", 47],
    ["BracketRight", 48],
    ["Backslash", 49],
    ["Semicolon", 51],
    ["Quote", 52],
    ["Backquote", 53],
    ["Comma", 54],
    ["Period", 55],
    ["Slash", 56],
    ["CapsLock", 57],

    ["PrintScreen", 70],
    ["ScrollLock", 71],
    ["Pause", 72],
    ["Insert", 73],
    ["Home", 74],
    ["PageUp", 75],
    ["Delete", 76],
    ["End", 77],
    ["PageDown", 78],
    ["ArrowRight", 79],
    ["ArrowLeft", 80],
    ["ArrowDown", 81],
    ["ArrowUp", 82],

    ["NumLock", 83],
    ["NumpadDivide", 84],
    ["NumpadMultiply", 85],
    ["NumpadSubtract", 86],
    ["NumpadAdd", 87],
    ["NumpadEnter", 88],
    ...rangeCodes("Numpad", ["1", "2", "3", "4", "5", "6", "7", "8", "9"], 89),
    ["Numpad0", 98],
    ["NumpadDecimal", 99],

    ["IntlBackslash", 100],
    ["ContextMenu", 101],

    // Modifiers, each side distinct — the whole reason to use `code`.
    ["ControlLeft", 224],
    ["ShiftLeft", 225],
    ["AltLeft", 226],
    ["MetaLeft", 227],
    ["ControlRight", 228],
    ["ShiftRight", 229],
    ["AltRight", 230],
    ["MetaRight", 231],
  ]);

/** The device keycode for a physical key, or null if the board has no name for it. */
export const keycodeForEvent = (event: KeyboardEvent): number | null =>
  CODE_TO_KEYCODE[event.code] ?? null;

/**
 * Keys the browser would otherwise swallow during a recording.
 *
 * `navigator.keyboard.lock` only honours these while the document is
 * fullscreen, and it is best-effort everywhere: without it Escape leaves the
 * page and Meta opens the OS menu, so those keys simply do not get recorded.
 */
export const LOCKABLE_CODES = [
  "Escape",
  "MetaLeft",
  "MetaRight",
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "Tab",
] as const;

/**
 * The Keyboard Lock API, which TypeScript's DOM library does not declare.
 *
 * Chromium-only and fullscreen-only, hence optional at every step: the
 * recorder treats it as a bonus, never a requirement.
 */
declare global {
  interface Navigator {
    readonly keyboard?: {
      lock(codes?: readonly string[]): Promise<void>;
      unlock(): void;
    };
  }
}
